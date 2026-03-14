// /assets/js/pages/merchants.js
// 가맹점 지도 + 보물찾기 시스템

import { initializeApp }  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, collection, getDocs, doc, getDoc, query, where, orderBy, limit }
                          from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth, onAuthStateChanged }
                          from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFunctions, httpsCallable }
                          from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import { firebaseConfig } from '/assets/js/firebase-config.js';

const app       = initializeApp(firebaseConfig);
const db        = getFirestore(app);
const auth      = getAuth(app);
const functions = getFunctions(app, 'us-central1');

const $ = id => document.getElementById(id);

// ── 상태 ────────────────────────────────────────────────────────────────────
let allMerchants    = [];
let allPlaces       = [];     // places 컬렉션
let map             = null;
let infoWindow      = null;
let markers         = [];
let placeMarkers    = [];
let treasureBoxes   = [];     // [{id, lat, lng, startHour, endHour, itemPool, active, name}]
let boxMarkers      = [];
let myLocationMarker    = null;
let myLocationAccCircle = null;
let _uid            = null;   // 로그인 유저 UID
let _isAdmin        = false;  // 관리자 여부
let _inventory      = {};     // {itemId: count}
let _boxInventory   = [];     // [{boxId, boxName, collectedAt}]  미개봉 박스
let _items          = {};     // {itemId: {name, image, description}}
let _vouchers       = [];
let _collectedBoxes = new Set(); // 이 세션에서 이미 수집한 box ID

// ── 유틸 ────────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function parseLatLng(gmapUrl) {
  if (!gmapUrl) return null;
  try {
    const m1 = gmapUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m1) return { lat: parseFloat(m1[1]), lng: parseFloat(m1[2]) };
    const url = new URL(gmapUrl);
    const q   = url.searchParams.get('q');
    if (q) {
      const m2 = q.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
      if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]) };
    }
  } catch { /* ignore */ }
  return null;
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function nowVietnamHour() {
  return (new Date().getUTCHours() + 7) % 24;
}

function isBoxActive(box) {
  if (!box.active) return false;
  const h = nowVietnamHour();
  const s = box.startHour ?? 0, e = box.endHour ?? 24;
  return s <= e ? (h >= s && h < e) : (h >= s || h < e);
}

