// assets/js/pages/merchants.ton.js
// TON Connect UI + GameCoin 교환 패널 프론트엔드
// Firebase Functions: tonGetPrice / tonDepositVerify / tonWithdrawRequest / tonGetTransactions

import { functions } from '/assets/js/firebase-init.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

// ── Firebase Functions 호출 래퍼 ─────────────────────────────────────────────
const _fnPrice    = httpsCallable(functions, 'tonGetPrice');
const _fnVerify   = httpsCallable(functions, 'tonDepositVerify');
const _fnWithdraw = httpsCallable(functions, 'tonWithdrawRequest');
const _fnHistory  = httpsCallable(functions, 'tonGetTransactions');

// ── 상태 ─────────────────────────────────────────────────────────────────────
let _tonUI        = null;   // TonConnectUI instance
let _tonUsd       = 0;
let _coinPerTon   = 0;
let _adminWallet  = '';
let _connected    = false;
let _walletAddr   = '';
let _priceTimer   = null;

const MANIFEST_URL = 'https://jump22.netlify.app/tonconnect-manifest.json';

// ── 초기화 ──────────────────────────────────────────────────────────────────
export async function initTonExchange() {
  // TON Connect UI SDK 로드 확인
  if (typeof TON_CONNECT_UI === 'undefined') {
    console.warn('[ton] TON Connect UI SDK 미로드');
    return;
  }

  _tonUI = new TON_CONNECT_UI.TonConnectUI({
    manifestUrl: MANIFEST_URL,
    buttonRootId: 'tonConnectBtnRoot',
  });

  // 지갑 연결 상태 구독
  _tonUI.onStatusChange(wallet => {
    _connected   = !!wallet;
    _walletAddr  = wallet?.account?.address || '';
    _updateWalletStatus();
    if (_connected) _setWithdrawAddress(_walletAddr);
  });

  // 가격 로드 (캐시 포함)
  await _loadPrice();
  _priceTimer = setInterval(_loadPrice, 60 * 1000); // 1분 갱신

  // 관리자 지갑 주소 + 잔고 로드
  await _loadAdminWallet();
  _loadAdminBalance();

  // 이벤트 연결
  _bindEvents();
}

// ── TON 가격 로드 ─────────────────────────────────────────────────────────────
async function _loadPrice() {
  try {
    const { data } = await _fnPrice();
    _tonUsd      = data.tonUsd      || 0;
    _coinPerTon  = data.coinPerTon  || 0;
    _adminWallet = data.adminWallet || _adminWallet;
    _renderPrice();
    _recalcDeposit();
    _recalcWithdraw();
  } catch (e) {
    console.warn('[ton] 가격 로드 실패:', e.message);
  }
}

// ── 관리자 지갑 주소 ──────────────────────────────────────────────────────────
async function _loadAdminWallet() {
  try {
    // Firestore public read (로그인 불필요)
    const { db } = await import('/assets/js/firebase-init.js');
    const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
    const snap = await getDoc(doc(db, 'config', 'ton'));
    _adminWallet = snap.data()?.adminWallet || '';
    _renderAdminWallet();
    _loadAdminBalance(); // 주소 로드 후 즉시 잔고 조회
  } catch {}
}

// ── UI 렌더 ───────────────────────────────────────────────────────────────────
function _renderPrice() {
  const el = (id) => document.getElementById(id);
  if (el('tonPriceUsd'))    el('tonPriceUsd').textContent    = _tonUsd ? `$${_tonUsd.toFixed(2)}` : '—';
  if (el('tonPriceCoin'))   el('tonPriceCoin').textContent   = _coinPerTon ? `${_coinPerTon.toLocaleString()} GP` : '—';
  if (el('tonPriceUpdated'))el('tonPriceUpdated').textContent= new Date().toLocaleTimeString('ko-KR', {hour:'2-digit',minute:'2-digit'});
}

function _renderAdminWallet() {
  const el = document.getElementById('tonAdminWallet');
  if (el && _adminWallet) {
    const short = _adminWallet.slice(0,6) + '…' + _adminWallet.slice(-6);
    el.textContent = short;
    el.title = _adminWallet;
    // QR 코드 영역에 전체 주소 넣기
    const qrEl = document.getElementById('tonDepositAddr');
    if (qrEl) qrEl.textContent = _adminWallet;
  }
}

function _updateWalletStatus() {
  const statusEl = document.getElementById('tonWalletStatus');
  const addrEl   = document.getElementById('tonWalletAddr');
  if (statusEl) statusEl.textContent = _connected ? '● 연결됨' : '○ 미연결';
  if (statusEl) statusEl.style.color = _connected ? '#b8ff00' : '#6b7280';
  if (addrEl)   addrEl.textContent   = _connected ? (_walletAddr.slice(0,8)+'…'+_walletAddr.slice(-6)) : '지갑 미연결';
}

