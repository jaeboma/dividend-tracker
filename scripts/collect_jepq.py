#!/usr/bin/env python3
"""JEPQ 전용 자료를 출처에서 직접 수집합니다. 설정은 저장소 루트의 jepq.json.

- 전체 구성종목·ELN 비중: J.P. Morgan 일별 보유종목 엑셀 → data/jepq/holdings.json
- 월별 비중 기록: 매월 처음 받은 보유종목을 한 줄씩 추가 → data/jepq/holdings_monthly.json
- 공식 수익률·NAV·발표된 최신 분배: J.P. Morgan 상품 데이터 → data/jepq/meta.json
- 분배 일정: J.P. Morgan Dividend Calendar PDF → data/jepq/meta.json
- 국내 유사 ETF 분배금: FunETF, 실부담비용: 금융투자협회 전자공시 → data/jepq/kr_etf.json

부분마다 따로 시도하며, 실패한 부분은 기존 값을 그대로 둡니다. 결과는 data/jepq/log.json 에 남습니다.
"""
import datetime as dt
import io
import json
import pathlib
import re
import sys
import time
import traceback
import warnings
import xml.etree.ElementTree as ET

import requests

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "jepq"
CFG = json.loads((ROOT / "jepq.json").read_text(encoding="utf-8"))
KST = dt.timezone(dt.timedelta(hours=9))
TODAY = dt.datetime.now(KST).date()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
JPM = "https://am.jpmorgan.com"
URL_DATA = f"{JPM}/FundsMarketingHandler/product-data?cusip={CFG['cusip']}&country=us&role=adv&language=en&userLoggedIn=false&version=6.0"
URL_HOLD = f"{JPM}/FundsMarketingHandler/excel?type=dailyETFHoldings&cusip={CFG['cusip']}&country=us&role=adv&fundType=N_ETF"
URL_CAL = JPM + "/content/dam/jpm-am-aem/americas/us/en/supplemental/income-distribution-rates/jpmorgan-etfs-{y}-distribution-notice.pdf"
URL_FUNETF = "https://www.funetf.co.kr/api/public/product/view/etfdividend?itemId={isin}"
URL_KOFIA = "https://dis.kofia.or.kr/proframeWeb/XMLSERVICES/"


def load(name, default=None):
    p = OUT / f"{name}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def save(name, obj, compact=False):
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":")) if compact else json.dumps(obj, ensure_ascii=False, indent=1)
    (OUT / f"{name}.json").write_text(text + "\n", encoding="utf-8")


def http_get(url, referer=None, accept="text/html,application/json,*/*", tries=3, timeout=40):
    headers = {"User-Agent": UA, "Accept": accept, "Accept-Language": "en-US,en;q=0.9,ko;q=0.8"}
    if referer:
        headers["Referer"] = referer
    last = None
    for i in range(tries):
        try:
            r = requests.get(url, headers=headers, timeout=timeout)
            if r.status_code == 200 and r.content:
                return r
            last = f"HTTP {r.status_code}"
        except Exception as e:  # noqa: BLE001
            last = str(e)
        time.sleep(2 * (i + 1))
    raise RuntimeError(f"요청 실패({last})")


def num(v):
    if v in (None, ""):
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    return float(str(v).replace(",", "").replace("%", "").replace("$", "").strip() or 0)


def to_iso(s):
    s = str(s or "").strip()[:10]
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return s
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", str(s).strip())
    if m:
        return dt.date(int(m.group(3)), int(m.group(1)), int(m.group(2))).isoformat()
    raise ValueError(f"날짜 형식을 알 수 없음: {s!r}")


