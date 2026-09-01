// /assets/js/pages/stock-option.js
// K-Culture Alliance 스톡옵션 바우처 — 수탁지갑 기반 (행사 탭과 동일 방식)

import { functions } from '../firebase-init.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { loadAdminPriceEditor } from './user-place.js';

// ── Cloud Functions ────────────────────────────────────────────────────────────
const cfAdminCreateOffering = httpsCallable(functions, 'adminCreateStockOffering');
const cfGetOfferings        = httpsCallable(functions, 'getStockOfferings');
const cfAdminGetOfferings   = httpsCallable(functions, 'adminGetAllStockOfferings');
const cfAdminGetVouchers    = httpsCallable(functions, 'adminGetAllStockVouchers');
const cfBuy                 = httpsCallable(functions, 'buyStockOptionVoucher', { timeout: 180000 });
const cfGetMine             = httpsCallable(functions, 'getMyStockVouchers');
const cfExercise            = httpsCallable(functions, 'exerciseStockOption', { timeout: 180000 });
const cfTransfer            = httpsCallable(functions, 'transferStockOptionVoucher', { timeout: 120000 });
const cfAdminToggle         = httpsCallable(functions, 'adminToggleStockOffering');

// ── 상태 ─────────────────────────────────────────────────────────────────────
let _user    = null;
let _isAdmin = false;

const $ = id => document.getElementById(id);
const escHtml = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function tsToDate(ts) {
  if (!ts) return null;
  if (ts?.toDate) return ts.toDate();
  const secs = ts.seconds ?? ts._seconds ?? 0;
  return new Date(secs * 1000);
}

function fmtDate(ts) {
  const d = tsToDate(ts);
  if (!d) return '-';
  return d.toLocaleDateString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit' });
}

function daysLeft(ts) {
  const d = tsToDate(ts);
  if (!d) return '-';
  const diff = Math.ceil((d - Date.now()) / 86400000);
  return diff > 0 ? `D-${diff}` : '만기';
}

function isMatured(ts) {
  const d = tsToDate(ts);
  if (!d) return false;
  return d <= new Date();
}

// ── 관리자 UI ─────────────────────────────────────────────────────────────────
function initAdminUI() {
  const panel = $('soAdminPanel');
  if (panel) panel.style.display = '';

  // 배치 상점 가격 편집 패널 로드
  loadAdminPriceEditor(document.getElementById('placePriceEditorWrap'));

  $('btnSoCreateOffering')?.addEventListener('click', async () => {
    const btn   = $('btnSoCreateOffering');
    const msgEl = $('soCreateMsg');
    const data  = {
      name:          $('soOfferingName')?.value?.trim(),
      description:   $('soOfferingDesc')?.value?.trim(),
      strikePrice:   parseFloat($('soStrikePrice')?.value || '0'),
      voucherPrice:  parseFloat($('soVoucherPrice')?.value || '0'),
      jumpPerVoucher: parseInt($('soJumpPerVoucher')?.value || '0'),
      totalVouchers:  parseInt($('soTotalVouchers')?.value || '0'),
      maturityDays:   parseInt($('soMaturityDays')?.value || '0'),
      stakeRequired:  parseInt($('soStakeRequired')?.value || '0'),
    };
    if (!data.name) { setMsg(msgEl, '오퍼링 이름을 입력하세요', false); return; }
    if (!data.strikePrice || !data.jumpPerVoucher || !data.totalVouchers || !data.maturityDays) {
      setMsg(msgEl, '필수 항목을 모두 입력하세요', false); return;
    }
    btn.disabled = true; btn.textContent = '처리 중...';
    msgEl.textContent = '';
    try {
      const res = await cfAdminCreateOffering(data);
      setMsg(msgEl, `✅ 오퍼링 "${res.data.name}" 발행 완료`, true);
      ['soOfferingName','soOfferingDesc','soStrikePrice','soVoucherPrice','soJumpPerVoucher','soTotalVouchers','soMaturityDays']
        .forEach(id => { const el=$(id); if(el) el.value=''; });
      loadAdminOfferings();
      loadPublicOfferings(); // 공개 목록도 갱신
    } catch (err) {
      setMsg(msgEl, '오류: ' + err.message, false);
    } finally {
      btn.disabled = false; btn.textContent = '오퍼링 발행';
    }
  });

  loadAdminOfferings();
}

