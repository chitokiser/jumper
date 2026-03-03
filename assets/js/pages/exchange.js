// /assets/js/pages/exchange.js
// JUMP 거래소 — 대시보드 UI + 가격 차트

import { auth, functions } from '../firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable }      from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

// ─────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function setText(id, v) {
  const el = $(id);
  if (el) el.textContent = v;
}

/** HEX wei (18 decimals) → 소수점 최대 6자리 */
function fmtHex(wei) {
  if (!wei || wei === '0') return '0';
  const n = Number(BigInt(wei)) / 1e18;
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 });
}

/** JUMP (0 decimals) → 정수 */
function fmtJump(raw) {
  if (!raw || raw === '0') return '0';
  return Number(raw).toLocaleString();
}

/** Unix timestamp → 남은 시간 문자열 (addDays 후를 기준) */
function fmtTimeLeft(ts, addDays = 0) {
  if (!ts || ts === '0') return '-';
  const targetTs = Number(ts) + addDays * 86400;
  const msLeft   = targetTs * 1000 - Date.now();
  if (msLeft <= 0) return '가능';
  const days = Math.ceil(msLeft / 86400000);
  const d    = new Date(targetTs * 1000);
  const ymd  = d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${ymd} (${days}일 후)`;
}

// ─────────────────────────────────────────────────────────
// 가격 차트 (Chart.js)
// ─────────────────────────────────────────────────────────
let _chart = null;

function renderChart(prices) {
  const canvas = $('priceChart');
  if (!canvas || !prices || prices.length === 0) return;

  const data   = prices.map(p => Number(BigInt(p)) / 1e18);
  const labels = data.map((_, i) => i + 1);

  if (_chart) {
    _chart.data.labels            = labels;
    _chart.data.datasets[0].data  = data;
    _chart.update('none');
    return;
  }

  _chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label:           'JUMP 가격 (HEX)',
        data,
        borderColor:     '#06b6d4',
        backgroundColor: 'rgba(6,182,212,0.07)',
        borderWidth:     2,
        pointRadius:     data.length > 20 ? 0 : 3,
        tension:         0.25,
        fill:            true,
      }],
    },
    options: {
      responsive: true,
      animation:  false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (ctx) => `${ctx.parsed.y.toFixed(6)} HEX` },
        },
      },
      scales: {
        x: { display: false },
        y: {
          ticks: { callback: (v) => v.toFixed(4) },
          grid:  { color: '#f0f0f0' },
        },
      },
    },
  });
}

// ─────────────────────────────────────────────────────────
// 상태 캐시
// ─────────────────────────────────────────────────────────
let _status = null;

// ─────────────────────────────────────────────────────────
// 상태 로드 + 렌더링
// ─────────────────────────────────────────────────────────
async function loadStatus() {
  setText('exState', '로딩 중...');
  try {
    const fn  = httpsCallable(functions, 'getJumpBankStatus');
    const res = await fn();
    _status   = res.data;

    const actLabel = { 0: '중단', 1: '구매만', 2: '구매+배당', 3: '전체' };

    // 현재가격 ROI = (price - BASE_PRICE) / BASE_PRICE × 100
    // BASE_PRICE = 0.01 HEX = 1e16 wei
    const BASE    = 10000000000000000n;
    const priceBI = BigInt(_status.price || '0');
    const roiPct  = priceBI > BASE
      ? Number((priceBI - BASE) * 100000n / BASE) / 1000
      : 0;

    // ── 정보 그리드 ──
    setText('exBankHex',     fmtHex(_status.bankHexBalance));
    setText('exBankJump',    fmtJump(_status.bankJumpInventory));
    setText('exPriceRoi',  roiPct.toFixed(3) + ' %');
    setText('exPrice',     fmtHex(_status.price));
    const krw = Number(_status.priceKrw || '0');
    setText('exPriceKrw', krw > 0 ? krw.toLocaleString() + ' 원' : '-');
    setText('exStaked',    fmtJump(_status.staked));

    setText('exTotalStaked', fmtJump(_status.totalStaked));
    setText('exBuyCap',      fmtJump(_status.buyCap));
    setText('exPerTokenDiv', fmtHex(_status.perTokenDiv));
    setText('exTotalBuy',    fmtJump(_status.totalBuy));
    setText('exJumpBal',     fmtJump(_status.jumpBalance));

    setText('exPendingDiv',  fmtHex(_status.pendingDividend));
    setText('exUnstakeLeft', fmtTimeLeft(_status.stakingTime, 120));
    setText('exClaimLeft',   fmtTimeLeft(_status.lastClaim, 7));
    setText('exMyMarketCap', fmtHex(_status.myMarketCap));
    setText('exMyAvgPrice',  fmtHex(_status.myAvgBuyPrice));

    // ROI (색상 포함)
    const roiBps = Number(_status.myRoiBps || '0');
    const roiEl  = $('exMyRoi');
    if (roiEl) {
      roiEl.textContent = (roiBps >= 0 ? '+' : '') + (roiBps / 100).toFixed(2) + ' %';
      roiEl.className   = 'ex-box-value' + (roiBps > 0 ? ' pos' : roiBps < 0 ? ' neg' : '');
    }

    const aBps = _status.autoStakeBps ?? 1000;
    setText('exAutoStake', aBps + ' bps (' + (aBps / 100).toFixed(0) + '%)');
    setText('exRate',      (_status.rate ?? 3) + ' %');
    setText('exAct',       actLabel[_status.act] ?? String(_status.act));
    setText('exHexBal',    fmtHex(_status.hexBalance));

    // ── 차트 ──
    if (_status.chart && _status.chart.length > 0) {
      renderChart(_status.chart);
    }

    setText('exState', '');
  } catch (err) {
    setText('exState', '오류: ' + (err.message || '조회 실패'));
  }
}

// ─────────────────────────────────────────────────────────
// 버튼 헬퍼
// ─────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────
// 구매
// ─────────────────────────────────────────────────────────
function bindBuy() {
  const btn = $('btnBuy');
  if (!btn) return;
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
      if (!confirm(`JUMP ${amount}개 구매\n필요 HEX: ${fmtHex(hexCost.toString())}\n진행할까요?`)) return;
    }
    setLoading('btnBuy', true, '구매');
    setStatus('buyStatus', '처리 중...');
    try {
      const fn  = httpsCallable(functions, 'buyJumpToken');
      const res = await fn({ jumpAmount: amount });
      setStatus('buyStatus', `완료! JUMP: ${fmtJump(res.data.jumpAmount)} / 소비 HEX: ${fmtHex(res.data.hexCost)}`);
      await loadStatus();
    } catch (err) {
      setStatus('buyStatus', '실패: ' + (err.message || String(err)), true);
    } finally {
      setLoading('btnBuy', false, '구매');
    }
  };
}

// ─────────────────────────────────────────────────────────
// 판매
// ─────────────────────────────────────────────────────────
function bindSell() {
  const btn = $('btnSell');
  if (!btn) return;
  btn.onclick = async () => {
    const amount = parseInt($('inputSellAmount')?.value, 10);
    if (!amount || amount <= 0) { alert('판매 수량을 입력하세요'); return; }
    if (_status && BigInt(_status.jumpBalance || '0') < BigInt(amount)) {
      alert('JUMP 잔액 부족'); return;
    }
    if (!confirm(`JUMP ${amount}개 환매 (수수료 ${_status?.rate ?? 3}% 차감)\n진행할까요?`)) return;
    setLoading('btnSell', true, '환매');
    setStatus('sellStatus', '처리 중...');
    try {
      const fn  = httpsCallable(functions, 'sellJumpToken');
      const res = await fn({ jumpAmount: amount });
      setStatus('sellStatus', `완료! TxHash: ${res.data.txHash.slice(0, 14)}...`);
      await loadStatus();
    } catch (err) {
      setStatus('sellStatus', '실패: ' + (err.message || String(err)), true);
    } finally {
      setLoading('btnSell', false, '환매');
    }
  };
}

// ─────────────────────────────────────────────────────────
// 스테이킹
// ─────────────────────────────────────────────────────────
function bindStake() {
  const btn = $('btnStake');
  if (!btn) return;
  btn.onclick = async () => {
    const amount = parseInt($('inputStakeAmount')?.value, 10);
    if (!amount || amount <= 0) { alert('수량을 입력하세요'); return; }
    if (_status && BigInt(_status.jumpBalance || '0') < BigInt(amount)) {
      alert('JUMP 잔액 부족'); return;
    }
    if (!confirm(`JUMP ${amount}개 스테이킹\n⚠ 120일 후 언스테이킹 가능\n진행할까요?`)) return;
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
    if (!confirm('스테이킹된 JUMP를 모두 출금합니다.\n(120일 미만이면 컨트랙트에서 거부됩니다)\n진행할까요?')) return;
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

// ─────────────────────────────────────────────────────────
// 배당 청구
// ─────────────────────────────────────────────────────────
function bindClaim() {
  const btn = $('btnClaim');
  if (!btn) return;
  btn.onclick = async () => {
    if (_status && BigInt(_status.pendingDividend || '0') === 0n) {
      alert('청구할 배당이 없습니다'); return;
    }
    if (!confirm(`배당 ${fmtHex(_status?.pendingDividend || '0')} HEX를 청구합니다.\n진행할까요?`)) return;
    setLoading('btnClaim', true, '청구');
    setStatus('claimStatus', '처리 중...');
    try {
      const fn  = httpsCallable(functions, 'claimJumpDividend');
      const res = await fn();
      setStatus('claimStatus', `완료! 수령 HEX: ${fmtHex(res.data.hexAmount)}`);
      await loadStatus();
    } catch (err) {
      setStatus('claimStatus', '실패: ' + (err.message || String(err)), true);
    } finally {
      setLoading('btnClaim', false, '청구');
    }
  };
}

// ─────────────────────────────────────────────────────────
// 초기화
// ─────────────────────────────────────────────────────────
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