# ---------------------------------------------------------------- 구성종목
def parse_holdings_xlsx(content):
    import openpyxl
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        sheet = openpyxl.load_workbook(io.BytesIO(content), read_only=True).active
        table = [list(r) for r in sheet.iter_rows(values_only=True)]
    as_of, head_at = None, None
    for n, row in enumerate(table[:25]):
        for cell in row:
            m = re.search(r"As of Date:\s*(\d{1,2}/\d{1,2}/\d{4})", str(cell or ""))
            if m:
                as_of = to_iso(m.group(1))
        if row and str(row[0] or "").strip() == "Ticker":
            head_at = n
            break
    if not as_of or head_at is None:
        raise RuntimeError("엑셀에서 기준일 또는 머리글 줄을 찾지 못함")
    col = {str(name).strip(): i for i, name in enumerate(table[head_at]) if name}
    for need in ("Ticker", "Security Description", "Security Type", "Shares/Par", "Market Value (USD)", "Sector"):
        if need not in col:
            raise RuntimeError(f"엑셀 머리글에 {need} 열이 없음")
    rows = []
    for r in table[head_at + 1:]:
        if not r or r[col["Market Value (USD)"]] in (None, ""):
            continue
        ticker = str(r[col["Ticker"]] or "").strip()
        desc = str(r[col["Security Description"]] or "").strip()
        if not (ticker or desc):
            continue
        kind_raw = str(r[col["Security Type"]] or "")
        sector = str(r[col["Sector"]] or "").strip()
        if re.search(r"equity linked", kind_raw, re.I):
            kind = "eln"
        elif re.search(r"money market|currenc|cash", kind_raw, re.I) or desc.upper() == "CASH":
            kind = "cash"
        else:
            kind = "stock" if sector else "other"
        rows.append(dict(symbol=ticker or desc, name=desc, type=kind, sector=sector,
                         shares=num(r[col["Shares/Par"]]), mv=round(num(r[col["Market Value (USD)"]]), 2)))
    return as_of, rows


def build_holdings(as_of, rows):
    total = sum(r["mv"] for r in rows)
    if total <= 0:
        raise RuntimeError("시장가치 합계가 0")
    items = sorted(({**r, "weight": round(r["mv"] / total * 100, 6)} for r in rows), key=lambda x: -x["weight"])
    part = lambda k: round(sum(i["weight"] for i in items if i["type"] == k), 4)
    count = lambda k: sum(1 for i in items if i["type"] == k)
    if count("stock") < 80 or count("eln") < 1:
        raise RuntimeError(f"주식 {count('stock')}종목·ELN {count('eln')}개 — 형식 확인 필요")
    return dict(asOf=as_of, basis="official", source="J.P. Morgan Asset Management JEPQ Daily Holdings (엑셀)",
                summary=dict(stock=part("stock"), eln=part("eln"), cash=part("cash"), other=part("other"),
                             stockCount=count("stock"), elnCount=count("eln"), totalMV=round(total, 2)),
                items=items)


def add_month(monthly, h):
    """그 달의 기록이 없을 때만 한 줄을 추가합니다. 주식은 [기호, 비중%, 주식 수], ELN·현금은 합계만."""
    month = h["asOf"][:7]
    if any(m["month"] == month for m in monthly["months"]):
        return False
    stocks = [i for i in h["items"] if i["type"] == "stock"]
    monthly["months"].append(dict(month=month, asOf=h["asOf"], basis="official", eln=h["summary"]["eln"],
                                  elnCount=h["summary"]["elnCount"], cash=h["summary"]["cash"],
                                  items=[[i["symbol"], round(i["weight"], 4), i["shares"]] for i in stocks]))
    monthly["months"].sort(key=lambda m: m["month"])
    for i in stocks:
        monthly.setdefault("names", {})[i["symbol"]] = [i["name"], i["sector"]]
    return True


def save_monthly(monthly):
    c = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
    head = {k: v for k, v in monthly.items() if k not in ("names", "months")}
    lines = ["{"] + [f"{c(k)}:{c(v)}," for k, v in head.items()] + ['"names":' + c(dict(sorted(monthly["names"].items()))) + ",", '"months":[']
    lines += [c(m) + ("," if n < len(monthly["months"]) - 1 else "") for n, m in enumerate(monthly["months"])]
    (OUT / "holdings_monthly.json").write_text("\n".join(lines + ["]}"]) + "\n", encoding="utf-8")


