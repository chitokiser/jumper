// assets/js/pages/buggy-admin.js
// 버기카 관리 대시보드

import { getApps, initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getFirestore, collection, query, where, orderBy, limit,
  getDocs, onSnapshot, doc, getDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { getFunctions, httpsCallable }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { firebaseConfig } from '/assets/js/firebase-config.js';
import { watchAuth }      from '/assets/js/auth.js';

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db  = getFirestore(app);
const fns = getFunctions(app);

const fnForceEnd        = httpsCallable(fns, 'buggyAdminForceEnd');
const fnTopUp           = httpsCallable(fns, 'buggyAdminTopUpBalance');
const fnCreateDriver    = httpsCallable(fns, 'buggyAdminCreateDriver');
const fnSaveConfig      = httpsCallable(fns, 'buggyAdminSaveConfig');
const fnGetConfig       = httpsCallable(fns, 'buggyGetConfig');
const fnToggleMerchant  = httpsCallable(fns, 'adminToggleMerchant');
const fnDisableUser     = httpsCallable(fns, 'adminDisableUser');
const fnEnableUser      = httpsCallable(fns, 'adminEnableUser');

// ── 유틸 ─────────────────────────────────────────────────────────────────
const toastEl = document.getElementById('adminToast');
function toast(msg, ms = 3000) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), ms);
}
function fmtVnd(n) { return `₫${Number(n || 0).toLocaleString()}`; }
function fmtDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('ko-KR');
}
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function statusBadge(status) {
  return `<span class="buggy-badge buggy-badge--${status}">${escHtml(status)}</span>`;
}

// ── 탭 ───────────────────────────────────────────────────────────────────
document.getElementById('adminTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.buggy-tab');
  if (!btn) return;
  document.querySelectorAll('.buggy-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const tab = btn.dataset.tab;
  document.querySelectorAll('[id^="tab"]').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`).classList.add('active');
  if (tab === 'rides')     loadRides();
  if (tab === 'drivers')   loadDrivers();
  if (tab === 'merchants') loadMerchants();
  if (tab === 'members')   loadMembers();
  if (tab === 'config')    loadConfig();
});

// ── 통계 실시간 ──────────────────────────────────────────────────────────
function subscribeStats() {
  // 진행 중 호출
  onSnapshot(
    query(collection(db, 'buggy_rides'), where('status', 'in', ['searching','accepted','arriving','riding'])),
    (snap) => { document.getElementById('statActive').textContent = snap.size; }
  );
  // 온라인 기사
  onSnapshot(
    query(collection(db, 'buggy_drivers'), where('isOnline', '==', true)),
    (snap) => { document.getElementById('statDrivers').textContent = snap.size; }
  );
  // 오늘 완료 + 매출
  const today = new Date(); today.setHours(0,0,0,0);
  onSnapshot(
    query(
      collection(db, 'buggy_rides'),
      where('status', '==', 'completed'),
      where('endedAt', '>=', today),
      orderBy('endedAt', 'desc')
    ),
    (snap) => {
      document.getElementById('statToday').textContent = snap.size;
      const rev = snap.docs.reduce((acc, d) => acc + (d.data().feeVnd || 0), 0);
      document.getElementById('statRevenue').textContent = fmtVnd(rev);
    }
  );
}

// ── 호출 목록 ────────────────────────────────────────────────────────────
let _forceRideId = null;

async function loadRides() {
  const statusVal = document.getElementById('rideStatusFilter').value;
  const wrap = document.getElementById('ridesTableWrap');
  wrap.innerHTML = '<div class="buggy-loading"><div class="buggy-spinner"></div><br>로딩 중...</div>';

  let q;
  if (statusVal) {
    q = query(collection(db, 'buggy_rides'), where('status', '==', statusVal), orderBy('createdAt', 'desc'), limit(50));
  } else {
    q = query(collection(db, 'buggy_rides'), orderBy('createdAt', 'desc'), limit(50));
  }

  try {
    const snap = await getDocs(q);
    if (snap.empty) { wrap.innerHTML = '<div class="buggy-empty"><div class="buggy-empty-icon">📋</div>데이터 없음</div>'; return; }

    let html = `<table class="buggy-table">
      <thead><tr>
        <th>상태</th><th>요청자</th><th>기사</th>
        <th>탑승 위치</th><th>요금</th><th>요청 시각</th><th>액션</th>
      </tr></thead><tbody>`;

    snap.docs.forEach((d) => {
      const r = d.data();
      const activeStatuses = ['searching','accepted','arriving','riding'];
      const actionBtn = activeStatuses.includes(r.status)
        ? `<button class="buggy-btn buggy-btn--danger" style="width:auto;padding:4px 8px;font-size:0.78rem;" data-rideid="${d.id}">강제 종료</button>`
        : '-';

      html += `<tr>
        <td>${statusBadge(r.status)}</td>
        <td>${escHtml(r.userDisplayName || r.userId?.slice(0,8))}</td>
        <td>${escHtml(r.driverName || '-')}</td>
        <td style="max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(r.pickupAddress || `${r.pickupLat},${r.pickupLng}`)}</td>
        <td>${r.feeVnd ? fmtVnd(r.feeVnd) : '-'}</td>
        <td>${fmtDate(r.createdAt)}</td>
        <td>${actionBtn}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;

    wrap.querySelectorAll('[data-rideid]').forEach((btn) => {
      btn.addEventListener('click', () => {
        _forceRideId = btn.dataset.rideid;
        document.getElementById('forceEndReason').value = '';
        document.getElementById('forceEndModal').classList.add('open');
      });
    });
  } catch (err) {
    wrap.innerHTML = `<div class="buggy-empty">오류: ${escHtml(err.message)}</div>`;
  }
}

