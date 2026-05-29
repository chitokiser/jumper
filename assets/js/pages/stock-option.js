// /assets/js/pages/stock-option.js
// JumpDao 스톡옵션 바우처 — MetaMask Web3 UI

import { auth, db, functions } from '../firebase-init.js';
import { onAuthStateChanged }  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable }       from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { getDoc, doc }         from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

// ── 네트워크 상수 ──────────────────────────────────────────────────────────────
const OPBNB_CHAIN_ID = '0xCC'; // 204
const OPBNB_PARAMS   = {
  chainId:           '0xCC',
  chainName:         'opBNB Mainnet',
  nativeCurrency:    { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls:           ['https://opbnb-mainnet-rpc.bnbchain.org'],
  blockExplorerUrls: ['https://opbnb.bscscan.com'],
};
const HEX_ADDRESS  = '0x41F2Ea9F4eF7c4E35ba1a8438fC80937eD4E5464'; // HEX (18 dec)
const JUMP_ADDRESS = '0xA3C35c52446C133b7211A743c6D47470D1385601'; // JUMP (0 dec)

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
];
const STOCK_OPTION_ABI = [
  'function createOptionVoucher(address _owner, uint256 _strikePrice, uint256 _totalAmount, uint256 _maturityDays) external returns (uint256)',
  'function transferVoucher(uint256 _voucherId, address _to) external',
  'function executeOption(uint256 _voucherId, uint256 _amount) external',
  'function getVoucher(uint256 _voucherId) external view returns (tuple(uint256 id, address currentOwner, uint256 strikePrice, uint256 totalAmount, uint256 exercisedAmount, uint256 purchaseDate, uint256 maturityDate, bool active))',
  'function remainingAmount(uint256 _voucherId) external view returns (uint256)',
  'function isMatured(uint256 _voucherId) external view returns (bool)',
];

// ── Cloud Functions ────────────────────────────────────────────────────────────
const cfAdminCreate      = httpsCallable(functions, 'adminCreateStockVoucher');
const cfAdminGetAll      = httpsCallable(functions, 'adminGetAllStockVouchers');
const cfGetMine          = httpsCallable(functions, 'getMyStockVouchers');
const cfSyncTransfer     = httpsCallable(functions, 'syncStockVoucherTransfer');
const cfSyncExecution    = httpsCallable(functions, 'syncStockOptionExecution');
const cfSetContract      = httpsCallable(functions, 'adminSetStockOptionContract');

// ── 상태 ────────────────────────────────────────────────────────────────────
let _user        = null;
let _isAdmin     = false;
let _provider    = null;
let _signer      = null;
let _mmAddress   = null;
let _contractAddr = null;

const $ = id => document.getElementById(id);
const escHtml = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function fmtDate(ts) {
  if (!ts) return '-';
  const d = ts?.toDate ? ts.toDate() : new Date(Number(ts) * 1000);
  return d.toLocaleDateString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit' });
}

function daysLeft(ts) {
  if (!ts) return '-';
  const d = ts?.toDate ? ts.toDate() : new Date(Number(ts) * 1000);
  const diff = Math.ceil((d - Date.now()) / 86400000);
  return diff > 0 ? `${diff}일 남음` : '만기';
}

// ── MetaMask 연결 ────────────────────────────────────────────────────────────
async function connectMetaMask() {
  if (!window.ethereum) { alert('MetaMask가 설치되어 있지 않습니다.'); return false; }

  const ethersLib = await import('https://cdn.jsdelivr.net/npm/ethers@6.11.1/dist/ethers.min.js');
  const ethers    = ethersLib.ethers ?? ethersLib.default ?? ethersLib;

  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: OPBNB_CHAIN_ID }],
    });
  } catch (e) {
    if (e.code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [OPBNB_PARAMS],
      });
    }
  }

  await window.ethereum.request({ method: 'eth_requestAccounts' });
  _provider  = new ethers.BrowserProvider(window.ethereum);
  _signer    = await _provider.getSigner();
  _mmAddress = (await _signer.getAddress()).toLowerCase();

  setText('soMmAddress', _mmAddress.slice(0,6) + '…' + _mmAddress.slice(-4));
  setMmStatus(true);
  return true;
}