function setMsg(el, text, ok) {
  if (!el) return;
  el.style.color = ok ? '#22c55e' : '#ef4444';
  el.textContent = text;
}

async function loadAdminOfferings() {
  const listEl = $('soAdminOfferingList');
  if (!listEl) return;
  listEl.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;">불러오는 중...</div>';
  try {
    const res = await cfAdminGetOfferings();
    const offerings = res.data?.offerings || [];
    if (!offerings.length) { listEl.innerHTML = '<div style="color:var(--muted);">발행된 오퍼링 없음</div>'; return; }
    listEl.innerHTML = offerings.map(o => `
      <div style="border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <div style="flex:1;min-width:180px;">
          <div style="font-weight:700;">${escHtml(o.name)}</div>
          <div style="font-size:0.78rem;color:var(--muted);">
            행사가 ${o.strikePrice} Point/JUMP · 구매가 ${o.voucherPrice} Point · ${o.jumpPerVoucher} JUMP/장 · 만기 ${o.maturityDays}일
          </div>
          <div style="font-size:0.78rem;color:var(--muted);">판매 ${o.soldVouchers||0}/${o.totalVouchers} · ${o.active?'활성':'종료'}</div>
        </div>
        <button onclick="window.__soToggle('${o.id}', ${!o.active})" type="button"
          style="padding:5px 12px;border-radius:6px;border:1px solid var(--border);cursor:pointer;font-size:0.8rem;background:${o.active?'#fee2e2':'#d1fae5'};color:${o.active?'#ef4444':'#059669'};">
          ${o.active ? '비활성화' : '활성화'}
        </button>
      </div>`).join('');

    window.__soToggle = async (offeringId, active) => {
      try {
        await cfAdminToggle({ offeringId, active });
        loadAdminOfferings();
        loadPublicOfferings();
      } catch (err) { alert(err.message); }
    };
  } catch (err) {
    listEl.innerHTML = `<div style="color:#ef4444;">오류: ${escHtml(err.message)}</div>`;
  }
}

// ── 공개: 구매 가능한 오퍼링 목록 ─────────────────────────────────────────────
async function loadPublicOfferings() {
  const listEl = $('soOfferingList');
  const emptyEl = $('soOfferingEmpty');
  if (!listEl) return;
  listEl.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;">불러오는 중...</div>';
  if (emptyEl) emptyEl.style.display = 'none';
  try {
    const res      = await cfGetOfferings();
    const offerings = (res.data?.offerings || []).filter(o => o.soldVouchers < o.totalVouchers);
    if (!offerings.length) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.style.display = '';
      return;
    }
    listEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    offerings.forEach(o => {
      const remaining    = (o.totalVouchers || 0) - (o.soldVouchers || 0);
      const matDate      = fmtDate(o.maturityDate);
      const stakeReq     = o.stakeRequired || 0;
      const stakeBadge   = stakeReq > 0
        ? `<div style="margin-bottom:10px;padding:7px 10px;background:#fef3c7;border-radius:8px;font-size:0.8rem;color:#92400e;font-weight:600;">
             🪙 스테이킹 조건: JUMP ${stakeReq.toLocaleString()}개 이상
           </div>`
        : '';
      const card = document.createElement('div');
      card.innerHTML = `
        <div style="border:1px solid var(--border,#e5e7eb);border-radius:14px;overflow:hidden;background:var(--surface,#fff);">
          <div style="background:linear-gradient(135deg,#1e3a5f,#1e40af);padding:14px 16px;">
            <div style="color:#fff;font-weight:700;font-size:1rem;">📈 ${escHtml(o.name)}</div>
            ${o.description ? `<div style="color:#bfdbfe;font-size:0.78rem;margin-top:2px;">${escHtml(o.description)}</div>` : ''}
          </div>
          <div style="padding:14px 16px;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
              <div><div style="font-size:0.72rem;color:var(--muted);">바우처 가격</div>
                   <div style="font-weight:700;font-size:1rem;color:#1d4ed8;">${o.voucherPrice} Point</div></div>
              <div><div style="font-size:0.72rem;color:var(--muted);">JUMP 수량</div>
                   <div style="font-weight:700;font-size:1rem;">${o.jumpPerVoucher} JUMP</div></div>
              <div><div style="font-size:0.72rem;color:var(--muted);">행사 가격</div>
                   <div style="font-weight:600;">${o.strikePrice} Point/JUMP</div></div>
              <div><div style="font-size:0.72rem;color:var(--muted);">만기일</div>
                   <div style="font-weight:600;">${matDate}</div></div>
            </div>
            ${stakeBadge}
            <div style="font-size:0.78rem;color:var(--muted);margin-bottom:10px;">
              잔여 ${remaining}/${o.totalVouchers}장
            </div>
            <button data-buy="${o.id}" type="button" ${!_user?'disabled':''}
              style="width:100%;padding:10px;background:${_user?'#1d4ed8':'#e5e7eb'};color:${_user?'#fff':'#9ca3af'};
                     border:none;border-radius:8px;font-size:0.9rem;font-weight:700;cursor:${_user?'pointer':'not-allowed'};">
              ${_user ? '🛒 바우처 구매' : '🔒 로그인 필요'}
            </button>
          </div>
        </div>`;
      card.querySelector(`[data-buy="${o.id}"]`)?.addEventListener('click', () => openBuyModal(o));
      frag.appendChild(card);
    });
    listEl.appendChild(frag);
  } catch (err) {
    listEl.innerHTML = `<div style="color:#ef4444;">오류: ${escHtml(err.message)}</div>`;
  }
}

