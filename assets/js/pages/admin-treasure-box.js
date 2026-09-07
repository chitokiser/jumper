// /assets/js/pages/admin-treasure-box.js
// AR 보물상자 GPS 위치 관리자 페이지

import { auth, functions } from '../firebase-init.js';
import { esc } from '../esc.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

// ── Cloud Function 래퍼 ───────────────────────────────────────────────────────
const fnSave   = httpsCallable(functions, 'adminSaveTreasureBox');
const fnDelete = httpsCallable(functions, 'adminDeleteTreasureBox');
const fnList   = httpsCallable(functions, 'adminListTreasureBoxes');

// ── DOM 캐싱 ──────────────────────────────────────────────────────────────────
const formTitle      = document.getElementById('formTitle');
const fBoxId         = document.getElementById('fBoxId');
const fBoxType       = document.getElementById('fBoxType');
const fGpPool        = document.getElementById('fGpPool');
const gpJackpotSection = document.getElementById('gpJackpotSection');
const fName          = document.getElementById('fName');
const fDesc          = document.getElementById('fDesc');
const fCoords        = document.getElementById('fCoords');
const fLat           = document.getElementById('fLat');
const fLng           = document.getElementById('fLng');
const fRadius        = document.getElementById('fRadius');
const fScanRadius    = document.getElementById('fScanRadius');
const fStartHour     = document.getElementById('fStartHour');
const fEndHour       = document.getElementById('fEndHour');
const fHp            = document.getElementById('fHp');
const fRespawn       = document.getElementById('fRespawn');
const fActive        = document.getElementById('fActive');
const fMemberOnly    = document.getElementById('fMemberOnly');
const fHidden        = document.getElementById('fHidden');
const saveBtn        = document.getElementById('saveBtn');
const deleteBtn      = document.getElementById('deleteBtn');
const resetBtn       = document.getElementById('resetBtn');
const formMsg        = document.getElementById('formMsg');
const coordDisplay   = document.getElementById('coordDisplay');
const boxTableBody   = document.getElementById('boxTableBody');

// ── 상태 ──────────────────────────────────────────────────────────────────────
let boxes     = [];
let mapMarkers = {};
let pinMarker  = null;
let map        = null;

// ── Box Type toggle ────────────────────────────────────────────────────────────
function _onBoxTypeChange() {
  const isGp = fBoxType.value === 'gp_jackpot';
  gpJackpotSection.style.display = isGp ? 'block' : 'none';
  if (isGp) {
    fRadius.value   = 5;
    fHidden.checked = true;
    fRadius.disabled  = true;
    fHidden.disabled  = true;
  } else {
    fRadius.disabled  = false;
    fHidden.disabled  = false;
  }
}
fBoxType.addEventListener('change', _onBoxTypeChange);