function setText(id, val) { const el=$(id); if (el) el.textContent = val; }
function setMmStatus(connected) {
  const btn = $('btnSoConnectMm');
  if (btn) btn.textContent = connected ? `✅ ${_mmAddress?.slice(0,6)}…` : '🦊 MetaMask 연결';
}

async function getContract() {
  if (!_signer) throw new Error('MetaMask를 먼저 연결해주세요');
  if (!_contractAddr) {
    const snap = await getDoc(doc(db, 'settings', 'stockOption'));
    _contractAddr = snap.data()?.contractAddress;
    if (!_contractAddr) throw new Error('컨트랙트 주소가 설정되지 않았습니다');
  }
  const ethersLib = await import('https://cdn.jsdelivr.net/npm/ethers@6.11.1/dist/ethers.min.js');
  const ethers    = ethersLib.ethers ?? ethersLib.default ?? ethersLib;
  return new ethers.Contract(_contractAddr, STOCK_OPTION_ABI, _signer);
}

async function getHexContract() {
  const ethersLib = await import('https://cdn.jsdelivr.net/npm/ethers@6.11.1/dist/ethers.min.js');
  const ethers    = ethersLib.ethers ?? ethersLib.default ?? ethersLib;
  return new ethers.Contract(HEX_ADDRESS, ERC20_ABI, _signer);
}

// ── 관리자 UI ────────────────────────────────────────────────────────────────
function initAdminUI() {
  // 컨트랙트 주소 설정
  $('btnSoSetContract')?.addEventListener('click', async () => {
    const addr = $('soContractAddrInput')?.value?.trim();
    const msgEl = $('soContractMsg');
    try {
      await cfSetContract({ contractAddress: addr });
      _contractAddr = addr;
      if (msgEl) { msgEl.style.color='#22c55e'; msgEl.textContent='✅ 저장됨'; }
    } catch (err) {
      if (msgEl) { msgEl.style.color='#ef4444'; msgEl.textContent=err.message; }
    }
  });

  // 바우처 생성
  $('btnSoCreateVoucher')?.addEventListener('click', async () => {
    const btn    = $('btnSoCreateVoucher');
    const msgEl  = $('soCreateMsg');
    const data   = {
      recipientAddress: $('soRecipient')?.value?.trim(),
      strikePrice:      parseFloat($('soStrikePrice')?.value || '0'),
      totalAmount:      parseInt($('soTotalAmount')?.value || '0'),
      maturityDays:     parseInt($('soMaturityDays')?.value || '0'),
    };
    if (!data.recipientAddress || !data.strikePrice || !data.totalAmount || !data.maturityDays) {
      if (msgEl) { msgEl.style.color='#ef4444'; msgEl.textContent='모든 항목을 입력하세요'; }
      return;
    }
    btn.disabled = true; btn.textContent = '처리 중...';
    if (msgEl) msgEl.textContent = '';
    try {
      const res = await cfAdminCreate(data);
      if (msgEl) {
        msgEl.style.color='#22c55e';
        msgEl.textContent = `✅ 바우처 #${res.data.voucherId} 생성 완료 (Tx: ${res.data.txHash?.slice(0,14)}…)`;
      }
      ['soRecipient','soStrikePrice','soTotalAmount','soMaturityDays'].forEach(id => { const el=$(id); if(el) el.value=''; });
      loadAdminVouchers();
    } catch (err) {
      if (msgEl) { msgEl.style.color='#ef4444'; msgEl.textContent='오류: ' + err.message; }
    } finally {
      btn.disabled = false; btn.textContent = '바우처 발행';
    }
  });

  loadAdminVouchers();
}

async function loadAdminVouchers() {
  const listEl = $('soAdminVoucherList');
  if (!listEl) return;
  listEl.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;">불러오는 중...</div>';
  try {
    const res = await cfAdminGetAll();
    const vouchers = res.data?.vouchers || res.data || [];
    if (!vouchers.length) { listEl.innerHTML = '<div style="color:var(--muted);">바우처 없음</div>'; return; }
    listEl.innerHTML = vouchers.map(v => renderAdminVoucherRow(v)).join('');
  } catch (err) {
    listEl.innerHTML = `<div style="color:#ef4444;">오류: ${escHtml(err.message)}</div>`;
  }
}

