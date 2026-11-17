/* JEPQ 분배 트래커 — 화면 로직. data/*.json 을 읽어 모든 수치를 계산해 그립니다. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pad2 = n => String(n).padStart(2, '0');
const usd = (v, d = 4) => '$' + (Math.round((v + (v >= 0 ? 1e-12 : -1e-12)) * 10 ** d) / 10 ** d).toFixed(d);
const pct = (v, d = 2) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(d) + '%';
const won = v => Math.round(v).toLocaleString('ko-KR') + '원';
const won1 = v => v.toLocaleString('ko-KR', {minimumFractionDigits: 1, maximumFractionDigits: 1}) + '원';
const tone = v => v > 0.00005 ? 'up' : v < -0.00005 ? 'down' : 'flat';
const dot = s => s.slice(0, 4) + '.' + s.slice(5, 7) + '.' + s.slice(8, 10);
const titleCase = s => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const sum = (a, f = x => x) => a.reduce((s, x) => s + f(x), 0);
const yearsBack = (iso, n) => (+iso.slice(0, 4) - n) + iso.slice(4);
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
const yearSpan = (a, b) => (Date.parse(b) - Date.parse(a)) / (365.25 * 864e5);

/* ---------- 공용 툴팁 ---------- */
const tipEl = $('tip');
function showTip(html, x, y) {
  tipEl.innerHTML = html; tipEl.hidden = false;
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let l = x + 12; if (l + w > innerWidth - 8) l = x - 12 - w; if (l < 8) l = 8;
  let t = y - h - 12; if (t < 8) t = y + 18;
  tipEl.style.left = l + 'px'; tipEl.style.top = t + 'px';
}
const hideTip = () => { tipEl.hidden = true; };
document.addEventListener('pointerover', e => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  if (t) showTip(t.dataset.tip, e.clientX, e.clientY);
  else if (!(e.target.closest && e.target.closest('.xh'))) hideTip();
});
addEventListener('scroll', hideTip, {passive: true});

/* ---------- 차트 공용 ---------- */
const redraws = [];
const niceStep = raw => { const p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };
const barPath = (x, y, w, h, down) => {
  const r = Math.min(3, w / 2, h);
  return down
    ? `M${x} ${y}V${y + h - r}Q${x} ${y + h} ${x + r} ${y + h}H${x + w - r}Q${x + w} ${y + h} ${x + w} ${y + h - r}V${y}Z`
    : `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
};
const EST_ATTR = 'fill="var(--est)" stroke="var(--accent)" stroke-width="1" stroke-dasharray="4 3"';
const setSvg = (host, W, H, body, label, cls = '') => {
  host.innerHTML = `<svg class="${cls}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${body}</svg>`;
  return host.firstChild;
};
const hostW = host => Math.max(280, Math.floor(host.clientWidth));
const avgLine = (x1, x2, y) => `<line x1="${x1}" x2="${x2}" y1="${y}" y2="${y}" stroke="var(--ink2)" stroke-width="1.5" stroke-dasharray="6 4"/>`;

/* 선 그래프: 날짜 축, 여러 계열, 끝 라벨, 십자선 툴팁 */
function lineChart(host, o) {
  const W = hostW(host), H = o.height || 300, narrow = W < 560;
  const pl = 46, pr = narrow ? o.pr[0] : o.pr[1], pt = 14, pb = 26;
  const n = o.dates.length, T = o.dates.map(d => Date.parse(d));
  const step = Math.max(1, Math.ceil(n / Math.min(700, W))), idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  let lo = Infinity, hi = -Infinity;
  o.series.forEach(s => idx.forEach(i => { const v = s.vals[i]; if (v < lo) lo = v; if (v > hi) hi = v; }));
  if (o.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const st = niceStep((hi - lo || 1) / (narrow ? 4 : 6));
  const g0 = Math.floor(lo / st + 1e-9), g1 = Math.max(g0 + 1, Math.ceil(hi / st - 1e-9));
  lo = g0 * st; hi = g1 * st;
  const t0 = T[0], t1 = T[n - 1];
  const X = t => pl + (W - pl - pr) * (t - t0) / (t1 - t0), Y = v => pt + (H - pt - pb) * (hi - v) / (hi - lo);
  let s = '';
  for (let g = g0; g <= g1; g++) {
    const y = Y(g * st);
    s += `<line class="${o.zero && g === 0 ? 'zero' : 'grid'}" x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"/><text x="${pl - 6}" y="${y + 4}" text-anchor="end">${o.fmtY(g * st)}</text>`;
  }
  const days = (t1 - t0) / 864e5, maxTicks = narrow ? 5 : 10, d0 = new Date(t0);
  const ticks = [];
  if (days <= 500) {
    let y = d0.getUTCFullYear(), m = d0.getUTCMonth() + 1;
    for (let k = 0; k < 24; k++) { m++; if (m > 12) { m = 1; y++; } const t = Date.UTC(y, m - 1, 1); if (t > t1) break; ticks.push([t, `${String(y).slice(2)}.${pad2(m)}`]); }
  } else {
    for (let y = d0.getUTCFullYear() + 1; Date.UTC(y, 0, 1) <= t1; y++) ticks.push([Date.UTC(y, 0, 1), `'${String(y).slice(2)}`]);
  }
  const every = Math.max(1, Math.ceil(ticks.length / maxTicks));
  ticks.forEach(([t, l], i) => { if (i % every) return; const x = X(t);
    s += `<line class="grid" stroke-dasharray="2 4" x1="${x}" x2="${x}" y1="${pt}" y2="${H - pb}"/><text x="${x}" y="${H - pb + 16}" text-anchor="middle">${l}</text>`; });
  if (o.area) { const a = o.series[o.area - 1];
    s += `<path d="${idx.map((i, k) => `${k ? 'L' : 'M'}${X(T[i]).toFixed(1)} ${Y(a.vals[i]).toFixed(1)}`).join('')}L${X(t1)} ${H - pb}L${pl} ${H - pb}Z" fill="${a.color}" opacity=".07"/>`; }
  o.series.forEach(se => { s += `<path d="${idx.map((i, k) => `${k ? 'L' : 'M'}${X(T[i]).toFixed(1)} ${Y(se.vals[i]).toFixed(1)}`).join('')}" fill="none" stroke="${se.color}" stroke-width="${se.width || 2}" stroke-linejoin="round" stroke-linecap="round"/>`; });
  const lx = X(t1);
  o.series.forEach(se => { s += `<circle cx="${lx}" cy="${Y(se.vals[n - 1])}" r="${se.hero ? 4.5 : 4}" fill="${se.color}" stroke="var(--surface)" stroke-width="2"/>`; });
  const labs = o.series.map(se => ({se, y: Y(se.vals[n - 1])})).sort((a, b) => a.y - b.y);
  labs.forEach((a, i) => { a.y = Math.max(a.y, i ? labs[i - 1].y + 14 : pt + 4); });
  for (let i = labs.length - 1; i >= 0; i--) labs[i].y = Math.min(labs[i].y, i < labs.length - 1 ? labs[i + 1].y - 14 : H - pb);
  labs.forEach(a => { s += `<rect x="${lx + 8}" y="${a.y - 4}" width="8" height="8" rx="2" fill="${a.se.color}"/><text x="${lx + 20}" y="${a.y + 4}" class="lab"${a.se.hero ? ' style="font-weight:700"' : ' style="font-weight:500"'}>${esc(a.se.end(a.se.vals[n - 1]))}</text>`; });
  s += `<line class="cross" x1="0" x2="0" y1="${pt}" y2="${H - pb}" stroke="var(--muted)" visibility="hidden"/>`;
  const svg = setSvg(host, W, H, s, o.label, 'xh'), cross = svg.querySelector('.cross');
  const move = e => {
    const b = svg.getBoundingClientRect(), x = (e.clientX - b.left) * W / b.width;
    if (x < pl - 4 || x > W - pr + 4) return leave();
    const t = t0 + (Math.min(Math.max(x, pl), W - pr) - pl) / (W - pl - pr) * (t1 - t0);
    let a = 0, z = n - 1; while (z - a > 1) { const m = (a + z) >> 1; if (T[m] <= t) a = m; else z = m; }
    const i = (t - T[a] > T[z] - t) ? z : a, cx = X(T[i]);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    showTip(o.tip(i), b.left + cx * b.width / W, b.top + 40);
  };
  const leave = () => { cross.setAttribute('visibility', 'hidden'); hideTip(); };
  svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move); svg.addEventListener('pointerleave', leave);
}

/* 도넛: TOP 10 주식(순위별 농도) + ELN + 기타 */
function donutSVG(segs, topSum, eln, other) {
  const cx = 150, cy = 150, R1 = 130, R0 = 86; let a0 = -Math.PI / 2, s = '';
  const P = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  segs.forEach(g => {
    if (g.v <= 0) return;
    const a1 = a0 + 2 * Math.PI * g.v / 100, lg = (a1 - a0) > Math.PI ? 1 : 0;
    const [x1, y1] = P(R1, a0), [x2, y2] = P(R1, a1), [x3, y3] = P(R0, a1), [x4, y4] = P(R0, a0);
    s += `<path d="M${x1} ${y1}A${R1} ${R1} 0 ${lg} 1 ${x2} ${y2}L${x3} ${y3}A${R0} ${R0} 0 ${lg} 0 ${x4} ${y4}Z" fill="${g.c}" stroke="var(--surface)" stroke-width="2" data-tip="${esc(`<b>${esc(g.n)}</b><br>${g.v.toFixed(2)}%`)}"/>`;
    a0 = a1;
  });
  return `<svg viewBox="0 0 300 300" role="img" aria-label="상위 10종목, ELN, 기타 비중 도넛 차트">${s}` +
    `<text x="${cx}" y="${cy - 20}" text-anchor="middle" style="font-size:12px">TOP 10 주식</text>` +
    `<text x="${cx}" y="${cy + 8}" text-anchor="middle" class="lab" style="font-size:26px;font-weight:700">${topSum.toFixed(2)}%</text>` +
    `<text x="${cx}" y="${cy + 28}" text-anchor="middle" style="font-size:11px">ELN ${eln.toFixed(2)}% · 기타 ${other.toFixed(2)}%</text></svg>`;
}

/* ---------- 종목 목록과 데이터 읽기 ---------- */
const SECTOR_KO = {technology: '정보기술', consumer_cyclical: '경기소비재', communication_services: '커뮤니케이션', healthcare: '헬스케어',
  consumer_defensive: '필수소비재', industrials: '산업재', financial_services: '금융', utilities: '유틸리티', basic_materials: '소재', energy: '에너지', realestate: '부동산'};
const TYPE_KO = {ETF: 'ETF', EQUITY: '주식', MUTUALFUND: '펀드'};
const cache = new Map();
const getJSON = p => { if (!cache.has(p)) cache.set(p, fetch(p, {cache: 'no-cache'}).then(r => { if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); }).catch(e => { cache.delete(p); throw e; })); return cache.get(p); };
let IDX = null, TEMPLATE = '', current = null;
const fail = msg => { $('app').innerHTML = `<p class="err">${msg}</p>`; };

