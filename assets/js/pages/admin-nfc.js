// /assets/js/pages/admin-nfc.js
// NFC 보물 태그 관리자 페이지

import { auth, db, functions } from '../firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

// ── Cloud Function 래퍼 ───────────────────────────────────────────────────────
const fnSaveTag       = httpsCallable(functions, 'adminSaveNfcTag');
const fnDeleteTag     = httpsCallable(functions, 'adminDeleteNfcTag');
const fnRegisterDev   = httpsCallable(functions, 'adminRegisterDevice');
const fnRemoveDev     = httpsCallable(functions, 'adminRemoveDevice');
const fnListTags      = httpsCallable(functions, 'adminListNfcTags');
const fnListClaims    = httpsCallable(functions, 'adminListNfcClaims');

// ── DOM 캐싱 ──────────────────────────────────────────────────────────────────
const newTagBtn        = document.getElementById('newTagBtn');
const loadingRow       = document.getElementById('loadingRow');
const tableWrap        = document.getElementById('tableWrap');
const emptyRow         = document.getElementById('emptyRow');
const tagTableBody     = document.getElementById('tagTableBody');
const myFingerprint    = document.getElementById('myFingerprint');
const copyFpBtn        = document.getElementById('copyFpBtn');

// 태그 모달
const tagModal         = document.getElementById('tagModal');
const modalTitle       = document.getElementById('modalTitle');
const fTagId           = document.getElementById('fTagId');
const fLabel           = document.getElementById('fLabel');
const fMessage         = document.getElementById('fMessage');
const fRewardType      = document.getElementById('fRewardType');
const fRewardItemId    = document.getElementById('fRewardItemId');
const fRewardItemCount = document.getElementById('fRewardItemCount');
const fRewardPoints    = document.getElementById('fRewardPoints');
const fCooldown        = document.getElementById('fCooldown');
const fMaxClaims       = document.getElementById('fMaxClaims');
const fStartHour       = document.getElementById('fStartHour');
const fEndHour         = document.getElementById('fEndHour');
const fActive          = document.getElementById('fActive');
const fMemberOnly      = document.getElementById('fMemberOnly');
const fDeviceRestricted = document.getElementById('fDeviceRestricted');
const rewardItemRow    = document.getElementById('rewardItemRow');
const rewardCountRow   = document.getElementById('rewardCountRow');
const rewardPointsRow  = document.getElementById('rewardPointsRow');
const modalCancelBtn   = document.getElementById('modalCancelBtn');
const modalSaveBtn     = document.getElementById('modalSaveBtn');

// 기기 모달
const deviceModal       = document.getElementById('deviceModal');
const deviceModalTagId  = document.getElementById('deviceModalTagId');
const fDeviceFp         = document.getElementById('fDeviceFp');
const fDeviceLabel      = document.getElementById('fDeviceLabel');
const addDeviceBtn      = document.getElementById('addDeviceBtn');
const deviceList        = document.getElementById('deviceList');
const deviceModalClose  = document.getElementById('deviceModalClose');

// 수령 모달
const claimsModal      = document.getElementById('claimsModal');
const claimsModalTagId = document.getElementById('claimsModalTagId');
const claimsList       = document.getElementById('claimsList');
const claimsModalClose = document.getElementById('claimsModalClose');

// QR 모달
const qrModal        = document.getElementById('qrModal');
const qrModalTagId   = document.getElementById('qrModalTagId');
const qrCanvas       = document.getElementById('qrCanvas');
const qrUrl          = document.getElementById('qrUrl');
const qrDownloadBtn  = document.getElementById('qrDownloadBtn');
const qrModalClose   = document.getElementById('qrModalClose');

// ── 상태 ──────────────────────────────────────────────────────────────────────
let tags = [];
let editingTagId = null;
let deviceModalCurrentTag = null;
let myFp = '';

// ── 보물 아이템 로드 (treasure_items → 드롭다운) ────────────────────────────────
async function loadItemOptions() {
  const sel = document.getElementById('fRewardItemId');
  if (!sel) return;
  try {
    const snap = await getDocs(collection(db, 'treasure_items'));
    const opts = snap.docs.map(d => {
      const r = d.data();
      return `<option value="${d.id}">#${d.id} ${r.name || ''}</option>`;
    }).join('');
    sel.innerHTML = '<option value="">아이템 선택...</option>' + opts;
  } catch (_) {}
}