// ── 구매 모달 ────────────────────────────────────────────────────────────────
let _buyOffering = null;
function openBuyModal(o) {
  _buyOffering = o;
  const modal = $('soBuyModal');
  if (!modal) return;
  document.getElementById('soBuyOfferingName').textContent = o.name;
  document.getElementById('soBuyPrice').textContent        = `${o.voucherPrice} Point`;
  document.getElementById('soBuyJump').textContent         = `${o.jumpPerVoucher} JUMP`;
  document.getElementById('soBuyStrike').textContent       = `${o.strikePrice} Point/JUMP`;
  document.getElementById('soBuyMaturity').textContent     = fmtDate(o.maturityDate);
  const stakeEl = document.getElementById('soBuyStakeReq');
  if (stakeEl) {
    const req = o.stakeRequired || 0;
    stakeEl.textContent  = req > 0 ? `🪙 조건: JUMP ${req.toLocaleString()}개 이상 스테이킹` : '';
    stakeEl.style.display = req > 0 ? '' : 'none';
  }
  document.getElementById('soBuyMsg').textContent = '';
  document.getElementById('btnSoBuyConfirm').disabled      = false;
  document.getElementById('btnSoBuyConfirm').textContent   = '🛒 구매하기';
  modal.style.display = 'flex';
}

async function handleBuyVoucher() {
  const o     = _buyOffering;
  const msgEl = $('soBuyMsg');
  const btn   = $('btnSoBuyConfirm');
  if (!o) return;

  if (!confirm(`"${o.name}" 바우처를 ${o.voucherPrice} Point로 구매하시겠습니까?\n(수탁 지갑 Point로 결제됩니다)`)) return;

  btn.disabled = true; btn.textContent = '처리 중...';
  setMsg(msgEl, '', true);
  try {
    const res = await cfBuy({ offeringId: o.id });
    setMsg(msgEl, `✅ 구매 완료! 바우처 #${res.data.voucherId} 발급 (${res.data.jumpPerVoucher} JUMP)`, true);
    setTimeout(() => {
      $('soBuyModal').style.display = 'none';
      loadMyVouchers();
      loadPublicOfferings();
    }, 2000);
  } catch (err) {
    setMsg(msgEl, '오류: ' + err.message, false);
    btn.disabled = false; btn.textContent = '🛒 구매하기';
  }
}

