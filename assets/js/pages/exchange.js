// /assets/js/pages/exchange.js
// JUMP 거래소 — 현황 / 구매 / 판매 / 스테이킹 / 배당

import { auth, functions } from '../firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable }      from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

// ─────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };

/** HEX wei (18 decimals) → 소수점 4자리 문자열 */
function fmtHex(wei) {
  if (!wei || wei === '0') return '0';
  const n = Number(BigInt(wei)) / 1e18;
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

/** JUMP (0 decimals) → 정수 문자열 */
function fmtJump(raw) {
  if (!raw || raw === '0') return '0';
  return Number(raw).toLocaleString();
}

/** Unix timestamp(초) → 날짜 문자열 */
function fmtDate(ts) {
  if (!ts || ts === '0') return '-';
  return new Date(Number(ts) * 1000).toLocaleDateString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

/** 오늘 + N일 후 날짜 */
function dateAfterDays(tsSec, days) {
  if (!tsSec || tsSec === '0') return '-';
  const d = new Date((Number(tsSec) + days * 86400) * 1000);
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** 남은 일수 계산 */
function daysUntil(tsSec) {
  if (!tsSec || tsSec === '0') return null;
  const ms = Number(tsSec) * 1000 - Date.now();
  return ms > 0 ? Math.ceil(ms / 86400000) : 0;
}

// ─────────────────────────────────────────────────────────
// 탭 전환
// ─────────────────────────────────────────────────────────
const TABS = ['Status', 'Buy', 'Sell', 'Staking', 'Dividend'];

function showTab(name) {
  TABS.forEach((t) => {
    const panel = $('tab' + t);
    const btn   = $('tabBtn' + t);
    if (panel) panel.style.display = (t === name) ? '' : 'none';
    if (btn)   btn.classList.toggle('active', t === name);
  });
}

// ─────────────────────────────────────────────────────────
// 상태 캐시
// ─────────────────────────────────────────────────────────
let _status = null;

// ─────────────────────────────────────────────────────────
// 현황 로드
// ─────────────────────────────────────────────────────────
async function loadStatus() {
  setText('exState', '로딩 중...');
  try {
    const fn   = httpsCallable(functions, 'getJumpBankStatus');
    const res  = await fn();
    _status    = res.data;

    const actLabel = { 0: '중단', 1: '구매만', 2: '구매+배당', 3: '전체' };

    // 현황 탭
    setText('exPrice',       fmtHex(_status.price) + ' HEX / JUMP');
    setText('exTotalStaked', fmtJump(_status.totalStaked) + ' JUMP');
    setText('exAct',         actLabel[_status.act] ?? String(_status.act));
    setText('exHexBal',      fmtHex(_status.hexBalance) + ' HEX');
    setText('exJumpBal',     fmtJump(_status.jumpBalance) + ' JUMP');
    setText('exStaked',      fmtJump(_status.staked) + ' JUMP');
    setText('exPendingDiv',  fmtHex(_status.pendingDividend) + ' HEX');

    // 구매 탭
    setText('buyPrice',  fmtHex(_status.price) + ' HEX / JUMP');
    setText('buyHexBal', fmtHex(_status.hexBalance) + ' HEX');

    // 판매 탭
    setText('sellPrice',   fmtHex(_status.price) + ' HEX / JUMP');
    setText('sellJumpBal', fmtJump(_status.jumpBalance) + ' JUMP');

    // 스테이킹 탭
    setText('stakeJumpBal',    fmtJump(_status.jumpBalance) + ' JUMP');
    setText('stakeStaked',     fmtJump(_status.staked) + ' JUMP');
    setText('stakeTime',       fmtDate(_status.stakingTime));
    const unstakeDate = dateAfterDays(_status.stakingTime, 120);
    const daysLeft    = daysUntil(_status.stakingTime ? String(Number(_status.stakingTime) + 120 * 86400) : '0');
    setText('unstakeAvailDate',
      unstakeDate === '-' ? '-' :
      (daysLeft > 0 ? `${unstakeDate} (${daysLeft}일 후)` : `${unstakeDate} (가능)`)
    );

    // 배당 탭
    setText('divPending',   fmtHex(_status.pendingDividend) + ' HEX');
    setText('divLastClaim', fmtDate(_status.lastClaim));
    const nextClaimDate = dateAfterDays(_status.lastClaim, 7);
    const claimDaysLeft = daysUntil(_status.lastClaim ? String(Number(_status.lastClaim) + 7 * 86400) : '0');
    setText('divNextClaim',
      nextClaimDate === '-' ? '-' :
      (claimDaysLeft > 0 ? `${nextClaimDate} (${claimDaysLeft}일 후)` : `${nextClaimDate} (청구 가능)`)
    );

    setText('exState', '');
  } catch (err) {
    setText('exState', '오류: ' + (err.message || '조회 실패'));
  }
}

// ─────────────────────────────────────────────────────────
// 구매 수량 입력 → HEX 비용 자동 계산
// ─────────────────────────────────────────────────────────
function bindBuyCalc() {
  const input = $('inputBuyAmount');
  if (!input) return;
  input.addEventListener('input', () => {
    const amount = parseInt(input.value, 10);
    if (!_status || !amount || amount <= 0) {
      setText('buyHexCost', '수량 입력 후 자동 계산');
      return;
    }
    const hexCost = BigInt(_status.price) * BigInt(amount);
    setText('buyHexCost', fmtHex(hexCost.toString()) + ' HEX');
  });
}

// ─────────────────────────────────────────────────────────
// 판매 수량 입력 → 수령 HEX 자동 계산 (3% 수수료 차감)
// ─────────────────────────────────────────────────────────
function bindSellCalc() {
  const input = $('inputSellAmount');
  if (!input) return;
  input.addEventListener('input', () => {
    const amount = parseInt(input.value, 10);
    if (!_status || !amount || amount <= 0) {
      setText('sellHexOut', '수량 입력 후 자동 계산');
      return;
    }
    const gross   = BigInt(_status.price) * BigInt(amount);
    const fee     = (gross * 3n) / 100n;
    const net     = gross - fee;
    setText('sellHexOut', fmtHex(net.toString()) + ' HEX (수수료 3% 차감)');
  });
}

// ─────────────────────────────────────────────────────────
// 버튼 바인딩
// ─────────────────────────────────────────────────────────
function setLoading(btn, loading, label) {
  btn.disabled  = loading;
  btn.textContent = loading ? '처리 중...' : label;
}

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
        alert(`HEX 잔액이 부족합니다.\n필요: ${fmtHex(hexCost.toString())} HEX\n보유: ${fmtHex(_status.hexBalance)} HEX`);
        return;
      }
      if (!confirm(`JUMP ${amount}개 구매\n필요 HEX: ${fmtHex(hexCost.toString())}\n진행할까요?`)) return;
    }
    setLoading(btn, true, 'JUMP 구매');
    try {
      const fn  = httpsCallable(functions, 'buyJumpToken');
      const res = await fn({ jumpAmount: amount });
      alert(`구매 완료!\nJUMP: ${fmtJump(res.data.jumpAmount)}\n소비 HEX: ${fmtHex(res.data.hexCost)}\nTxHash: ${res.data.txHash}`);
      await loadStatus();
    } catch (err) {
      alert('구매 실패: ' + (err.message || String(err)));
    } finally {
      setLoading(btn, false, 'JUMP 구매');
    }
  };
}