document.getElementById('btnLoadRides').addEventListener('click', loadRides);

// 강제 종료 모달
document.getElementById('btnConfirmForceEnd').addEventListener('click', async () => {
  if (!_forceRideId) return;
  const reason = document.getElementById('forceEndReason').value.trim() || '관리자 강제 종료';
  document.getElementById('btnConfirmForceEnd').disabled = true;
  try {
    await fnForceEnd({ rideId: _forceRideId, reason });
    document.getElementById('forceEndModal').classList.remove('open');
    toast('강제 종료 완료');
    loadRides();
  } catch (err) {
    toast('오류: ' + (err.message || err));
  } finally {
    document.getElementById('btnConfirmForceEnd').disabled = false;
  }
});

document.getElementById('btnCloseForceEnd').addEventListener('click', () => {
  document.getElementById('forceEndModal').classList.remove('open');
});

// ── 기사 관리 ────────────────────────────────────────────────────────────
async function loadDrivers() {
  const wrap = document.getElementById('driversTableWrap');
  wrap.innerHTML = '<div class="buggy-loading"><div class="buggy-spinner"></div><br>로딩 중...</div>';
  try {
    const snap = await getDocs(query(collection(db, 'buggy_drivers'), orderBy('createdAt', 'desc')));
    if (snap.empty) { wrap.innerHTML = '<div class="buggy-empty"><div class="buggy-empty-icon">🧑</div>등록된 기사 없음</div>'; return; }

    let html = `<table class="buggy-table">
      <thead><tr>
        <th>이름</th><th>차량번호</th><th>차종</th><th>상태</th><th>활성</th>
      </tr></thead><tbody>`;
    snap.docs.forEach((d) => {
      const r = d.data();
      html += `<tr>
        <td>${escHtml(r.name)}</td>
        <td>${escHtml(r.vehicleNumber)}</td>
        <td>${escHtml(r.vehicleModel)}</td>
        <td>${r.isOnline ? '<span class="buggy-badge buggy-badge--online">온라인</span>' : '<span class="buggy-badge buggy-badge--offline">오프라인</span>'}</td>
        <td>${r.isActive ? '✅' : '❌'}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
  } catch (err) {
    wrap.innerHTML = `<div class="buggy-empty">오류: ${escHtml(err.message)}</div>`;
  }
}

document.getElementById('btnCreateDriver').addEventListener('click', async () => {
  const uid          = document.getElementById('drvUid').value.trim();
  const name         = document.getElementById('drvName').value.trim();
  const vehicleNumber= document.getElementById('drvVehicleNum').value.trim();
  const vehicleModel = document.getElementById('drvVehicleModel').value.trim();
  if (!uid || !name) { toast('UID와 이름을 입력하세요'); return; }

  document.getElementById('btnCreateDriver').disabled = true;
  try {
    await fnCreateDriver({ uid, name, vehicleNumber, vehicleModel });
    toast('기사 등록 완료');
    document.getElementById('drvUid').value = '';
    document.getElementById('drvName').value = '';
    document.getElementById('drvVehicleNum').value = '';
    document.getElementById('drvVehicleModel').value = '';
    loadDrivers();
  } catch (err) {
    toast('오류: ' + (err.message || err));
  } finally {
    document.getElementById('btnCreateDriver').disabled = false;
  }
});

// ── 잔액 충전 ────────────────────────────────────────────────────────────
document.getElementById('btnTopUp').addEventListener('click', async () => {
  const userId = document.getElementById('topUpUid').value.trim();
  const amount = parseInt(document.getElementById('topUpAmount').value);
  if (!userId) { toast('사용자 UID를 입력하세요'); return; }
  if (!amount || amount <= 0) { toast('올바른 금액을 입력하세요'); return; }

  document.getElementById('btnTopUp').disabled = true;
  const resultEl = document.getElementById('topUpResult');
  resultEl.textContent = '';
  try {
    const res = await fnTopUp({ userId, amount });
    resultEl.textContent = `✅ 충전 완료! 새 잔액: ${fmtVnd(res.data.newBalance)}`;
    resultEl.style.color = '#16a34a';
    document.getElementById('topUpUid').value = '';
    document.getElementById('topUpAmount').value = '';
  } catch (err) {
    resultEl.textContent = '❌ ' + (err.message || err);
    resultEl.style.color = '#dc2626';
  } finally {
    document.getElementById('btnTopUp').disabled = false;
  }
});

// ── 거래 내역 ────────────────────────────────────────────────────────────
document.getElementById('btnLoadTx').addEventListener('click', async () => {
  const uid = document.getElementById('txUid').value.trim();
  const wrap = document.getElementById('txTableWrap');
  wrap.innerHTML = '<div class="buggy-loading"><div class="buggy-spinner"></div></div>';

  let q;
  if (uid) {
    q = query(collection(db, 'buggy_transactions'), where('userId', '==', uid), orderBy('createdAt', 'desc'), limit(50));
  } else {
    q = query(collection(db, 'buggy_transactions'), orderBy('createdAt', 'desc'), limit(50));
  }

  try {
    const snap = await getDocs(q);
    if (snap.empty) { wrap.innerHTML = '<div class="buggy-empty">내역 없음</div>'; return; }

    let html = `<table class="buggy-table">
      <thead><tr><th>타입</th><th>금액</th><th>잔액 후</th><th>상태</th><th>설명</th><th>일시</th></tr></thead><tbody>`;
    snap.docs.forEach((d) => {
      const r = d.data();
      const amtColor = r.amount > 0 ? '#16a34a' : '#dc2626';
      html += `<tr>
        <td>${escHtml(r.type)}</td>
        <td style="color:${amtColor};font-weight:700;">${r.amount > 0 ? '+' : ''}${fmtVnd(r.amount)}</td>
        <td>${fmtVnd(r.balanceAfter)}</td>
        <td>${escHtml(r.status)}</td>
        <td style="max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(r.description)}</td>
        <td>${fmtDate(r.createdAt)}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
  } catch (err) {
    wrap.innerHTML = `<div class="buggy-empty">오류: ${escHtml(err.message)}</div>`;
  }
});

// ── 가맹점 관리 ──────────────────────────────────────────────────────────
async function loadMerchants() {
  const wrap = document.getElementById('merchantsTableWrap');
  wrap.innerHTML = '<div class="buggy-loading"><div class="buggy-spinner"></div><br>로딩 중...</div>';
  try {
    const snap = await getDocs(query(collection(db, 'merchants'), orderBy('createdAt', 'desc')));
    if (snap.empty) {
      wrap.innerHTML = '<div class="buggy-empty"><div class="buggy-empty-icon">🏪</div>등록된 가맹점 없음</div>';
      return;
    }

    let html = `<table class="buggy-table">
      <thead><tr>
        <th>ID</th><th>상호명</th><th>수수료</th><th>상태</th><th>등록일</th><th>액션</th>
      </tr></thead><tbody>`;

    snap.docs.forEach((d) => {
      const m = d.data();
      const isActive = m.active !== false;
      const feePct   = m.feeBps != null ? (m.feeBps / 100).toFixed(1) + '%' : '-';
      const badge    = isActive
        ? '<span class="buggy-badge buggy-badge--online">활성</span>'
        : '<span class="buggy-badge buggy-badge--offline">비활성</span>';
      const actionBtn = isActive
        ? `<button class="buggy-btn buggy-btn--danger" style="width:auto;padding:4px 10px;font-size:0.78rem;"
              data-merchant-id="${escHtml(String(m.merchantId))}" data-action="deactivate">비활성화</button>`
        : `<button class="buggy-btn buggy-btn--success" style="width:auto;padding:4px 10px;font-size:0.78rem;"
              data-merchant-id="${escHtml(String(m.merchantId))}" data-action="activate">활성화</button>`;

      html += `<tr>
        <td>${escHtml(String(m.merchantId ?? d.id))}</td>
        <td>${escHtml(m.businessName || m.name || '-')}</td>
        <td>${feePct}</td>
        <td>${badge}</td>
        <td>${fmtDate(m.createdAt)}</td>
        <td>${actionBtn}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;

    wrap.querySelectorAll('[data-merchant-id]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const merchantId = Number(btn.dataset.merchantId);
        const active     = btn.dataset.action === 'activate';
        const label      = active ? '활성화' : '비활성화';
        if (!confirm(`가맹점 #${merchantId}을(를) ${label}하시겠습니까?`)) return;
        btn.disabled = true;
        try {
          await fnToggleMerchant({ merchantId, active });
          toast(`가맹점 #${merchantId} ${label} 완료`);
          loadMerchants();
        } catch (err) {
          toast('오류: ' + (err.message || err));
          btn.disabled = false;
        }
      });
    });
  } catch (err) {
    wrap.innerHTML = `<div class="buggy-empty">오류: ${escHtml(err.message)}</div>`;
  }
}