// ── 기기 지문 계산 ────────────────────────────────────────────────────────────
async function computeFingerprint() {
  const raw = [
    navigator.userAgent,
    navigator.language,
    `${screen.width}x${screen.height}`,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 0,
    navigator.platform || '',
    navigator.maxTouchPoints || 0,
  ].join('|');
  const buf = new TextEncoder().encode(raw);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── 태그 URL 생성 ─────────────────────────────────────────────────────────────
function getTagUrl(tagId) {
  return `https://jump22.netlify.app/nfc-treasure.html?tag=${encodeURIComponent(tagId)}`;
}

// ── 보상 텍스트 ───────────────────────────────────────────────────────────────
function rewardLabel(tag) {
  if (tag.rewardType === 'item')   return `아이템: ${tag.rewardItemId} ×${tag.rewardItemCount}`;
  if (tag.rewardType === 'points') return `포인트 +${tag.rewardPoints}`;
  return '없음';
}

// ── 날짜 포맷 ─────────────────────────────────────────────────────────────────
function fmtDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts._seconds * 1000);
  return d.toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}

// ── 태그 목록 렌더링 ──────────────────────────────────────────────────────────
function renderTags() {
  if (!tags.length) {
    tableWrap.classList.add('hidden');
    emptyRow.classList.remove('hidden');
    return;
  }
  tableWrap.classList.remove('hidden');
  emptyRow.classList.add('hidden');

  const rows = tags.map(tag => {
    const url = getTagUrl(tag.tagId);
    return `<tr data-id="${tag.tagId}">
      <td class="mono" style="font-size:11px;">${tag.tagId}</td>
      <td><strong>${tag.label}</strong>${tag.message ? `<br><span style="font-size:11px;color:#94a3b8;">${tag.message.slice(0,30)}…</span>` : ''}</td>
      <td style="font-size:12px;">${rewardLabel(tag)}</td>
      <td>
        <span class="badge ${tag.active ? 'badge-on' : 'badge-off'}">${tag.active ? '활성' : '비활성'}</span>
        ${tag.memberOnly ? '<span class="badge badge-member" style="margin-left:4px;">정회원</span>' : ''}
        ${tag.deviceRestricted ? '<span class="badge" style="margin-left:4px;background:#f3e8ff;color:#7c3aed;">기기제한</span>' : ''}
      </td>
      <td style="font-weight:700;">${tag.totalClaims ?? 0}${tag.maxClaims >= 0 ? ` / ${tag.maxClaims}` : ''}</td>
      <td>
        <div class="copy-row">
          <input class="copy-input" value="${url}" readonly />
          <button class="btn-copy js-copy-url" data-url="${url}">복사</button>
        </div>
      </td>
      <td>
        <div class="act-btns">
          <button class="btn-sm btn-edit js-edit">수정</button>
          <button class="btn-sm btn-qr js-qr">QR</button>
          <button class="btn-sm btn-device js-device">기기</button>
          <button class="btn-sm btn-claim js-claims">수령기록</button>
          <button class="btn-sm btn-del js-del">삭제</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  tagTableBody.innerHTML = rows;

  // 이벤트 위임
  tagTableBody.querySelectorAll('.js-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      openEditModal(tags.find(t => t.tagId === id));
    });
  });
  tagTableBody.querySelectorAll('.js-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      deleteTag(id);
    });
  });
  tagTableBody.querySelectorAll('.js-device').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      openDeviceModal(tags.find(t => t.tagId === id));
    });
  });
  tagTableBody.querySelectorAll('.js-claims').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      openClaimsModal(id);
    });
  });
  tagTableBody.querySelectorAll('.js-copy-url').forEach(btn => {
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.url).then(() => {
        btn.textContent = '복사됨!';
        setTimeout(() => { btn.textContent = '복사'; }, 1500);
      });
    });
  });
  tagTableBody.querySelectorAll('.js-qr').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('tr').dataset.id;
      openQrModal(id);
    });
  });
}

// ── 태그 목록 로드 ────────────────────────────────────────────────────────────
async function loadTags() {
  loadingRow.classList.remove('hidden');
  tableWrap.classList.add('hidden');
  emptyRow.classList.add('hidden');
  try {
    const res = await fnListTags();
    tags = res.data || [];
    renderTags();
  } catch (err) {
    alert('태그 목록 로드 실패: ' + err.message);
  } finally {
    loadingRow.classList.add('hidden');
  }
}

// ── 보상 필드 토글 ────────────────────────────────────────────────────────────
function updateRewardFields() {
  const type = fRewardType.value;
  rewardItemRow.style.display  = type === 'item'   ? '' : 'none';
  rewardCountRow.style.display = type === 'item'   ? '' : 'none';
  rewardPointsRow.style.display = type === 'points' ? '' : 'none';
}

// ── 태그 모달 열기 ────────────────────────────────────────────────────────────
function openNewModal() {
  editingTagId = null;
  modalTitle.textContent = 'NFC 태그 생성';
  fTagId.value = ''; fTagId.disabled = false;
  fLabel.value = ''; fMessage.value = '';
  fRewardType.value = 'none';
  fRewardItemId.value = ''; fRewardItemCount.value = 1; fRewardPoints.value = 10;
  fCooldown.value = 24; fMaxClaims.value = -1;
  fStartHour.value = ''; fEndHour.value = '';
  fActive.checked = true; fMemberOnly.checked = false; fDeviceRestricted.checked = false;
  updateRewardFields();
  tagModal.classList.remove('hidden');
}

function openEditModal(tag) {
  if (!tag) return;
  editingTagId = tag.tagId;
  modalTitle.textContent = 'NFC 태그 수정';
  fTagId.value = tag.tagId; fTagId.disabled = true;
  fLabel.value = tag.label || '';
  fMessage.value = tag.message || '';
  fRewardType.value = tag.rewardType || 'none';
  fRewardItemId.value = tag.rewardItemId || '';
  fRewardItemCount.value = tag.rewardItemCount ?? 1;
  fRewardPoints.value = tag.rewardPoints ?? 0;
  fCooldown.value = Math.round((tag.cooldownMs ?? 86400000) / 3600000);
  fMaxClaims.value = tag.maxClaims ?? -1;
  fStartHour.value = tag.startHour ?? '';
  fEndHour.value = tag.endHour ?? '';
  fActive.checked = !!tag.active;
  fMemberOnly.checked = !!tag.memberOnly;
  fDeviceRestricted.checked = !!tag.deviceRestricted;
  updateRewardFields();
  tagModal.classList.remove('hidden');
}

function closeTagModal() {
  tagModal.classList.add('hidden');
}

// ── 태그 저장 ─────────────────────────────────────────────────────────────────
async function saveTag() {
  const tagId = fTagId.value.trim();
  const label = fLabel.value.trim();
  if (!tagId || !label) { alert('태그 ID와 이름을 입력하세요'); return; }

  modalSaveBtn.disabled = true;
  modalSaveBtn.textContent = '저장 중...';
  try {
    await fnSaveTag({
      tagId,
      label,
      message:        fMessage.value.trim(),
      rewardType:     fRewardType.value,
      rewardItemId:   fRewardItemId.value.trim() || null,
      rewardItemCount: Number(fRewardItemCount.value) || 1,
      rewardPoints:   Number(fRewardPoints.value) || 0,
      cooldownMs:     (Number(fCooldown.value) || 24) * 3600000,
      maxClaims:      Number(fMaxClaims.value) ?? -1,
      startHour:      fStartHour.value !== '' ? Number(fStartHour.value) : null,
      endHour:        fEndHour.value   !== '' ? Number(fEndHour.value)   : null,
      active:         fActive.checked,
      memberOnly:     fMemberOnly.checked,
      deviceRestricted: fDeviceRestricted.checked,
    });
    closeTagModal();
    await loadTags();
  } catch (err) {
    alert('저장 실패: ' + err.message);
  } finally {
    modalSaveBtn.disabled = false;
    modalSaveBtn.textContent = '저장';
  }
}

// ── 태그 삭제 ─────────────────────────────────────────────────────────────────
async function deleteTag(tagId) {
  if (!confirm(`태그 "${tagId}"를 삭제하시겠습니까? 수령 기록은 유지됩니다.`)) return;
  try {
    await fnDeleteTag({ tagId });
    await loadTags();
  } catch (err) {
    alert('삭제 실패: ' + err.message);
  }
}

// ── 기기 모달 ─────────────────────────────────────────────────────────────────
function renderDeviceList(tag) {
  const devices = tag.registeredDevices || [];
  const meta    = tag.registeredDeviceMeta || {};

  if (!devices.length) {
    deviceList.innerHTML = '<p style="font-size:12px;color:#94a3b8;">등록된 기기가 없습니다</p>';
    return;
  }

  const html = devices.map(fp => {
    const info = meta[fp] || {};
    return `<div class="device-item">
      <div>
        <div style="font-weight:700;font-size:12px;">${info.label || '이름 없음'}</div>
        <div class="device-fp">${fp}</div>
        <div style="font-size:10px;color:#94a3b8;">${info.registeredAt || ''}</div>
      </div>
      <button class="btn-remove-dev" data-fp="${fp}">제거</button>
    </div>`;
  }).join('');

  deviceList.innerHTML = html;

  deviceList.querySelectorAll('.btn-remove-dev').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('이 기기를 제거하시겠습니까?')) return;
      btn.disabled = true;
      try {
        await fnRemoveDev({ tagId: deviceModalCurrentTag.tagId, deviceFingerprint: btn.dataset.fp });
        const updated = tags.find(t => t.tagId === deviceModalCurrentTag.tagId);
        if (updated) {
          updated.registeredDevices = (updated.registeredDevices || []).filter(d => d !== btn.dataset.fp);
          const m = updated.registeredDeviceMeta || {};
          delete m[btn.dataset.fp];
          updated.registeredDeviceMeta = m;
        }
        deviceModalCurrentTag.registeredDevices = (deviceModalCurrentTag.registeredDevices || []).filter(d => d !== btn.dataset.fp);
        renderDeviceList(deviceModalCurrentTag);
      } catch (err) {
        alert('제거 실패: ' + err.message);
        btn.disabled = false;
      }
    });
  });
}

function openDeviceModal(tag) {
  if (!tag) return;
  deviceModalCurrentTag = tag;
  deviceModalTagId.textContent = tag.tagId;
  fDeviceFp.value = '';
  fDeviceLabel.value = '';
  renderDeviceList(tag);
  deviceModal.classList.remove('hidden');
}

function closeDeviceModal() {
  deviceModal.classList.add('hidden');
  deviceModalCurrentTag = null;
}

// ── 기기 등록 처리 ────────────────────────────────────────────────────────────
async function addDevice() {
  const fp    = fDeviceFp.value.trim();
  const label = fDeviceLabel.value.trim();
  if (!fp) { alert('기기 지문을 입력하세요'); return; }

  addDeviceBtn.disabled = true;
  addDeviceBtn.textContent = '등록 중...';
  try {
    await fnRegisterDev({
      tagId: deviceModalCurrentTag.tagId,
      deviceFingerprint: fp,
      deviceLabel: label,
    });
    // 로컬 업데이트
    deviceModalCurrentTag.registeredDevices = deviceModalCurrentTag.registeredDevices || [];
    if (!deviceModalCurrentTag.registeredDevices.includes(fp)) {
      deviceModalCurrentTag.registeredDevices.push(fp);
    }
    deviceModalCurrentTag.registeredDeviceMeta = deviceModalCurrentTag.registeredDeviceMeta || {};
    deviceModalCurrentTag.registeredDeviceMeta[fp] = { label, registeredAt: new Date().toISOString() };

    fDeviceFp.value = '';
    fDeviceLabel.value = '';
    renderDeviceList(deviceModalCurrentTag);

    const inList = tags.find(t => t.tagId === deviceModalCurrentTag.tagId);
    if (inList) {
      inList.registeredDevices = deviceModalCurrentTag.registeredDevices;
      inList.registeredDeviceMeta = deviceModalCurrentTag.registeredDeviceMeta;
    }
  } catch (err) {
    alert('등록 실패: ' + err.message);
  } finally {
    addDeviceBtn.disabled = false;
    addDeviceBtn.textContent = '기기 등록';
  }
}

// ── 수령 기록 모달 ────────────────────────────────────────────────────────────
async function openClaimsModal(tagId) {
  claimsModalTagId.textContent = tagId;
  claimsList.innerHTML = '<p style="padding:16px;text-align:center;color:#94a3b8;">로딩 중...</p>';
  claimsModal.classList.remove('hidden');

  try {
    const res = await fnListClaims({ tagId });
    const claims = res.data || [];
    if (!claims.length) {
      claimsList.innerHTML = '<p style="padding:16px;text-align:center;color:#94a3b8;">수령 기록이 없습니다</p>';
      return;
    }
    const html = claims.map(c => {
      const reward = c.reward || {};
      let rewardStr = '없음';
      if (reward.type === 'item')   rewardStr = `아이템 ${reward.itemId} ×${reward.count}`;
      if (reward.type === 'points') rewardStr = `포인트 +${reward.points}`;
      return `<div class="claim-item">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="mono" style="font-size:11px;">${c.uid}</span>
          <span style="font-size:11px;color:#94a3b8;">${fmtDate(c.claimedAt)}</span>
        </div>
        <div style="font-size:11px;color:#6366f1;margin-top:2px;">${rewardStr}</div>
        <div style="font-size:10px;color:#cbd5e1;margin-top:1px;">기기: ${(c.deviceFingerprint||'').slice(0,16)}…</div>
      </div>`;
    }).join('');
    claimsList.innerHTML = html;
  } catch (err) {
    claimsList.innerHTML = `<p style="color:#ef4444;padding:16px;">${err.message}</p>`;
  }
}

function closeClaimsModal() {
  claimsModal.classList.add('hidden');
}

// ── QR 코드 모달 ──────────────────────────────────────────────────────────────
function openQrModal(tagId) {
  const url = getTagUrl(tagId);
  qrModalTagId.textContent = tagId;
  qrUrl.textContent = url;
  qrModal.classList.remove('hidden');

  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(url);
    qr.make();

    const modules = qr.getModuleCount();
    const cell = Math.floor(280 / modules);
    const size = cell * modules;

    qrCanvas.width  = size;
    qrCanvas.height = size;

    const ctx = qrCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#1e1b4b';

    for (let r = 0; r < modules; r++) {
      for (let c = 0; c < modules; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(c * cell, r * cell, cell, cell);
      }
    }
  } catch (err) {
    const ctx = qrCanvas.getContext('2d');
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#ef4444';
    ctx.fillText('QR 생성 실패: ' + err.message, 8, 24);
  }
}

function closeQrModal() {
  qrModal.classList.add('hidden');
}

// ── 이벤트 바인딩 ────────────────────────────────────────────────────────────
newTagBtn.addEventListener('click', openNewModal);
modalCancelBtn.addEventListener('click', closeTagModal);
modalSaveBtn.addEventListener('click', saveTag);
fRewardType.addEventListener('change', updateRewardFields);
addDeviceBtn.addEventListener('click', addDevice);
deviceModalClose.addEventListener('click', closeDeviceModal);
claimsModalClose.addEventListener('click', closeClaimsModal);
qrModalClose.addEventListener('click', closeQrModal);
qrDownloadBtn.addEventListener('click', () => {
  const a = document.createElement('a');
  a.download = `nfc-qr-${qrModalTagId.textContent}.png`;
  a.href = qrCanvas.toDataURL('image/png');
  a.click();
});

// 기기 지문 복사
copyFpBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(myFp).then(() => {
    copyFpBtn.textContent = '복사됨!';
    setTimeout(() => { copyFpBtn.textContent = '복사'; }, 1500);
  });
});

// ── 초기화 ────────────────────────────────────────────────────────────────────
async function init() {
  // 기기 지문 표시
  myFp = await computeFingerprint();
  myFingerprint.textContent = myFp;

  // 보물 아이템 드롭다운 채우기
  loadItemOptions();

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      alert('관리자 로그인이 필요합니다');
      location.href = '/index.html';
      return;
    }
    await loadTags();
  });
}

init();