// ── 내 바우처 ────────────────────────────────────────────────────────────────
async function loadMyVouchers() {
  const listEl  = $('soUserVoucherList');
  const emptyEl = $('soUserEmpty');
  if (!listEl) return;
  if (!_user) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
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
      const matured   = isMatured(v.maturityDate);
      const remaining = (v.jumpPerVoucher || 0) - (v.exercisedAmount || 0);
      const canExec   = v.active && matured && remaining > 0;
      const pct       = v.jumpPerVoucher ? Math.round(((v.exercisedAmount||0) / v.jumpPerVoucher) * 100) : 0;
      const card      = document.createElement('div');
      card.innerHTML  = `
        <div style="border:1px solid var(--border,#e5e7eb);border-radius:12px;overflow:hidden;background:var(--surface,#fff);">
          <div style="background:linear-gradient(135deg,#7c3aed,#a78bfa);padding:12px 16px;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="color:#fff;font-weight:700;">📈 ${escHtml(v.offeringName||'스톡옵션')} #${v.voucherId}</div>
              <div style="color:#e9d5ff;font-size:0.75rem;">만기: ${fmtDate(v.maturityDate)} · ${daysLeft(v.maturityDate)}</div>
            </div>
            <span style="padding:2px 10px;border-radius:99px;font-size:0.75rem;font-weight:700;
              background:${canExec?'#fef3c7':matured?'#f3f4f6':'#ede9fe'};
              color:${canExec?'#92400e':matured?'#6b7280':'#7c3aed'};">
              ${canExec ? '✅ 행사 가능' : matured ? '만기 완료' : '대기 중'}
            </span>
          </div>
          <div style="padding:14px 16px;">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;">
              <div><div style="font-size:0.72rem;color:var(--muted);">행사 가격</div>
                   <div style="font-weight:600;">${v.strikePrice} Point</div></div>
              <div><div style="font-size:0.72rem;color:var(--muted);">행사 완료</div>
                   <div style="font-weight:600;color:#7c3aed;">${v.exercisedAmount||0} JUMP</div></div>
              <div><div style="font-size:0.72rem;color:var(--muted);">잔여</div>
                   <div style="font-weight:600;color:#059669;">${remaining} JUMP</div></div>
            </div>
            <div style="background:#f3f4f6;border-radius:4px;height:6px;margin-bottom:12px;">
              <div style="background:#7c3aed;border-radius:4px;height:6px;width:${pct}%;"></div>
            </div>
            <div style="display:flex;gap:8px;">
              <button data-exec="${v.voucherId}" ${!canExec?'disabled':''} type="button"
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
      card.querySelector(`[data-exec="${v.voucherId}"]`)?.addEventListener('click', () => openExecModal(v, remaining));
      card.querySelector(`[data-transfer="${v.voucherId}"]`)?.addEventListener('click', () => openTransferModal(v));
      frag.appendChild(card);
    });
    listEl.appendChild(frag);
  } catch (err) {
    listEl.innerHTML = `<div style="color:#ef4444;">오류: ${escHtml(err.message)}</div>`;
  }
}

// ── 권리행사 모달 ─────────────────────────────────────────────────────────────
let _execVoucher = null, _execRemaining = 0;
function openExecModal(v, remaining) {
  _execVoucher = v; _execRemaining = remaining;
  const modal = $('soExecuteModal');
  if (!modal) return;
  document.getElementById('soExecVoucherId').textContent  = `#${v.voucherId}`;
  document.getElementById('soExecStrike').textContent     = `${v.strikePrice} Point/JUMP`;
  document.getElementById('soExecRemaining').textContent  = `${remaining} JUMP`;
  const inp = document.getElementById('soExecAmount');
  if (inp) { inp.value = ''; inp.max = remaining; }
  document.getElementById('soExecMsg').textContent = '';
  document.getElementById('btnSoExecute').disabled = false;
  document.getElementById('btnSoExecute').textContent = '⚡ 권리행사';
  modal.style.display = 'flex';
}