def part_holdings():
    old = load("holdings", {})
    as_of, rows = parse_holdings_xlsx(http_get(URL_HOLD, referer=CFG["page"]).content)
    msg = f"기준일 {as_of}"
    if as_of > old.get("asOf", ""):
        new = build_holdings(as_of, rows)
        save("holdings", new)
        old = new
        msg += " (갱신)"
    monthly = load("holdings_monthly") or dict(note="", names={}, months=[])
    if old.get("items") and add_month(monthly, old):
        save_monthly(monthly)
        msg += f", 월별 기록 {old['asOf'][:7]} 추가"
    return msg


# ---------------------------------------------------------------- 공식 수익률·발표 분배
def part_official(meta):
    j = http_get(URL_DATA, referer=CFG["page"], accept="application/json").json()
    fd = j.get("fundData") or {}
    sc = fd.get("shareClass") or {}
    if sc.get("cusip") != CFG["cusip"]:
        raise RuntimeError("상품 데이터의 CUSIP이 다름")
    sec, dy, nav = sc.get("etfSecYield") or {}, sc.get("dailyYield") or {}, sc.get("nav") or {}
    got = dict(sec_yield=dict(value=sec.get("thirtyDaySecYield"), asOf=sec.get("effectiveDate")),
               rolling_12m=dict(value=dy.get("twlvMthSimpleYield"), asOf=dy.get("effectiveDate")),
               dist_yield=dict(value=dy.get("dividendYield"), asOf=dy.get("effectiveDate")),
               nav=dict(value=nav.get("price"), asOf=nav.get("date")))
    for k, v in got.items():
        if v["value"] is None or not v["asOf"]:
            raise RuntimeError(f"{k} 값 없음")
        v["value"], v["asOf"] = round(float(v["value"]), 4), to_iso(v["asOf"])
        if k != "nav" and not 0.02 < v["value"] < 0.40:
            raise RuntimeError(f"{k} 값이 범위 밖: {v['value']}")
    exp = (sc.get("expenses") or {}).get("netExpense")
    if exp is not None:
        meta["jepq_fee"] = round(float(exp) / 100, 6)
    aum = fd.get("aum") or {}
    if aum.get("netAsset"):
        got["aum"] = dict(value=round(float(aum["netAsset"])), asOf=to_iso(aum.get("date")) if aum.get("date") else None)
    meta["official"] = dict(got, source="J.P. Morgan Asset Management JEPQ 상품 데이터", url=CFG["page"], checked=TODAY.isoformat())
    msg = f"SEC 수익률 기준일 {got['sec_yield']['asOf']}"
    d = sc.get("fundShareclassDividend") or {}
    if d.get("exDate") and d.get("dividendAmount"):
        meta["announced"] = dict(ex=to_iso(d["exDate"]), record=to_iso(d.get("recordDate") or d["exDate"]),
                                 pay=to_iso(d.get("payDate") or d["exDate"]), amount=round(float(d["dividendAmount"]), 6),
                                 source="J.P. Morgan 공식")
        msg += f", 발표 분배 {meta['announced']['ex']} ${meta['announced']['amount']}"
    return msg


# ---------------------------------------------------------------- 분배 일정
def parse_calendar(content):
    import pypdf
    text = "\n".join(p.extract_text() or "" for p in pypdf.PdfReader(io.BytesIO(content)).pages)
    block = next((b for b in re.split(r"(?=Monthly Distributing)", text) if f"({CFG['symbol']})" in b), None)
    if not block:
        raise RuntimeError("일정 PDF에서 종목이 속한 묶음을 찾지 못함")
    ex = re.search(r"Ex-Date/Record Date\s+([\d/ ]+)", block)
    pay = re.search(r"Pay Date\s+([\d/ ]+)", block)
    if not (ex and pay):
        raise RuntimeError("일정 PDF 형식이 바뀜")
    exs, pays = [to_iso(x) for x in ex.group(1).split()], [to_iso(x) for x in pay.group(1).split()]
    if len(exs) != len(pays) or len(exs) < 6:
        raise RuntimeError(f"일정 날짜 수가 맞지 않음({len(exs)}/{len(pays)})")
    capgain = "Capital Gains" in block.split("Ex-Date")[0]
    return [dict(ex=e, record=e, pay=p, kind="capgain" if capgain and n == len(exs) - 1 else "income")
            for n, (e, p) in enumerate(zip(exs, pays))]


