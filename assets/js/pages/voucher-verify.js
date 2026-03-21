// /assets/js/pages/voucher-verify.js
// 바우처 QR 확인 페이지 — 판매자 사용 확인 + 정산 안내

import { getApps, initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getFirestore, doc, getDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { getFunctions, httpsCallable }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { firebaseConfig } from '/assets/js/firebase-config.js';
import { watchAuth }      from '/assets/js/auth.js';

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db  = getFirestore(app);
const fns = getFunctions(app);
const fnConfirmVoucher = httpsCallable(fns, 'confirmVoucher');

// ── URL 파라미터 파싱 ─────────────────────────────────────────
const params    = new URLSearchParams(location.search);
const voucherId = params.get('v'); // uid_eventId

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('ko-KR');
}
function fmtVnd(n) {
  return `₫${Number(n||0).toLocaleString()} VND`;
}

// ── 상태 ──────────────────────────────────────────────────────
let _voucher  = null;
let _event    = null;
let _user     = null;
let _isAdmin  = false;

const root = document.getElementById('verifyRoot');

function render() {
  if (!_voucher || !_event) return;

  const isUsed     = _voucher.status === 'used';
  const isSettled  = _voucher.settlementStatus === 'settled';
  const sellers    = _event.allowedSellers || [];
  const settleAmt  = _event.settlementAmount || 0;

  const badgeClass = isUsed ? 'used' : 'active';
  const badgeText  = isUsed ? '✅ 사용 완료' : '🟢 미사용 (유효)';

  const sellersHtml = sellers.length > 0
    ? `<div class="verify-sellers">
         📍 사용 가능 판매자
         <ul>${sellers.map(s => `<li>${escHtml(s.name || s)}</li>`).join('')}</ul>
       </div>`
    : '';

  let actionHtml = '';

  if (isUsed) {
    actionHtml = `
      <div class="verify-used-box">
        이미 사용된 바우처입니다.<br>
        <span style="font-size:0.8rem;">사용일시: ${fmtDate(_voucher.usedAt)}</span><br>
        ${_voucher.usedBySellerName
          ? `<span style="font-size:0.8rem;">사용 판매자: ${escHtml(_voucher.usedBySellerName)}</span>`
          : ''}
        ${isSettled
          ? `<div style="margin-top:8px;color:#15803d;font-size:0.82rem;">✅ 정산 완료</div>`
          : (settleAmt > 0
            ? `<div style="margin-top:8px;color:#d97706;font-size:0.82rem;">⏳ 정산 대기 중 (${fmtVnd(settleAmt)})</div>`
            : '')}
      </div>`;
  } else if (!_user) {
    actionHtml = `
      <div class="verify-login-prompt">
        🔒 사용 확인을 위해 로그인이 필요합니다.
      </div>`;
  } else {
    actionHtml = `
      <button class="btn-confirm" id="btnConfirm">
        ✅ 사용 확인 (${settleAmt > 0 ? `정산: ${fmtVnd(settleAmt)}` : '정산 없음'})
      </button>`;
  }

  root.innerHTML = `
    <div class="verify-card">
      <span class="verify-status-badge verify-status-badge--${badgeClass}">${badgeText}</span>
      <h2 class="verify-event-name">${escHtml(_event.name || '')}</h2>

      <div class="verify-row">
        <span class="k">행사 장소</span>
        <span class="v">${escHtml(_event.location || '-')}</span>
      </div>
      <div class="verify-row">
        <span class="k">바우처 금액</span>
        <span class="v">${fmtVnd(_voucher.priceVnd)}</span>
      </div>
      <div class="verify-row">
        <span class="k">구매자</span>
        <span class="v">${escHtml(_voucher.displayName || '회원')}</span>
      </div>
      <div class="verify-row">
        <span class="k">구매일시</span>
        <span class="v">${fmtDate(_voucher.createdAt)}</span>
      </div>
      <div class="verify-row">
        <span class="k">정산 금액</span>
        <span class="v" style="color:var(--accent,#7c3aed);font-weight:700;">${settleAmt > 0 ? fmtVnd(settleAmt) : '해당 없음'}</span>
      </div>

      ${sellersHtml}
      ${actionHtml}
    </div>`;

  // 확인 버튼 이벤트
  const btn = document.getElementById('btnConfirm');
  if (btn) {
    btn.addEventListener('click', async () => {
      if (!confirm('이 바우처를 사용 처리하시겠습니까?\n확인 후 취소할 수 없습니다.')) return;
      btn.disabled = true;
      btn.textContent = '처리 중...';
      try {
        const res = await fnConfirmVoucher({ voucherId });
        document.querySelector('.verify-card').insertAdjacentHTML('beforeend', `
          <div class="verify-confirm-done">
            ✅ 사용 확인 완료!
            <div class="verify-settle">
              ${res.data.settlementAmount > 0
                ? `관리자에게 정산 요청: <strong>${fmtVnd(res.data.settlementAmount)}</strong>`
                : '정산 금액 없음'}
            </div>
          </div>`);
        btn.remove();
        // 배지 갱신
        document.querySelector('.verify-status-badge').className = 'verify-status-badge verify-status-badge--used';
        document.querySelector('.verify-status-badge').textContent = '✅ 사용 완료';
      } catch (err) {
        alert('오류: ' + (err.message || err));
        btn.disabled = false;
        btn.textContent = '✅ 사용 확인';
      }
    });
  }
}

// ── 초기 로드 ─────────────────────────────────────────────────
async function init() {
  if (!voucherId) {
    root.innerHTML = '<div class="verify-error">유효하지 않은 바우처 링크입니다.</div>';
    return;
  }

  try {
    const vSnap = await getDoc(doc(db, 'community_event_vouchers', voucherId));
    if (!vSnap.exists()) {
      root.innerHTML = '<div class="verify-error">바우처를 찾을 수 없습니다.</div>';
      return;
    }
    _voucher = vSnap.data();

    const eSnap = await getDoc(doc(db, 'community_events', _voucher.eventId));
    _event = eSnap.exists() ? eSnap.data() : {};
    // id 주입
    _voucher.id = voucherId;
    _event.id   = _voucher.eventId;

    render();
  } catch (err) {
    root.innerHTML = `<div class="verify-error">불러오기 실패: ${err.message}</div>`;
  }
}

// ── 인증 감시 ────────────────────────────────────────────────
watchAuth(({ loggedIn, role, profile }) => {
  _user    = loggedIn ? profile : null;
  _isAdmin = loggedIn && role === 'admin';
  if (_voucher) render(); // 로그인 상태 변화 시 버튼 재렌더
});

init();