// ── Leaflet 맵 초기화 ─────────────────────────────────────────────────────────
function initMap() {
  const defaultPos = [21.0285, 105.8542];
  map = L.map('map').setView(defaultPos, 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  pinMarker = L.marker(defaultPos, {
    draggable: true,
    icon: L.divIcon({ html: '🎯', iconSize: [30, 30], className: '' })
  }).addTo(map);

  pinMarker.on('dragend', e => {
    const p = e.target.getLatLng();
    valLat.value = p.lat.toFixed(6);
    valLng.value = p.lng.toFixed(6);
  });

  // 유저 현재 위치 (GPS) 가져와서 지도 중심 맞추기
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((pos) => {
      const userLat = pos.coords.latitude;
      const userLng = pos.coords.longitude;
      const userPos = [userLat, userLng];
      
      map.setView(userPos, 16); // 내 위치로 이동 및 줌인
      pinMarker.setLatLng(userPos); // 과녁(저장포인트)을 내 위치로
      valLat.value = userLat.toFixed(6);
      valLng.value = userLng.toFixed(6);
      
      // 내 위치 파란 마커 추가
      L.marker(userPos, {
        icon: L.divIcon({ html: '🔵', iconSize: [20, 20], className: 'animate-bounce' })
      }).addTo(map).bindPopup("Current GPS").openPopup();
      
    }, (err) => {
      console.warn("GPS failed", err);
    }, { enableHighAccuracy: true });
  }
}

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
    boxTableBody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:#ef4444">${esc(err.message)}</td></tr>`;
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

  fBoxId.value        = b.id;
  fBoxType.value      = b.boxType === 'gp_jackpot' ? 'gp_jackpot' : 'normal';
  fName.value         = b.name || '';
  fDesc.value         = b.description || '';
  fCoords.value       = `${(+b.lat).toFixed(6)}, ${(+b.lng).toFixed(6)}`;
  fLat.value          = b.lat ?? '';
  fLng.value          = b.lng ?? '';
  fRadius.value       = b.radius ?? 30;
  fScanRadius.value   = b.scanRadius ?? 100;
  fStartHour.value    = b.startHour ?? 0;
  fEndHour.value      = b.endHour ?? 24;
  fHp.value           = b.hp ?? 300;
  fRespawn.value      = Math.round((b.respawnIntervalMs || 86400000) / 3600000);
  fActive.checked     = b.active !== false;
  fMemberOnly.checked = b.memberOnly === true;
  fHidden.checked     = b.hiddenBox === true;
  fGpPool.value       = b.gpPool ?? 10000;

  _onBoxTypeChange();

  setLatLng(+b.lat, +b.lng);
  map.setView([+b.lat, +b.lng], 16);

  formTitle.textContent = '✏️ Edit Treasure Box';
  deleteBtn.classList.remove('hidden');
  setMsg('');
  formMsg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function resetForm() {
  fBoxId.value        = '';
  fBoxType.value      = 'normal';
  fGpPool.value       = 10000;
  fName.value         = '';
  fDesc.value         = '';
  fCoords.value       = '';
  fLat.value          = '';
  fLng.value          = '';
  fRadius.value       = 30;
  fScanRadius.value   = 100;
  fStartHour.value    = 0;
  fEndHour.value      = 24;
  fHp.value           = 300;
  fRespawn.value      = 24;
  fActive.checked     = true;
  fMemberOnly.checked = false;
  fHidden.checked     = false;
  fRadius.disabled    = false;
  fHidden.disabled    = false;
  gpJackpotSection.style.display = 'none';
  coordDisplay.textContent = '';
  formTitle.textContent = '➕ New Treasure Box';
  deleteBtn.classList.add('hidden');
  if (pinMarker) { map.removeLayer(pinMarker); pinMarker = null; }
  setMsg('');
}

// ── 저장 ─────────────────────────────────────────────────────────────────────
async function saveBox() {
  const parts = fCoords.value.split(',').map(s => parseFloat(s.trim()));
  const lat = parts[0], lng = parts[1];

  if (!fName.value.trim()) return setMsg('Name is required.', true);
  if (isNaN(lat) || isNaN(lng)) return setMsg('Enter coordinates (e.g. 21.13070, 106.73020) or click the map.', true);

  setMsg('Saving…');
  saveBtn.disabled = true;

  const isGp = fBoxType.value === 'gp_jackpot';

  try {
    const payload = {
      boxId:             fBoxId.value || null,
      name:              fName.value.trim(),
      description:       fDesc.value.trim(),
      lat,
      lng,
      radius:            isGp ? 5 : (Number(fRadius.value) || 30),
      scanRadius:        Number(fScanRadius.value) || 100,
      startHour:         Number(fStartHour.value) || 0,
      endHour:           Number(fEndHour.value) || 24,
      hp:                Number(fHp.value) || 300,
      respawnIntervalMs: (Number(fRespawn.value) || 24) * 3600000,
      active:            fActive.checked,
      memberOnly:        fMemberOnly.checked,
      hiddenBox:         isGp ? true : fHidden.checked,
      boxType:           isGp ? 'gp_jackpot' : 'normal',
    };
    if (isGp) payload.gpPool = Math.max(1, parseInt(fGpPool.value) || 10000);
    await fnSave(payload);
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

fCoords.addEventListener('change', () => {
  const parts = fCoords.value.split(',').map(s => parseFloat(s.trim()));
  const lat = parts[0], lng = parts[1];
  if (!isNaN(lat) && !isNaN(lng)) {
    fLat.value = lat; fLng.value = lng;
    setLatLng(lat, lng);
    map.setView([lat, lng], 16);
  }
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