def part_schedule(meta):
    sch = meta.setdefault("schedule", dict(rows=[]))
    have = {r["ex"][:4] for r in sch.get("rows", [])}
    added = []
    for y in (TODAY.year, TODAY.year + 1):
        if str(y) in have:
            continue
        url = URL_CAL.format(y=y)
        r = requests.get(url, headers={"User-Agent": UA}, timeout=40)
        if r.status_code != 200 or not r.content.startswith(b"%PDF"):
            continue  # 아직 공시 전
        rows = [x for x in parse_calendar(r.content) if x["ex"][:4] == str(y)]
        sch["rows"] = sorted([x for x in sch.get("rows", []) if x["ex"][:4] != str(y)] + rows, key=lambda x: x["ex"])
        sch.setdefault("urls", {})[str(y)] = url
        added.append(str(y))
    if added:
        sch["source"], sch["checked"] = "J.P. Morgan Exchange-Traded Fund Trust Dividend Calendar (PDF)", TODAY.isoformat()
    return f"보유 연도 {sorted(have | set(added))}" + (f", 추가 {added}" if added else "")


# ---------------------------------------------------------------- 국내 유사 ETF
def kr_base(kr):
    """jepq.json 의 종목 목록을 기준으로 틀을 맞춥니다(기존 이력·비용은 유지)."""
    etfs = kr.setdefault("etfs", {})
    kr["order"] = [e["code"] for e in CFG["kr"]]
    for e in CFG["kr"]:
        cur = etfs.setdefault(e["code"], dict(history=[]))
        cur.update(name=e["name"], isin=e["isin"], index=e.get("index"), timing=e.get("timing"), listed=e.get("listed"))
        cur.setdefault("fee", 0)
    return kr


def part_kr_dist(kr):
    got = []
    for e in CFG["kr"]:
        cur = kr["etfs"][e["code"]]
        rows = http_get(URL_FUNETF.format(isin=e["isin"]), referer="https://www.funetf.co.kr/").json()
        hist = {x[0]: x for x in cur["history"]}
        before = len(hist)
        for x in rows:
            day = str(x.get("gijunYmd") or "")
            if re.fullmatch(r"\d{8}", day) and x.get("divAmt") is not None and float(x["divAmt"]) > 0:
                hist[day] = [day, float(x["divAmt"]), float(x.get("divRt") or 0)]
        cur["history"] = [hist[d] for d in sorted(hist)]
        got.append(f"{e['code']} {len(hist)}건(+{len(hist) - before})")
        time.sleep(1)
    return ", ".join(got)


def kofia_costs(basis):
    body = ('<?xml version="1.0" encoding="utf-8"?><message><proframeHeader><pfmAppName>FS-DIS2</pfmAppName>'
            '<pfmSvcName>DISFundFeeCmsSO</pfmSvcName><pfmFnName>select</pfmFnName></proframeHeader><systemHeader></systemHeader>'
            f'<DISCondFuncDTO><tmpV30>{basis}</tmpV30><tmpV11></tmpV11><tmpV12>상장지수</tmpV12>'
            '<tmpV3></tmpV3><tmpV5></tmpV5><tmpV4></tmpV4></DISCondFuncDTO></message>')
    last = None
    for i in range(4):  # 응답이 커서 중간에 끊기는 경우가 있어 다시 시도
        try:
            r = requests.post(URL_KOFIA, data=body.encode("utf-8"), timeout=120,
                              headers={"Content-Type": "application/xml; charset=UTF-8", "User-Agent": UA})
            root = ET.fromstring(r.content.decode("utf-8"))
            break
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (i + 1))
    else:
        raise RuntimeError(f"KOFIA 조회 실패: {last}")
    out = {}
    for m in root.findall(".//selectMeta"):
        g = lambda t: ((m.find(t).text or "").strip() if m.find(t) is not None else "")
        if not g("tmpV2"):
            continue
        ter, sales, trade = num(g("tmpV12")), num(g("tmpV13")) + num(g("tmpV14")), num(g("tmpV16"))
        out[g("tmpV15")] = dict(total_fee=num(g("tmpV9")), other=num(g("tmpV11")), ter=ter, trading=trade, sales=sales,
                                real=round(ter + sales + trade, 4))
    return out