function renderAdminVoucherRow(v) {
  const remaining = (v.totalAmount || 0) - (v.exercisedAmount || 0);
  const matured   = v.maturityDate && (v.maturityDate?.toDate?.().getTime() || v.maturityDate * 1000) <= Date.now();
  return `
    <div style="border:1px solid var(--border,#e5e7eb);border-radius:10px;padding:12px 14px;margin-bottom:8px;background:var(--surface,#fff);">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
        <div>
          <span style="font-weight:700;color:#7c3aed;">#${v.voucherId}</span>
          <span style="margin-left:8px;font-size:0.8rem;padding:1px 7px;border-radius:99px;background:${v.active?'#d1fae5':'#f3f4f6'};color:${v.active?'#065f46':'#6b7280'};">
            ${v.active ? '활성' : '완료'}
          </span>
          ${matured ? '<span style="margin-left:4px;font-size:0.78rem;color:#f59e0b;">만기</span>' : ''}
        </div>
        <div style="font-size:0.78rem;color:var(--muted);">${fmtDate(v.maturityDate)}</div>
      </div>
      <div style="font-size:0.82rem;margin-top:6px;color:var(--muted);">
        소유자: <span style="color:var(--fg);">${escHtml((v.currentOwner||'').slice(0,10))}…</span>
        · 행사가: <b>${v.strikePrice} HEX/JUMP</b>
        · 잔여: <b>${remaining}/${v.totalAmount} JUMP</b>
      </div>
    </div>`;
}

// ── 유저 UI ─────────────────────────────────────────────────────────────────
async function loadUserVouchers() {
  const listEl = $('soUserVoucherList');
  const emptyEl = $('soUserEmpty');
  if (!listEl) return;
  listEl.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;">불러오는 중...</div>';
  if (emptyEl) emptyEl.style.display = 'none';

  try {
    const res      = await cfGetMine();
    const vouchers = res.data?.vouchers || [];
    if (!vouchers.length) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    listEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    vouchers.forEach(v => {
      const card = document.createElement('div');
      card.innerHTML = renderUserVoucherCard(v);
      // 권리행사 버튼
      card.querySelector(`[data-execute="${v.voucherId}"]`)?.addEventListener('click', () => openExecuteModal(v));
      // 양도 버튼
      card.querySelector(`[data-transfer="${v.voucherId}"]`)?.addEventListener('click', () => openTransferModal(v));
      frag.appendChild(card);
    });
    listEl.appendChild(frag);
  } catch (err) {
    listEl.innerHTML = `<div style="color:#ef4444;">오류: ${escHtml(err.message)}</div>`;
  }
}

function renderUserVoucherCard(v) {
  const now       = Date.now();
  const matDate   = v.maturityDate?.toDate?.() || new Date((v.maturityDate?.seconds || 0) * 1000);
  const matured   = matDate <= now;
  const remaining = (v.totalAmount || 0) - (v.exercisedAmount || 0);
  const pct       = v.totalAmount ? Math.round(((v.exercisedAmount || 0) / v.totalAmount) * 100) : 0;
  const canExec   = v.active && matured && remaining > 0;

  return `
    <div style="border:1px solid var(--border,#e5e7eb);border-radius:12px;overflow:hidden;background:var(--surface,#fff);">
      <div style="background:linear-gradient(135deg,#7c3aed,#a78bfa);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="color:#fff;font-weight:700;font-size:0.95rem;">📈 스톡옵션 #${v.voucherId}</div>
          <div style="color:#e9d5ff;font-size:0.75rem;">만기: ${fmtDate(v.maturityDate)} · ${daysLeft(v.maturityDate)}</div>
        </div>
        <span style="padding:2px 10px;border-radius:99px;font-size:0.75rem;font-weight:700;
          background:${canExec?'#fef3c7':matured?'#f3f4f6':'#ede9fe'};
          color:${canExec?'#92400e':matured?'#6b7280':'#7c3aed'};">
          ${canExec ? '✅ 행사 가능' : matured ? '만기 완료' : '행사 대기'}
        </span>
      </div>
      <div style="padding:14px 16px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
          <div>
            <div style="font-size:0.72rem;color:var(--muted);">행사 가격</div>
            <div style="font-weight:700;">${v.strikePrice} HEX/JUMP</div>
          </div>
          <div>
            <div style="font-size:0.72rem;color:var(--muted);">총 수량</div>
            <div style="font-weight:700;">${v.totalAmount} JUMP</div>
          </div>
          <div>
            <div style="font-size:0.72rem;color:var(--muted);">행사 완료</div>
            <div style="font-weight:700;color:#7c3aed;">${v.exercisedAmount || 0} JUMP</div>
          </div>
          <div>
            <div style="font-size:0.72rem;color:var(--muted);">잔여 수량</div>
            <div style="font-weight:700;color:#059669;">${remaining} JUMP</div>
          </div>
        </div>
        <!-- 진행 바 -->
        <div style="background:#f3f4f6;border-radius:4px;height:6px;margin-bottom:12px;">
          <div style="background:#7c3aed;border-radius:4px;height:6px;width:${pct}%;"></div>
        </div>
        <!-- 버튼 -->
        <div style="display:flex;gap:8px;">
          <button data-execute="${v.voucherId}" ${!canExec?'disabled':''} type="button"
            style="flex:1;padding:8px;background:${canExec?'#7c3aed':'#e5e7eb'};color:${canExec?'#fff':'#9ca3af'};
                   border:none;border-radius:8px;font-size:0.85rem;font-weight:600;cursor:${canExec?'pointer':'not-allowed'};">
            ⚡ 권리행사
          </button>
          <button data-transfer="${v.voucherId}" ${!v.active?'disabled':''} type="button"
            style="flex:1;padding:8px;background:${v.active?'#f0fdf4':'#e5e7eb'};color:${v.active?'#059669':'#9ca3af'};
                   border:1px solid ${v.active?'#bbf7d0':'#e5e7eb'};border-radius:8px;font-size:0.85rem;font-weight:600;cursor:${v.active?'pointer':'not-allowed'};">
            🔄 양도
          </button>
        </div>
      </div>
    </div>`;
}

