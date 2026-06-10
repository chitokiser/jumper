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
    console.warn('[ton] TON Connect UI SDK not loaded');
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

  // 가격 로드 (adminWallet 포함) + 1분 갱신
  await _loadPrice();
  _priceTimer = setInterval(_loadPrice, 60 * 1000);

  // 이벤트 연결
  _bindEvents();
}

// ── TON 가격 로드 ─────────────────────────────────────────────────────────────
async function _loadPrice() {
  try {
    const { data } = await _fnPrice();
    _tonUsd     = data.tonUsd     || 0;
    _coinPerTon = data.coinPerTon || 0;
    if (data.adminWallet && !_adminWallet) {
      _adminWallet = data.adminWallet;
      _renderAdminWallet();
      _loadAdminBalance();
    }
    _renderPrice();
    _recalcDeposit();
    _recalcWithdraw();
  } catch (e) {
    console.warn('[ton] Price load failed:', e.message);
  }
}

// ── UI 렌더 ───────────────────────────────────────────────────────────────────
function _renderPrice() {
  const el = (id) => document.getElementById(id);
  if (el('tonPriceUsd'))    el('tonPriceUsd').textContent    = _tonUsd ? `$${_tonUsd.toFixed(2)}` : '—';
  if (el('tonPriceCoin'))   el('tonPriceCoin').textContent   = _coinPerTon ? `${_coinPerTon.toLocaleString()} GP` : '—';
  if (el('tonPriceUpdated'))el('tonPriceUpdated').textContent= new Date().toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit'});
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
  if (statusEl) statusEl.textContent = _connected ? '● Connected' : '○ Not connected';
  if (statusEl) statusEl.style.color = _connected ? '#b8ff00' : '#6b7280';
  if (addrEl)   addrEl.textContent   = _connected ? (_walletAddr.slice(0,8)+'…'+_walletAddr.slice(-6)) : 'Wallet not connected';
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

// ── 출금 계산 (수수료 3% 차감) ───────────────────────────────────────────────
const WITHDRAW_FEE_RATE = 0.03;

function _recalcWithdraw() {
  const gpInput   = document.getElementById('tonWithdrawGp');
  const tonResult = document.getElementById('tonWithdrawTon');
  const feeEl     = document.getElementById('tonWithdrawFeeInfo');
  if (!gpInput || !tonResult) return;
  const gp  = parseInt(gpInput.value) || 0;
  if (gp <= 0) {
    tonResult.textContent = '— TON';
    if (feeEl) feeEl.textContent = '';
    return;
  }
  const fee = Math.floor(gp * WITHDRAW_FEE_RATE);
  const net = gp - fee;
  const ton = _coinPerTon > 0 ? net / _coinPerTon : 0;
  tonResult.textContent = ton > 0 ? ton.toFixed(4) + ' TON' : '— TON';
  if (feeEl) feeEl.textContent = `Fee 3% = ${fee.toLocaleString()} GP deducted → Net ${net.toLocaleString()} GP`;
}

// ── 이벤트 바인딩 ─────────────────────────────────────────────────────────────
function _bindEvents() {
  document.getElementById('tonDepositAmt')?.addEventListener('input',  _recalcDeposit);
  document.getElementById('tonWithdrawGp')?.addEventListener('input',  _recalcWithdraw);
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

// ── 입금 (TON 전송) ───────────────────────────────────────────────────────────
async function _doDeposit() {
  if (!_connected) return _toast('Please connect your TON wallet first', 'warn');
  if (!_adminWallet) return _toast('Loading admin wallet address...', 'warn');

  const tonAmt = parseFloat(document.getElementById('tonDepositAmt')?.value) || 0;
  if (tonAmt < 0.01) return _toast('Minimum deposit is 0.01 TON', 'warn');

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
    _toast('TON sent! Click "Confirm Deposit" below to verify.', 'success');
    document.getElementById('tonDepositAmt').value = '';
    _recalcDeposit();
  } catch (e) {
    if (!e.message?.includes('User')) _toast('Transfer error: ' + e.message, 'error');
  } finally {
    _setLoading('tonSendBtn', false);
  }
}

// ── 입금 검증 ─────────────────────────────────────────────────────────────────
async function _doVerify() {
  const txHash = document.getElementById('tonVerifyHash')?.value?.trim();
  if (!txHash) return _toast('Please enter the TX Hash', 'warn');
  _setLoading('tonVerifyBtn', true);
  try {
    const { data } = await _fnVerify({ txHash });
    _toast(`✅ Deposit confirmed! +${data.gamecoin.toLocaleString()} GP (${data.tonAmount.toFixed(4)} TON)`, 'success');
    document.getElementById('tonVerifyHash').value = '';
    window.dispatchEvent(new CustomEvent('ton:deposited', { detail: data }));
  } catch (e) {
    _toast('Deposit verification failed: ' + (e.message || 'Network error'), 'error');
  } finally {
    _setLoading('tonVerifyBtn', false);
  }
}

// ── 출금 요청 ─────────────────────────────────────────────────────────────────
async function _doWithdraw() {
  const gp      = parseInt(document.getElementById('tonWithdrawGp')?.value)   || 0;
  const address = document.getElementById('tonWithdrawAddr')?.value?.trim();
  if (gp < 10000)  return _toast('Minimum withdrawal is 10,000 GP', 'warn');
  if (!address)    return _toast('Please enter your TON wallet address', 'warn');
  const fee = Math.floor(gp * WITHDRAW_FEE_RATE);
  const net = gp - fee;
  const ton = _coinPerTon > 0 ? net / _coinPerTon : 0;
  if (!confirm(`Confirm Withdrawal\n\n` +
    `GP deducted: ${gp.toLocaleString()} GP\n` +
    `Fee 3%: ${fee.toLocaleString()} GP\n` +
    `Net receive: ${ton.toFixed(4)} TON\n\n` +
    `Wallet: ${address}`)) return;

  _setLoading('tonWithdrawBtn', true);
  try {
    const { data } = await _fnWithdraw({ gamecoin: gp, walletAddress: address });
    _toast(`Withdrawal complete! ${data.tonAmount.toFixed(4)} TON sent (fee ${fee.toLocaleString()} GP deducted)`, 'success');
    document.getElementById('tonWithdrawGp').value = '';
    _recalcWithdraw();
    window.dispatchEvent(new CustomEvent('ton:withdrawn', { detail: data }));
  } catch (e) {
    _toast('Withdrawal request failed: ' + (e.message || 'Network error'), 'error');
  } finally {
    _setLoading('tonWithdrawBtn', false);
  }
}

// ── 거래 내역 ─────────────────────────────────────────────────────────────────
async function _loadHistory() {
  const container = document.getElementById('tonHistoryList');
  if (!container) return;
  container.innerHTML = '<div style="color:#6b7280;font-size:11px;text-align:center;padding:12px">Loading...</div>';
  try {
    const { data } = await _fnHistory();
    if (!data.length) {
      container.innerHTML = '<div style="color:#6b7280;font-size:11px;text-align:center;padding:12px">No transaction history</div>';
      return;
    }
    container.innerHTML = data.map(tx => `
      <div class="ton-tx-row">
        <span class="ton-tx-type ${tx.type}">${tx.type === 'deposit' ? '▼ Deposit' : '▲ Withdraw'}</span>
        <span class="ton-tx-amount">${tx.type === 'deposit' ? '+' : '-'}${tx.gamecoin.toLocaleString()} GP</span>
        <span class="ton-tx-ton">${tx.tonAmount.toFixed(4)} TON</span>
        <span class="ton-tx-status ${tx.status}">${tx.status}</span>
        <span class="ton-tx-date">${tx.createdAt ? new Date(tx.createdAt).toLocaleDateString('en-US') : '—'}</span>
      </div>`).join('');
  } catch (e) {
    container.innerHTML = `<div style="color:#f87171;font-size:11px;text-align:center;padding:12px">Error: ${e.message}</div>`;
  }
}

// ── 주소 복사 ─────────────────────────────────────────────────────────────────
async function _copyAdminAddr() {
  if (!_adminWallet) return;
  try {
    await navigator.clipboard.writeText(_adminWallet);
    _toast('Address copied', 'success');
  } catch { _toast('Copy failed — select manually', 'warn'); }
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────
function _setLoading(btnId, on) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = on;
  btn._origText = btn._origText || btn.textContent;
  btn.textContent = on ? 'Processing...' : btn._origText;
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

// ── 관리자 지갑 잔고 조회 (tonapi.io — CORS 허용, 무료) ──────────────────────
async function _loadAdminBalance() {
  if (!_adminWallet) return;
  const balEl = document.getElementById('tonAdminBalance');
  const usdEl = document.getElementById('tonAdminBalanceUsd');
  try {
    const res = await fetch(
      `https://tonapi.io/v2/accounts/${encodeURIComponent(_adminWallet)}`,
      { cache: 'no-store' }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    const nanoton = parseInt(d?.balance ?? '0', 10);
    if (isNaN(nanoton)) throw new Error('Balance parse failed');
    const ton = nanoton / 1e9;
    const usd = _tonUsd ? ton * _tonUsd : 0;
    if (balEl) balEl.textContent = ton.toFixed(4);
    if (usdEl) usdEl.textContent = usd > 0 ? '$' + usd.toFixed(2) : '$—';
  } catch (e) {
    console.warn('[ton] Balance fetch failed:', e.message);
    if (balEl) balEl.textContent = 'Error';
  }
}

// 전역 노출 (버튼 onclick용)
window._tonRefreshBalance = _loadAdminBalance;

export { _loadPrice as refreshTonPrice, _loadAdminBalance as loadAdminBalance };