def part_kr_cost(kr):
    have = min(((kr["etfs"][e["code"]].get("cost") or {}).get("basis") or "0000-00-00") for e in CFG["kr"])
    last_month_end = TODAY.replace(day=1) - dt.timedelta(days=1)
    prev_month_end = last_month_end.replace(day=1) - dt.timedelta(days=1)
    days = []
    for end in (last_month_end, prev_month_end):  # 월말 기준, 약 한 달 뒤 공개 → 마지막 영업일 후보 4일씩
        if end.isoformat() <= have:
            break
        d, n = end, 0
        while n < 4:
            if d.weekday() < 5:
                days.append(d)
                n += 1
            d -= dt.timedelta(days=1)
    if not days:
        return f"최신({have})"
    for day in days:
        rows = kofia_costs(day.strftime("%Y%m%d"))
        if len(rows) < 500:  # 아직 공개 전이거나 휴일
            continue
        missing = [e["name"] for e in CFG["kr"] if e.get("kofia_code") not in rows]
        if missing:
            raise RuntimeError(f"KOFIA {day}에서 찾지 못한 종목: {', '.join(missing)}")
        for e in CFG["kr"]:
            row = rows[e["kofia_code"]]
            kr["etfs"][e["code"]]["cost"] = dict(basis=day.isoformat(), **row, kofia_code=e["kofia_code"])
            kr["etfs"][e["code"]]["fee"] = round(row["total_fee"] / 100, 6)
        kr["fee_source"] = f"KOFIA 금융투자협회 전자공시 {day.isoformat()}"
        return f"{day} 기준으로 갱신"
    return f"새 기준일 미공개(현재 {have})"


# ---------------------------------------------------------------- 실행
def main():
    OUT.mkdir(parents=True, exist_ok=True)
    meta = load("meta", {})
    kr = kr_base(load("kr_etf", {}))
    meta_before, kr_before = json.dumps(meta, sort_keys=True), json.dumps(kr, sort_keys=True)
    meta.update(names_ko=CFG["names_ko"], sectors_ko=CFG["sectors_ko"], withholding=0.15)
    meta.setdefault("jepq_fee", 0.0035)
    kr["cost_source"] = "KOFIA 금융투자협회 전자공시 펀드별 보수비용비교 (단위 %, 실부담비용 = 총보수 + 기타비용 + 매매·중개수수료 + 판매수수료)"

    parts = [("holdings", part_holdings), ("official", lambda: part_official(meta)), ("schedule", lambda: part_schedule(meta)),
             ("kr_dist", lambda: part_kr_dist(kr)), ("kr_cost", lambda: part_kr_cost(kr))]
    log = {}
    for name, fn in parts:
        try:
            log[name] = dict(ok=True, note=fn())
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            log[name] = dict(ok=False, error=f"{type(e).__name__}: {e}"[:300])
        print(name, json.dumps(log[name], ensure_ascii=False))

    if json.dumps(kr, sort_keys=True) != kr_before:
        save("kr_etf", kr)
    stable = lambda m: json.dumps({k: v for k, v in m.items() if k != "updated"}, sort_keys=True)
    if stable(meta) != stable(json.loads(meta_before)):
        meta["updated"] = TODAY.isoformat()
        save("meta", meta)
    save("log", dict(checked=TODAY.isoformat(), parts=log))
    return 0


if __name__ == "__main__":
    sys.exit(main())
