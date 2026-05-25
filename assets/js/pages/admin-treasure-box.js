// /assets/js/pages/admin-treasure-box.js
// AR 보물상자 GPS 위치 관리자 페이지

import { auth, functions } from '../firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

// ── Cloud Function 래퍼 ───────────────────────────────────────────────────────
const fnSave   = httpsCallable(functions, 'adminSaveTreasureBox');
const fnDelete = httpsCallable(functions, 'adminDeleteTreasureBox');
const fnList   = httpsCallable(functions, 'adminListTreasureBoxes');

// ── DOM 캐싱 ──────────────────────────────────────────────────────────────────
const formTitle    = document.getElementById('formTitle');
const fBoxId       = document.getElementById('fBoxId');
const fName        = document.getElementById('fName');
const fDesc        = document.getElementById('fDesc');
const fLat         = document.getElementById('fLat');
const fLng         = document.getElementById('fLng');
const fRadius      = document.getElementById('fRadius');
const fScanRadius  = document.getElementById('fScanRadius');
const fStartHour   = document.getElementById('fStartHour');
const fEndHour     = document.getElementById('fEndHour');
const fHp          = document.getElementById('fHp');
const fRespawn     = document.getElementById('fRespawn');
const fActive      = document.getElementById('fActive');
const fMemberOnly  = document.getElementById('fMemberOnly');
const fHidden      = document.getElementById('fHidden');
const saveBtn      = document.getElementById('saveBtn');
const deleteBtn    = document.getElementById('deleteBtn');
const resetBtn     = document.getElementById('resetBtn');
const formMsg      = document.getElementById('formMsg');
const coordDisplay = document.getElementById('coordDisplay');
const boxTableBody = document.getElementById('boxTableBody');

// ── 상태 ──────────────────────────────────────────────────────────────────────
let boxes     = [];
let mapMarkers = {};
let pinMarker  = null;
let map        = null;

// ── Leaflet 맵 초기화 ─────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map').setView([21.0285, 105.8542], 13); // 하노이 기본
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);

  map.on('click', e => {
    const { lat, lng } = e.latlng;
    setLatLng(lat, lng);
  });
}

function setLatLng(lat, lng) {
  fLat.value = lat.toFixed(6);
  fLng.value = lng.toFixed(6);
  coordDisplay.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  if (pinMarker) {
    pinMarker.setLatLng([lat, lng]);
  } else {
    pinMarker = L.marker([lat, lng], {
      draggable: true,
      icon: L.divIcon({ html: '📍', iconSize: [30, 30], iconAnchor: [15, 30], className: '' }),
    }).addTo(map);
    pinMarker.on('dragend', e => {
      const p = e.target.getLatLng();
      setLatLng(p.lat, p.lng);
    });
  }
}

// ── 보물상자 목록 로드 ────────────────────────────────────────────────────────
async function loadBoxes() {
  boxTableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:#94a3b8">Loading...</td></tr>';

  // 기존 맵 마커 정리
  Object.values(mapMarkers).forEach(m => map.removeLayer(m));
  mapMarkers = {};

  try {
    const res = await fnList({});
    boxes = res.data.boxes || [];
    renderTable(boxes);
    renderMapMarkers(boxes);
  } catch (err) {
    boxTableBody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:#ef4444">${err.message}</td></tr>`;
  }
}

function renderTable(list) {
  if (!list.length) {
    boxTableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:#94a3b8">No treasure boxes yet.</td></tr>';
    return;
  }
  const rows = list.map(b => {
    const respawnH = Math.round((b.respawnIntervalMs || 86400000) / 3600000);
    const statusBadge = b.active
      ? '<span class="badge on">Active</span>'
      : '<span class="badge off">Inactive</span>';
    return `<tr data-id="${b.id}">
      <td>${escHtml(b.name || '—')}</td>
      <td style="font-size:.75rem;white-space:nowrap">${(+b.lat).toFixed(5)}, ${(+b.lng).toFixed(5)}</td>
      <td>${b.radius ?? 30}m</td>
      <td>${b.startHour ?? 0}–${b.endHour ?? 24}h</td>
      <td>${b.hp ?? 300}</td>
      <td>${respawnH}h</td>
      <td>${statusBadge}</td>
      <td>
        <button class="act-btn act-edit" data-id="${b.id}">Edit</button>
        <button class="act-btn act-del"  data-id="${b.id}">Del</button>
      </td>
    </tr>`;
  });
  boxTableBody.innerHTML = rows.join('');

  boxTableBody.querySelectorAll('.act-edit').forEach(btn =>
    btn.addEventListener('click', () => editBox(btn.dataset.id)));
  boxTableBody.querySelectorAll('.act-del').forEach(btn =>
    btn.addEventListener('click', () => confirmDelete(btn.dataset.id)));
}