function bindSell() {
  const btn = $('btnSell');
  if (!btn) return;
  btn.onclick = async () => {
    const amount = parseInt($('inputSellAmount')?.value, 10);
    if (!amount || amount <= 0) { alert('판매 수량을 입력하세요'); return; }
    if (_status && BigInt(_status.jumpBalance || '0') < BigInt(amount)) {
      alert('JUMP 잔액이 부족합니다'); return;
    }
    if (!confirm(`JUMP ${amount}개 판매 (수수료 3% 차감)\n진행할까요?`)) return;
    setLoading(btn, true, 'JUMP 판매');
    try {
      const fn  = httpsCallable(functions, 'sellJumpToken');
      const res = await fn({ jumpAmount: amount });
      alert(`판매 완료!\nTxHash: ${res.data.txHash}`);
      await loadStatus();
    } catch (err) {
      alert('판매 실패: ' + (err.message || String(err)));
    } finally {
      setLoading(btn, false, 'JUMP 판매');
    }
  };
}

function bindStake() {
  const btn = $('btnStake');
  if (!btn) return;
  btn.onclick = async () => {
    const amount = parseInt($('inputStakeAmount')?.value, 10);
    if (!amount || amount <= 0) { alert('스테이킹 수량을 입력하세요'); return; }
    if (_status && BigInt(_status.jumpBalance || '0') < BigInt(amount)) {
      alert('JUMP 잔액이 부족합니다'); return;
    }
    if (!confirm(`JUMP ${amount}개 스테이킹\n⚠ 120일 후 언스테이킹 가능\n진행할까요?`)) return;
    setLoading(btn, true, '스테이킹');
    try {
      const fn  = httpsCallable(functions, 'stakeJumpToken');
      const res = await fn({ jumpAmount: amount });
      alert(`스테이킹 완료!\nTxHash: ${res.data.txHash}`);
      await loadStatus();
    } catch (err) {
      alert('스테이킹 실패: ' + (err.message || String(err)));
    } finally {
      setLoading(btn, false, '스테이킹');
    }
  };
}