async function boot() {
  TEMPLATE = $('app').innerHTML;
  try { IDX = await getJSON('data/index.json'); }
  catch (e) { return fail('아직 수집된 데이터가 없습니다. 저장소의 Actions 탭에서 데이터 자동 갱신이 끝난 뒤 다시 열어 주십시오. 로컬에서는 폴더에서 <code>python -m http.server</code>를 실행한 뒤 접속해야 합니다.'); }
  if (!IDX.tickers || !IDX.tickers.length) return fail('tickers.json에 종목이 없거나 수집에 모두 실패하였습니다.');
  $('picker').innerHTML = IDX.tickers.map(t => `<button type="button" data-s="${esc(t.symbol)}" aria-pressed="false"><b>${esc(t.symbol)}</b><span>${esc(t.name)}</span></button>`).join('');
  $('picker').addEventListener('click', e => { const b = e.target.closest('button'); if (b) location.hash = b.dataset.s; });
  addEventListener('hashchange', route);
  let lastW = $('app').clientWidth, timer;
  new ResizeObserver(() => { const w = $('app').clientWidth; if (w === lastW) return; lastW = w; clearTimeout(timer); timer = setTimeout(() => redraws.forEach(f => f()), 80); }).observe($('app'));
  route();
}
function route() {
  const want = decodeURIComponent(location.hash.slice(1)).toUpperCase();
  const sym = IDX.tickers.some(t => t.symbol === want) ? want : IDX.tickers[0].symbol;
  if (sym !== current) show(sym);
}
async function show(sym) {
  current = sym;
  document.querySelectorAll('#picker button').forEach(b => { const on = b.dataset.s === sym; b.setAttribute('aria-pressed', on); if (on && b.scrollIntoView) b.scrollIntoView({block: 'nearest', inline: 'nearest'}); });
  try {
    const T = await getJSON(`data/t/${sym}.json`);
    const bsyms = (IDX.benchmarks || []).filter(b => b !== sym);
    const bench = (await Promise.all(bsyms.map(b => getJSON(`data/t/${b}.json`).catch(() => null)))).filter(Boolean);
    let EXT = null;
    if (sym === 'JEPQ') {
      const [hold, hm, kr, meta] = await Promise.all(['holdings', 'holdings_monthly', 'kr_etf', 'meta'].map(n => getJSON(`data/jepq/${n}.json`).catch(() => null)));
      if (hold && meta) EXT = {hold, hm, kr, meta};
    }
    if (current !== sym) return;
    hideTip(); redraws.length = 0; $('app').innerHTML = TEMPLATE;
    render(T, bench, EXT);
  } catch (e) { console.error(e); if (current === sym) fail(`${esc(sym)} 데이터를 불러오지 못했습니다(${esc(e.message)}).`); }
}

/* 분배 주기(연간 횟수) 추정 */
function detectFreq(rows) {
  const snap = c => c >= 9 ? 12 : c >= 3 ? 4 : c >= 1.5 ? 2 : 1;
  if (rows.length < 2) return 12;
  const ys = [...new Set(rows.map(r => r.y))], inner = ys.filter(y => y > ys[0] && y < ys[ys.length - 1]).slice(-3);
  if (inner.length) { const c = inner.map(y => rows.filter(r => r.y === y).length).sort((a, b) => a - b); return snap(c[Math.floor(c.length / 2)]); }
  const last = rows.slice(-13), gap = (Date.parse(last[last.length - 1].date) - Date.parse(last[0].date)) / 864e5 / (last.length - 1);
  return gap < 45 ? 12 : gap < 135 ? 4 : gap < 270 ? 2 : 1;
}