async function handleExercise() {
  const v      = _execVoucher;
  const amount = parseInt($('soExecAmount')?.value || '0');
  const msgEl  = $('soExecMsg');
  const btn    = $('btnSoExecute');
  if (!v || !amount || amount <= 0) { setMsg(msgEl, '수량을 입력하세요', false); return; }
  if (amount > _execRemaining)       { setMsg(msgEl, `잔여 수량(${_execRemaining} JUMP) 초과`, false); return; }

  const hexCost = (v.strikePrice * amount).toFixed(4);
  if (!confirm(`${amount} JUMP 행사\n결제 금액: ${hexCost} Point (수탁 지갑)\n계속하시겠습니까?`)) return;

  btn.disabled = true; btn.textContent = '처리 중...';
  setMsg(msgEl, '⏳ 수탁 지갑에서 처리 중...', true);
  try {
    const res = await cfExercise({ voucherId: v.voucherId, amount });
    setMsg(msgEl, `✅ ${res.data.jumpReceived} JUMP 수령 완료! (Tx: ${res.data.txHash?.slice(0,14)}…)`, true);
    setTimeout(() => { $('soExecuteModal').style.display = 'none'; loadMyVouchers(); }, 2500);
  } catch (err) {
    setMsg(msgEl, '오류: ' + err.message, false);
    btn.disabled = false; btn.textContent = '⚡ 권리행사';
  }
}

// ── 양도 모달 ─────────────────────────────────────────────────────────────────
let _transferVoucher = null;
function openTransferModal(v) {
  _transferVoucher = v;
  const modal = $('soTransferModal');
  if (!modal) return;
  document.getElementById('soTransferVoucherId').textContent = `#${v.voucherId}`;
  const inp = $('soTransferTo'); if (inp) inp.value = '';
  document.getElementById('soTransferMsg').textContent = '';
  document.getElementById('btnSoTransfer').disabled    = false;
  document.getElementById('btnSoTransfer').textContent = '🔄 양도 확인';
  modal.style.display = 'flex';
}

async function handleTransfer() {
  const v      = _transferVoucher;
  const toAddr = $('soTransferTo')?.value?.trim();
  const msgEl  = $('soTransferMsg');
  const btn    = $('btnSoTransfer');
  if (!v || !toAddr) { setMsg(msgEl, '받는 주소를 입력하세요', false); return; }
  if (!confirm(`바우처 #${v.voucherId}을 아래 주소로 양도합니다:\n${toAddr}\n\n취소할 수 없습니다. 계속하시겠습니까?`)) return;

  btn.disabled = true; btn.textContent = '처리 중...';
  setMsg(msgEl, '⏳ 온체인 양도 처리 중...', true);
  try {
    const res = await cfTransfer({ voucherId: v.voucherId, toAddress: toAddr });
    setMsg(msgEl, `✅ 양도 완료 (Tx: ${res.data.txHash?.slice(0,14)}…)`, true);
    setTimeout(() => { $('soTransferModal').style.display = 'none'; loadMyVouchers(); }, 2500);
  } catch (err) {
    setMsg(msgEl, '오류: ' + err.message, false);
    btn.disabled = false; btn.textContent = '🔄 양도 확인';
  }
}

// ── 초기화 ────────────────────────────────────────────────────────────────────
export function initStockOption(user, isAdmin) {
  _user    = user;
  _isAdmin = isAdmin;

  // 모달 닫기
  ['soBuyModal','soExecuteModal','soTransferModal'].forEach(id => {
    const modal = $(id);
    modal?.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
  });
  $('btnSoBuyClose')?.addEventListener('click',      () => { $('soBuyModal').style.display      = 'none'; });
  $('btnSoExecClose')?.addEventListener('click',     () => { $('soExecuteModal').style.display  = 'none'; });
  $('btnSoTransferClose')?.addEventListener('click', () => { $('soTransferModal').style.display = 'none'; });

  // 확인 버튼
  $('btnSoBuyConfirm')?.addEventListener('click', handleBuyVoucher);
  $('btnSoExecute')?.addEventListener('click',    handleExercise);
  $('btnSoTransfer')?.addEventListener('click',   handleTransfer);

  // 새로고침
  $('btnSoRefreshUser')?.addEventListener('click',  loadMyVouchers);
  $('btnSoRefreshMarket')?.addEventListener('click', loadPublicOfferings);
  $('btnSoRefreshAdmin')?.addEventListener('click',  loadAdminOfferings);

  // 관리자 패널
  if (isAdmin) initAdminUI();

  // 공개 오퍼링 + 내 바우처 로드
  loadPublicOfferings();
  if (user) loadMyVouchers();
}
