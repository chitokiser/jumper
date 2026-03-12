// /assets/js/pages/exchange.js
// JUMP 토큰 거래소 UI + 가격 차트

import { auth, functions } from '../firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable }      from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

// ─────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function setText(id, v) {
  const el = $(id);
  if (el) el.textContent = v;
}

/** HEX wei (18 decimals) 숫자를 최대 6자리 */
function fmtHex(wei) {
  if (!wei || wei === '0') return '0';
  const n = Number(BigInt(wei)) / 1e18;
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 });
}

/** JUMP (0 decimals) 정수 */
function fmtJump(raw) {
  if (!raw || raw === '0') return '0';
  return Number(raw).toLocaleString();
}

/** Unix timestamp 기준 남은 시간 표시 (addDays 만큼 더함) */
function fmtTimeLeft(ts, addDays = 0) {
  if (!ts || ts === '0') return '-';
  const targetTs = Number(ts) + addDays * 86400;
  const msLeft   = targetTs * 1000 - Date.now();
  if (msLeft <= 0) return '만료';
  const days = Math.ceil(msLeft / 86400000);
  const d    = new Date(targetTs * 1000);
  const ymd  = d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${ymd} (${days}일 남음)`;
}

// ─────────────────────────────────────────────────
// 캔들차트 (chartjs-chart-financial)
// ─────────────────────────────────────────────────
let _chart     = null;
let _allOhlc   = [];   // 전체 캔들 캐시
let _tfLimit   = 0;    // 0 = 전체, N = 최근 N개

/** 가격 배열 → OHLC 캔들 배열 변환 */
function buildOHLC(prices) {
  if (!prices || prices.length < 2) return [];

  const TARGET  = 80;
  const bucket  = Math.max(1, Math.ceil((prices.length - 1) / TARGET));
  const now     = Date.now();
  const candles = [];
  const total   = Math.ceil((prices.length - 1) / bucket);

  for (let i = 1; i < prices.length; i += bucket) {
    const slice = prices.slice(i - 1, i + bucket);
    const o = slice[0];
    const c = slice[slice.length - 1];
    const hi = Math.max(...slice);
    const lo = Math.min(...slice);
    const mid = (hi + lo) / 2 || 1;
    const minWick = mid * 0.003;

    candles.push({
      x: now - (total - candles.length) * 3_600_000,
      o,
      h: hi + minWick,
      l: Math.max(0, lo - minWick),
      c,
    });
  }
  return candles;
}

/** 티커 헤더 현재가 + 등락율 업데이트 */
function updateChartHeader(prices) {
  const priceEl  = $('chartCurrentPrice');
  const changeEl = $('chartPriceChange');
  if (!priceEl || prices.length === 0) return;

  const last  = prices[prices.length - 1];
  const first = prices[0];
  priceEl.textContent = last.toFixed(6) + ' HEX';
  priceEl.className   = 'ex-ticker-price';   // 기본 색

  if (changeEl && first > 0) {
    const pct  = ((last - first) / first) * 100;
    const sign = pct >= 0 ? '+' : '';
    changeEl.textContent = `${sign}${pct.toFixed(2)}%`;
    changeEl.className   = 'ex-ticker-change ' + (pct >= 0 ? 'pos' : 'neg');
    priceEl.classList.add(pct >= 0 ? 'up' : 'dn');
  }
}

/** OHLC 인라인 바 업데이트 */
function updateOhlcBar(d) {
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v.toFixed(6); };
  set('ohlcO', d.o); set('ohlcH', d.h); set('ohlcL', d.l); set('ohlcC', d.c);
}

/** 차트 데이터셋만 교체 (재생성 없이) */
function applyTfFilter() {
  if (!_chart || !_allOhlc.length) return;
  const data = _tfLimit > 0 ? _allOhlc.slice(-_tfLimit) : _allOhlc;
  _chart.data.datasets[0].data = data;
  _chart.update('none');
  if (data.length) updateOhlcBar(data[data.length - 1]);
}

/** TF 변경 핸들러 (HTML에서 호출) */
window.__exchangeSetTf = (limit) => {
  _tfLimit = limit;
  applyTfFilter();
};

function renderChart(pricesRaw) {
  const canvas = $('priceChart');
  if (!canvas || !pricesRaw || pricesRaw.length === 0) return;

  const prices = pricesRaw.map(p => Number(BigInt(p)) / 1e18);
  _allOhlc     = buildOHLC(prices);
  if (_allOhlc.length === 0) return;

  updateChartHeader(prices);

  const visData = _tfLimit > 0 ? _allOhlc.slice(-_tfLimit) : _allOhlc;
  if (visData.length) updateOhlcBar(visData[visData.length - 1]);

  if (_chart) { _chart.destroy(); _chart = null; }

  _chart = new Chart(canvas, {
    type: 'candlestick',
    data: {
      datasets: [{
        label: 'JUMP/HEX',
        data:  visData,
        color: {
          up:        'rgba(38,166,154,0.9)',
          down:      'rgba(239,83,80,0.9)',
          unchanged: 'rgba(120,123,134,0.9)',
        },
        borderColor: {
          up:        '#26a69a',
          down:      '#ef5350',
          unchanged: '#787b86',
        },
      }],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation:           false,
      layout: { padding: { left: 4, right: 4, top: 8, bottom: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          mode:            'index',
          intersect:       false,
          backgroundColor: '#1e222d',
          titleColor:      '#9598a1',
          bodyColor:       '#d1d4dc',
          borderColor:     '#363a45',
          borderWidth:     1,
          padding:         10,
          callbacks: {
            title: (items) => {
              const d = new Date(items[0].raw.x);
              return d.toLocaleString('ko-KR');
            },
            label: (ctx) => {
              const d = ctx.raw;
              updateOhlcBar(d);
              return [
                ` O  ${d.o.toFixed(6)}`,
                ` H  ${d.h.toFixed(6)}`,
                ` L  ${d.l.toFixed(6)}`,
                ` C  ${d.c.toFixed(6)}`,
              ];
            },
          },
        },
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'hour', displayFormats: { hour: 'MM/dd HH시' } },
          ticks: {
            maxTicksLimit: 10,
            color: '#555',
            font: { size: 10 },
            maxRotation: 0,
          },
          grid: { color: '#1a1e2a', drawBorder: false },
          border: { color: '#2a2e39' },
        },
        y: {
          position: 'right',
          ticks: {
            callback: (v) => v.toFixed(5),
            color: '#555',
            font:  { size: 10 },
            maxTicksLimit: 8,
          },
          grid:   { color: '#1a1e2a', drawBorder: false },
          border: { color: '#2a2e39' },
        },
      },
    },
  });
}

// ─────────────────────────────────────────────────
// 상태 캐시
// ─────────────────────────────────────────────────
let _status = null;

// ─────────────────────────────────────────────────
// 상태 로드 + 화면 업데이트
// ─────────────────────────────────────────────────
async function loadStatus() {
  setText('exState', '로딩 중...');
  try {
    const fn  = httpsCallable(functions, 'getJumpBankStatus');
    const res = await fn();
    _status   = res.data;

    const actLabel = { 0: '미등록', 1: '구매', 2: '구매+배당', 3: '완료' };

    // 현재가격 ROI = (price - BASE_PRICE) / BASE_PRICE × 100
    // BASE_PRICE = 0.01 HEX = 1e16 wei
    const BASE    = 10000000000000000n;
    const priceBI = BigInt(_status.price || '0');
    const roiPct  = priceBI > BASE
      ? Number((priceBI - BASE) * 100000n / BASE) / 1000
      : 0;

    // 기본 정보 업데이트
    setText('exBankHex',     fmtHex(_status.bankHexBalance));
    setText('exBankJump',    fmtJump(_status.bankJumpInventory));
    setText('exPriceRoi',  roiPct.toFixed(3) + ' %');
    setText('exPrice',     fmtHex(_status.price));
    const krw    = Number(_status.priceKrw    || 0);
    const usdKrw = Number(_status.usdKrwRate  || 0);
    setText('exPriceKrw', krw > 0 ? krw.toLocaleString() + '원' : '-');
    setText('exUsdKrw',   usdKrw > 0 ? '환율 ' + usdKrw.toLocaleString() + '/USD' : '');
    setText('exStaked',    fmtJump(_status.staked));

    setText('exTotalStaked', fmtJump(_status.totalStaked));
    setText('exBuyCap',      fmtJump(_status.buyCap));
    setText('exPerTokenDiv', fmtHex(_status.perTokenDiv));
    setText('exTotalBuy',    fmtJump(_status.totalBuy));
    setText('exJumpBal',     fmtJump(_status.jumpBalance));

    setText('exPendingDiv',  fmtHex(_status.pendingDividend));
    setText('exUnstakeLeft', fmtTimeLeft(_status.stakingTime, 120));
    setText('exClaimLeft',   fmtTimeLeft(_status.lastClaim, 7));
    const myStakedJump   = BigInt(_status.staked || '0');
    const myHoldJump     = BigInt(_status.jumpBalance || '0');
    const myTotalJump    = myStakedJump + myHoldJump;
    const currentPrice   = BigInt(_status.price || '0');
    const myMarketCapWei = myTotalJump * currentPrice;
    setText('exMyMarketCap', fmtHex(myMarketCapWei.toString()));
    setText('exMyAvgPrice',  fmtHex(_status.myAvgBuyPrice));

    // ROI (색상 포함)
    const roiBps = Number(_status.myRoiBps || '0');
    const roiEl  = $('exMyRoi');
    if (roiEl) {
      roiEl.textContent = (roiBps >= 0 ? '+' : '') + (roiBps / 100).toFixed(2) + ' %';
      roiEl.className   = 'ex-info-val' + (roiBps > 0 ? ' pos' : roiBps < 0 ? ' neg' : '');
    }

    const aBps = _status.autoStakeBps ?? 1000;
    setText('exAutoStake', aBps + ' bps (' + (aBps / 100).toFixed(0) + '%)');
    setText('exRate',      (_status.rate ?? 3) + ' %');
    setText('exAct',       actLabel[_status.act] ?? String(_status.act));
    setText('exHexBal',    fmtHex(_status.hexBalance));

    // 티커 헤더 보조 정보
    setText('tickerRoi',      roiPct.toFixed(3) + ' %');
    setText('tickerKrw',      krw > 0 ? krw.toLocaleString() + '원' : '-');
    setText('tickerBankHex',  fmtHex(_status.bankHexBalance));
    setText('tickerBankJump', fmtJump(_status.bankJumpInventory));
    setText('tickerAct',      actLabel[_status.act] ?? String(_status.act));

    // 사이드바 포지션 패널
    setText('sideJumpBal',   fmtJump(_status.jumpBalance));
    setText('sideStaked',    fmtJump(_status.staked));
    setText('sideHexBal',    fmtHex(_status.hexBalance));
    setText('sideAvgPrice',  fmtHex(_status.myAvgBuyPrice));
    setText('sideMarketCap', fmtHex(myMarketCapWei.toString()));
    setText('sidePendingDiv',fmtHex(_status.pendingDividend));
    setText('sideClaimLeft', fmtTimeLeft(_status.lastClaim, 7));
    setText('sideUnstakeLeft', fmtTimeLeft(_status.stakingTime, 120));
    const sideRoiEl = $('sideRoi');
    if (sideRoiEl) {
      sideRoiEl.textContent = (roiBps >= 0 ? '+' : '') + (roiBps / 100).toFixed(2) + ' %';
      sideRoiEl.style.color = roiBps > 0 ? '#26a69a' : roiBps < 0 ? '#ef5350' : '#9598a1';
    }

    // 가격 차트 업데이트
    if (_status.chart && _status.chart.length > 0) {
      renderChart(_status.chart);
    }

    setText('exState', '');
  } catch (err) {
    setText('exState', '오류: ' + (err.message || '알 수 없는 오류'));
  }
}

// ─────────────────────────────────────────────────
// 버튼 헬퍼
// ─────────────────────────────────────────────────
function setLoading(btnId, loading, label) {
  const btn = $(btnId);
  if (!btn) return;
  btn.disabled    = loading;
  btn.textContent = loading ? '처리 중...' : label;
}

function setStatus(id, msg, isErr = false) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = msg;
  el.className = 'ex-status' + (isErr ? ' err' : '');
}

// ─────────────────────────────────────────────────
// 구매
// ─────────────────────────────────────────────────
function bindBuy() {
  const btn = $('btnBuy');
  if (!btn) return;

  $('inputBuyAmount')?.addEventListener('input', () => {
    const previewEl = $('buyPreview');
    if (!previewEl) return;
    const amount = parseInt($('inputBuyAmount')?.value, 10);
    if (!amount || amount <= 0 || !_status?.price) { previewEl.style.display = 'none'; return; }
    const hexCost = BigInt(_status.price) * BigInt(amount);
    const krwCost = amount * Number(_status.priceKrw || 0);
    previewEl.innerHTML =
      `필요 HEX: <strong>${fmtHex(hexCost.toString())}</strong>` +
      (krwCost > 0 ? `<br>약 <strong>${krwCost.toLocaleString()}</strong>원` : '');
    previewEl.style.display = '';
  });

  btn.onclick = async () => {
    const amount = parseInt($('inputBuyAmount')?.value, 10);
    if (!amount || amount <= 0) { alert('구매 수량을 입력하세요'); return; }
    if (_status) {
      const hexCost = BigInt(_status.price) * BigInt(amount);
      const hexBal  = BigInt(_status.hexBalance || '0');
      if (hexBal < hexCost) {
        alert(`HEX 잔액 부족\n필요: ${fmtHex(hexCost.toString())} HEX\n보유: ${fmtHex(_status.hexBalance)} HEX`);
        return;
      }
      if (!confirm(`JUMP ${amount}개 구매\n필요 HEX: ${fmtHex(hexCost.toString())}\n진행하시겠습니까?`)) return;
    }
    setLoading('btnBuy', true, '구매');
    setStatus('buyStatus', '처리 중...');
    try {
      const fn  = httpsCallable(functions, 'buyJumpToken');
      const res = await fn({ jumpAmount: amount });
      setStatus('buyStatus', `완료! JUMP: ${fmtJump(res.data.jumpAmount)} / 사용 HEX: ${fmtHex(res.data.hexCost)}`);
      await loadStatus();
    } catch (err) {
      setStatus('buyStatus', '실패: ' + (err.message || String(err)), true);
    } finally {
      setLoading('btnBuy', false, '구매');
    }
  };
}

// ─────────────────────────────────────────────────
// 매도
// ─────────────────────────────────────────────────
function bindSell() {
  const btn = $('btnSell');
  if (!btn) return;
  btn.onclick = async () => {
    const amount = parseInt($('inputSellAmount')?.value, 10);
    if (!amount || amount <= 0) { alert('매도 수량을 입력하세요'); return; }
    if (_status && BigInt(_status.jumpBalance || '0') < BigInt(amount)) {
      alert('JUMP 잔액 부족'); return;
    }
    if (!confirm(`JUMP ${amount}개 매도 (수수료 ${_status?.rate ?? 3}% 공제)\n진행하시겠습니까?`)) return;
    setLoading('btnSell', true, '매도');
    setStatus('sellStatus', '처리 중...');
    try {
      const fn  = httpsCallable(functions, 'sellJumpToken');
      const res = await fn({ jumpAmount: amount });
      setStatus('sellStatus', `완료! TxHash: ${res.data.txHash.slice(0, 14)}...`);
      await loadStatus();
    } catch (err) {
      setStatus('sellStatus', '실패: ' + (err.message || String(err)), true);
    } finally {
      setLoading('btnSell', false, '매도');
    }
  };
}

// ─────────────────────────────────────────────────
// 스테이킹
// ─────────────────────────────────────────────────
function bindStake() {
  const btn = $('btnStake');
  if (!btn) return;
  btn.onclick = async () => {
    const amount = parseInt($('inputStakeAmount')?.value, 10);
    if (!amount || amount <= 0) { alert('수량을 입력하세요'); return; }
    if (_status && BigInt(_status.jumpBalance || '0') < BigInt(amount)) {
      alert('JUMP 잔액 부족'); return;
    }
    if (!confirm(`JUMP ${amount}개 스테이킹\n약 120일 후 언스테이킹 가능\n진행하시겠습니까?`)) return;
    setLoading('btnStake', true, '스테이킹');
    setStatus('stakeStatus', '처리 중...');
    try {
      const fn  = httpsCallable(functions, 'stakeJumpToken');
      const res = await fn({ jumpAmount: amount });
      setStatus('stakeStatus', `완료! TxHash: ${res.data.txHash.slice(0, 14)}...`);
      await loadStatus();
    } catch (err) {
      setStatus('stakeStatus', '실패: ' + (err.message || String(err)), true);
    } finally {
      setLoading('btnStake', false, '스테이킹');
    }
  };
}

function bindUnstake() {
  const btn = $('btnUnstake');
  if (!btn) return;
  btn.onclick = async () => {
    if (!confirm('스테이킹된 JUMP를 모두 반환합니다\n(120일 미만이면 패널티가 있습니다)\n진행하시겠습니까?')) return;
    setLoading('btnUnstake', true, '언스테이킹');
    setStatus('stakeStatus', '처리 중...');
    try {
      const fn  = httpsCallable(functions, 'unstakeJumpToken');
      const res = await fn();
      setStatus('stakeStatus', `언스테이킹 완료! TxHash: ${res.data.txHash.slice(0, 14)}...`);
      await loadStatus();
    } catch (err) {
      setStatus('stakeStatus', '실패: ' + (err.message || String(err)), true);
    } finally {
      setLoading('btnUnstake', false, '언스테이킹');
    }
  };
}

// ─────────────────────────────────────────────────
// 배당 클레임
// ─────────────────────────────────────────────────
function bindClaim() {
  const btn = $('btnClaim');
  if (!btn) return;
  btn.onclick = async () => {
    if (_status && BigInt(_status.pendingDividend || '0') === 0n) {
      alert('클레임할 배당이 없습니다'); return;
    }
    if (!confirm(`배당 ${fmtHex(_status?.pendingDividend || '0')} HEX를 클레임합니다\n진행하시겠습니까?`)) return;
    setLoading('btnClaim', true, '클레임');
    setStatus('claimStatus', '처리 중...');
    try {
      const fn  = httpsCallable(functions, 'claimJumpDividend');
      const res = await fn();
      setStatus('claimStatus', `완료! 수령 HEX: ${fmtHex(res.data.hexAmount)}`);
      await loadStatus();
    } catch (err) {
      setStatus('claimStatus', '실패: ' + (err.message || String(err)), true);
    } finally {
      setLoading('btnClaim', false, '클레임');
    }
  };
}

// ─────────────────────────────────────────────────
// 초기화
// ─────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    const n = $('exLoginNotice');
    const m = $('exMain');
    if (n) n.style.display = '';
    if (m) m.style.display = 'none';
    return;
  }

  const n = $('exLoginNotice');
  const m = $('exMain');
  if (n) n.style.display = 'none';
  if (m) m.style.display = '';

  const btnRefresh = $('btnRefresh');
  if (btnRefresh) btnRefresh.onclick = loadStatus;

  bindBuy();
  bindSell();
  bindStake();
  bindUnstake();
  bindClaim();

  await loadStatus();
});
