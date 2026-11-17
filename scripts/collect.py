#!/usr/bin/env python3
"""종목별 자료 수집.

tickers.json 에 적힌 종목(과 비교 기준 종목)마다 아래 자료를 모아 data/t/<티커>.json 으로 저장합니다.
- 일별 종가와 배당 재투자 수정주가: Yahoo Finance
- 배당·분배 이력: Yahoo Finance(금액) + Nasdaq.com(기준일·지급일, 소수 자릿수가 더 많은 금액)
- 지급일 원/달러 환율: Yahoo Finance KRW=X 종가
- 종목 정보, ETF 상위 보유종목·섹터 비중: Yahoo Finance

한 종목이 실패해도 나머지는 계속하며, 실패한 종목은 기존 파일을 그대로 둡니다.
결과 요약은 data/index.json 의 log 에 남습니다.
"""
import datetime as dt
import json
import pathlib
import sys
import time
import traceback

import requests
import yfinance as yf

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TDIR = DATA / "t"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
KST = dt.timezone(dt.timedelta(hours=9))


def iso(d):
    return d.strftime("%Y-%m-%d")


def days_between(a, b):
    return abs((dt.date.fromisoformat(a) - dt.date.fromisoformat(b)).days)


# ---------------------------------------------------------------- 순수 계산 (시험 가능)
def split_factor(ex, splits):
    """ex 이후에 일어난 액면분할 비율의 곱. Nasdaq 원금액을 분할 반영 금액으로 바꿀 때 나눕니다."""
    f = 1.0
    for d, ratio in splits:
        if d > ex and ratio > 0:
            f *= ratio
    return f


def merge_dividends(yahoo, nasdaq, splits, since):
    """yahoo: [(ex, 금액)] 분할 반영. nasdaq: [{ex, record, pay, amount}] 원금액.
    Yahoo 를 기준으로 Nasdaq 의 지급일·기준일을 붙이고, 금액이 1% 안에서 일치하면 자릿수가 많은 Nasdaq 금액을 씁니다."""
    out, used = [], set()
    for ex, amt in yahoo:
        row = dict(ex=ex, record=None, pay=None, amount=round(amt, 6), source="Yahoo Finance")
        for i, n in enumerate(nasdaq):
            if i in used or days_between(n["ex"], ex) > 4:
                continue
            used.add(i)
            row["record"], row["pay"] = n.get("record"), n.get("pay")
            adj = n["amount"] / split_factor(n["ex"], splits)
            if amt > 0 and abs(adj / amt - 1) < 0.01:
                row["amount"], row["source"] = round(adj, 6), "Nasdaq.com"
            else:
                row["source"] = "Yahoo Finance (지급일: Nasdaq.com)"
            break
        out.append(row)
    last_y = yahoo[-1][0] if yahoo else ""
    for i, n in enumerate(nasdaq):  # Yahoo 에 아직 없는 최신 공시분
        if i not in used and n["ex"] > last_y and n["ex"] >= since:
            out.append(dict(ex=n["ex"], record=n.get("record"), pay=n.get("pay"),
                            amount=round(n["amount"] / split_factor(n["ex"], splits), 6), source="Nasdaq.com"))
    out.sort(key=lambda r: r["ex"])
    return out


def on_or_before(table, dates, day):
    """dates(정렬된 목록)에서 day 이하인 가장 가까운 날짜의 값을 돌려줍니다."""
    lo, hi = 0, len(dates) - 1
    if not dates or day < dates[0]:
        return None
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if dates[mid] <= day:
            lo = mid
        else:
            hi = mid - 1
    return table[dates[lo]]


def attach_close_fx(divs, prices, fx, today):
    close = {r[0]: r[1] for r in prices}
    pdates = [r[0] for r in prices]
    fdates = sorted(fx)
    for r in divs:
        r["close"] = close.get(r["ex"]) or (on_or_before(close, pdates, r["ex"]) if r["ex"] <= today else None)
        pay = r["pay"] or r["ex"]
        r["fx"] = on_or_before(fx, fdates, pay) if (fx and pay <= today) else None
    return divs


# ---------------------------------------------------------------- 수집
def fetch_history(sym, since):
    h = yf.Ticker(sym).history(start=since, auto_adjust=False, actions=True)
    h = h[h["Close"].notna()]
    if len(h) < 30:
        raise RuntimeError(f"가격 자료가 너무 적음({len(h)}행)")
    adj = h["Adj Close"] if "Adj Close" in h else h["Close"]
    prices = [[iso(d), round(float(c), 4), round(float(a), 4)] for d, c, a in zip(h.index, h["Close"], adj)]
    divs = [(iso(d), float(v)) for d, v in h["Dividends"].items() if v and v > 0] if "Dividends" in h else []
    splits = [(iso(d), float(v)) for d, v in h["Stock Splits"].items() if v and v > 0] if "Stock Splits" in h else []
    return prices, divs, splits