// ── 권리행사 모달 ────────────────────────────────────────────────────────────
let _execVoucher = null;
function openExecuteModal(v) {
  _execVoucher = v;
  const modal = $('soExecuteModal');
  if (!modal) return;
  setText('soExecVoucherId', `#${v.voucherId}`);
  setText('soExecStrike',    `${v.strikePrice} HEX/JUMP`);
  setText('soExecRemaining', `${(v.totalAmount||0)-(v.exercisedAmount||0)} JUMP`);
  if ($('soExecAmount')) $('soExecAmount').value = '';
  if ($('soExecMsg'))    $('soExecMsg').textContent = '';
  modal.style.display = 'flex';
}

async function handleExecuteOption() {
  const v       = _execVoucher;
  const amount  = parseInt($('soExecAmount')?.value || '0');
  const msgEl   = $('soExecMsg');
  const btn     = $('btnSoExecute');
  if (!v || !amount || amount <= 0) {
    if (msgEl) { msgEl.style.color='#ef4444'; msgEl.textContent='수량을 입력하세요'; }
    return;
  }
  const remaining = (v.totalAmount || 0) - (v.exercisedAmount || 0);
  if (amount > remaining) {
    if (msgEl) { msgEl.style.color='#ef4444'; msgEl.textContent=`잔여 수량(${remaining} JUMP) 초과`; }
    return;
  }

  const connected = await connectMetaMask();
  if (!connected) return;

  btn.disabled = true; btn.textContent = '처리 중...';
  if (msgEl) { msgEl.style.color='#6b7280'; msgEl.textContent='MetaMask에서 서명해주세요...'; }

  try {
    const ethersLib  = await import('https://cdn.jsdelivr.net/npm/ethers@6.11.1/dist/ethers.min.js');
    const ethers     = ethersLib.ethers ?? ethersLib.default ?? ethersLib;
    const hexCost    = BigInt(amount) * ethers.parseEther(String(v.strikePrice));
    const hexContract = await getHexContract();
    const contract    = await getContract();

    // HEX approve
    if (msgEl) msgEl.textContent = '① HEX approve 중...';
    const approveTx = await hexContract.approve(_contractAddr, hexCost);
    await approveTx.wait();

    // executeOption
    if (msgEl) msgEl.textContent = '② 권리행사 중...';
    const execTx  = await contract.executeOption(BigInt(v.voucherId), BigInt(amount));
    const receipt = await execTx.wait();

    // Firebase sync
    await cfSyncExecution({ voucherId: v.voucherId, amount, txHash: receipt.hash });

    if (msgEl) { msgEl.style.color='#22c55e'; msgEl.textContent=`✅ 완료! ${amount} JUMP 수령 (Tx: ${receipt.hash.slice(0,14)}…)`; }
    setTimeout(() => { $('soExecuteModal').style.display='none'; loadUserVouchers(); }, 2500);
  } catch (err) {
    if (msgEl) { msgEl.style.color='#ef4444'; msgEl.textContent='오류: ' + (err.reason || err.message); }
  } finally {
    btn.disabled = false; btn.textContent = '⚡ 권리행사 확인';
  }
}