function renderMapMarkers(list) {
  list.forEach(b => {
    if (!b.lat || !b.lng) return;
    const m = L.marker([b.lat, b.lng], {
      icon: L.divIcon({ html: '📦', iconSize: [28, 28], iconAnchor: [14, 14], className: '' }),
    }).addTo(map)
      .bindPopup(`<b>${escHtml(b.name)}</b><br>r=${b.radius ?? 30}m | HP=${b.hp ?? 300}`);
    mapMarkers[b.id] = m;
  });

  if (list.length) {
    const latlngs = list.filter(b => b.lat && b.lng).map(b => [b.lat, b.lng]);
    if (latlngs.length) map.fitBounds(latlngs, { padding: [40, 40], maxZoom: 15 });
  }
}

// ── 편집 ─────────────────────────────────────────────────────────────────────
function editBox(id) {
  const b = boxes.find(x => x.id === id);
  if (!b) return;

  fBoxId.value       = b.id;
  fName.value        = b.name || '';
  fDesc.value        = b.description || '';
  fLat.value         = b.lat ?? '';
  fLng.value         = b.lng ?? '';
  fRadius.value      = b.radius ?? 30;
  fScanRadius.value  = b.scanRadius ?? 100;
  fStartHour.value   = b.startHour ?? 0;
  fEndHour.value     = b.endHour ?? 24;
  fHp.value          = b.hp ?? 300;
  fRespawn.value     = Math.round((b.respawnIntervalMs || 86400000) / 3600000);
  fActive.checked    = b.active !== false;
  fMemberOnly.checked = b.memberOnly === true;
  fHidden.checked    = b.hiddenBox === true;

  coordDisplay.textContent = `${(+b.lat).toFixed(5)}, ${(+b.lng).toFixed(5)}`;

  setLatLng(+b.lat, +b.lng);
  map.setView([+b.lat, +b.lng], 16);

  formTitle.textContent = '✏️ Edit Treasure Box';
  deleteBtn.classList.remove('hidden');
  setMsg('');
  formMsg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function resetForm() {
  fBoxId.value      = '';
  fName.value       = '';
  fDesc.value       = '';
  fLat.value        = '';
  fLng.value        = '';
  fRadius.value     = 30;
  fScanRadius.value = 100;
  fStartHour.value  = 0;
  fEndHour.value    = 24;
  fHp.value         = 300;
  fRespawn.value    = 24;
  fActive.checked   = true;
  fMemberOnly.checked = false;
  fHidden.checked   = false;
  coordDisplay.textContent = '';
  formTitle.textContent = '➕ New Treasure Box';
  deleteBtn.classList.add('hidden');
  if (pinMarker) { map.removeLayer(pinMarker); pinMarker = null; }
  setMsg('');
}

// ── 저장 ─────────────────────────────────────────────────────────────────────
async function saveBox() {
  const lat = parseFloat(fLat.value);
  const lng = parseFloat(fLng.value);

  if (!fName.value.trim()) return setMsg('Name is required.', true);
  if (isNaN(lat) || isNaN(lng)) return setMsg('Click the map to set GPS coordinates.', true);

  setMsg('Saving…');
  saveBtn.disabled = true;

  try {
    await fnSave({
      boxId:             fBoxId.value || null,
      name:              fName.value.trim(),
      description:       fDesc.value.trim(),
      lat,
      lng,
      radius:            Number(fRadius.value) || 30,
      scanRadius:        Number(fScanRadius.value) || 100,
      startHour:         Number(fStartHour.value) || 0,
      endHour:           Number(fEndHour.value) || 24,
      hp:                Number(fHp.value) || 300,
      respawnIntervalMs: (Number(fRespawn.value) || 24) * 3600000,
      active:            fActive.checked,
      memberOnly:        fMemberOnly.checked,
      hiddenBox:         fHidden.checked,
    });
    setMsg('Saved!');
    resetForm();
    await loadBoxes();
  } catch (err) {
    setMsg(err.message, true);
  } finally {
    saveBtn.disabled = false;
  }
}

// ── 삭제 ─────────────────────────────────────────────────────────────────────
async function confirmDelete(id) {
  const b = boxes.find(x => x.id === id) || { name: id };
  if (!confirm(`Delete "${b.name}"?\nThis cannot be undone.`)) return;

  try {
    await fnDelete({ boxId: id });
    resetForm();
    await loadBoxes();
  } catch (err) {
    setMsg(err.message, true);
  }
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────
function setMsg(text, isErr = false) {
  formMsg.textContent = text;
  formMsg.className = isErr ? 'err' : 'ok';
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── 이벤트 ───────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', saveBox);
deleteBtn.addEventListener('click', () => {
  const id = fBoxId.value;
  if (id) confirmDelete(id);
});
resetBtn.addEventListener('click', resetForm);

fLat.addEventListener('change', () => {
  const lat = parseFloat(fLat.value);
  const lng = parseFloat(fLng.value);
  if (!isNaN(lat) && !isNaN(lng)) setLatLng(lat, lng);
});
fLng.addEventListener('change', () => {
  const lat = parseFloat(fLat.value);
  const lng = parseFloat(fLng.value);
  if (!isNaN(lat) && !isNaN(lng)) setLatLng(lat, lng);
});

// ── 인증 ─────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) {
    document.querySelector('.page-wrap').innerHTML =
      '<p style="text-align:center;margin-top:80px;color:#ef4444">⛔ Admin login required.</p>';
    return;
  }

  initMap();
  await loadBoxes();
});