function render(T, BENCH, EXT) {
  const SYM = T.symbol, INFO = T.info || {}, isStock = T.type === 'EQUITY', DV = isStock ? '배당' : '분배';
  const RATE = isStock ? '배당률' : '분배율';
  const WHT = 0.15, PR = T.prices, pNow = PR[PR.length - 1], p0 = PR[0];
  const listedInRange = IDX.since ? p0[0] > yearsBack(IDX.since, 0).slice(0, 4) + '-03-01' || p0[0].slice(0, 4) > IDX.since.slice(0, 4) : true;
  const sinceLabel = listedInRange ? '상장 이후' : `${p0[0].slice(0, 4)}년 이후`;
  document.querySelectorAll('.dv').forEach(el => { el.textContent = DV; });
  document.title = `${SYM} ${DV} 트래커`;
  $('title').textContent = `${SYM} ${DV} 트래커`;
  $('eyebrow').textContent = `${T.name}${TYPE_KO[T.type] ? ' · ' + TYPE_KO[T.type] : ''}`;
  $('prange').lastElementChild.textContent = listedInRange ? '상장 이후' : '전체';

  /* ----- 분배 기본 계산: 연·월은 지급일 기준(지급일이 없으면 배당락일) ----- */
  const LAG = T.payLag != null ? T.payLag : 5;
  const merged = [];
  T.dividends.forEach(x => {
    const date = x.pay || addDays(x.ex, LAG), y = +date.slice(0, 4), m = +date.slice(5, 7), p = merged[merged.length - 1];
    if (p && p.y === y && p.m === m) { p.amt += x.amount; p.pay = x.pay || p.pay; p.date = date; p.krw = p.krw != null && x.fx ? p.krw + x.amount * x.fx : null; p.fx = x.fx || p.fx; p.multi = true; }
    else merged.push({ex: x.ex, record: x.record, pay: x.pay, date, amt: x.amount, close: x.close, fx: x.fx, src: x.source, y, m, krw: x.fx ? x.amount * x.fx : null});
  });
  const R = merged;
  if (!R.length) { $('app').innerHTML = `<header class="top"><div><div class="eyebrow">${esc(T.name)}</div><h1>${esc(SYM)} ${DV} 트래커</h1></div></header><p class="err">${esc(SYM)}은(는) 수집 기간(${esc(IDX.since || '')} 이후)에 ${DV} 이력이 없어 분석할 내용이 없습니다.</p>`; return; }
  const N = detectFreq(R), monthly = N === 12;
  const years = [...new Set(R.map(r => r.y))];
  years.forEach((y, yi) => { const rs = R.filter(r => r.y === y); rs.forEach((r, i) => { r.slot = monthly ? r.m : (yi === 0 && rs.length < N ? N - rs.length + i + 1 : i + 1); }); });
  const NS = Math.max(N, ...R.map(r => r.slot));
  const slotName = s => monthly ? `${s}월` : `${s}회차`;
  const slotsText = a => monthly ? a.join('·') + '월' : a.join('·') + '회차';
  const perLabel = r => monthly ? `${r.y}년 ${r.m}월` : `${r.y}년 ${r.slot}회차(${r.m}월)`;
  const ym = r => `${r.y}.${pad2(r.m)}`;
  const PREV = monthly ? '전월' : '직전 회차', SAME = monthly ? '전년 같은 달' : '전년 같은 회차';
  const find = (y, s) => R.find(r => r.y === y && r.slot === s);
  R.forEach((r, i) => {
    r.mom = i > 0 ? r.amt / R[i - 1].amt - 1 : null;
    const p = find(r.y - 1, r.slot); r.yoy = p ? r.amt / p.amt - 1 : null;
    r.ttm = i >= N - 1 ? sum(R.slice(i - N + 1, i + 1), x => x.amt) : null;
    r.yld = r.ttm && r.close ? r.ttm / r.close : null;
  });
  const A = years.map(y => { const rs = R.filter(r => r.y === y); return {y, n: rs.length, tot: sum(rs, r => r.amt)}; });
  A.forEach((a, i) => { const p = A[i - 1]; a.g = (p && a.n >= N && p.n >= N) ? a.tot / p.tot - 1 : null; });
  const byY = y => A.find(a => a.y === y);
  const FIRSTY = A[0].y, L = R[R.length - 1], curY = A[A.length - 1];
  const full = A.filter(a => a.n >= N && !(a === curY && (monthly ? L.m < 12 : false))), lastFull = full[full.length - 1] || null;
  const ytdPrev = sum(R.filter(r => r.y === L.y - 1 && r.slot <= L.slot), r => r.amt);
  const ytdCur = sum(R.filter(r => r.y === L.y), r => r.amt);
  const lastSame = find(L.y - 1, L.slot);
  const lastYld = [...R].reverse().find(r => r.yld != null);

  /* 예상: 진행 중인 해의 남은 회차 = 그해 확정분 평균 */
  const EST = {};
  if (curY.n < N && L.slot < N) {
    EST.y = curY.y; EST.avg = curY.tot / curY.n; EST.ms = [];
    for (let s = L.slot + 1; s <= N; s++) EST.ms.push(s);
    EST.add = EST.avg * EST.ms.length; EST.total = curY.tot + EST.add;
    const p = byY(curY.y - 1); EST.g = p && p.n >= N ? EST.total / p.tot - 1 : null;
  }

  /* ----- 머리글 · 최신 분배 ----- */
  $('rangeTxt').textContent = `${ym(R[0])} ~ ${ym(L)} 지급분`;
  $('updTxt').textContent = IDX.updated || T.asOf;
  $('latestLbl').textContent = `최신 ${DV} · ${perLabel(L)} 지급분`;
  $('latestAmt').innerHTML = `${usd(L.amt, 5)}<span>1주당</span>`;
  $('latestChips').innerHTML =
    (L.mom != null ? `<span class="chip ${tone(L.mom)}">${PREV} 대비 ${pct(L.mom)}</span>` : '') +
    (L.yoy != null ? `<span class="chip ${tone(L.yoy)}">${SAME} 대비 ${pct(L.yoy)}</span>` : '') +
    (lastSame ? `<span class="chip">작년 ${slotName(L.slot)} ${usd(lastSame.amt, 5)}</span>` : '');
  const SCH = (EXT && EXT.meta.schedule && EXT.meta.schedule.rows) || [];
  const nx = SCH.find(r => r.ex > L.ex && r.kind !== 'capgain'), cg = SCH.find(r => r.ex > L.ex && r.kind === 'capgain');
  /* 다음 지급 예정: ① JPMorgan 분배 일정(JEPQ) ② 공시된 다음 배당락일 ③ 작년 같은 회차 일정으로 추정 */
  let NX = null;
  if (nx) NX = {ex: nx.ex, pay: nx.pay, tag: '금액 미발표', cap: `JPMorgan ${nx.ex.slice(0, 4)}년 분배 일정 기준이며 날짜는 변경될 수 있습니다.${cg ? ` 자본이득 분배 예정일은 ${cg.ex}이며, 자본이득이 없으면 지급되지 않습니다.` : ''}`};
  else if (T.next && T.next.ex > L.ex) NX = {ex: T.next.ex, pay: T.next.pay, payEst: T.next.pay ? null : addDays(T.next.ex, LAG), tag: '금액 미발표',
    cap: `${esc(T.next.source)} 기준이며 날짜는 변경될 수 있습니다.${T.next.pay ? '' : ' 지급일은 최근 배당락일과 지급일의 간격으로 추정하였습니다.'}`};
  else if (R.length >= N) { const b = R[R.length - N], shift = d => yearsBack(d, -1);
    NX = {ex: shift(b.ex), pay: null, payEst: shift(b.pay || b.date), tag: '일정 추정', est: true, cap: '아직 공시되지 않아 작년 같은 회차의 일정으로 추정한 날짜이며, 실제 일정과 며칠 차이가 날 수 있습니다.'}; }
  if (NX) { const pd = NX.pay || NX.payEst || NX.ex;
    $('nextDiv').innerHTML = `<div class="nh"><b>다음 ${DV}(예정)</b><span>${pd.slice(0, 4)}년 ${+pd.slice(5, 7)}월 지급분</span><span class="tbd">${NX.tag}</span></div>
       <dl class="kv2"><div><dt>배당락일${NX.est ? '(추정)' : ''}</dt><dd>${NX.ex}</dd></div><div><dt>지급일${NX.pay ? '' : '(추정)'}</dt><dd>${NX.pay || NX.payEst}</dd></div></dl>
       <span class="cap">${NX.cap}</span>`; }
  else $('nextDiv').hidden = true;
  $('latestKv').innerHTML = [
    ['배당락일', L.ex], [L.pay ? '지급일' : '지급일(추정)', L.pay || L.date], ['배당락일 종가', L.close ? usd(L.close, 2) : '배당락 후 표시'],
    [`TTM ${DV}(최근 ${N}회)`, L.ttm ? usd(L.ttm) : '-'],
    [`12개월 ${RATE}(배당락일 종가)`, L.yld ? (L.yld * 100).toFixed(2) + '%' : (lastYld ? `${(lastYld.yld * 100).toFixed(2)}%<small>${ym(lastYld)} 지급분 기준</small>` : '-')],
    ['지급일 환율', L.fx ? won1(L.fx) : '지급 예정'],
    ['1주 원화 세전', L.krw ? won1(L.krw) : '지급 후 표시'], ['1주 원화 세후', L.krw ? won1(L.krw * (1 - WHT)) : '지급 후 표시'], ['100주 세후', L.krw ? won(L.krw * (1 - WHT) * 100) : '지급 후 표시']
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  const O = EXT && EXT.meta.official;
  if (O && O.sec_yield) {
    const yv = x => (x.value * 100).toFixed(2) + '%';
    $('offi').innerHTML = `<p class="oh">JPMORGAN 공식 수익률</p><dl class="kv">
      <div><dt>30일 SEC 수익률</dt><dd>${yv(O.sec_yield)}<small>${O.sec_yield.asOf} 기준</small></dd></div>
      ${O.rolling_12m ? `<div><dt>12개월 롤링 분배수익률</dt><dd>${yv(O.rolling_12m)}<small>${O.rolling_12m.asOf} 기준</small></dd></div>` : ''}
      ${O.nav ? `<div><dt>NAV</dt><dd>${usd(O.nav.value, 2)}<small>${O.nav.asOf} 기준</small></dd></div>` : ''}</dl>
      <span class="cap">위쪽의 12개월 분배율(배당락일 종가)과는 계산 방식과 기준일이 달라 수치가 다릅니다. 30일 SEC 수익률은 최근 30일 순투자수익(보수 차감)을 연율로 환산한 표준 공시 수치이고, 12개월 롤링 분배수익률은 JPMorgan이 최근 12개월 분배금으로 계산하여 공시하는 값입니다.</span>`;
    $('offi').hidden = false;
  } else {
    const big = v => v >= 1e12 ? `${(v / 1e12).toFixed(2)}조 달러` : `${Math.round(v / 1e8).toLocaleString('ko-KR')}억 달러`;
    const items = [
      INFO.expenseRatio != null ? ['총보수', INFO.expenseRatio.toFixed(2) + '%'] : null,
      INFO.aum ? ['순자산', big(INFO.aum)] : null, INFO.marketCap ? ['시가총액', big(INFO.marketCap)] : null,
      INFO.nav ? ['NAV', usd(INFO.nav, 2)] : null, INFO.payoutRatio ? ['배당성향', (INFO.payoutRatio * 100).toFixed(0) + '%'] : null,
      INFO.family ? ['운용사', esc(INFO.family)] : null, INFO.category ? ['분류', esc(INFO.category)] : null,
      INFO.sector ? ['섹터', esc(INFO.sector)] : null, INFO.industry ? ['업종', esc(INFO.industry)] : null].filter(Boolean);
    if (items.length) { $('offi').innerHTML = `<p class="oh">종목 정보 (YAHOO FINANCE)</p><dl class="kv">${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`; $('offi').hidden = false; }
  }
  $('latestSrc').textContent = `금액 출처: ${L.src}${L.multi ? ' (같은 달 지급분 합산)' : ''}. 원화 금액은 지급일${L.pay ? '' : '(자료가 없어 배당락일)'} 원/달러 환율(${IDX.fxSource || 'Yahoo Finance'})로 환산한 참고값입니다. 실제 세후 입금액은 환전 시점과 증권사 수수료에 따라 달라지므로 증권사 거래내역으로 확인해 주십시오.`;

  /* ----- 요약 타일 8개 ----- */
  const miniBars = (vals, colorOf, tips) => {
    const W = 100, H = 36, n = vals.length, mx = Math.max(...vals.map(Math.abs)) || 1, neg = vals.some(v => v < 0), base = neg ? H / 2 : H, sc = neg ? H / 2 - 1 : H - 1, bw = W / n;
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${vals.map((v, i) => { const h = Math.max(Math.abs(v) / mx * sc, .8);
      return `<rect x="${i * bw + bw * .15}" y="${v >= 0 ? base - h : base}" width="${bw * .7}" height="${h}" fill="${colorOf(v, i)}" data-tip="${esc(tips[i])}"/>`; }).join('')}${neg ? `<line class="grid" x1="0" x2="${W}" y1="${base}" y2="${base}" vector-effect="non-scaling-stroke"/>` : ''}</svg>`;
  };
  const hbars = items => { const mx = Math.max(...items.map(x => Math.abs(x[1]))) || 1;
    return items.map(([k, v, c, t]) => `<div class="hb"><span>${k}</span><span class="tr"><i style="width:${Math.max(Math.abs(v) / mx * 100, 2)}%;background:${c}"></i></span><b>${t}</b></div>`).join(''); };
  const curRows = R.filter(r => r.y === L.y);
  const K = Math.min(R.length, monthly ? 12 : 8), lastK = R.slice(-K), mn = lastK.reduce((a, r) => r.amt < a.amt ? r : a), mx = lastK.reduce((a, r) => r.amt > a.amt ? r : a), avK = sum(lastK, r => r.amt) / K;
  const withYoy = R.filter(r => r.yoy != null), cuts = withYoy.filter(r => r.yoy < 0);
  const allSum = sum(R, r => r.amt);
  const yocNow = lastYld ? lastYld.ttm / pNow[1] : null, yoc0 = lastYld ? lastYld.ttm / p0[1] : null;
  const drip = pNow[2] / p0[2] - 1, pxOnly = pNow[1] / p0[1] - 1;
  const FUND = T.holdings && T.holdings.top && T.holdings.top.length ? T.holdings : null;
  let streak = 0; for (let i = full.length - 1; i >= 0 && full[i].g != null && full[i].g > 0; i--) streak++;
  const HS = EXT ? (EXT.hold.summary || {}) : null;
  const tile6 = HS && HS.eln != null
    ? ['ELN 비중', HS.eln.toFixed(2) + '%', '', [`${EXT.hold.asOf} 기준`, `ELN ${HS.elnCount || '-'}개 · 주식 ${HS.stockCount || '-'}종목`],
        hbars([['주식', HS.stock, 'var(--s1)', HS.stock.toFixed(1) + '%'], ['ELN', HS.eln, 'var(--s2)', HS.eln.toFixed(1) + '%'], ['현금', HS.cash, 'var(--other)', HS.cash.toFixed(1) + '%']]) + `<div class="axl"><span>JPMorgan 공식 보유종목 · 시장가치 기준</span></div>`]
    : FUND
      ? ['상위 10종목 비중', sum(FUND.top.slice(0, 10), x => x.weight).toFixed(2) + '%', '', [`1위 ${esc(FUND.top[0].symbol)} ${FUND.top[0].weight.toFixed(2)}%`],
          hbars(FUND.top.slice(0, 3).map((x, i) => [esc(x.symbol), x.weight, `var(--r${i * 3 + 1})`, x.weight.toFixed(1) + '%'])) + `<div class="axl"><span>Yahoo Finance 제공 상위 보유종목</span></div>`]
      : [`연간 ${DV} 연속 증가`, `${streak}년`, '', [lastFull ? `${lastFull.y}년까지, 모든 회차가 확정된 해 기준` : '확정된 해가 아직 없습니다'],
          full.length > 1 ? miniBars(full.slice(-12).map(a => a.g || 0), v => v < 0 ? 'var(--down)' : 'var(--up)', full.slice(-12).map(a => `${a.y}년 ${a.g != null ? pct(a.g, 1) : '-'}`)) + `<div class="axl"><span>${full.slice(-12)[0].y}</span><span>연간 증감률</span><span>${lastFull.y}</span></div>` : ''];
  const tiles = [
    ['올해 누적 vs 작년 같은 기간', ytdPrev ? pct(ytdCur / ytdPrev - 1) : '-', ytdPrev ? tone(ytdCur / ytdPrev - 1) : '', [`${L.y}년 ${curY.n}회 ${usd(ytdCur)}`, ytdPrev ? `작년 같은 기간 ${usd(ytdPrev)}` : ''],
      miniBars(curRows.map(r => r.yoy || 0), v => v < 0 ? 'var(--down)' : 'var(--up)', curRows.map(r => `${ym(r)} ${SAME} 대비 ${r.yoy != null ? pct(r.yoy, 1) : '-'}`)) + `<div class="axl"><span>${slotName(curRows[0].slot)}</span><span>${SAME} 대비</span><span>${slotName(L.slot)}</span></div>`],
    lastFull
      ? [`${lastFull.y}년 연간 ${DV}`, usd(lastFull.tot), '', [lastFull.g != null ? `전년 대비 ${pct(lastFull.g)}` : '', `회당 평균 ${usd(lastFull.tot / lastFull.n)}`],
          miniBars(full.slice(-12).map(a => a.tot), (v, i, ) => i === Math.min(full.length, 12) - 1 ? 'var(--s1)' : 'var(--other)', full.slice(-12).map(a => `${a.y}년 ${usd(a.tot)}`)) + `<div class="axl"><span>${full.slice(-12)[0].y}</span><span>${lastFull.y}</span></div><div class="hint">모든 회차(연 ${N}회)가 확정된 해 ${full.length}개 기준입니다.</div>`]
      : [`연간 ${DV}`, '-', '', ['모든 회차가 확정된 해가 아직 없습니다'], ''],
    [`최근 ${K}회 ${DV} 범위`, `${usd(mn.amt, 3)} ~ ${usd(mx.amt, 3)}`, '', [`평균 ${usd(avK)}`, `최저 ${ym(mn)} · 최고 ${ym(mx)}`],
      miniBars(lastK.map(r => r.amt), (v, i) => lastK[i] === mx ? 'var(--s1)' : lastK[i] === mn ? 'var(--s2)' : 'var(--other)', lastK.map(r => `${ym(r)} ${usd(r.amt)}`)) + `<div class="axl"><span>${ym(lastK[0])}</span><span>${ym(L)}</span></div><div class="hint">최고액이 최저액의 <b>${(mx.amt / mn.amt).toFixed(2)}배</b>입니다.</div>`],
    [`${sinceLabel} 누적 ${DV}`, usd(allSum, 2), '', [`${R.length}회`, `${R[0].date.slice(0, 7)} ~ ${L.date.slice(0, 7)} 지급분`],
      `<div class="hint">${listedInRange ? '상장 첫 거래일' : '수집 시작일'}(${p0[0]}) 종가 ${usd(p0[1], 2)}의 <b>${(allSum / p0[1] * 100).toFixed(1)}%</b>에 해당하는 금액입니다(세전).</div>`],
    [`${SAME}보다 줄어든 회차`, `${cuts.length}회`, '', [`비교할 수 있는 ${withYoy.length}회 중`],
      `<div class="tags">${cuts.slice(-8).reverse().map(r => `<span><b>${String(r.y).slice(2)}.${pad2(r.m)}</b>${pct(r.yoy, 1)}</span>`).join('')}</div><div class="hint">연간 합계가 줄어든 해는 <b>${A.filter(a => a.g != null && a.g < 0).length}번</b>입니다.</div>`],
    tile6,
    [`${listedInRange ? '상장일' : p0[0].slice(0, 4) + '년 초'} 매수가 기준 ${RATE}`, yoc0 ? (yoc0 * 100).toFixed(2) + '%' : '-', '', lastYld ? [`${p0[0]} 종가 ${usd(p0[1], 2)} 매수 가정`, `최근 ${N}회 ${DV} ${usd(lastYld.ttm)} 기준`] : [],
      yoc0 ? hbars([[listedInRange ? '상장일 매수' : '당시 매수', yoc0, 'var(--s1)', (yoc0 * 100).toFixed(1) + '%'], ['현재 매수', yocNow, 'var(--other)', (yocNow * 100).toFixed(1) + '%']]) + `<div class="axl"><span>현재 매수는 ${pNow[0]} 종가 ${usd(pNow[1], 2)} 기준</span></div>` : ''],
    [`${sinceLabel} ${DV} 재투자 총수익`, pct(drip, 0), drip > 0 ? 'up' : '', [`${p0[0]} → ${pNow[0]}`, `${DV}금을 재투자한 경우`],
      hbars([[`${DV} 재투자`, drip, 'var(--s3)', pct(drip, 0)], ['주가만', pxOnly, 'var(--other)', pct(pxOnly, 0)]]) + `<div class="axl"><span>세금·수수료 미반영</span></div>`],
  ];
  $('stats').innerHTML = tiles.map(([t, v, c, s, x]) => `<div class="stat"><span class="t">${t}</span><span class="v ${c}">${v}</span><span class="s">${s.filter(Boolean).map(l => `<span>${l}</span>`).join('')}</span>${x ? `<div class="mini">${x}</div>` : ''}</div>`).join('');

  /* ----- 주가 흐름 ----- */
  (() => {
    const rows = PR, last = pNow; let cur = [rows[0][0], last[0]];
    $('pcap').textContent = `${T.asOf} 종가 기준 · Yahoo Finance(종가·수정주가) · 날짜를 바꾸면 즉시 다시 계산하며, 휴장일을 고르면 가장 가까운 거래일을 사용합니다. 재투자선에는 세금과 수수료가 반영되지 않았습니다.`;
    const draw = () => {
      const sub = rows.filter(r => r[0] >= cur[0] && r[0] <= cur[1]);
      if (sub.length < 2) { $('pstats').innerHTML = '<div><dt>기간</dt><dd>거래일이 2일 이상 포함되도록 기간을 선택해 주십시오.</dd></div>'; $('pchart').innerHTML = ''; return; }
      const q0 = sub[0], end = sub[sub.length - 1], k = q0[1] / q0[2], tr = r => r[2] * k;
      $('pFrom').value = q0[0]; $('pTo').value = end[0];
      const yrs = yearSpan(q0[0], end[0]), pr = end[1] / q0[1] - 1, trr = tr(end) / q0[1] - 1, cagr = v => Math.pow(1 + v, 1 / yrs) - 1;
      $('pstats').innerHTML = [
        ['기간', `${dot(q0[0])} ~ ${dot(end[0])}`], ['주가', `$${q0[1].toFixed(2)} → $${end[1].toFixed(2)}`],
        ['주가 상승률', `<span class="${tone(pr)}">${pct(pr, 1)}</span>${yrs >= 1 ? `<small>연 ${pct(cagr(pr), 1)}</small>` : ''}`],
        [`${DV} 재투자 포함`, `<span class="${tone(trr)}">${pct(trr, 1)}</span>${yrs >= 1 ? `<small>연 ${pct(cagr(trr), 1)}</small>` : ''}`]
      ].map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('');
      lineChart($('pchart'), {label: `${SYM} 주가와 재투자 가치 선그래프`, dates: sub.map(r => r[0]), height: 300, pr: [64, 70], area: 1,
        series: [{name: '주가', color: 'var(--ink)', vals: sub.map(r => r[1]), end: v => '$' + v.toFixed(2)}, {name: '재투자', color: 'var(--s3)', vals: sub.map(tr), end: v => '$' + v.toFixed(2)}],
        fmtY: v => '$' + (v % 1 ? v.toFixed(1) : v),
        tip: i => `<b>${dot(sub[i][0])}</b><br><i style="background:var(--surface)"></i>주가 $${sub[i][1].toFixed(2)}<br><i style="background:var(--s3)"></i>재투자 $${tr(sub[i]).toFixed(2)}`});
    };
    const press = b => document.querySelectorAll('#prange button').forEach(x => x.setAttribute('aria-pressed', x === b));
    document.querySelectorAll('#prange button').forEach(b => b.addEventListener('click', () => { press(b); const y = +b.dataset.y; cur = [y ? yearsBack(last[0], y) : rows[0][0], last[0]]; draw(); }));
    $('pFrom').min = $('pTo').min = rows[0][0]; $('pFrom').max = $('pTo').max = last[0];
    const custom = () => { let f = $('pFrom').value, t = $('pTo').value; if (!f || !t) return; if (f > t) [f, t] = [t, f]; press(null); cur = [f, t]; draw(); };
    $('pFrom').addEventListener('change', custom); $('pTo').addEventListener('change', custom);
    redraws.push(draw); draw();
  })();

  /* ----- 총수익 비교: 선택 종목 + 기준 종목 ----- */
  const TRSUM = []; let TRROWS = null, TRT = null;
  (() => {
    const all = [T, ...BENCH];
    if (all.length < 2) { $('trSec').hidden = true; return; }
    const start = all.map(t => t.prices[0][0]).sort().pop();
    const maps = BENCH.map(t => new Map(t.prices.map(r => [r[0], r[2]])));
    const rows = PR.filter(r => r[0] >= start && maps.every(m => m.has(r[0]))).map(r => [r[0], r[2], ...maps.map(m => m.get(r[0]))]);
    if (rows.length < 2) { $('trSec').hidden = true; return; }
    const TK = all.map(t => t.symbol), NAME = Object.fromEntries(all.map(t => [t.symbol, t.name])), last = rows[rows.length - 1];
    TRROWS = rows; TRT = TK;
    const fixed = {SPY: 'var(--s2)', QQQ: 'var(--s3)', SCHD: 'var(--s4)', JEPI: 'var(--s5)', VOO: 'var(--s7)', DIA: 'var(--s6)'}, spare = ['var(--s5)', 'var(--s7)', 'var(--s6)', 'var(--s8)'];
    let sp = 0; const colors = {[SYM]: 'var(--s1)'}; BENCH.forEach(t => { colors[t.symbol] = fixed[t.symbol] || spare[sp++ % spare.length]; });
    const col = t => colors[t];
    $('trTitle').textContent = `총수익 비교: ${TK.join(' · ')}`;
    const startIdx = y => { if (!y) return 0; const f = yearsBack(last[0], y), i = rows.findIndex(r => r[0] >= f); return i < 0 ? 0 : i; };
    const summ = y => { const a = rows[startIdx(y)], yr = yearSpan(a[0], last[0]);
      return {from: a[0], v: TK.map((t, j) => { const c = last[j + 1] / a[j + 1] - 1; return [c, y !== 1 && yr >= 1 ? Math.pow(1 + c, 1 / yr) - 1 : null]; })}; };
    $('trcap').textContent = `${dot(last[0])} 종가 기준 · 전체 기간의 시작일은 ${dot(rows[0][0])}(비교 종목 가운데 자료가 가장 늦게 시작하는 날)이며 이날을 0%로 둡니다. 1년·3년을 선택하면 해당 기간의 첫 거래일을 0%로 다시 맞춥니다. 출처: Yahoo Finance 수정주가. 배당 재투자를 가정하였고 세금과 환율은 반영하지 않았습니다. 과거 수익률이며 미래 수익을 의미하지 않습니다.`;
    $('trlegend').innerHTML = TK.map(t => `<span><i style="background:${col(t)}"></i>${t === SYM ? `<b>${esc(t)} ${esc(NAME[t])}</b>` : `${esc(t)} ${esc(NAME[t])}`}</span>`).join('');
    const P = [[1, '1년'], [3, '3년'], [0, '시작일 이후']].map(([y, l]) => [l, summ(y)]);
    P.forEach(p => TRSUM.push(p));
    $('trtable').innerHTML = `<thead><tr><th>누적 총수익</th>${P.map(([l, s]) => `<th class="num">${l}<small>${dot(s.from)}~</small></th>`).join('')}</tr></thead><tbody>` +
      TK.map((t, j) => `<tr${t === SYM ? ' class="mine"' : ''}><td><span class="nm"><span class="sw" style="background:${col(t)}"></span>${esc(t)}<span class="tk">${esc(NAME[t])}</span></span></td>${P.map(([l, s]) => { const [c, g] = s.v[j]; return `<td class="num">${pct(c, 1)}${g != null ? `<small>연 ${pct(g, 1)}</small>` : ''}</td>`; }).join('')}</tr>`).join('') + '</tbody>';
    let yrs = 0;
    const draw = () => {
      const sub = rows.slice(startIdx(yrs)), b = sub[0], v = (r, k) => r[k] / b[k] - 1;
      lineChart($('trchart'), {label: `${TK.join('·')} 배당 재투자 누적 수익률 선그래프`, dates: sub.map(r => r[0]), height: 320, pr: [96, 104], zero: true,
        series: [...TK.slice(1), SYM].map(t => { const k = TK.indexOf(t) + 1; return {name: t, color: col(t), hero: t === SYM, width: t === SYM ? 3 : 2, vals: sub.map(r => v(r, k)), end: x => `${t} ${pct(x, 0)}`}; }),
        fmtY: x => pct(x, 0),
        tip: i => `<b>${dot(sub[i][0])}</b>` + TK.map((t, j) => [t, v(sub[i], j + 1)]).sort((a, c) => c[1] - a[1]).map(([t, x]) => `<br><i style="background:${col(t)}"></i>${t === SYM ? `<b>${t} ${pct(x, 1)}</b>` : `${t} ${pct(x, 1)}`}`).join('')});
    };
    document.querySelectorAll('#trange button').forEach(b => b.addEventListener('click', () => { document.querySelectorAll('#trange button').forEach(x => x.setAttribute('aria-pressed', x === b)); yrs = +b.dataset.y; draw(); }));
    redraws.push(draw); draw();
  })();

  /* ----- 연간 막대 ----- */
  $('annualCap').textContent = `연 ${N}회 지급 · 연도는 지급일 기준입니다`;
  redraws.push(drawAnnual); drawAnnual();
  function drawAnnual() {
    const host = $('annual'), W = hostW(host), H = 300, pl = 40, pr = 8, pt = 40, pb = 30, n = A.length, cw = (W - pl - pr) / n, bw = Math.min(64, cw * 0.62);
    const top = Math.max(...A.map(a => a.tot), EST.total || 0), st = niceStep(top / 5), max = Math.ceil(top / st - 1e-9) * st, Y = v => pt + (H - pt - pb) * (1 - v / max);
    const small = cw < 70, dense = cw < 46, every = Math.max(1, Math.ceil(26 / cw)), dec = st < 1 ? (st < 0.1 ? 2 : 1) : 0;
    let s = '';
    for (let t = 0; t <= max + 1e-9; t += st) { const y = Y(t); s += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"/><text x="${pl - 6}" y="${y + 4}" text-anchor="end">$${t.toFixed(dec)}</text>`; }
    A.forEach((a, i) => {
      const x = pl + cw * i + (cw - bw) / 2, y = Y(a.tot), cx = x + bw / 2, isEst = EST.y === a.y, first = a.y === FIRSTY && a.n < N && !isEst, lastBar = i === n - 1;
      let labY = y, lab = usd(a.tot, small ? 2 : 4);
      if (isEst) {
        const ye = Y(EST.total);
        s += `<path d="${barPath(x + .5, ye, bw - 1, Math.max(0, y - ye - 2))}" ${EST_ATTR} data-tip="${esc(`<b>${a.y}년 예상</b><br>연간 ${usd(EST.total)}<br>추가 예상분 ${usd(EST.add)} (${slotsText(EST.ms)})`)}"/>`;
        s += `<rect x="${x}" y="${y}" width="${bw}" height="${H - pb - y}" fill="var(--s1)" data-tip="${esc(`<b>${a.y}년 확정</b><br>${usd(a.tot)} (${a.n}회)`)}"/>`;
        labY = ye; lab = `예상 ${usd(EST.total, 2)}`;
      } else {
        s += `<path d="${barPath(x, y, bw, H - pb - y)}" fill="${first ? 'var(--other)' : 'var(--s1)'}" data-tip="${esc(`<b>${a.y}년</b><br>${usd(a.tot)} (${a.n}회)`)}"/>`;
      }
      if (!dense || lastBar) s += `<text x="${lastBar && dense ? W - pr : cx}" y="${labY - 6}" text-anchor="${lastBar && dense ? 'end' : 'middle'}" class="lab">${lab}</text>`;
      if (!dense || (n - 1 - i) % every === 0) s += `<text x="${cx}" y="${H - pb + 16}" text-anchor="middle">${dense ? `'${String(a.y).slice(2)}` : a.y}${!dense && a.n < N ? `(${a.n})` : ''}</text>`;
    });
    if (full.length) { const av = sum(full, a => a.tot) / full.length; s += avgLine(pl, W - pr, Y(av)); $('annualAvg').textContent = `확정 연도 평균 ${usd(av)} (${full[0].y}~${lastFull.y})`; }
    setSvg(host, W, H, s, `연도별 ${SYM} ${DV} 막대그래프`);
  }

  /* ----- 연간 증감률 ----- */
  const G = A.filter(a => a.g != null).map(a => ({y: a.y, g: a.g, est: false}));
  if (EST.g != null) G.push({y: EST.y, g: EST.g, est: true});
  if (!G.length) $('growthSec').hidden = true; else { redraws.push(drawGrowth); drawGrowth(); }
  function drawGrowth() {
    const host = $('growth'), W = hostW(host), H = 250, pl = 44, pr = 8, pt = 24, pb = 30, n = G.length, cw = (W - pl - pr) / n, bw = Math.min(64, cw * 0.6);
    const gmax = Math.max(...G.map(d => d.g)), gmin = Math.min(...G.map(d => d.g)), gs = niceStep(Math.max(0.05, gmax - Math.min(0, gmin)) / 5);
    const hi = Math.max(gs, Math.ceil(gmax / gs - 1e-9) * gs), lo = Math.min(0, Math.floor(gmin / gs + 1e-9) * gs);
    const Y = v => pt + (H - pt - pb) * (hi - v) / (hi - lo), y0 = Y(0), dense = cw < 46, every = Math.max(1, Math.ceil(26 / cw));
    let s = '';
    for (let t = lo; t <= hi + 1e-9; t += gs) { const y = Y(t); s += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"/><text x="${pl - 6}" y="${y + 4}" text-anchor="end">${(t * 100).toFixed(Math.round(gs * 1000) % 10 ? 1 : 0)}%</text>`; }
    s += `<line class="zero" x1="${pl}" x2="${W - pr}" y1="${y0}" y2="${y0}"/>`;
    G.forEach((d, i) => {
      const x = pl + cw * i + (cw - bw) / 2, cx = x + bw / 2, y = Y(d.g), top = Math.min(y, y0), h = Math.max(1.5, Math.abs(y - y0));
      s += `<path d="${barPath(x, top, bw, h, d.g < 0)}" ${d.est ? EST_ATTR : `fill="${d.g < 0 ? 'var(--down)' : 'var(--up)'}"`} data-tip="${esc(`<b>${d.y}년${d.est ? ' 예상' : ''}</b><br>전년 대비 ${pct(d.g)}`)}"/>`;
      if (!dense) s += `<text x="${cx}" y="${d.g >= 0 ? top - 6 : top + h + 13}" text-anchor="middle" class="lab">${d.est ? '예상 ' : ''}${pct(d.g, 1)}</text>`;
      if (!dense || (n - 1 - i) % every === 0) s += `<text x="${cx}" y="${H - pb + 16}" text-anchor="middle">${dense ? `'${String(d.y).slice(2)}` : d.y}${!dense && d.est ? ' (예상)' : ''}</text>`;
    });
    setSvg(host, W, H, s, `연도별 ${SYM} ${DV} 증감률 막대그래프`);
  }

  /* ----- 회차별 추이 ----- */
  const Q = R.map(r => ({y: r.y, m: r.m, s: r.slot, v: r.amt, est: false}));
  if (EST.y) EST.ms.forEach(s => Q.push({y: EST.y, m: null, s, v: EST.avg, est: true}));
  $('mchartCap').textContent = `${ym(R[0])} ~ ${ym(L)} 지급분${EST.y ? ' + 올해 남은 회차 예상' : ''}`;
  redraws.push(drawMonthly); drawMonthly();
  function drawMonthly() {
    const host = $('mchart'), W = hostW(host), H = 290, pl = 44, pr = 8, pt = 40, pb = 30, n = Q.length, cw = (W - pl - pr) / n, bw = Math.max(1, cw > 6 ? cw - 2 : cw * 0.7);
    const top = Math.max(...Q.map(d => d.v)), st = niceStep(top / 5), max = Math.ceil(top / st - 1e-9) * st, Y = v => pt + (H - pt - pb) * (1 - v / max), dec = st < 0.1 ? 2 : st < 1 ? 1 : 0;
    const yrs = [...new Set(Q.map(d => d.y))], yevery = Math.max(1, Math.ceil(yrs.length / Math.max(3, Math.floor((W - pl - pr) / 34))));
    let s = '', seen = new Set();
    for (let t = 0; t <= max + 1e-9; t += st) { const y = Y(t); s += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"/><text x="${pl - 6}" y="${y + 4}" text-anchor="end">$${t.toFixed(dec)}</text>`; }
    Q.forEach((d, i) => {
      const x = pl + cw * i + (cw - bw) / 2, y = Y(d.v), nm = d.est ? `${d.y}년 ${slotName(d.s)}` : `${d.y}.${pad2(d.m)}`;
      s += `<path d="${barPath(x, y, bw, H - pb - y)}" ${d.est ? EST_ATTR : 'fill="var(--s1)"'} data-tip="${esc(`<b>${nm} ${d.est ? '예상' : '지급'}</b><br>${usd(d.v, d.est ? 4 : 5)}`)}"/>`;
      if (!seen.has(d.y)) { seen.add(d.y); if ((yrs.length - 1 - yrs.indexOf(d.y)) % yevery === 0 && (i === 0 || d.s === Q.find(z => z.y === d.y).s)) s += `<text x="${x}" y="${H - pb + 16}">'${String(d.y).slice(2)}</text>`; }
    });
    const lc = Q.filter(d => !d.est).pop(), le = Q[Q.length - 1];
    s += `<text x="${W - pr}" y="${pt - 22}" text-anchor="end" class="lab">최신 ${lc.y}.${pad2(lc.m)} ${usd(lc.v)}</text>`;
    if (le.est) s += `<text x="${W - pr}" y="${pt - 8}" text-anchor="end" class="labm">남은 회차 예상 ${usd(le.v)}</text>`;
    const cq = Q.filter(d => !d.est), aq = sum(cq, d => d.v) / cq.length;
    s += avgLine(pl, W - pr, Y(aq)); $('monthlyAvg').textContent = `확정 ${cq.length}회 평균 ${usd(aq)}`;
    setSvg(host, W, H, s, `회차별 ${SYM} ${DV} 막대그래프`);
  }
  let ESTB = null;
  if (EST.y && lastFull) {
    const done = R.filter(r => r.y === EST.y).map(r => r.slot);
    const sameAsLast = sum(EST.ms, s => (find(EST.y - 1, s) || {}).amt || 0), tB = curY.tot + sameAsLast;
    const avgM = (y, ms) => { const rs = R.filter(r => r.y === y && ms.includes(r.slot)); return rs.length ? sum(rs, r => r.amt) / rs.length : NaN; };
    const ratios = full.slice(-5).map(a => ({y: a.y, r: avgM(a.y, EST.ms) / avgM(a.y, done) - 1})).filter(x => isFinite(x.r)), hiN = ratios.filter(v => v.r > 0).length;
    const prevA = byY(EST.y - 1), g0 = ytdPrev ? ytdCur / ytdPrev - 1 : null, gA = prevA && prevA.n >= N ? EST.total / prevA.tot - 1 : null, gB = prevA && prevA.n >= N ? tB / prevA.tot - 1 : null;
    ESTB = {tB, sameAsLast, gB};
    const gtxt = g => g == null ? '' : ` · 전년 대비 <span class="${tone(g)}">${pct(g)}</span>`;
    const doneTxt = done.length > 1 ? `${slotName(done[0]).replace(/월|회차/, '')}~${slotName(done[done.length - 1])}` : slotName(done[0]);
    $('estNote').innerHTML = `<p class="bh">${EST.y}년 ${DV} 점검</p><ul>
      <li><b>확정 ${done.length}회(${doneTxt} 지급)</b><span class="numv">${usd(ytdCur)}</span>${g0 != null ? `<span class="sub">작년 같은 기간 ${usd(ytdPrev)} 대비 <span class="${tone(g0)}">${pct(g0)}</span></span>` : ''}</li>
      <li><b>연간 예상 ① 올해 평균 적용</b><span class="numv">${usd(EST.total)}</span><span class="sub">남은 ${slotsText(EST.ms)}를 올해 확정분 평균 ${usd(EST.avg)}으로 가정${gtxt(gA)}</span></li>
      <li><b>연간 예상 ② 작년 같은 ${monthly ? '달' : '회차'} 적용</b><span class="numv">${usd(tB)}</span><span class="sub">남은 ${slotsText(EST.ms)}가 작년과 같다고(합계 ${usd(sameAsLast)}) 가정${gtxt(gB)}</span></li></ul>
      ${ratios.length ? `<p>최근 ${ratios.length}개 확정 연도 가운데 ${hiN}개 해에서 ${slotsText(EST.ms)} ${DV}이 그해 ${doneTxt} 평균보다 높았습니다(${ratios.map(x => `${x.y}년 ${pct(x.r, 1)}`).join(', ')}). 표본이 적으므로 참고용으로만 활용해 주십시오.</p>` : ''}`;
    $('estNote').hidden = false;
  }

  /* ----- 회차별 표 ----- */
  let unit = 'usd';
  const valOf = (r, u) => u === 'usd' ? r.amt : r.krw == null ? null : (u === 'krw' ? r.krw : r.krw * (1 - WHT));
  function drawTable() {
    const fmt = v => unit === 'usd' ? usd(v) : won(v), val = r => valOf(r, unit);
    let h = `<thead><tr><th>연도</th>${Array.from({length: NS}, (_, i) => `<th>${slotName(i + 1)}</th>`).join('')}<th>연간</th></tr></thead><tbody>`;
    [...years].reverse().forEach(y => {
      const a = byY(y);
      h += `<tr class="${a.n < N ? 'partial' : ''}"><td class="yr">${y}</td>`;
      for (let s = 1; s <= NS; s++) {
        const r = find(y, s);
        if (!r) { const sc = monthly && SCH.find(z => +z.pay.slice(0, 4) === y && +z.pay.slice(5, 7) === s && z.kind !== 'capgain' && z.ex > L.ex);
          h += sc ? `<td><span class="d flat">${sc.ex.slice(5).replace('-', '/')} 배당락 예정</span></td>` : `<td class="na">·</td>`; continue; }
        if (val(r) == null) { h += `<td>${usd(r.amt)}<span class="d flat">지급 전</span></td>`; continue; }
        const prev = find(y - 1, s), d = prev && val(prev) != null ? val(r) / val(prev) - 1 : null;
        h += `<td>${fmt(val(r))}${d != null ? `<span class="d ${tone(d)}">${pct(d, 1)}</span>` : (monthly ? '' : `<span class="d flat">${r.m}월 지급</span>`)}</td>`;
      }
      const tot = sum(R.filter(r => r.y === y), r => val(r) || 0), pa = byY(y - 1), ptot = pa ? sum(R.filter(r => r.y === y - 1), r => val(r) || 0) : null;
      const g = (a.n >= N && pa && pa.n >= N && ptot) ? tot / ptot - 1 : null;
      h += `<td><b>${fmt(tot)}</b>${g != null ? `<span class="d ${tone(g)}">${pct(g, 1)}</span>` : (a.n < N ? `<span class="d flat">${a.n}회 누적</span>` : '')}</td></tr>`;
    });
    $('mtable').innerHTML = h + '</tbody>';
    $('mcap').textContent = unit === 'usd'
      ? `${monthly ? '월은 지급일이 속한 달입니다.' : '회차는 그해 지급 순서입니다. 같은 달에 여러 번 지급된 금액은 합산하였습니다.'} 작은 숫자는 ${SAME} 대비 증감률이며, 음영 줄은 진행 중인 해 또는 일부 기간만 포함된 해입니다.`
      : `원화는 각 지급일의 원/달러 환율(${IDX.fxSource || 'Yahoo Finance'})로 환산하였습니다. 세후는 미국 원천징수 ${WHT * 100}%를 차감한 값입니다. 원화 기준 증감률에는 환율 변동이 함께 반영되며, 지급 전인 회차는 원화 합계에서 제외됩니다.`;
  }
  document.querySelectorAll('#unitSeg button').forEach(b => b.addEventListener('click', () => { unit = b.dataset.u; document.querySelectorAll('#unitSeg button').forEach(x => x.setAttribute('aria-pressed', x === b)); drawTable(); }));
  drawTable();

  /* ----- ETF 구성종목 (Yahoo Finance 상위 10종목·섹터) ----- */
  const barRows = (rows, color) => { const mxv = Math.max(...rows.map(r => r[1]));
    return rows.map(([k, v, t]) => `<div class="srow"><span>${esc(k)}</span><span class="trk"><i style="width:${(v / mxv * 100).toFixed(1)}%${color ? `;background:${color}` : ''}"></i></span><span class="pv">${v.toFixed(2)}%</span><span class="sc">${t || ''}</span></div>`).join(''); };
  if (FUND && !EXT) {
    const top = FUND.top.slice(0, 10), topSum = sum(top, x => x.weight), other = Math.max(0, 100 - topSum);
    $('fundSec').hidden = false;
    $('fundAsOf').textContent = `Yahoo Finance 제공 자료 · 기준일은 운용사 공시 주기에 따라 다릅니다`;
    $('fundDonut').innerHTML = donutSVG(top.map((x, i) => ({n: `${i + 1}. ${x.name} (${x.symbol})`, v: x.weight, c: `var(--r${i + 1})`})).concat([{n: '그 밖의 보유종목', v: other, c: 'var(--other)'}]), topSum, 0, other)
      .replace(/ELN 0\.00% · /, '');
    $('fundTable').innerHTML = `<thead><tr><th class="num">순위</th><th>종목</th><th class="num">비중</th></tr></thead><tbody>` +
      top.map((x, i) => `<tr><td class="num">${i + 1}</td><td><span class="nm"><span class="sw" style="background:var(--r${i + 1})"></span>${esc(titleCase(x.name))}<span class="tk">${esc(x.symbol)}</span></span></td><td class="num">${x.weight.toFixed(2)}%</td></tr>`).join('') +
      `<tr class="fold"><td class="num">–</td><td><span class="nm"><span class="sw" style="background:var(--other)"></span>기타</span></td><td class="num">${other.toFixed(2)}%</td></tr><tr class="sum"><td></td><td>합계</td><td class="num">100.00%</td></tr></tbody>`;
    const secs = Object.entries(FUND.sectors || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    if (secs.length) $('fundSectors').innerHTML = barRows(secs.map(([k, v]) => [SECTOR_KO[k] || k, v]));
    else $('fundSecPanel').hidden = true;
  }

  /* ----- JEPQ 전용: 전체 구성종목·ELN, 월별 비중 기록, 국내 ETF 비교 ----- */
  const JX = EXT ? renderJepq(EXT, R, find) : null;

  /* ----- 맺음말 ----- */
  const logNote = T.dividends.some(x => !x.pay) ? ' 이 종목은 일부 또는 전체 지급일 자료를 받지 못해 추정 지급일을 사용하였습니다.' : '';
  $('foot').innerHTML = `
    <p><b>기준</b> · 연도와 ${monthly ? '월' : '회차'}은 지급일 기준이며, 지급일 자료가 없는 건은 최근 배당락일과 지급일의 간격(${LAG}일)을 더해 지급일을 추정하여 배치합니다. ${SYM}은(는) 최근 지급 이력으로 보아 연 ${N}회 지급으로 판단하였습니다. 연간 증감률은 모든 회차가 확정된 해끼리만 계산합니다. 수집 기간은 ${esc(IDX.since || p0[0])} 이후입니다.${EXT ? ' JEPQ의 분배금은 주식 배당과 ELN(콜옵션 매도) 수익에서 나오므로 매달 달라지며, 증감에는 옵션 프리미엄 변화의 영향이 크게 반영됩니다.' : ''}</p>
    <p><b>세금</b> · 미국 상장 종목을 직접 보유하면 ${DV}금에 대해 미국에서 15%가 원천징수되며 국내 추가 원천징수는 없습니다(금융소득이 연 2,000만 원을 넘으면 종합과세 대상에 합산됩니다).${EXT ? ' 국내 상장 해외주식형 ETF의 분배금은 배당소득세 15.4% 과세 대상입니다.' : ''}</p>
    <p><b>출처</b> · 종가·수정주가·${DV}금·종목 정보·ETF 상위 보유종목: Yahoo Finance · 기준일·지급일: Nasdaq.com · 환율: ${esc(IDX.fxSource || 'Yahoo Finance')}${EXT ? ' · JEPQ 전체 구성종목·ELN·월별 비중·분배 일정·공식 수익률·국내 ETF 비교: 공개 저장소 ttokjaetv/jepq-tracker(똑재TV)가 J.P. Morgan, SEC EDGAR, FunETF, 금융투자협회에서 수집한 자료' : ''}. 화면 구성과 계산 기준은 ttokjaetv/jepq-tracker를 참고하였습니다.${logNote}</p>
    <p>이 자료는 특정 종목의 매수·매도를 권유하지 않으며, 과거 ${DV}이 미래 ${DV}을 보장하지 않습니다.</p>`;

  /* ----- 엑셀 내려받기 ----- */
  function buildSheets() {
    const S = {};
    S['분배이력'] = [['지급 연도', monthly ? '지급 월' : '회차', '배당락일', '기준일', '지급일', `${DV}금(USD)`, `${PREV} 대비`, `${SAME} 대비`, 'TTM(USD)', '배당락일 종가', `12개월 ${RATE}`, '지급일 환율', '원화 세전', '원화 세후', '출처']]
      .concat(R.map(r => [r.y, r.slot, r.ex, r.record || '', r.pay || '', r.amt, r.mom, r.yoy, r.ttm, r.close ?? null, r.yld, r.fx ?? null, r.krw, r.krw != null ? r.krw * (1 - WHT) : null, r.src || '']));
    S['연간'] = [['연도', '지급 횟수', `연간 ${DV}(USD)`, '전년 대비', '비고']].concat(A.map(a => [a.y, a.n, a.tot, a.g, a.n < N ? (a.y === EST.y ? '진행 중' : '일부 기간') : '']));
    if (EST.y) { S['연간'].push([], [`${EST.y}년 예상 ① 올해 평균 적용`, '', EST.total, EST.g]); if (ESTB) S['연간'].push([`${EST.y}년 예상 ② 작년 같은 ${monthly ? '달' : '회차'} 적용`, '', ESTB.tB, ESTB.gB]); }
    ['usd', 'krw', 'net'].forEach(u => { S[{usd: '회차별표_USD', krw: '회차별표_원화세전', net: '회차별표_원화세후'}[u]] = [['연도', ...Array.from({length: NS}, (_, i) => slotName(i + 1)), '연간']]
      .concat(years.map(y => [y, ...Array.from({length: NS}, (_, i) => { const r = find(y, i + 1); return r ? valOf(r, u) : null; }), sum(R.filter(r => r.y === y), r => valOf(r, u) || 0)])); });
    if (FUND) { S['상위보유종목'] = [['순위', '티커', '종목', '비중(%)']].concat(FUND.top.map((x, i) => [i + 1, x.symbol, x.name, x.weight]));
      if (Object.keys(FUND.sectors || {}).length) S['섹터비중'] = [['섹터', '비중(%)']].concat(Object.entries(FUND.sectors).sort((a, b) => b[1] - a[1]).map(([k, v]) => [SECTOR_KO[k] || k, v])); }
    if (JX) {
      S['구성종목_전체'] = [[`기준일 ${EXT.hold.asOf}`], ['순위', '구분', '티커', '종목', '섹터', '비중(%)']].concat(JX.HOLD.map((x, i) => [i + 1, {stock: '주식', eln: 'ELN'}[x.type] || '현금', x.type === 'stock' ? x.k : '', x.name, x.sec, x.w]));
      if (JX.hmApi) { const h = JX.hmApi, secs = [...new Set(h.MS.flatMap(r => Object.keys(h.secOf(r))))];
        S['월별섹터비중'] = [['월', '기준일', '자료', ...secs]].concat(h.MS.map(r => { const o = h.secOf(r); return [r.month, r.asOf, r.basis === 'nport' ? 'SEC N-PORT' : 'JPMorgan 공식', ...secs.map(s => o[s] ?? null)]; }));
        S['월별TOP10'] = [['월', '순위', '티커', '종목', '섹터', '비중(%)']].concat(h.MS.flatMap(r => r.items.slice(0, 10).map(([k, w], i) => [r.month, i + 1, k, h.nm(k), h.sk(k), w]))); }
      if (EXT.kr) { S['국내ETF_비교'] = [['코드', '종목', '상장일', '실부담비용(%)', '총보수(%)', '최근 분배금(원)', '최근 분배 기준일', '12개월 분배금(원)', '횟수', '기준 가격(원)', '12개월 분배율']].concat(JX.KRX.map(k => [k.code, k.name, k.listed || '', k.real, k.fee, k.last, k.lastDate, k.s12, k.n, k.px, k.yld]));
        S['국내ETF_분배이력'] = [['코드', '종목', '분배 기준일', '분배금(원)', '회차 분배율(%)']].concat(EXT.kr.order.flatMap(c => EXT.kr.etfs[c].history.map(x => [c, EXT.kr.etfs[c].name, `${x[0].slice(0, 4)}-${x[0].slice(4, 6)}-${x[0].slice(6, 8)}`, x[1], x[2]]))); }
    }
    S['주가'] = [['날짜', '종가', '배당 재투자 수정주가']].concat(PR);
    if (TRROWS) { S['TR비교'] = [['날짜', ...TRT.map(t => `${t} 수정주가`)]].concat(TRROWS);
      S['TR요약'] = [['구간', '시작일', ...TRT.flatMap(t => [`${t} 누적`, `${t} 연환산`])]].concat(TRSUM.map(([l, s]) => [l, s.from, ...s.v.flatMap(([c, g]) => [c, g])])); }
    return S;
  }
  $('xlsxBtn').addEventListener('click', async () => {
    const msg = $('xlsxMsg'), btn = $('xlsxBtn'); btn.disabled = true; msg.textContent = '파일을 만드는 중입니다…';
    try {
      const X = await loadXLSX(), wb = X.utils.book_new(), S = buildSheets();
      Object.entries(S).forEach(([name, aoa]) => X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), name));
      const buf = X.write(wb, {bookType: 'xlsx', type: 'array'}), filename = `${SYM.toLowerCase()}_tracker_${IDX.updated || T.asOf}.xlsx`;
      const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
      if (dl) { await dl.save({filename, data: new Blob([buf])}); msg.textContent = '저장을 요청하였습니다.'; }
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); msg.textContent = '내려받기를 시작하였습니다.'; }
    } catch (e) {
      msg.textContent = e && e.code === 'declined' ? '저장을 취소하였습니다.' : `파일을 저장하지 못했습니다(${(e && (e.code || e.message)) || '알 수 없는 오류'}).`;
    } finally { btn.disabled = false; }
  });
  window.__tracker = {buildSheets, N, R, A, EST};
}
const loadXLSX = () => window.XLSX ? Promise.resolve(window.XLSX) : new Promise((ok, no) => {
  const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  s.onload = () => ok(window.XLSX); s.onerror = () => no(new Error('엑셀 라이브러리를 불러오지 못했습니다')); document.head.appendChild(s); });