// ── 양도 모달 ────────────────────────────────────────────────────────────────
let _transferVoucher = null;
function openTransferModal(v) {
  _transferVoucher = v;
  const modal = $('soTransferModal');
  if (!modal) return;
  setText('soTransferVoucherId', `#${v.voucherId}`);
  if ($('soTransferTo'))  $('soTransferTo').value = '';
  if ($('soTransferMsg')) $('soTransferMsg').textContent = '';
  modal.style.display = 'flex';
}

async function handleTransferVoucher() {
  const v       = _transferVoucher;
  const toAddr  = $('soTransferTo')?.value?.trim();
  const msgEl   = $('soTransferMsg');
  const btn     = $('btnSoTransfer');
  if (!v || !toAddr) { if (msgEl) { msgEl.style.color='#ef4444'; msgEl.textContent='받는 주소를 입력하세요'; } return; }

  const connected = await connectMetaMask();
  if (!connected) return;

  btn.disabled = true; btn.textContent = '처리 중...';
  if (msgEl) { msgEl.style.color='#6b7280'; msgEl.textContent='MetaMask에서 서명해주세요...'; }

  try {
    const contract = await getContract();
    const tx       = await contract.transferVoucher(BigInt(v.voucherId), toAddr);
    const receipt  = await tx.wait();

    await cfSyncTransfer({ voucherId: v.voucherId, toAddress: toAddr, txHash: receipt.hash });

    if (msgEl) { msgEl.style.color='#22c55e'; msgEl.textContent=`✅ 양도 완료 (Tx: ${receipt.hash.slice(0,14)}…)`; }
    setTimeout(() => { $('soTransferModal').style.display='none'; loadUserVouchers(); }, 2500);
  } catch (err) {
    if (msgEl) { msgEl.style.color='#ef4444'; msgEl.textContent='오류: ' + (err.reason || err.message); }
  } finally {
    btn.disabled = false; btn.textContent = '🔄 양도 확인';
  }
}

// ── 초기화 ───────────────────────────────────────────────────────────────────
function init(user, isAdmin) {
  _user    = user;
  _isAdmin = isAdmin;

  // MetaMask 연결 버튼
  $('btnSoConnectMm')?.addEventListener('click', connectMetaMask);

  // 모달 닫기
  ['soExecuteModal','soTransferModal'].forEach(id => {
    const modal = $(id);
    modal?.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
  });
  $('btnSoExecClose')?.addEventListener('click',     () => { $('soExecuteModal').style.display='none'; });
  $('btnSoTransferClose')?.addEventListener('click', () => { $('soTransferModal').style.display='none'; });

  // 권리행사·양도 확인
  $('btnSoExecute')?.addEventListener('click',  handleExecuteOption);
  $('btnSoTransfer')?.addEventListener('click', handleTransferVoucher);

  // 관리자 패널
  if (isAdmin) {
    const adminPanel = $('soAdminPanel');
    if (adminPanel) adminPanel.style.display = '';
    initAdminUI();

    // 현재 설정된 컨트랙트 주소 표시
    getDoc(doc(db, 'settings', 'stockOption')).then(snap => {
      const addr = snap.data()?.contractAddress || '';
      _contractAddr = addr;
      const inp = $('soContractAddrInput');
      if (inp && addr) inp.value = addr;
    }).catch(() => {});
  }

  // 유저 바우처 로드
  if (user) loadUserVouchers();

  // 새로고침
  $('btnSoRefreshUser')?.addEventListener('click', loadUserVouchers);
  $('btnSoRefreshAdmin')?.addEventListener('click', loadAdminVouchers);
}

// ── 외부 진입점 ───────────────────────────────────────────────────────────────
export { init as initStockOption };
