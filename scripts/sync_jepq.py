#!/usr/bin/env python3
"""JEPQ 전용 자료(전체 구성종목·ELN, 월별 비중 기록, 국내 ETF 비교, 분배 일정·공식 수익률)를
원본 공개 저장소(ttokjaetv/jepq-tracker)에서 받아 검증한 뒤, 바뀐 파일만 data/jepq/ 에 반영합니다.
분배 이력·주가 등 공통 자료는 scripts/collect.py 가 직접 수집하므로 여기서 받지 않습니다.

- 받은 파일은 JSON 으로만 읽고 실행하지 않습니다.
- 형식이 어긋나거나 기존보다 데이터가 줄어든 파일은 반영하지 않고 기존 값을 유지합니다.
- 표준 라이브러리만 사용합니다.
"""
import json
import pathlib
import subprocess
import sys
import tempfile

UPSTREAM = "https://github.com/ttokjaetv/jepq-tracker.git"
FILES = ["holdings", "holdings_monthly", "kr_etf", "meta"]
ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "jepq"
MAX_BYTES = 5 * 1024 * 1024


def strings(o):
    if isinstance(o, str):
        yield o
    elif isinstance(o, dict):
        for k, v in o.items():
            yield k
            yield from strings(v)
    elif isinstance(o, list):
        for v in o:
            yield from strings(v)


def need(cond, msg):
    if not cond:
        raise ValueError(msg)


def check(name, new, old):
    """형식과 '줄어들지 않음'을 확인합니다. 문제가 있으면 ValueError."""
    for s in strings(new):
        need("<" not in s and ">" not in s, f"허용하지 않는 문자(<, >)가 든 문자열: {s[:40]!r}")
    if name == "holdings":
        need(isinstance(new.get("items"), list) and len(new["items"]) >= 30, "구성종목이 너무 적음")
        need(isinstance(new.get("summary"), dict) and "asOf" in new, "구성종목 요약 없음")
        total = sum(x["weight"] for x in new["items"])
        need(99 < total < 101, f"비중 합계가 100%가 아님: {total:.2f}")
        if old:
            need(new["asOf"] >= old["asOf"], "구성종목 기준일이 기존보다 과거")
    elif name == "holdings_monthly":
        need(isinstance(new.get("months"), list) and new["months"], "월별 기록 없음")
        need(isinstance(new.get("names"), dict), "종목 이름표 없음")
        if old:
            need(len(new["months"]) >= len(old["months"]), "월별 기록이 기존보다 줄어듦")
    elif name == "kr_etf":
        need(isinstance(new.get("order"), list) and new["order"], "국내 ETF 목록 없음")
        for c in new["order"]:
            e = new["etfs"][c]
            need(isinstance(e.get("history"), list) and e["history"], f"{c} 분배 이력 없음")
            need(all(len(x) == 3 and x[1] > 0 for x in e["history"]), f"{c} 분배 행 형식 오류")
            if old and c in old.get("etfs", {}):
                need(len(e["history"]) >= len(old["etfs"][c]["history"]), f"{c} 분배 이력이 줄어듦")
    elif name == "meta":
        need(all(k in new for k in ("updated", "names_ko", "sectors_ko", "withholding")), "메타 필수 항목 없음")
        need(0 <= new["withholding"] < 1, "원천징수율 범위 밖")
        if old:
            need(new["updated"] >= old["updated"], "갱신일이 기존보다 과거")


def main():
    DATA.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["git", "clone", "--depth", "1", "--quiet", UPSTREAM, tmp], check=True, timeout=120)
        src = pathlib.Path(tmp) / "data"
        changed, problems = [], []
        for name in FILES:
            try:
                f = src / f"{name}.json"
                need(f.is_file() and not f.is_symlink(), "파일 없음")
                raw = f.read_bytes()
                need(len(raw) <= MAX_BYTES, "파일이 너무 큼")
                new = json.loads(raw.decode("utf-8"))
                dst = DATA / f"{name}.json"
                old = json.loads(dst.read_text(encoding="utf-8")) if dst.exists() else None
                check(name, new, old)
                if new != old:
                    dst.write_text(json.dumps(new, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
                    changed.append(name)
            except Exception as e:  # noqa: BLE001  한 파일이 실패해도 나머지는 계속
                problems.append(f"{name}: {e}")
    print("바뀐 파일:", ", ".join(changed) or "없음")
    for p in problems:
        print("반영하지 않음 →", p)
    out = ROOT / ".run"
    out.mkdir(exist_ok=True)
    if problems:
        (out / "errors.md").write_text("다음 파일은 검증을 통과하지 못해 기존 값을 유지했습니다.\n\n" + "\n".join(f"- {p}" for p in problems) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
