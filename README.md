# 배당 트래커

미국 상장 배당주와 배당 ETF의 분배·배당 이력, 연간 합계와 증감률, 원화 환산, 주가와 재투자 총수익, ETF 상위 보유종목을 종목별로 보여 줍니다. 데이터는 GitHub Actions가 매일 자동으로 수집합니다.

## 종목 추가·삭제

`tickers.json`만 고치면 됩니다. 저장하면 수집이 바로 실행되고, 몇 분 뒤 화면에 반영됩니다.

```json
{
  "tickers": ["JEPQ", "JEPI", "SCHD", "QQQ", "SPY", "O", "KO"],
  "benchmarks": ["SPY", "QQQ", "SCHD"],
  "since": "2006-01-01"
}
```

- `tickers`: 화면 상단에서 선택할 종목(Yahoo Finance 티커)
- `benchmarks`: 총수익 비교 차트에 함께 그릴 기준 종목
- `since`: 수집 시작일

GitHub 웹이나 앱에서 이 파일을 열고 연필 아이콘으로 수정한 뒤 Commit하면 됩니다.

## 자동 갱신

- 매일 한국시간 07:40과 09:40에 `.github/workflows/update.yml`이 실행됩니다. `tickers.json`이나 `scripts/`를 고쳐도 실행됩니다.
- `scripts/collect.py`: 종목마다 종가·수정주가·배당금·종목 정보·ETF 상위 보유종목(Yahoo Finance), 기준일·지급일(Nasdaq.com), 원/달러 환율(Yahoo Finance KRW=X)을 수집해 `data/t/<티커>.json`에 저장합니다. 한 종목이 실패하면 그 종목만 기존 값을 유지하고, 결과는 `data/index.json`의 `log`에 남습니다.
- `scripts/sync_jepq.py`: JEPQ 전용 자료(전체 구성종목·ELN, 월별 비중 기록, 분배 일정·공식 수익률, 국내 ETF 비교)를 공개 저장소 [ttokjaetv/jepq-tracker](https://github.com/ttokjaetv/jepq-tracker)에서 받아 검증한 뒤 `data/jepq/`에 저장합니다. 이 부분만 원본 저장소에 의존하며, 원본이 멈추면 JEPQ 전용 섹션만 마지막 값에서 멈춥니다.
- GitHub은 60일 동안 저장소 활동이 없으면 예약 실행을 중지합니다. 데이터 커밋이 계속 생기는 동안에는 해당되지 않습니다.

## 화면 기준

- 연도와 월(또는 회차)은 지급일 기준입니다. 지급일 자료가 없는 건은 최근 배당락일과 지급일의 간격을 더해 지급일을 추정합니다. 다음 지급 예정일은 공시된 일정이 있으면 그 날짜를, 없으면 작년 같은 회차의 일정으로 추정한 날짜를 보여 줍니다.
- 지급 주기(월·분기·반기·연)는 최근 지급 이력으로 자동 판단합니다.
- 연간 증감률은 모든 회차가 확정된 해끼리만 계산합니다.
- 원화 환산은 지급일 Yahoo Finance 환율 종가를 사용하므로 은행 고시 환율과 1% 안팎 차이가 날 수 있습니다.

## GitHub Pages 설정 (처음 한 번)

저장소 **Settings → Pages**에서 Source를 `Deploy from a branch`, Branch를 `main` / `(root)`로 지정합니다. 주소는 `https://<계정>.github.io/<저장소 이름>/`입니다.

## 로컬에서 보기

폴더에서 `python -m http.server`를 실행한 뒤 http://localhost:8000 으로 접속합니다.

이 자료는 특정 종목의 매수·매도를 권유하지 않습니다.