function _setWithdrawAddress(addr) {
  const el = document.getElementById('tonWithdrawAddr');
  if (el && !el.value) el.value = addr;
}

// ── 입금 계산 ─────────────────────────────────────────────────────────────────
function _recalcDeposit() {
  const tonInput = document.getElementById('tonDepositAmt');
  const gpResult = document.getElementById('tonDepositGp');
  if (!tonInput || !gpResult) return;
  const ton = parseFloat(tonInput.value) || 0;
  const gp  = _coinPerTon > 0 ? Math.floor(ton * _coinPerTon) : 0;
  gpResult.textContent = gp > 0 ? gp.toLocaleString() + ' GP' : '— GP';
}

// ── 출금 계산 ─────────────────────────────────────────────────────────────────
function _recalcWithdraw() {
  const gpInput  = document.getElementById('tonWithdrawGp');
  const tonResult= document.getElementById('tonWithdrawTon');
  if (!gpInput || !tonResult) return;
  const gp  = parseInt(gpInput.value) || 0;
  const ton = _coinPerTon > 0 ? gp / _coinPerTon : 0;
  tonResult.textContent = ton > 0 ? ton.toFixed(4) + ' TON' : '— TON';
}

// ── 이벤트 바인딩 ─────────────────────────────────────────────────────────────
function _bindEvents() {
  document.getElementById('tonDepositAmt')?.addEventListener('input',  _recalcDeposit);
  document.getElementById('tonWithdrawGp')?.addEventListener('input',  _recalcWithdraw);
  document.getElementById('tonConnectWallet')?.addEventListener('click', _connectWallet);
  document.getElementById('tonSendBtn')?.addEventListener('click',     _doDeposit);
  document.getElementById('tonVerifyBtn')?.addEventListener('click',   _doVerify);
  document.getElementById('tonWithdrawBtn')?.addEventListener('click', _doWithdraw);
  document.getElementById('tonHistoryBtn')?.addEventListener('click',  _loadHistory);
  document.getElementById('tonCopyAddr')?.addEventListener('click',    _copyAdminAddr);
  // 탭 전환
  document.querySelectorAll('.ton-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ton-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.ton-tab-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.target)?.classList.remove('hidden');
    });
  });
}

// ── 지갑 연결 ─────────────────────────────────────────────────────────────────
async function _connectWallet() {
  if (!_tonUI) return _toast('TON Connect SDK 로딩 중...', 'warn');
  try {
    if (_connected) { await _tonUI.disconnect(); }
    else            { await _tonUI.openModal(); }
  } catch (e) { _toast('지갑 연결 오류: ' + e.message, 'error'); }
}

// ── 입금 (TON 전송) ───────────────────────────────────────────────────────────
async function _doDeposit() {
  if (!_connected) return _toast('먼저 TON 지갑을 연결하세요', 'warn');
  if (!_adminWallet) return _toast('관리자 지갑 주소를 로드 중입니다...', 'warn');

  const tonAmt = parseFloat(document.getElementById('tonDepositAmt')?.value) || 0;
  if (tonAmt < 0.01) return _toast('최소 입금은 0.01 TON 입니다', 'warn');

  const nanoTon = Math.floor(tonAmt * 1e9);
  _setLoading('tonSendBtn', true);
  try {
    const result = await _tonUI.sendTransaction({
      validUntil: Math.floor(Date.now() / 1000) + 600,
      messages: [{
        address: _adminWallet,
        amount:  String(nanoTon),
      }],
    });
    // TX hash 자동 입력
    const txHash = result?.boc || '';
    const hashEl = document.getElementById('tonVerifyHash');
    if (hashEl) hashEl.value = txHash;
    _toast('TON 전송 완료! 아래에서 "입금 확인" 버튼을 누르세요', 'success');
    document.getElementById('tonDepositAmt').value = '';
    _recalcDeposit();
  } catch (e) {
    if (!e.message?.includes('User')) _toast('전송 오류: ' + e.message, 'error');
  } finally {
    _setLoading('tonSendBtn', false);
  }
}

// ── 입금 검증 ─────────────────────────────────────────────────────────────────
async function _doVerify() {
  const txHash = document.getElementById('tonVerifyHash')?.value?.trim();
  if (!txHash) return _toast('TX Hash를 입력하세요', 'warn');
  _setLoading('tonVerifyBtn', true);
  try {
    const { data } = await _fnVerify({ txHash });
    _toast(`✅ 입금 완료! +${data.gamecoin.toLocaleString()} GP (${data.tonAmount.toFixed(4)} TON)`, 'success');
    document.getElementById('tonVerifyHash').value = '';
    window.dispatchEvent(new CustomEvent('ton:deposited', { detail: data }));
  } catch (e) {
    _toast('입금 확인 실패: ' + (e.message || '네트워크 오류'), 'error');
  } finally {
    _setLoading('tonVerifyBtn', false);
  }
}