def fetch_nasdaq_dividends(sym, kinds):
    def mdy(s):
        try:
            return dt.datetime.strptime(s.strip(), "%m/%d/%Y").date().isoformat()
        except Exception:  # noqa: BLE001  'N/A' 등
            return None
    last, errs, summary = None, [], {}
    for kind in kinds:
        try:
            r = requests.get(f"https://api.nasdaq.com/api/quote/{sym}/dividends?assetclass={kind}",
                             headers={"User-Agent": UA, "Accept": "application/json, text/plain, */*",
                                      "Accept-Language": "en-US,en;q=0.9"}, timeout=25)
            data = r.json().get("data") or {}
            rows = ((data.get("dividends") or {}).get("rows")) or []
            ex0, pay0 = mdy(str(data.get("exDividendDate") or "")), mdy(str(data.get("dividendPaymentDate") or ""))
            if ex0 and not summary:
                summary.update(ex=ex0, pay=pay0, source="Nasdaq.com")
            out = []
            for x in rows:
                ex = mdy(x.get("exOrEffDate") or "")
                try:
                    amt = float(str(x.get("amount", "")).replace("$", "").replace(",", ""))
                except ValueError:
                    continue
                if ex and amt > 0:
                    out.append(dict(ex=ex, record=mdy(x.get("recordDate") or ""), pay=mdy(x.get("paymentDate") or ""), amount=amt))
            if out:
                return sorted(out, key=lambda r: r["ex"]), None, summary
            last = f"{kind}: 이력 없음"
            errs.append(last)
        except Exception as e:  # noqa: BLE001
            last = f"{kind}: {e}"
            errs.append(last)
        time.sleep(1)
    return [], " | ".join(errs), summary


def fetch_calendar(sym):
    """Yahoo Finance 일정: 다음(또는 최근) 배당락일과 지급일."""
    cal = yf.Ticker(sym).calendar or {}
    def d(v):
        if isinstance(v, (list, tuple)):
            v = v[0] if v else None
        if isinstance(v, dt.datetime):
            v = v.date()
        return v.isoformat() if isinstance(v, dt.date) else None
    ex, pay = d(cal.get("Ex-Dividend Date")), d(cal.get("Dividend Date"))
    return dict(ex=ex, pay=pay, source="Yahoo Finance") if ex else {}