// ── Google Maps 로드 ─────────────────────────────────────────────────────────
function loadMapsScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) return resolve();
    window.__merchantMapCb = resolve;
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${window.__mapsKey || ''}&callback=__merchantMapCb&language=ko&region=KR`;
    s.async = true;
    s.onerror = () => reject(new Error('Google Maps 로드 실패'));
    document.head.appendChild(s);
  });
}

// ── 지도 초기화 ──────────────────────────────────────────────────────────────
function initMap() {
  map = new google.maps.Map($('merchantMap'), {
    center: { lat: 20.9947, lng: 105.9487 },
    zoom: 13,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    styles: [
      { featureType: 'poi',   elementType: 'all', stylers: [{ visibility: 'off' }] },
      { featureType: 'transit', elementType: 'all', stylers: [{ visibility: 'off' }] },
    ],
  });
  infoWindow = new google.maps.InfoWindow();
}

// ── 공유 bounds (가맹점 + 보물박스 합산) ─────────────────────────────────────
let _sharedBounds = null;

function fitMapToAllMarkers() {
  if (!map || !_sharedBounds || _sharedBounds.isEmpty()) return;
  const count = markers.length + boxMarkers.length;
  if (count === 1) {
    const pt = _sharedBounds.getCenter();
    map.setCenter(pt); map.setZoom(16);
  } else {
    map.fitBounds(_sharedBounds);
  }
}

// ── 장소 마커 색상 (index.html 동기화) ───────────────────────────────────────
const PLACE_TYPE_COLOR = {
  hospital: '#ef4444', school: '#16a34a', park: '#22c55e',
  shopping: '#ec4899', restaurant: '#f97316', cafe: '#a16207',
};
function placeColor(type) {
  return PLACE_TYPE_COLOR[String(type).toLowerCase()] || '#6b7280';
}

// ── 장소 마커 렌더링 ──────────────────────────────────────────────────────────
function renderPlaceMarkers() {
  placeMarkers.forEach(m => m.setMap(null));
  placeMarkers = [];
  if (!map) return;
  if (!_sharedBounds) _sharedBounds = new google.maps.LatLngBounds();

  allPlaces.forEach(p => {
    let latLng = null;
    if (typeof p.lat === 'number' && typeof p.lng === 'number') latLng = { lat: p.lat, lng: p.lng };
    else latLng = parseLatLng(p.gmap);
    if (!latLng) return;

    const marker = new google.maps.Marker({
      position: latLng, map,
      title: p.name || '',
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: placeColor(p.type),
        fillOpacity: 1,
        strokeColor: '#fff',
        strokeWeight: 2,
        scale: 9,
      },
      zIndex: 1,
    });

    marker.addListener('click', () => {
      infoWindow.setContent(`
        <div style="max-width:240px;font-size:13px;line-height:1.5;">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${escHtml(p.name||'')}</div>
          ${p.type    ? `<div style="color:#7c3aed;margin-bottom:2px;">${escHtml(p.type)}</div>` : ''}
          ${p.area    ? `<div style="color:#6b7280;">구역: ${escHtml(p.area)}</div>` : ''}
          ${p.address ? `<div style="color:#374151;">${escHtml(p.address)}</div>` : ''}
          ${p.phone   ? `<div style="color:#374151;">📞 ${escHtml(p.phone)}</div>` : ''}
          ${p.note    ? `<div style="color:#6b7280;margin-top:4px;">${escHtml(p.note)}</div>` : ''}
          ${p.gmap    ? `<a href="${escHtml(p.gmap)}" target="_blank" rel="noopener"
             style="display:inline-block;margin-top:6px;color:#2563eb;font-size:12px;">구글 지도에서 보기 →</a>` : ''}
        </div>`);
      infoWindow.open(map, marker);
    });

    placeMarkers.push(marker);
    _sharedBounds.extend(latLng);
  });
}

// ── 가맹점 마커 렌더링 ───────────────────────────────────────────────────────
function renderMarkers(list) {
  markers.forEach(m => m.setMap(null));
  markers = [];
  if (!map) return;
  if (!_sharedBounds) _sharedBounds = new google.maps.LatLngBounds();

  list.forEach(m => {
    if (!m._latLng) return;
    const marker = new google.maps.Marker({
      position: m._latLng, map,
      title: m.name || '',
      icon: { url: '/assets/images/jump/favicon.png',
        scaledSize: new google.maps.Size(18, 18), anchor: new google.maps.Point(9, 9) },
      zIndex: 10,
    });
    marker.addListener('click', () => {
      infoWindow.setContent(`
        <div style="max-width:240px;font-size:13px;line-height:1.6;">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">🏪 ${escHtml(m.name)}</div>
          ${m.career ? `<div style="color:#f59e0b;font-size:12px;">${escHtml(m.career)}</div>` : ''}
          ${m.region ? `<div style="color:#6b7280;">📍 ${escHtml(m.region)}</div>` : ''}
          ${m.phone  ? `<div style="color:#374151;">📞 ${escHtml(m.phone)}</div>` : ''}
          ${m.description ? `<div style="color:#6b7280;margin-top:4px;">${escHtml(m.description)}</div>` : ''}
          ${m.gmap ? `<a href="${escHtml(m.gmap)}" target="_blank" rel="noopener"
             style="display:inline-block;margin-top:6px;color:#2563eb;font-size:12px;">구글 지도에서 보기 →</a>` : ''}
        </div>`);
      infoWindow.open(map, marker);
      document.querySelectorAll('.mc-card').forEach(el => el.style.borderColor = '');
      const card = document.querySelector(`.mc-card[data-id="${m.id}"]`);
      if (card) { card.style.borderColor = '#f59e0b'; card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    });
    markers.push(marker);
    _sharedBounds.extend(m._latLng);
    m._marker = marker;
  });
}

// ── 보물박스 마커 렌더링 ──────────────────────────────────────────────────────
function renderBoxMarkers() {
  boxMarkers.forEach(m => m.setMap(null));
  boxMarkers = [];
  if (!map) return;
  if (!_sharedBounds) _sharedBounds = new google.maps.LatLngBounds();

  treasureBoxes.forEach(box => {
    const lat = Number(box.lat), lng = Number(box.lng);
    if (!lat || !lng) return;
    const active = isBoxActive(box);
    const marker = new google.maps.Marker({
      position: { lat, lng }, map,
      title: box.name || '보물박스',
      icon: {
        url: '/assets/images/item/box.png',
        scaledSize: new google.maps.Size(20, 20),
        anchor: new google.maps.Point(10, 10),
      },
      opacity: active ? 1 : 0.35,
      zIndex: 20,
    });

    const h = `${String(box.startHour ?? 0).padStart(2,'0')}:00~${String(box.endHour ?? 24).padStart(2,'0')}:00`;
    marker.addListener('click', () => {
      const alreadyCollected = _collectedBoxes.has(box.id);
      const adminBtn = _isAdmin && !alreadyCollected
        ? `<button onclick="window.__adminCollect('${box.id}')" style="
            margin-top:8px; background:#5c3a1e; color:#ffd700; border:1px solid #7a5c3a;
            padding:4px 12px; border-radius:6px; font-size:12px; font-weight:700; cursor:pointer;">
            🔑 관리자 수집 (PC)
          </button>`
        : (alreadyCollected ? '<div style="margin-top:6px;font-size:11px;color:#aaa;">✓ 이미 수집됨</div>' : '');
      infoWindow.setContent(`
        <div style="font-size:13px;line-height:1.7;">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">🎁 ${escHtml(box.name||'보물박스')}</div>
          <div style="color:#888;">등장 시간: ${h}</div>
          <div style="color:${active?'#16a34a':'#dc2626'};font-weight:600;">${active?'✅ 지금 열려있음':'⏰ 현재 비활성'}</div>
          ${active && !_isAdmin ? '<div style="margin-top:6px;color:#555;font-size:12px;">30m 이내로 접근하면 자동 수집!</div>' : ''}
          ${adminBtn}
        </div>`);
      infoWindow.open(map, marker);
    });

    boxMarkers.push(marker);
    box._marker = marker;
    _sharedBounds.extend({ lat, lng });
  });
}

// ── 카드 렌더링 ──────────────────────────────────────────────────────────────
function renderCards(list) {
  const grid = $('mcGrid');
  if (!list.length) { grid.innerHTML = '<p class="mc-state">등록된 가맹점이 없습니다.</p>'; $('mcCount').textContent = ''; return; }
  $('mcCount').textContent = `${list.length}개`;
  grid.innerHTML = '';
  list.forEach(m => {
    const el = document.createElement('div');
    el.className = 'mc-card';
    el.dataset.id = m.id;
    el.innerHTML = `
      <div class="mc-card-name">${escHtml(m.name||'(이름없음)')}${m._latLng?'<span class="mc-badge-map">지도</span>':''}</div>
      ${m.career  ? `<div class="mc-card-career">${escHtml(m.career)}</div>` : ''}
      ${m.region  ? `<div class="mc-card-region">📍 ${escHtml(m.region)}</div>` : ''}
      ${m.phone   ? `<div class="mc-card-phone">📞 ${escHtml(m.phone)}</div>` : ''}
      ${m.description ? `<div class="mc-card-desc">${escHtml(m.description)}</div>` : ''}
      ${m._latLng
        ? `<a class="mc-card-gmap" href="${escHtml(m.gmap||'')}" target="_blank" rel="noopener">구글 지도에서 보기 →</a>`
        : '<div class="mc-card-no-map">지도 미등록</div>'}`;
    if (m._latLng) {
      el.addEventListener('click', e => {
        if (e.target.tagName === 'A') return;
        map?.panTo(m._latLng); map?.setZoom(17);
        if (m._marker) google.maps.event.trigger(m._marker, 'click');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
    grid.appendChild(el);
  });
}

// ── 검색 필터 ────────────────────────────────────────────────────────────────
$('mcSearch').addEventListener('input', () => {
  const q = $('mcSearch').value.trim().toLowerCase();
  const filtered = q ? allMerchants.filter(m =>
    [m.name, m.career, m.region, m.description].some(v => (v||'').toLowerCase().includes(q))) : allMerchants;
  renderCards(filtered);
  renderMarkers(filtered);
});

// ── 내 위치 표시 ─────────────────────────────────────────────────────────────
function showMyLocation() {
  const btn = $('btnMyLocation');
  if (!navigator.geolocation) { alert('이 브라우저는 위치 서비스를 지원하지 않습니다.'); return; }
  if (btn) btn.textContent = '⏳';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const latLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (myLocationMarker)    { myLocationMarker.setMap(null);    myLocationMarker = null; }
      if (myLocationAccCircle) { myLocationAccCircle.setMap(null); myLocationAccCircle = null; }

      myLocationMarker = new google.maps.Marker({
        position: latLng, map, title: '내 위치',
        icon: { path: google.maps.SymbolPath.CIRCLE,
          fillColor: '#4285F4', fillOpacity: 1,
          strokeColor: '#fff', strokeWeight: 2, scale: 9 },
        zIndex: 100,
      });
      if (pos.coords.accuracy) {
        myLocationAccCircle = new google.maps.Circle({
          map, center: latLng, radius: pos.coords.accuracy,
          fillColor: '#4285F4', fillOpacity: 0.08,
          strokeColor: '#4285F4', strokeOpacity: 0.3, strokeWeight: 1,
        });
      }
      map.panTo(latLng); map.setZoom(15);
      if (btn) btn.textContent = '📍';
    },
    (err) => {
      if (btn) btn.textContent = '📍';
      alert({ 1:'위치 권한이 거부되었습니다.', 2:'위치를 가져올 수 없습니다.', 3:'위치 요청 시간 초과.' }[err.code] || '위치 오류');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ── 보물박스 근접 감지 + 자동 수집 ──────────────────────────────────────────
async function checkProximity(lat, lng) {
  if (!_uid) return;
  for (const box of treasureBoxes) {
    if (!box.lat || !box.lng) continue;
    if (!isBoxActive(box)) continue;
    if (_collectedBoxes.has(box.id)) continue;
    const dist = haversine(lat, lng, box.lat, box.lng);
    if (dist <= 30) {  // 서버 허용(10m) + GPS 오차 여유
      await tryCollect(box);
    }
  }
}

async function tryCollect(box) {
  if (_collectedBoxes.has(box.id)) return;
  _collectedBoxes.add(box.id); // 동시 중복 호출 방지
  try {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 8000 }));
    const result = await httpsCallable(functions, 'collectTreasureBox')({
      boxId: box.id,
      userLat: pos.coords.latitude,
      userLng: pos.coords.longitude,
    });
    const d = result.data;
    showCollectToast(d.boxName);
    // 미개봉 박스 인벤토리에 추가
    if (!_boxInventory.find(b => b.boxId === box.id)) {
      _boxInventory.push({ boxId: box.id, boxName: d.boxName });
    }
    renderBoxInventory();
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('이미')) {
      // 영구 수집 완료 → 세션 중 재시도 불필요
    } else if (msg.includes('너무 멀리')) {
      _collectedBoxes.delete(box.id);
    } else {
      _collectedBoxes.delete(box.id);
      console.warn('collect:', msg);
    }
  }
}

// ── 수집 사운드 (Web Audio API) ───────────────────────────────────────────────
function playCollectSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.35, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  } catch (_) { /* 사운드 실패는 무시 */ }
}

function showCollectToast(boxName) {
  playCollectSound();
  const el = $('collectToast');
  el.innerHTML = `📦 보물박스 획득!\n<strong>${escHtml(boxName || '보물박스')}</strong>\n인벤토리에서 열어보세요!`;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// ── 박스 오픈 사운드 (Web Audio API) ──────────────────────────────────────────
function playOpenBoxSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // 둔탁한 오픈 효과: 낮은 타격음 + 반짝 상승음
    const hits = [
      { freq: 120, type: 'triangle', t: 0,    dur: 0.18, vol: 0.5 },
      { freq: 200, type: 'sine',     t: 0.05, dur: 0.12, vol: 0.3 },
      { freq: 880, type: 'sine',     t: 0.20, dur: 0.15, vol: 0.3 },
      { freq: 1320,type: 'sine',     t: 0.32, dur: 0.18, vol: 0.25 },
      { freq: 1760,type: 'sine',     t: 0.44, dur: 0.22, vol: 0.2 },
    ];
    hits.forEach(({ freq, type, t, dur, vol }) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = type; osc.frequency.value = freq;
      const st = ctx.currentTime + t;
      gain.gain.setValueAtTime(0, st);
      gain.gain.linearRampToValueAtTime(vol, st + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, st + dur);
      osc.start(st); osc.stop(st + dur);
    });
  } catch (_) { /* 무시 */ }
}

// ── 관리자: PC에서 GPS 없이 박스 수집 ────────────────────────────────────────
async function adminCollectBox(boxId) {
  if (_collectedBoxes.has(boxId)) { alert('이미 수집한 보물박스입니다.'); return; }
  _collectedBoxes.add(boxId);
  infoWindow.close();
  try {
    const result = await httpsCallable(functions, 'adminCollectTreasureBox')({ boxId });
    const d = result.data;
    showCollectToast(d.boxName);
    if (!_boxInventory.find(b => b.boxId === boxId)) {
      _boxInventory.push({ boxId, boxName: d.boxName });
    }
    renderBoxInventory();
  } catch (err) {
    _collectedBoxes.delete(boxId);
    alert('수집 실패: ' + (err.message || err));
  }
}

// infoWindow 버튼용 전역 핸들러
window.__adminCollect = (boxId) => adminCollectBox(boxId);

// ── 박스 오픈 (인벤토리 박스 클릭) ────────────────────────────────────────────
async function openBox(boxId, slotEl) {
  if (slotEl) slotEl.classList.add('opening');
  try {
    const result = await httpsCallable(functions, 'openTreasureBox')({ boxId });
    const d = result.data;
    // 미개봉 박스 인벤토리에서 제거
    _boxInventory = _boxInventory.filter(b => b.boxId !== boxId);
    renderBoxInventory();
    // 아이템 인벤토리 업데이트
    const iid = String(d.itemId);
    _inventory[iid] = (_inventory[iid] || 0) + 1;
    renderInventory();
    // 오픈 사운드 + 아이템 획득 오버레이
    playOpenBoxSound();
    showItemReveal(d.itemName, d.itemImage);
  } catch (err) {
    if (slotEl) slotEl.classList.remove('opening');
    alert('박스 오픈 실패: ' + (err.message || err));
  }
}

function showItemReveal(itemName, itemImage) {
  const img = $('itemRevealImg');
  const name = $('itemRevealName');
  if (img)  { img.src = `/assets/images/items/${escHtml(itemImage || '')}`; img.style.display = ''; }
  if (name) name.textContent = itemName || '아이템';
  $('itemReveal')?.classList.add('open');
}

// ── 미개봉 보물박스 렌더링 ────────────────────────────────────────────────────
function renderBoxInventory() {
  const el = $('boxInvList');
  if (!el) return;
  if (!_boxInventory.length) {
    el.innerHTML = '<div class="voucher-empty">미개봉 보물박스가 없습니다.</div>';
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'box-inv-grid';
  _boxInventory.forEach(({ boxId, boxName }) => {
    const slot = document.createElement('div');
    slot.className = 'box-inv-slot';
    slot.title = `${boxName || '보물박스'} — 클릭하여 열기`;
    slot.innerHTML = `
      <img src="/assets/images/item/box.png" alt="box" onerror="this.style.display='none'">
      <span class="box-slot-name">${escHtml(boxName || '보물박스')}</span>`;
    slot.addEventListener('click', () => openBox(boxId, slot));
    grid.appendChild(slot);
  });
  el.innerHTML = '';
  el.appendChild(grid);
}

// ── 위치 추적 시작 ───────────────────────────────────────────────────────────
function startWatchPosition() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(
    pos => checkProximity(pos.coords.latitude, pos.coords.longitude),
    null,
    { enableHighAccuracy: true, maximumAge: 5000 }
  );
}

// ── 인벤토리 렌더링 (4×5 = 20 슬롯) ────────────────────────────────────────
function renderInventory() {
  const grid = $('invGrid');
  if (!grid) return;
  const SLOTS = 20;

  // 아이템 있는 것 먼저 정렬
  const filled = Object.entries(_inventory)
    .filter(([, c]) => c > 0)
    .sort((a, b) => Number(a[0]) - Number(b[0]));

  grid.innerHTML = '';
  for (let i = 0; i < SLOTS; i++) {
    const slot = document.createElement('div');
    slot.className = 'inv-slot';
    if (i < filled.length) {
      const [itemId, count] = filled[i];
      const meta = _items[itemId] || {};
      slot.classList.add('has-item');
      slot.innerHTML = `
        <img src="/assets/images/items/${escHtml(meta.image || itemId + '.png')}"
             onerror="this.src='/assets/images/items/placeholder.png'"
             alt="${escHtml(meta.name || itemId)}" />
        <span class="slot-name">${escHtml(meta.name || '#'+itemId)}</span>
        <span class="slot-count">${count}</span>`;
    } else {
      slot.innerHTML = '<span class="slot-placeholder">□</span>';
    }
    grid.appendChild(slot);
  }
}

// ── 바우처 레시피 렌더링 ─────────────────────────────────────────────────────
function renderVouchers() {
  const el = $('voucherList');
  if (!el) return;
  if (!_vouchers.length) { el.innerHTML = '<div class="voucher-empty">등록된 조합 레시피가 없습니다.</div>'; return; }

  el.innerHTML = _vouchers.map(v => {
    const reqs = (v.requirements || []).map(r => {
      const have = _inventory[String(r.itemId)] || 0;
      const meta = _items[String(r.itemId)] || {};
      const ok = have >= r.count;
      return `<span style="color:${ok?'#86efac':'#fca5a5'}">${escHtml(meta.name||'#'+r.itemId)} ×${r.count} (보유:${have})</span>`;
    }).join(' + ');
    const canCraft = (v.requirements||[]).every(r => (_inventory[String(r.itemId)]||0) >= r.count);
    return `
      <div class="voucher-row">
        <div class="voucher-name">🎟 ${escHtml(v.name)}</div>
        <div class="voucher-reqs">${reqs}</div>
        <div class="voucher-reward">보상: ${escHtml(v.reward||'바우처 지급')}</div>
        <button class="btn-craft" data-voucher="${escHtml(v.id)}" ${canCraft?'':'disabled'}>
          ${canCraft?'조합하기':'재료 부족'}
        </button>
      </div>`;
  }).join('');

  el.querySelectorAll('.btn-craft:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', async () => {
      const vid = btn.dataset.voucher;
      btn.disabled = true; btn.textContent = '처리 중...';
      try {
        const res = await httpsCallable(functions, 'craftVoucher')({ voucherId: vid });
        alert(`✅ 조합 성공!\n${res.data.voucherName}\n보상: ${res.data.reward}`);
        await loadInventory();
      } catch (err) {
        alert('조합 실패: ' + (err.message || err));
        btn.disabled = false; btn.textContent = '조합하기';
      }
    });
  });
}

// ── 데이터 로드 ──────────────────────────────────────────────────────────────
async function loadPlaces() {
  const snap = await getDocs(collection(db, 'places'));
  allPlaces = [];
  snap.forEach(d => { if (d.data().visible !== false) allPlaces.push({ id: d.id, ...d.data() }); });
}

async function loadTreasureBoxes() {
  const snap = await getDocs(collection(db, 'treasure_boxes'));
  treasureBoxes = [];
  snap.forEach(d => { if (d.data().active !== false) treasureBoxes.push({ id: d.id, ...d.data() }); });
}

async function loadItems() {
  const snap = await getDocs(collection(db, 'treasure_items'));
  _items = {};
  snap.forEach(d => { _items[d.id] = d.data(); });
}

async function loadVouchers() {
  const snap = await getDocs(collection(db, 'treasure_vouchers'));
  _vouchers = [];
  snap.forEach(d => { if (d.data().active !== false) _vouchers.push({ id: d.id, ...d.data() }); });
}

async function loadInventory() {
  if (!_uid) {
    _inventory = {}; _boxInventory = [];
    renderBoxInventory(); renderInventory(); renderVouchers(); renderMyVouchers([]);
    return;
  }
  const [invSnap, boxInvSnap, myVSnap] = await Promise.all([
    getDocs(query(collection(db, 'treasure_inventory'), where('uid', '==', _uid))),
    getDocs(query(collection(db, 'treasure_inventory_boxes'), where('uid', '==', _uid))),
    getDocs(query(
      collection(db, 'treasure_voucher_logs'),
      where('uid', '==', _uid),
      orderBy('craftedAt', 'desc'),
      limit(50)
    )),
  ]);
  _inventory = {};
  invSnap.forEach(d => {
    const r = d.data();
    if (r.count > 0) _inventory[r.itemId] = r.count;
  });
  _boxInventory = [];
  boxInvSnap.forEach(d => {
    const r = d.data();
    _boxInventory.push({ boxId: r.boxId, boxName: r.boxName });
    // 이미 서버에 저장된 박스는 재수집 방지 세트에도 추가
    _collectedBoxes.add(r.boxId);
  });
  renderBoxInventory();
  renderInventory();
  renderVouchers();
  renderMyVouchers(myVSnap.docs.map(d => d.data()));
}

function renderMyVouchers(logs) {
  const el = $('myVoucherList');
  if (!el) return;
  if (!logs.length) { el.innerHTML = '<div class="voucher-empty">보유 바우처가 없습니다.</div>'; return; }

  el.innerHTML = logs.map(r => {
    const ts = r.craftedAt?.toDate?.();
    const dateStr = ts ? ts.toLocaleDateString('ko-KR') : '';
    const imgSrc = r.image ? `/assets/images/vouchers/${escHtml(r.image)}` : '';
    return `
      <div class="voucher-row" style="display:flex;gap:10px;align-items:center;">
        ${imgSrc ? `<img src="${imgSrc}" style="width:44px;height:44px;object-fit:contain;border-radius:6px;background:#1a0e06;" onerror="this.style.display='none'">` : '<div style="width:44px;height:44px;background:#1a0e06;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:22px;">🎟</div>'}
        <div style="flex:1;">
          <div class="voucher-name">${escHtml(r.voucherName || '바우처')}</div>
          <div class="voucher-reward">${escHtml(r.reward || '')}</div>
          ${dateStr ? `<div style="font-size:10px;color:#888;">${dateStr}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

// ── 인벤토리 모달 ────────────────────────────────────────────────────────────
function openInventory() {
  $('invModal').classList.add('open');
  loadInventory(); // 최신 데이터로 갱신
}
function closeInventory() { $('invModal').classList.remove('open'); }

// ── 메인 ────────────────────────────────────────────────────────────────────
async function init() {
  // Firebase Auth + 관리자 여부 확인
  onAuthStateChanged(auth, async user => {
    _uid = user?.uid || null;
    if (_uid) {
      const snap = await getDoc(doc(db, 'admins', _uid));
      _isAdmin = snap.exists();
    } else {
      _isAdmin = false;
    }
  });

  // 병렬 데이터 로드
  const [merchantSnap] = await Promise.all([
    getDocs(collection(db, 'merchants')),
    loadPlaces(),
    loadTreasureBoxes(),
    loadItems(),
    loadVouchers(),
  ]);

  // 가맹점 데이터
  allMerchants = [];
  merchantSnap.forEach(d => {
    const m = d.data();
    if (m.active === false) return;
    const latLng = (m.lat && m.lng) ? { lat: m.lat, lng: m.lng } : parseLatLng(m.gmap);
    allMerchants.push({ id: d.id, ...m, _latLng: latLng });
  });
  allMerchants.sort((a, b) => (b._latLng ? 1 : 0) - (a._latLng ? 1 : 0));

  // 지도
  try {
    await loadMapsScript();
    initMap();
    renderPlaceMarkers();
    renderMarkers(allMerchants);
    renderBoxMarkers();
    fitMapToAllMarkers();
  } catch {
    $('merchantMap').innerHTML = '<p style="padding:20px;color:#888;">지도를 불러오지 못했습니다.</p>';
  }

  renderCards(allMerchants);
  renderBoxInventory();
  renderInventory();
  renderVouchers();

  // 버튼 이벤트
  $('btnMyLocation')?.addEventListener('click', showMyLocation);
  $('btnInventory')?.addEventListener('click', openInventory);
  $('btnCloseInv')?.addEventListener('click', closeInventory);
  $('invModal')?.addEventListener('click', e => { if (e.target === $('invModal')) closeInventory(); });
  $('btnRevealClose')?.addEventListener('click', () => $('itemReveal')?.classList.remove('open'));
  $('itemReveal')?.addEventListener('click', e => { if (e.target === $('itemReveal')) $('itemReveal').classList.remove('open'); });

  // 보물 근접 감지 시작
  startWatchPosition();
}

init();