// ── 출금 요청 ─────────────────────────────────────────────────────────────────
async function _doWithdraw() {
  const gp      = parseInt(document.getElementById('tonWithdrawGp')?.value)   || 0;
  const address = document.getElementById('tonWithdrawAddr')?.value?.trim();
  if (gp < 10000)  return _toast('최소 출금은 10,000 GP 입니다', 'warn');
  if (!address)    return _toast('TON 지갑 주소를 입력하세요', 'warn');
  if (!confirm(`${gp.toLocaleString()} GP → TON 출금을 요청하시겠습니까?\n지갑: ${address}`)) return;

  _setLoading('tonWithdrawBtn', true);
  try {
    const { data } = await _fnWithdraw({ gamecoin: gp, walletAddress: address });
    _toast(`출금 요청 완료! ${data.tonAmount.toFixed(4)} TON → 검토 후 송금됩니다`, 'success');
    document.getElementById('tonWithdrawGp').value = '';
    _recalcWithdraw();
    window.dispatchEvent(new CustomEvent('ton:withdrawn', { detail: data }));
  } catch (e) {
    _toast('출금 요청 실패: ' + (e.message || '네트워크 오류'), 'error');
  } finally {
    _setLoading('tonWithdrawBtn', false);
  }
}

// ── 거래 내역 ─────────────────────────────────────────────────────────────────
async function _loadHistory() {
  const container = document.getElementById('tonHistoryList');
  if (!container) return;
  container.innerHTML = '<div style="color:#6b7280;font-size:11px;text-align:center;padding:12px">로딩 중...</div>';
  try {
    const { data } = await _fnHistory();
    if (!data.length) {
      container.innerHTML = '<div style="color:#6b7280;font-size:11px;text-align:center;padding:12px">거래 내역이 없습니다</div>';
      return;
    }
    container.innerHTML = data.map(tx => `
      <div class="ton-tx-row">
        <span class="ton-tx-type ${tx.type}">${tx.type === 'deposit' ? '▼ 입금' : '▲ 출금'}</span>
        <span class="ton-tx-amount">${tx.type === 'deposit' ? '+' : '-'}${tx.gamecoin.toLocaleString()} GP</span>
        <span class="ton-tx-ton">${tx.tonAmount.toFixed(4)} TON</span>
        <span class="ton-tx-status ${tx.status}">${tx.status}</span>
        <span class="ton-tx-date">${tx.createdAt ? new Date(tx.createdAt).toLocaleDateString('ko-KR') : '—'}</span>
      </div>`).join('');
  } catch (e) {
    container.innerHTML = `<div style="color:#f87171;font-size:11px;text-align:center;padding:12px">오류: ${e.message}</div>`;
  }
}

// ── 주소 복사 ─────────────────────────────────────────────────────────────────
async function _copyAdminAddr() {
  if (!_adminWallet) return;
  try {
    await navigator.clipboard.writeText(_adminWallet);
    _toast('주소가 복사됐습니다', 'success');
  } catch { _toast('복사 실패 — 직접 선택하세요', 'warn'); }
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────
function _setLoading(btnId, on) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = on;
  btn._origText = btn._origText || btn.textContent;
  btn.textContent = on ? '처리 중...' : btn._origText;
}

function _toast(msg, type = 'info') {
  const el = document.getElementById('tonToast');
  if (!el) { console.log('[ton]', msg); return; }
  el.textContent = msg;
  el.className   = `ton-toast ton-toast-${type}`;
  el.style.display = 'block';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.display = 'none'; }, 3500);
}

// ── 관리자 지갑 잔고 조회 ─────────────────────────────────────────────────────
async function _loadAdminBalance() {
  if (!_adminWallet) return;
  try {
    const res = await fetch(
      `https://toncenter.com/api/v2/getAddressBalance?address=${encodeURIComponent(_adminWallet)}`,
      { cache: 'no-store' }
    );
    const d = await res.json();
    const nanoton = parseInt(d?.result || '0', 10);
    if (isNaN(nanoton)) return;
    const ton = nanoton / 1e9;
    const usd = _tonUsd ? ton * _tonUsd : 0;
    const balEl = document.getElementById('tonAdminBalance');
    const usdEl = document.getElementById('tonAdminBalanceUsd');
    if (balEl) balEl.textContent = ton.toFixed(4);
    if (usdEl) usdEl.textContent = usd > 0 ? '$' + usd.toFixed(2) : '$—';
  } catch (e) {
    console.warn('[ton] 잔고 조회 실패:', e.message);
  }
}

// 전역 노출 (버튼 onclick용)
window._tonRefreshBalance = _loadAdminBalance;

export { _loadPrice as refreshTonPrice, _loadAdminBalance as loadAdminBalance };