def pick_schedule(cands, divs):
    """후보 일정에서 (다음 지급 예정, 배당락일→지급일 간격 일수)를 고릅니다."""
    last_ex = divs[-1]["ex"] if divs else ""
    lag, nxt = None, None
    for c in cands:
        if not c or not c.get("ex"):
            continue
        pay = c.get("pay")
        if pay and pay < c["ex"]:  # 지급일이 배당락일보다 앞이면 서로 다른 회차의 날짜
            pay = None
        if pay and lag is None and days_between(pay, c["ex"]) <= 75:
            lag = days_between(pay, c["ex"])
        if nxt is None and c["ex"] > last_ex and days_between(c["ex"], last_ex or c["ex"]) <= 400:
            nxt = dict(ex=c["ex"], pay=pay, source=c["source"])
    if lag is None:  # Nasdaq 이력에 지급일이 있으면 최근 간격의 중앙값
        gaps = sorted(days_between(r["pay"], r["ex"]) for r in divs[-12:] if r.get("pay") and r["pay"] >= r["ex"])
        lag = gaps[len(gaps) // 2] if gaps else None
    return nxt, lag


def fetch_info(sym):
    i = yf.Ticker(sym).info or {}
    def num(k):
        v = i.get(k)
        return v if isinstance(v, (int, float)) else None
    exp = num("netExpenseRatio")
    if exp is None and num("annualReportExpenseRatio") is not None:
        exp = num("annualReportExpenseRatio") * 100
    exd = num("exDividendDate")
    return dict(
        name=i.get("longName") or i.get("shortName") or sym,
        type=i.get("quoteType") or "",
        currency=i.get("currency") or "USD",
        expenseRatio=exp, aum=num("totalAssets"), nav=num("navPrice"), marketCap=num("marketCap"),
        payoutRatio=num("payoutRatio"), sector=i.get("sector"), industry=i.get("industry"),
        category=i.get("category"), family=i.get("fundFamily"),
        exDividendDate=dt.datetime.fromtimestamp(exd, dt.timezone.utc).date().isoformat() if exd else None,
    )


def fetch_fund(sym):
    fd = yf.Ticker(sym).funds_data
    top = []
    th = fd.top_holdings
    if th is not None and len(th):
        for symbol, row in th.iterrows():
            w = float(row.get("Holding Percent", 0) or 0) * 100
            top.append(dict(symbol=str(symbol), name=str(row.get("Name", symbol)), weight=round(w, 4)))
    sectors = {k: round(float(v) * 100, 4) for k, v in (fd.sector_weightings or {}).items() if v}
    assets = {k: round(float(v) * 100, 4) for k, v in (fd.asset_classes or {}).items() if v}
    if not top and not sectors:
        raise RuntimeError("보유종목·섹터 자료 없음")
    return dict(top=top, sectors=sectors, assets=assets)


def collect(sym, since, fx, today):
    notes = []
    prices, ydivs, splits = fetch_history(sym, since)
    try:
        info = fetch_info(sym)
    except Exception as e:  # noqa: BLE001
        info, _ = dict(name=sym, type="", currency="USD"), notes.append(f"종목 정보 실패: {e}")
    is_etf = (info.get("type") or "").upper() in ("ETF", "MUTUALFUND")
    ndivs, nerr, nsum = fetch_nasdaq_dividends(sym, ["etf", "stocks"] if is_etf or not info.get("type") else ["stocks", "etf"])
    if nerr:
        notes.append("Nasdaq.com에 지급일 이력이 없어(나스닥 상장 종목만 제공) 최근 배당락일→지급일 간격으로 지급일을 추정")
    divs = attach_close_fx(merge_dividends(ydivs, ndivs, splits, since), prices, fx, today)
    try:
        ycal = fetch_calendar(sym)
    except Exception as e:  # noqa: BLE001
        ycal, _ = {}, notes.append(f"Yahoo 일정 실패: {e}")
    nxt, lag = pick_schedule([nsum, ycal], divs)
    holdings = None
    if is_etf:
        try:
            holdings = fetch_fund(sym)
        except Exception as e:  # noqa: BLE001
            notes.append(f"보유종목 실패: {e}")
    return dict(symbol=sym, name=info.get("name") or sym, type=(info.get("type") or "").upper(), asOf=prices[-1][0],
                info=info, splits=splits, next=nxt, payLag=lag, dividends=divs, prices=prices, holdings=holdings), notes


def main():
    cfg = json.loads((ROOT / "tickers.json").read_text(encoding="utf-8"))
    since = cfg.get("since", "2006-01-01")
    tickers = [str(t).strip().upper() for t in cfg.get("tickers", []) if str(t).strip()]
    bench = [str(t).strip().upper() for t in cfg.get("benchmarks", []) if str(t).strip()]
    every = list(dict.fromkeys(tickers + bench))
    today = dt.datetime.now(KST).date().isoformat()
    TDIR.mkdir(parents=True, exist_ok=True)

    fx = {}
    try:
        h = yf.Ticker("KRW=X").history(start=since, auto_adjust=False)
        fx = {iso(d): round(float(v), 2) for d, v in h["Close"].items() if v == v and 500 < v < 3000}
    except Exception as e:  # noqa: BLE001
        print("환율 실패:", e)

    log, entries, changed = {}, [], []
    for sym in every:
        dst = TDIR / f"{sym}.json"
        old = json.loads(dst.read_text(encoding="utf-8")) if dst.exists() else None
        try:
            new, notes = collect(sym, since, fx, today)
            if old:
                if new["prices"][-1][0] < old["prices"][-1][0]:
                    raise RuntimeError("마지막 거래일이 기존보다 과거")
                if len(new["dividends"]) < len(old["dividends"]) - 1:
                    raise RuntimeError(f"배당 이력이 줄어듦({len(old['dividends'])}→{len(new['dividends'])})")
                if new["holdings"] is None and old.get("holdings"):
                    new["holdings"] = old["holdings"]
            if new != old:
                dst.write_text(json.dumps(new, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
                changed.append(sym)
            log[sym] = dict(ok=True, rows=len(new["prices"]), dividends=len(new["dividends"]), asOf=new["asOf"], notes=notes)
            cur = new
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            log[sym] = dict(ok=False, error=f"{type(e).__name__}: {e}")
            cur = old
        if cur:
            entries.append(dict(symbol=sym, name=cur["name"], type=cur["type"], asOf=cur["asOf"], listed=sym in tickers))
        print(sym, json.dumps(log[sym], ensure_ascii=False))
        time.sleep(1.5)

    idx_path = DATA / "index.json"
    old_idx = json.loads(idx_path.read_text(encoding="utf-8")) if idx_path.exists() else {}
    idx = dict(updated=old_idx.get("updated"), checked=today, since=since, fxSource="Yahoo Finance KRW=X 종가" if fx else None,
               tickers=[e for e in entries if e["listed"]], extra=[e for e in entries if not e["listed"]],
               benchmarks=[b for b in bench if any(e["symbol"] == b for e in entries)], log=log)
    if changed or not idx["updated"]:
        idx["updated"] = today
    for e in idx["tickers"] + idx["extra"]:
        e.pop("listed", None)
    idx_path.write_text(json.dumps(idx, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("바뀐 종목:", ", ".join(changed) or "없음")
    return 0 if any(v["ok"] for v in log.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