document.getElementById('btnLoadMerchants').addEventListener('click', loadMerchants);

// ── 회원 관리 ────────────────────────────────────────────────────────────
async function renderMembersTable(snap, wrap) {
  if (snap.empty) {
    wrap.innerHTML = '<div class="buggy-empty"><div class="buggy-empty-icon">👤</div>회원 없음</div>';
    return;
  }

  let html = `<table class="buggy-table">
    <thead><tr>
      <th>UID</th><th>이름</th><th>이메일</th><th>지갑</th><th>상태</th><th>가입일</th><th>액션</th>
    </tr></thead><tbody>`;

  snap.docs.forEach((d) => {
    const u = d.data();
    const uid = d.id;
    const isDisabled = u.disabled === true;
    const badge = isDisabled
      ? '<span class="buggy-badge buggy-badge--offline">비활성</span>'
      : '<span class="buggy-badge buggy-badge--online">정상</span>';
    const wallet = u.walletAddress
      ? `<span title="${escHtml(u.walletAddress)}">${escHtml(u.walletAddress.slice(0,8))}…</span>`
      : '-';
    const actionBtn = isDisabled
      ? `<button class="buggy-btn buggy-btn--success" style="width:auto;padding:4px 10px;font-size:0.78rem;"
            data-user-uid="${escHtml(uid)}" data-action="enable">복원</button>`
      : `<button class="buggy-btn buggy-btn--danger" style="width:auto;padding:4px 10px;font-size:0.78rem;"
            data-user-uid="${escHtml(uid)}" data-action="disable">탈퇴처리</button>`;

    html += `<tr>
      <td style="font-size:0.75rem;">${escHtml(uid.slice(0,12))}…</td>
      <td>${escHtml(u.displayName || u.name || '-')}</td>
      <td style="font-size:0.8rem;">${escHtml(u.email || '-')}</td>
      <td>${wallet}</td>
      <td>${badge}</td>
      <td>${fmtDate(u.createdAt)}</td>
      <td>${actionBtn}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;

  wrap.querySelectorAll('[data-user-uid]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const targetUid = btn.dataset.userUid;
      const disable   = btn.dataset.action === 'disable';
      const label     = disable ? '탈퇴 처리(비활성화)' : '계정 복원';
      if (!confirm(`${targetUid}\n위 회원을 ${label}하시겠습니까?\n${disable ? 'Firebase 로그인이 차단됩니다.' : ''}`)) return;
      btn.disabled = true;
      try {
        if (disable) {
          await fnDisableUser({ targetUid });
          toast('탈퇴 처리 완료 — 로그인 차단됨');
        } else {
          await fnEnableUser({ targetUid });
          toast('계정 복원 완료');
        }
        loadMembers();
      } catch (err) {
        toast('오류: ' + (err.message || err));
        btn.disabled = false;
      }
    });
  });
}

async function loadMembers() {
  const wrap = document.getElementById('membersTableWrap');
  wrap.innerHTML = '<div class="buggy-loading"><div class="buggy-spinner"></div><br>로딩 중...</div>';
  try {
    const snap = await getDocs(
      query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(50))
    );
    await renderMembersTable(snap, wrap);
  } catch (err) {
    wrap.innerHTML = `<div class="buggy-empty">오류: ${escHtml(err.message)}</div>`;
  }
}

async function searchMember() {
  const keyword = document.getElementById('memberSearchEmail').value.trim();
  if (!keyword) { loadMembers(); return; }
  const wrap = document.getElementById('membersTableWrap');
  wrap.innerHTML = '<div class="buggy-loading"><div class="buggy-spinner"></div><br>검색 중...</div>';
  try {
    // uid 직접 조회 시도
    const byUid = await getDoc(doc(db, 'users', keyword));
    if (byUid.exists()) {
      const fakeSnap = { empty: false, docs: [byUid] };
      await renderMembersTable(fakeSnap, wrap);
      return;
    }
    // 이메일로 검색
    const snap = await getDocs(
      query(collection(db, 'users'), where('email', '==', keyword), limit(20))
    );
    await renderMembersTable(snap, wrap);
  } catch (err) {
    wrap.innerHTML = `<div class="buggy-empty">오류: ${escHtml(err.message)}</div>`;
  }
}

document.getElementById('btnLoadMembers').addEventListener('click', loadMembers);
document.getElementById('btnSearchMember').addEventListener('click', searchMember);
document.getElementById('memberSearchEmail').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchMember();
});

// ── 설정 ─────────────────────────────────────────────────────────────────
async function loadConfig() {
  try {
    const res = await fnGetConfig({});
    const cfg = res.data;
    document.getElementById('cfgBaseFare').value     = cfg.baseFare      ?? 50000;
    document.getElementById('cfgInterval').value     = cfg.intervalMinutes ?? 10;
    document.getElementById('cfgIntervalFare').value = cfg.intervalFare  ?? 50000;
    document.getElementById('cfgMinBalance').value   = cfg.minBalance    ?? 50000;
    document.getElementById('cfgTimeout').value      = cfg.driverTimeoutSeconds ?? 120;
    document.getElementById('cfgDriverShare').value  = cfg.driverSharePct ?? 80;
  } catch (_) {}
}

document.getElementById('btnSaveConfig').addEventListener('click', async () => {
  const cfg = {
    baseFare:             parseInt(document.getElementById('cfgBaseFare').value)     || 50000,
    intervalMinutes:      parseInt(document.getElementById('cfgInterval').value)     || 10,
    intervalFare:         parseInt(document.getElementById('cfgIntervalFare').value) || 50000,
    minBalance:           parseInt(document.getElementById('cfgMinBalance').value)   || 50000,
    driverTimeoutSeconds: parseInt(document.getElementById('cfgTimeout').value)      || 120,
    driverSharePct:       parseInt(document.getElementById('cfgDriverShare').value)  || 80,
  };
  document.getElementById('btnSaveConfig').disabled = true;
  const resultEl = document.getElementById('configResult');
  try {
    await fnSaveConfig(cfg);
    resultEl.textContent = '✅ 설정 저장 완료';
    resultEl.style.color = '#16a34a';
  } catch (err) {
    resultEl.textContent = '❌ ' + (err.message || err);
    resultEl.style.color = '#dc2626';
  } finally {
    document.getElementById('btnSaveConfig').disabled = false;
  }
});

// ── 인증 감시 ────────────────────────────────────────────────────────────
watchAuth(({ loggedIn, role }) => {
  if (!loggedIn || role !== 'admin') {
    document.querySelector('main').innerHTML =
      '<div class="buggy-empty"><div class="buggy-empty-icon">🔒</div><div>관리자만 접근 가능합니다.</div></div>';
    return;
  }
  subscribeStats();
  loadRides();
});