/* ---------- JEPQ 전용 섹션 ---------- */
function renderJepq(EXT, R, find) {
  const META = EXT.meta, HOLDJ = EXT.hold, HM = EXT.hm, D = {kr: EXT.kr};
  const SK = META.sectors_ko || {}, ELN = SK.ELN || 'ELN(옵션 프리미엄)', CASH = SK[''] || '현금·단기자금';
  const tailOrder = k => k === ELN ? 1 : k === CASH ? 2 : 0;
  $('holdSec').hidden = false; $('hmSec').hidden = false; $('krSec').hidden = !D.kr;
  /* ----- 구성종목 ----- */
  const sectorRows = rows => { const mxv = Math.max(...rows.map(r => r[1]));
    return rows.map(([k, v, t, c]) => `<div class="srow"><span>${esc(k)}</span><span class="trk"><i style="width:${(v / mxv * 100).toFixed(1)}%${k === ELN ? ';background:var(--s2)' : k === CASH ? ';background:var(--other)' : ''}"></i></span><span class="pv">${v.toFixed(2)}%</span><span class="sc ${c || ''}">${t || ''}</span></div>`).join(''); };
  const r2 = v => Math.round(v * 100) / 100;
  const md = s => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;
  const HOLD = HOLDJ.items.map(x => ({k: x.symbol, w: x.weight, type: x.type,
    name: x.type === 'eln' ? x.symbol.replace('NDX_', 'ELN #') : x.type === 'stock' ? (META.names_ko[x.symbol] || titleCase(x.name)) : '현금',
    sec: x.type === 'eln' ? ELN : (x.type === 'stock' && x.sector ? (SK[x.sector] || x.sector) : CASH)})).sort((a, b) => b.w - a.w);
  (() => {
    const stocks = HOLD.filter(x => x.type === 'stock'), elns = HOLD.filter(x => x.type === 'eln'), cash = HOLD.filter(x => x.type !== 'stock' && x.type !== 'eln');
    const top = stocks.slice(0, 10), topR = top.map(h => r2(h.w)), topSum = r2(sum(topR)), elnSum = r2(sum(elns, x => x.w)), other = r2(100 - topSum - elnSum);
    const segs = top.map((h, i) => ({n: `${i + 1}. ${h.name} (${h.k})`, v: topR[i], c: `var(--r${i + 1})`}))
      .concat([{n: `ELN ${elns.length}개 합계`, v: elnSum, c: 'var(--s2)'}, {n: `그 밖의 주식 ${stocks.length - 10}종목·현금`, v: other, c: 'var(--other)'}]);
    const prevRec = HM ? [...HM.months].reverse().find(r => r.basis !== 'nport' && r.month < HOLDJ.asOf.slice(0, 7)) : null;
    const prevW = prevRec ? Object.fromEntries(prevRec.items.map(x => [x[0], x[1]])) : null;
    $('holdAsOf').textContent = `${HOLDJ.asOf} 기준 · JPMorgan 공식 일별 보유종목`;
    $('holdTopCap').textContent = prevRec ? `비중 아래의 작은 숫자는 ${md(prevRec.asOf)} 대비 변화입니다` : '';
    $('donut').innerHTML = donutSVG(segs, topSum, elnSum, other);
    const delta = x => { if (!prevW || x.type !== 'stock') return ''; const p = prevW[x.k]; if (p == null) return '<span class="d up">신규</span>';
      const d = x.w - p; return `<span class="d ${d > 0.005 ? 'up' : d < -0.005 ? 'down' : 'flat'}">${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}%p</span>`; };
    const color = x => { if (x.type === 'eln') return 'var(--s2)'; const i = top.indexOf(x); return i >= 0 ? `var(--r${i + 1})` : 'var(--other)'; };
    const row = (rank, x, w) => `<tr><td class="num">${rank}</td><td><span class="nm"><span class="sw" style="background:${color(x)}"></span>${esc(x.name)}<span class="tk">${x.type === 'stock' ? x.k : ''}</span></span></td><td>${esc(x.sec)}</td><td class="num">${(w ?? x.w).toFixed(2)}%${delta(x)}</td></tr>`;
    const head = `<thead><tr><th class="num">순위</th><th>종목</th><th>섹터</th><th class="num">비중</th></tr></thead><tbody>`;
    let open = false;
    const draw = () => {
      let h = head;
      if (!open) {
        top.forEach((x, i) => { h += row(i + 1, x, topR[i]); });
        h += `<tr class="fold"><td class="num">–</td><td><span class="nm"><span class="sw" style="background:var(--s2)"></span>ELN 합계<span class="tk">${elns.length}개</span></span></td><td>${ELN}</td><td class="num">${elnSum.toFixed(2)}%</td></tr>`;
        h += `<tr class="fold"><td class="num">–</td><td><span class="nm"><span class="sw" style="background:var(--other)"></span>기타<span class="tk">주식 ${stocks.length - 10}종목·현금</span></span></td><td>–</td><td class="num">${other.toFixed(2)}%</td></tr>`;
        h += `<tr class="sum"><td></td><td>합계</td><td></td><td class="num">100.00%</td></tr>`;
        $('hcnt').textContent = '';
      } else {
        const q = ($('hq').value || '').trim().toLowerCase();
        const list = stocks.map((x, i) => [i + 1, x]).concat(elns.map(x => ['–', x]), cash.map(x => ['–', x])).filter(([, x]) => !q || [x.k, x.name, x.sec].some(v => String(v).toLowerCase().includes(q)));
        list.forEach(([r, x]) => { h += row(r, x); });
        if (!list.length) h += `<tr><td></td><td class="cap" colspan="3">'${esc(q)}'에 해당하는 종목이 없습니다.</td></tr>`;
        else if (!q) h += `<tr class="sum"><td></td><td>합계</td><td></td><td class="num">${sum(HOLD, x => x.w).toFixed(2)}%</td></tr>`;
        $('hcnt').textContent = q ? `${list.length}건` : '';
      }
      $('holdTable').innerHTML = h + '</tbody>';
      $('holdTitle').textContent = open ? '전체 구성종목' : 'TOP 10';
      const b = $('holdToggle'); b.setAttribute('aria-expanded', open);
      b.textContent = open ? 'TOP 10만 보기 ▴' : `전체 펼치기 ▾ (주식 ${stocks.length}종목 · ELN ${elns.length}개 · 현금 ${cash.length}건)`;
      $('holdSearch').hidden = !open;
    };
    $('holdToggle').addEventListener('click', () => { open = !open; if (!open) $('hq').value = ''; draw(); });
    $('hq').addEventListener('input', draw);
    draw();
    const sec = {}, cnt = {}; HOLD.forEach(x => { sec[x.sec] = (sec[x.sec] || 0) + x.w; cnt[x.sec] = (cnt[x.sec] || 0) + 1; });
    $('sectors').innerHTML = sectorRows(Object.entries(sec).sort((a, b) => tailOrder(a[0]) - tailOrder(b[0]) || b[1] - a[1]).map(([k, v]) => [k, v, k === ELN ? cnt[k] + '개' : k === CASH ? '' : cnt[k] + '종목']));
  })();

  /* ----- 월별 비중 기록 ----- */
  let hmApi = null;
  (() => {
    if (!HM || !HM.months || !HM.months.length) { $('hmSec').hidden = true; return; }
    const MS = HM.months;
    const nm = k => META.names_ko[k] || titleCase((HM.names[k] || [k])[0]);
    const sk = k => { const s = (HM.names[k] || ['', ''])[1]; return s ? (SK[s] || s) : '섹터 미확인'; };
    const ymk = s => `${s.slice(0, 4)}년 ${+s.slice(5, 7)}월`;
    const secOf = r => { const o = {}; r.items.forEach(([k, w]) => { const s = sk(k); o[s] = (o[s] || 0) + w; }); if (r.eln) o[ELN] = r.eln; if (r.cash) o[CASH] = r.cash; return o; };
    hmApi = {MS, nm, sk, secOf};
    const lastSec = secOf(MS[MS.length - 1]);
    const SEC = Object.keys(Object.assign({}, ...MS.map(secOf))).sort((a, b) => tailOrder(a) - tailOrder(b) || (lastSec[b] || 0) - (lastSec[a] || 0));
    /* 색은 섹터에 고정: 상위 7개 섹터만 고유 색, 나머지는 '그 외 섹터'로 묶습니다 */
    const slots = ['var(--s1)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
    const plain = SEC.filter(s => !tailOrder(s)), REST = '그 외 섹터';
    const groupOf = s => s === ELN || s === CASH ? s : plain.indexOf(s) < slots.length ? s : REST;
    const GROUPS = [...plain.slice(0, slots.length), ...(plain.length > slots.length ? [REST] : []), ELN, CASH];
    const gcol = g => g === ELN ? 'var(--s2)' : g === CASH ? 'var(--other2)' : g === REST ? 'var(--other)' : slots[plain.indexOf(g)];
    const OF = MS.filter(r => r.basis !== 'nport'), NP = MS.filter(r => r.basis === 'nport');
    $('hmCap').textContent = `${MS[0].month} ~ ${MS[MS.length - 1].month} · ` + [NP.length ? `분기말 ${NP.length}개(SEC N-PORT)` : '', OF.length ? `월별 ${OF.length}개(JPMorgan 공식)` : ''].filter(Boolean).join(' + ');
    const opts = rs => [...rs].reverse().map(r => `<option value="${r.month}">${ymk(r.month)} (${md(r.asOf)})</option>`).join('');
    $('hmSel').innerHTML = (OF.length ? `<optgroup label="JPMorgan 공식(매월 첫 수집 파일)">${opts(OF)}</optgroup>` : '') + (NP.length ? `<optgroup label="SEC N-PORT 분기말 공시">${opts(NP)}</optgroup>` : '');
    $('hmNote').innerHTML = `JEPQ는 지수를 그대로 추종하지 않는 액티브 ETF이므로 정해진 리밸런싱일이 없습니다. JPMorgan은 과거 일자의 보유종목 파일을 제공하지 않아, <b>${OF.length ? OF[0].month : '-'}부터</b> 매월 처음 수집한 공식 파일을 기록합니다.` +
      (NP.length ? ` 그 이전 기간은 SEC에 제출되는 N-PORT 공시(${NP[0].month}~${NP[NP.length - 1].month})로 보완하였습니다. N-PORT는 분기말(3·6·9·12월 말) 보유종목만 약 60일 뒤에 공개되므로 중간 달은 비어 있습니다. 비중은 공식 파일과 동일하게 시장가치를 합계로 나누어 다시 계산하였고, 증권대여 담보 MMF와 선물은 제외하였습니다. 섹터는 현재 분류를 과거 분기에 적용한 것이어서 당시 분류와 다를 수 있습니다.` : '');
    const sig = d => { const r = r2(d); return {c: r > 0 ? 'up' : r < 0 ? 'down' : 'flat', t: `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(2)}%p`}; };
    const dspan = x => `<span class="d ${x.c}">${x.t}</span>`;
    let selected = MS[MS.length - 1].month;
    const draw = mo => {
      selected = mo;
      const i = MS.findIndex(z => z.month === mo), r = MS[i], p = i > 0 ? MS[i - 1] : null, plabel = p ? `${p.month.slice(2, 4)}년 ${+p.month.slice(5, 7)}월` : '';
      $('hmSel').value = mo;
      $('hmBasis').innerHTML = r.basis === 'nport'
        ? `${r.asOf} 기준 · <a href="https://www.sec.gov/Archives/edgar/data/1485894/${(r.accession || '').replace(/-/g, '')}/" target="_blank" rel="noopener">SEC N-PORT 분기말 공시</a> · ELN ${r.elnCount || '-'}개`
        : `${r.asOf} 기준 · JPMorgan 공식 · ELN ${r.elnCount || '-'}개`;
      $('hmVs').textContent = p ? `${plabel} 대비` : '';
      const sc = secOf(r), sp = p ? secOf(p) : {};
      $('hmSectors').innerHTML = sectorRows(Object.entries(sc).sort((a, b) => tailOrder(a[0]) - tailOrder(b[0]) || b[1] - a[1]).map(([k, v]) => { const d = p ? sig(v - (sp[k] || 0)) : null; return [k, v, d ? d.t : '', d ? d.c : '']; }));
      const pw = p ? Object.fromEntries(p.items.map(x => [x[0], x[1]])) : null;
      const top = r.items.slice(0, 10), topR = top.map(x => r2(x[1])), topSum = r2(sum(topR)), eln = r2(r.eln || 0), other = r2(100 - topSum - eln);
      $('hmDonut').innerHTML = donutSVG(top.map((x, n) => ({n: `${n + 1}. ${nm(x[0])} (${x[0]})`, v: topR[n], c: `var(--r${n + 1})`})).concat([{n: 'ELN 합계', v: eln, c: 'var(--s2)'}, {n: `그 밖의 주식 ${r.items.length - 10}종목·현금`, v: other, c: 'var(--other)'}]), topSum, eln, other);
      $('hmTopCap').textContent = p ? `비중 아래의 작은 숫자는 ${plabel} 대비 변화입니다` : '';
      const dl = (k, w) => !pw ? '' : pw[k] == null ? '<span class="d up">신규</span>' : dspan(sig(w - pw[k]));
      $('hmTop').innerHTML = `<thead><tr><th class="num">순위</th><th>종목</th><th>섹터</th><th class="num">비중</th></tr></thead><tbody>` +
        top.map(([k, w], n) => `<tr><td class="num">${n + 1}</td><td><span class="nm"><span class="sw" style="background:var(--r${n + 1})"></span>${esc(nm(k))}<span class="tk">${k}</span></span></td><td>${esc(sk(k))}</td><td class="num">${topR[n].toFixed(2)}%${dl(k, w)}</td></tr>`).join('') +
        `<tr class="fold"><td class="num">–</td><td><span class="nm"><span class="sw" style="background:var(--s2)"></span>ELN 합계<span class="tk">${r.elnCount || ''}개</span></span></td><td>${ELN}</td><td class="num">${eln.toFixed(2)}%${p ? dspan(sig(eln - (p.eln || 0))) : ''}</td></tr>` +
        `<tr class="fold"><td class="num">–</td><td><span class="nm"><span class="sw" style="background:var(--other)"></span>기타<span class="tk">주식 ${r.items.length - 10}종목·현금</span></span></td><td>–</td><td class="num">${other.toFixed(2)}%</td></tr>` +
        `<tr class="sum"><td></td><td>합계</td><td></td><td class="num">100.00%</td></tr></tbody>`;
      if (!p) $('hmMoves').innerHTML = '<div class="moves cap">기록이 시작된 달이어서 비교할 직전 기록이 없습니다.</div>';
      else {
        const a = new Set(r.items.map(x => x[0])), b = new Set(p.items.map(x => x[0]));
        const ins = r.items.filter(x => !b.has(x[0])), outs = p.items.filter(x => !a.has(x[0]));
        const chip = (x, c) => `<span class="t ${c}" data-tip="${esc(`${nm(x[0])} ${x[1].toFixed(2)}%`)}">${esc(nm(x[0]))} <span class="tk" style="margin:0">${x[0]}</span></span>`;
        $('hmMoves').innerHTML = (ins.length || outs.length)
          ? `<div class="moves"><b>신규 편입 ${ins.length}</b>${ins.map(x => chip(x, 'in')).join('') || '<span class="cap">없음</span>'}</div><div class="moves"><b>편출 ${outs.length}</b>${outs.map(x => chip(x, 'out')).join('') || '<span class="cap">없음</span>'}</div>`
          : `<div class="moves cap">직전 기록과 주식 종목 구성은 같고 비중만 달라졌습니다.</div>`;
      }
      drawTrend();
    };
    const mi = m => +m.slice(0, 4) * 12 + +m.slice(5, 7) - 1, M0 = mi(MS[0].month), NM = mi(MS[MS.length - 1].month) - M0 + 1;
    function drawTrend() {
      const host = $('hmTrend'), W = hostW(host), H = 210, pb = 20, ph = H - pb, n = Math.max(NM, 12), bw = W / n; let g = '';
      MS.forEach(r => {
        const i = mi(r.month) - M0, o = {}; Object.entries(secOf(r)).forEach(([s, v]) => { const k = groupOf(s); o[k] = (o[k] || 0) + v; });
        let y = ph; const x = i * bw + Math.min(1, bw * 0.1), w = Math.max(2, bw - 2 * Math.min(1, bw * 0.1));
        const tipHtml = `<b>${ymk(r.month)}</b>` + GROUPS.filter(s => o[s]).map(s => `<br><i style="background:${gcol(s)}"></i>${esc(s)} ${o[s].toFixed(2)}%`).join('');
        GROUPS.forEach(s => { const v = o[s] || 0; if (!v) return; const h = v / 100 * ph; y -= h; g += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${Math.max(0, h - 1).toFixed(2)}" fill="${gcol(s)}"/>`; });
        if (r.month === selected) g += `<rect x="${(i * bw + 1).toFixed(2)}" y="1" width="${(bw - 2).toFixed(2)}" height="${ph - 2}" fill="none" stroke="var(--ink)" stroke-width="2"/>`;
        g += `<rect x="${(i * bw).toFixed(2)}" y="0" width="${bw.toFixed(2)}" height="${ph}" fill="transparent" data-m="${r.month}" data-tip="${esc(tipHtml)}"/>`;
      });
      for (let i = 0; i < NM; i++) { const m = M0 + i; if (m % 12 === 0) g += `<text x="${(i * bw).toFixed(1)}" y="${H - 5}">${Math.floor(m / 12)}</text>`; }
      setSvg(host, W, H, g, '월별 섹터·ELN 비중 누적 막대');
    }
    $('hmTrend').addEventListener('click', e => { const m = e.target.getAttribute && e.target.getAttribute('data-m'); if (m) draw(m); });
    $('hmSel').addEventListener('change', e => draw(e.target.value));
    $('hmLegend').innerHTML = GROUPS.map(s => `<span><i style="background:${gcol(s)}"></i>${esc(s)}</span>`).join('');
    redraws.push(drawTrend); draw(selected);
  })();

  /* ----- 국내 JEPQ형 ETF ----- */
  const KRX = [];
  if (D.kr) (() => {
    const K = D.kr, ORDER = K.order, E = c => K.etfs[c];
    const lastKR = ORDER.map(c => E(c).history[E(c).history.length - 1][0]).sort().pop();
    const eom = new Date(Date.UTC(+lastKR.slice(0, 4), +lastKR.slice(4, 6), 0)), AS_OF = eom.toISOString().slice(0, 10), FROM = yearsBack(AS_OF, 1);
    const iso = s => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    $('krAsOf').textContent = `${AS_OF} 기준 최근 12개월`;
    let h = `<thead><tr><th>종목</th><th class="num">실부담비용</th><th>분배 시점</th><th class="num">최근 분배금</th><th class="num">12개월 분배금</th><th class="num">12개월 분배율</th></tr></thead><tbody>`;
    ORDER.forEach(c => {
      const e = E(c), xs = e.history.filter(x => iso(x[0]) > FROM && iso(x[0]) <= AS_OF), last = xs[xs.length - 1], s12 = sum(xs, x => x[1]);
      const px = last && last[2] > 0 ? last[1] / (last[2] / 100) : null, x = e.cost;
      KRX.push({code: c, name: e.name, listed: e.listed, real: x ? x.real : null, fee: x ? x.total_fee : e.fee * 100, last: last[1], lastDate: iso(last[0]), s12, n: xs.length, px, yld: px ? s12 / px : null});
      const costCell = x
        ? `<span data-tip="${esc(`총보수 ${x.total_fee.toFixed(4)}%<br>기타비용 ${x.other.toFixed(4)}%<br>매매·중개수수료 ${x.trading.toFixed(4)}%${x.sales ? `<br>판매수수료 ${x.sales.toFixed(4)}%` : ''}<br>금융투자협회 ${x.basis} 기준`)}" style="border-bottom:1px dotted var(--muted);cursor:help">${x.real.toFixed(4)}%</span><span class="d flat">총보수 ${x.total_fee.toFixed(4)}%</span>`
        : `${(e.fee * 100).toFixed(4)}%<span class="d flat">총보수</span>`;
      h += `<tr><td>${esc(e.name)} <span class="tk" style="margin:0">${c}</span>${e.listed ? `<span class="d flat">${e.listed} 상장</span>` : ''}</td><td class="num">${costCell}</td><td>${esc(e.timing || '')}</td>` +
        `<td class="num">${won(last[1])}<span class="d flat">${iso(last[0])}</span></td><td class="num">${won(s12)}<span class="d flat">${xs.length}회</span></td>` +
        `<td class="num">${px ? `${(s12 / px * 100).toFixed(2)}%<span class="d flat">÷ ${won(px)}</span>` : '-'}</td></tr>`;
    });
    const sl = R.filter(r => r.ex <= AS_OF && r.yld != null).pop();
    if (sl) h += `<tr class="ref"><td>JEPQ <span class="tk" style="margin:0">미국 직접투자 · 참고</span></td><td class="num">${(META.jepq_fee * 100).toFixed(2)}%<span class="d flat">총보수만</span></td><td>매월(월초 배당락)</td>` +
      `<td class="num">${usd(sl.amt)}<span class="d flat">${sl.ex}</span></td><td class="num">${usd(sl.ttm)}<span class="d flat">12회 · ~${sl.ex}</span></td><td class="num">${(sl.yld * 100).toFixed(2)}%<span class="d flat">÷ ${usd(sl.close, 2)}</span></td></tr>`;
    $('krtable').innerHTML = h + '</tbody>';
    const cb = ORDER.map(c => E(c).cost && E(c).cost.basis).filter(Boolean).sort().pop();
    $('krCostCap').textContent = cb ? `실부담비용은 총보수에 기타비용과 매매·중개수수료(판매수수료 포함)를 더한 값이며, 금융투자협회 공시 ${cb} 기준입니다(월 1회 공시, 약 한 달 뒤 공개). 숫자를 누르거나 마우스를 올리면 항목별 수치를 볼 수 있습니다. JEPQ의 ${(META.jepq_fee * 100).toFixed(2)}%는 총보수(Expense Ratio)만 반영한 값이어서 국내 ETF 실부담비용과 기준이 다릅니다. 증권사 수수료와 환전 비용은 양쪽 모두 포함되지 않았습니다.` : '';
    const first = ORDER.map(c => E(c).history[0][0]).sort()[0], fy = +first.slice(0, 4), fm = +first.slice(4, 6);
    const all = []; { let y = +AS_OF.slice(0, 4), m = +AS_OF.slice(5, 7); while (y > fy || (y === fy && m >= fm)) { all.unshift([y, m]); m--; if (!m) { m = 12; y--; } } }
    let showAll = false;
    const drawM = () => {
      const ms = showAll ? all : all.slice(-12);
      let t = `<thead><tr><th>월 합계</th>${ORDER.map(c => `<th>${esc(E(c).name.split(' ')[0])}<small>${c}</small></th>`).join('')}<th>JEPQ (USD)<small>지급월</small></th></tr></thead><tbody>`;
      [...ms].reverse().forEach(([yy, mm]) => {
        t += `<tr><td class="yr">${yy}.${pad2(mm)}</td>`;
        ORDER.forEach(c => {
          const key = `${yy}${pad2(mm)}`, pkey = `${yy - 1}${pad2(mm)}`, hist = E(c).history;
          const xs = hist.filter(x => x[0].slice(0, 6) === key), prev = hist.filter(x => x[0].slice(0, 6) === pkey);
          const s = sum(xs, x => x[1]), p = sum(prev, x => x[1]), ls = (E(c).listed || '').replace(/-/g, '');
          if (!xs.length && ls && `${key}31` < ls) { t += `<td><span class="d flat">상장 전</span></td>`; return; }
          t += xs.length ? `<td>${won(s)}${p && prev.length === xs.length ? `<span class="d ${tone(s / p - 1)}">${pct(s / p - 1, 1)}</span>` : ''}</td>` : `<td class="na">·</td>`;
        });
        const r = find(yy, mm);
        t += r ? `<td>${usd(r.amt)}${r.yoy != null ? `<span class="d ${tone(r.yoy)}">${pct(r.yoy, 1)}</span>` : ''}</td>` : '<td class="na">·</td>';
        t += '</tr>';
      });
      $('krm').innerHTML = t + '</tbody>';
      const b = $('krmToggle'); b.setAttribute('aria-expanded', showAll);
      b.textContent = showAll ? '최근 12개월만 보기 ▴' : `이전 달 모두 보기 ▾ (${fy}.${pad2(fm)}부터 ${all.length}개월)`;
      b.hidden = all.length <= 12;
    };
    $('krmToggle').addEventListener('click', () => { showAll = !showAll; drawM(); });
    drawM();
    $('krNote').innerHTML = `<p class="bh">세 종목의 분배율이 서로 다른 이유</p>
      <p>세 종목 모두 나스닥100에 커버드콜(콜옵션 매도) 전략을 결합한 상품이지만, 추종하는 지수의 옵션 전략이 각각 다르고 JEPQ와도 다릅니다.</p>
      <ol>${ORDER.map(c => `<li><b>${esc(E(c).name)}</b><span class="sub">기초지수: ${esc(E(c).index || '-')}</span></li>`).join('')}
      <li><b>JEPQ</b><span class="sub">지수를 추종하지 않는 액티브 ETF이며, 나스닥100 중심의 주식과 콜옵션 매도 수익을 담은 ELN으로 구성됩니다.</span></li></ol>
      <p>옵션을 더 많이, 더 자주 매도할수록 분배금은 커지지만 주가 상승에 참여하는 비율은 줄어듭니다. 분배율만으로 우열을 판단하기 어려우므로 같은 기간의 총수익(분배 재투자 포함)을 함께 확인하시기 바랍니다.</p>`;
  })();


  return {HOLD, hmApi, KRX};
}
boot();
})();