function bindUnstake() {
  const btn = $('btnUnstake');
  if (!btn) return;
  btn.onclick = async () => {
    if (!confirm('스테이킹된 JUMP를 모두 출금합니다.\n(120일 미만이면 컨트랙트에서 거부됩니다)\n진행할까요?')) return;
    setLoading(btn, true, '언스테이킹');
    try {
      const fn  = httpsCallable(functions, 'unstakeJumpToken');
      const res = await fn();
      alert(`언스테이킹 완료!\nTxHash: ${res.data.txHash}`);
      await loadStatus();
    } catch (err) {
      alert('언스테이킹 실패: ' + (err.message || String(err)));
    } finally {
      setLoading(btn, false, '언스테이킹');
    }
  };
}

function bindClaim() {
  const btn = $('btnClaim');
  if (!btn) return;
  btn.onclick = async () => {
    if (_status && BigInt(_status.pendingDividend || '0') === 0n) {
      alert('청구할 배당이 없습니다'); return;
    }
    if (!confirm(`배당 ${fmtHex(_status?.pendingDividend || '0')} HEX를 청구합니다.\n진행할까요?`)) return;
    setLoading(btn, true, '배당 청구');
    try {
      const fn  = httpsCallable(functions, 'claimJumpDividend');
      const res = await fn();
      alert(`배당 청구 완료!\n수령 HEX: ${fmtHex(res.data.hexAmount)}\nTxHash: ${res.data.txHash}`);
      await loadStatus();
    } catch (err) {
      alert('배당 청구 실패: ' + (err.message || String(err)));
    } finally {
      setLoading(btn, false, '배당 청구');
    }
  };
}

// ─────────────────────────────────────────────────────────
// 초기화
// ─────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    $('exLoginNotice') && ($('exLoginNotice').style.display = '');
    $('exMain')        && ($('exMain').style.display        = 'none');
    $('exNoWallet')    && ($('exNoWallet').style.display    = 'none');
    return;
  }

  $('exLoginNotice') && ($('exLoginNotice').style.display = 'none');

  // 탭 버튼 이벤트
  TABS.forEach((t) => {
    const btn = $('tabBtn' + t);
    if (btn) btn.onclick = () => showTab(t);
  });

  // 새로고침 버튼
  const btnRefresh = $('btnRefreshStatus');
  if (btnRefresh) btnRefresh.onclick = loadStatus;

  // 계산 바인딩
  bindBuyCalc();
  bindSellCalc();

  // 버튼 바인딩
  bindBuy();
  bindSell();
  bindStake();
  bindUnstake();
  bindClaim();

  // 기본 탭 = 현황
  showTab('Status');
  $('exMain').style.display = '';

  // 상태 로드
  await loadStatus();

  // 지갑 없음 처리
  if (_status && _status.hexBalance === '0' && _status.jumpBalance === '0' && !_status.staked) {
    // 잔액이 모두 0이어도 지갑이 있으면 정상 표시
  }
});
