// /assets/js/pages/merchants.js
// 가맹점 지도 + 보물찾기 시스템

import { auth, db, functions } from '/assets/js/firebase-init.js';
import { collection, getDocs, doc, getDoc, query, where, orderBy, limit }
                          from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { onAuthStateChanged }
                          from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable }
                          from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { initBattle, loadBattleData, loadDecorations, loadPlayerState,
         startBattleLoop, startWatchPosition,
         enterAdminPlaceMode, exitAdminPlaceMode, toggleTowerRanges,
         updateMyLocation, healHp, playSound,
         castLightning, castIceFreeze, castFireStorm,
         useReviveTicket, updateSkillBar, getPlayerGold }
  from './merchants.battle.js';

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
let _uid            = null;   // 로그인 유저 UID
let _userEmail      = null;   // 로그인 유저 이메일
let _isAdmin        = false;  // 관리자 여부
let _inventory      = {};     // {itemId: count}
let _boxInventory   = [];     // [{boxId, boxName, collectedAt}]  미개봉 박스
let _items          = {};     // {itemId: {name, image, description}}
let _vouchers       = [];
let _collectedBoxes = new Set(); // 이 세션에서 이미 수집한 box ID
let _boxHpState     = {};        // {boxId: {current, max}} 클라이언트 HP 추적
let _boxAtkCd       = {};        // {boxId: true} 공격 쿨다운

// ── 공유 컨텍스트 (battle 모듈과 공유) ───────────────────────────────────────
const _ctx = {
  map:                 null,   // initMap() 후 설정
  infoWindow:          null,   // initMap() 후 설정
  db,
  functions,
  uid:                 null,   // auth 후 설정
  isAdmin:             false,
  myLocationMarker:    null,   // battle이 쓰고 core가 읽음
  myLocationAccCircle: null,
  locationWatchId:     null,
  totalDist:           0,
  lastDistPos:         null,
  lastHeading:         null,
  lastSpeedPos:        null,
  lastPos:             null,
};

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

  // ctx에도 반영
  _ctx.map = map;
  _ctx.infoWindow = infoWindow;

  // HUD 버튼을 Google Maps Custom Control로 등록 (전체화면·확대 시에도 유지)
  const existingHud = $('mapHud');
  if (existingHud) map.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(existingHud);

  // 전투 HUD (LEFT_TOP)
  const combatHud = $('combatHud');
  if (combatHud) map.controls[google.maps.ControlPosition.LEFT_TOP].push(combatHud);

  // 스킬바 (BOTTOM_CENTER)
  const skillBar = $('skillBar');
  if (skillBar) map.controls[google.maps.ControlPosition.BOTTOM_CENTER].push(skillBar);

  // 관리자 전투 패널 (LEFT_BOTTOM)
  const adminBattlePanel = $('adminBattlePanel');
  if (adminBattlePanel) map.controls[google.maps.ControlPosition.LEFT_BOTTOM].push(adminBattlePanel);

  // 전체화면 진입/종료 시 position:fixed 모달들을 fullscreen 요소 안으로 이동
  // (HUD·스킬바는 Google Maps Control이므로 자동으로 fullscreen에 포함됨)
  const FS_MODALS = ['invModal', 'itemReveal', 'collectToast', 'criticalToast'];
  document.addEventListener('fullscreenchange', () => {
    const fs = document.fullscreenElement;
    FS_MODALS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (fs) fs.appendChild(el);
      else document.body.appendChild(el);
    });
    // 스킬 애니메이션 오버레이도 이동 (존재할 경우)
    const so = document.getElementById('skillOverlay');
    if (so) {
      if (fs) fs.appendChild(so);
      else document.body.appendChild(so);
    }
  });
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
      icon: { url: m.imageUrl || '/assets/images/jump/favicon.png',
        scaledSize: new google.maps.Size(36, 36), anchor: new google.maps.Point(18, 18) },
      zIndex: 10,
    });
    marker.addListener('click', () => {
      infoWindow.setContent(`
        <div style="max-width:240px;font-size:13px;line-height:1.6;">
          ${m.imageUrl ? `<img src="${escHtml(m.imageUrl)}" alt="" style="width:100%;max-height:120px;object-fit:cover;border-radius:6px;margin-bottom:6px;">` : ''}
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

// ── 보물박스 HP 초기화 ────────────────────────────────────────────────────────
function getBoxHpState(box) {
  if (!_boxHpState[box.id]) {
    const max = Math.max(1, box.hp || 300);
    _boxHpState[box.id] = { current: max, max };
  }
  return _boxHpState[box.id];
}

// ── 보물박스 정보 InfoWindow ──────────────────────────────────────────────────
function showBoxInfo(box, marker, dist) {
  const h = `${String(box.startHour ?? 0).padStart(2,'0')}:00~${String(box.endHour ?? 24).padStart(2,'0')}:00`;
  const active = isBoxActive(box);
  const st = getBoxHpState(box);
  const hpPct = Math.max(0, (st.current / st.max) * 100);
  const hpColor = hpPct > 50 ? '#22c55e' : hpPct > 25 ? '#f59e0b' : '#ef4444';
  const isAdminNow = _isAdmin || (_userEmail === 'daguri75@gmail.com');
  const alreadyCollected = _collectedBoxes.has(box.id);

  const adminBtn = isAdminNow && !alreadyCollected
    ? `<button onclick="window.__adminCollect('${box.id}')" style="
        margin-top:8px;background:#5c3a1e;color:#ffd700;border:1px solid #7a5c3a;
        padding:4px 12px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">
        🔑 관리자 수집
      </button>` : '';

  infoWindow.setContent(`
    <div style="font-size:13px;line-height:1.7;min-width:190px;">
      <div style="font-weight:700;font-size:14px;margin-bottom:4px;">🎁 ${escHtml(box.name||'보물박스')}</div>
      <div style="color:#888;font-size:12px;">등장: ${h}</div>
      <div style="color:${active?'#16a34a':'#dc2626'};font-weight:600;">${active?'✅ 활성':'⏰ 비활성'}</div>
      ${active && !alreadyCollected ? `
        <div style="margin:6px 0 3px;display:flex;align-items:center;gap:6px;">
          <span style="font-size:11px;color:#888;min-width:20px;">HP</span>
          <div style="flex:1;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;">
            <div style="height:100%;width:${hpPct}%;background:${hpColor};border-radius:4px;transition:width .3s;"></div>
          </div>
          <span style="font-size:11px;color:#374151;">${st.current}/${st.max}</span>
        </div>
        <div style="font-size:11px;color:#555;">
          ${dist !== undefined ? `거리 ${Math.round(dist)}m — ` : ''}20m 이내 접근 후 클릭하여 공격!
        </div>` : ''}
      ${alreadyCollected ? '<div style="font-size:11px;color:#aaa;margin-top:4px;">✓ 이미 수집됨</div>' : ''}
      ${adminBtn}
    </div>`);
  infoWindow.open(map, marker);
}

// ── 보물박스 공격 ─────────────────────────────────────────────────────────────
function attackBox(box, marker) {
  if (_boxAtkCd[box.id]) return;
  _boxAtkCd[box.id] = true;
  setTimeout(() => delete _boxAtkCd[box.id], 800);

  const st = getBoxHpState(box);
  if (st.current <= 0) { tryCollect(box); return; }

  const dmg = 30 + Math.floor(Math.random() * 21); // 30-50
  st.current = Math.max(0, st.current - dmg);
  playSound('arrow_shot');

  if (st.current <= 0) {
    // 박스 파괴!
    marker.setIcon({ url:'/assets/images/item/box.png',
      scaledSize: new google.maps.Size(34,34), anchor: new google.maps.Point(17,17) });
    playSound('gold_drop');
    infoWindow.close();
    tryCollect(box);
    return;
  }

  const hpPct = (st.current / st.max) * 100;
  const hpColor = hpPct > 50 ? '#22c55e' : hpPct > 25 ? '#f59e0b' : '#ef4444';
  infoWindow.setContent(`
    <div style="font-size:13px;line-height:1.6;min-width:190px;">
      <div style="font-weight:700;font-size:14px;margin-bottom:6px;">🎁 ${escHtml(box.name||'보물박스')}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <span style="font-size:11px;color:#888;min-width:20px;">HP</span>
        <div style="flex:1;height:10px;background:#e5e7eb;border-radius:5px;overflow:hidden;">
          <div style="height:100%;width:${hpPct}%;background:${hpColor};border-radius:5px;transition:width .3s;"></div>
        </div>
        <span style="font-size:11px;color:#374151;min-width:60px;text-align:right;">${st.current}/${st.max}</span>
      </div>
      <div style="color:#ef4444;font-weight:700;font-size:13px;">💥 -${dmg}</div>
      <div style="font-size:11px;color:#555;margin-top:4px;">계속 클릭하여 공격!</div>
    </div>`);
  infoWindow.open(map, marker);
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
    // HP 상태 미리 초기화
    getBoxHpState(box);

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

    marker.addListener('click', () => {
      if (_collectedBoxes.has(box.id)) {
        infoWindow.setContent('<div style="font-size:13px;color:#888;padding:4px;">✓ 이미 수집한 보물박스입니다.</div>');
        infoWindow.open(map, marker);
        return;
      }
      if (!isBoxActive(box)) { showBoxInfo(box, marker); return; }
      if (!_uid) {
        infoWindow.setContent('<div style="font-size:13px;padding:4px;">로그인이 필요합니다.</div>');
        infoWindow.open(map, marker);
        return;
      }
      const myLat = _ctx.lastPos?.lat;
      const myLng = _ctx.lastPos?.lng;
      if (!myLat || !myLng) { showBoxInfo(box, marker); return; }

      const dist = haversine(myLat, myLng, lat, lng);
      if (dist > 20) { showBoxInfo(box, marker, dist); return; }

      // 20m 이내 → 공격!
      attackBox(box, marker);
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

// ── 이동거리 표시 업데이트 ────────────────────────────────────────────────────
function updateDistDisplay() {
  const panel = $('distPanel');
  const el = $('distValue');
  if (!el) return;
  if (panel && !panel.classList.contains('active')) panel.classList.add('active');
  el.textContent = _ctx.totalDist >= 1000
    ? (_ctx.totalDist / 1000).toFixed(2) + ' km'
    : Math.round(_ctx.totalDist) + ' m';
}

// ── 내 위치 버튼: 지도 이동 (백그라운드 추적은 battle 모듈이 담당) ─────────────
function showMyLocation() {
  const btn = $('btnMyLocation');
  if (!navigator.geolocation) { alert('이 브라우저는 위치 서비스를 지원하지 않습니다.'); return; }
  if (btn) btn.textContent = '⏳';

  // 백그라운드 watch가 이미 실행 중 → 마커 표시 + 현재 위치로 이동
  if (_ctx.locationWatchId != null) {
    if (_ctx.lastPos) {
      updateMyLocation(_ctx.lastPos.lat, _ctx.lastPos.lng, _ctx.lastPos.accuracy, _ctx.lastPos.heading);
      map.panTo({ lat: _ctx.lastPos.lat, lng: _ctx.lastPos.lng });
      map.setZoom(16);
    }
    if (btn) btn.textContent = '📍';
    return;
  }

  let firstFix = true;
  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude: lat, longitude: lng, accuracy, heading } = pos.coords;
      _ctx.lastPos = { lat, lng, accuracy, heading };
      updateMyLocation(lat, lng, accuracy, heading);
      checkProximity(lat, lng);
      if (firstFix) {
        map.panTo({ lat, lng });
        map.setZoom(16);
        firstFix = false;
        if (btn) btn.textContent = '📍';
      }
    },
    (err) => {
      if (btn) btn.textContent = '📍';
      _ctx.locationWatchId = null;
      alert({ 1:'위치 권한이 거부되었습니다.', 2:'위치를 가져올 수 없습니다.', 3:'위치 요청 시간 초과.' }[err.code] || '위치 오류');
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
  );
  _ctx.locationWatchId = watchId;
}

// ── 보물박스 근접 감지 — 범위 내 마커 강조, HP 있으면 공격해야 수집 ──────────
async function checkProximity(lat, lng) {
  if (!_uid) return;
  for (const box of treasureBoxes) {
    if (!box.lat || !box.lng) continue;
    if (!isBoxActive(box)) continue;
    if (_collectedBoxes.has(box.id)) continue;
    const dist = haversine(lat, lng, Number(box.lat), Number(box.lng));
    const maxHp = box.hp || 300;

    if (box._marker) {
      const inRange = dist <= 20;
      // 범위 내: 마커 강조 (크게 + 타이틀 변경)
      box._marker.setIcon({
        url: '/assets/images/item/box.png',
        scaledSize: new google.maps.Size(inRange ? 30 : 20, inRange ? 30 : 20),
        anchor: new google.maps.Point(inRange ? 15 : 10, inRange ? 15 : 10),
      });
      box._marker.setTitle(inRange
        ? `⚔️ ${box.name||'보물박스'} — 클릭하여 공격! (HP ${getBoxHpState(box).current}/${maxHp})`
        : box.name || '보물박스');
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
    const AC = window.AudioContext || /** @type {any} */(window).webkitAudioContext;
    const ctx = new AC();
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
    const AC = window.AudioContext || /** @type {any} */(window).webkitAudioContext;
    const ctx = new AC();
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
    showItemReveal(d.itemName, d.itemImage, d.itemId);
  } catch (err) {
    if (slotEl) slotEl.classList.remove('opening');
    alert('박스 오픈 실패: ' + (err.message || err));
  }
}

function showItemReveal(itemName, itemImage, itemId) {
  const img = $('itemRevealImg');
  const name = $('itemRevealName');
  if (img) {
    const fallback = itemId ? `/assets/images/item/${escHtml(String(itemId))}.png` : '/assets/images/item/0.png';
    const src = itemImage ? `/assets/images/item/${escHtml(itemImage)}` : fallback;
    img.src = src;
    img.onerror = () => { img.onerror = null; img.src = fallback; };
    img.style.display = '';
  }
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

// ── 인벤토리 렌더링 (4×5 = 20 슬롯) ────────────────────────────────────────
function renderInventory() {
  const grid = $('invGrid');
  if (!grid) return;
  const SLOTS = 20;

  // 정렬: potion_red 1순위, revive_ticket 2순위, 나머지 숫자 정렬
  const ITEM_PRIORITY = { potion_red: 0, revive_ticket: 1 };
  const filled = Object.entries(_inventory)
    .filter(([, c]) => c > 0)
    .sort((a, b) => {
      const pa = ITEM_PRIORITY[a[0]] ?? 99;
      const pb = ITEM_PRIORITY[b[0]] ?? 99;
      if (pa !== pb) return pa - pb;
      return Number(a[0]) - Number(b[0]);
    });

  // 스킬바 빨간약 뱃지 업데이트
  const potBadge = $('skillPotionBadge');
  const potBtn   = $('skillBtnPotion');
  if (potBadge) potBadge.textContent = (_inventory['potion_red'] || 0) > 0 ? String(_inventory['potion_red']) : '';
  if (potBtn)   potBtn.disabled = (_inventory['potion_red'] || 0) <= 0;

  grid.innerHTML = '';
  for (let i = 0; i < SLOTS; i++) {
    const slot = document.createElement('div');
    slot.className = 'inv-slot';
    if (i < filled.length) {
      const [itemId, count] = filled[i];
      slot.classList.add('has-item');
      slot.dataset.itemid = itemId;
      if (itemId === 'potion_red') {
        slot.title = '빨간약 — 클릭하여 사용 (HP +100)';
        slot.style.cursor = 'pointer';
        slot.innerHTML = `
          <img src="/assets/images/item/potion_red.png"
               onerror="this.onerror=null;this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22><circle cx=%2220%22 cy=%2220%22 r=%2218%22 fill=%22%23ef4444%22/><text x=%2220%22 y=%2226%22 font-size=%2220%22 text-anchor=%22middle%22>💊</text></svg>'"
               alt="빨간약" />
          <span class="slot-name">빨간약</span>
          <span class="slot-count">${count}</span>`;
        slot.addEventListener('click', usePotion);
      } else if (itemId === 'revive_ticket') {
        slot.title = '부활 아이템 — 사망 시 클릭하여 즉시 부활 (HP·MP 50%)';
        slot.style.cursor = 'pointer';
        slot.innerHTML = `
          <img src="/assets/images/item/revive_ticket.png"
               onerror="this.onerror=null;this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22><circle cx=%2220%22 cy=%2220%22 r=%2218%22 fill=%22%238b5cf6%22/><text x=%2220%22 y=%2226%22 font-size=%2220%22 text-anchor=%22middle%22>✨</text></svg>'"
               alt="부활 아이템" />
          <span class="slot-name">부활권</span>
          <span class="slot-count">${count}</span>`;
        slot.addEventListener('click', () => useReviveTicket());
      } else {
        const meta = _items[String(itemId)] || {};
        const imgFile = meta.image || (itemId + '.png');
        const fallbackImg = `/assets/images/item/${escHtml(String(itemId))}.png`;
        slot.innerHTML = `
          <img src="/assets/images/item/${escHtml(imgFile)}"
               onerror="this.onerror=null;this.src='${fallbackImg}'"
               alt="${escHtml(meta.name || itemId)}" />
          <span class="slot-name">${escHtml(meta.name || ('#' + itemId))}</span>
          <span class="slot-count">${count}</span>`;
      }
    } else {
      slot.innerHTML = '<span class="slot-placeholder">□</span>';
    }
    grid.appendChild(slot);
  }
}

async function usePotion() {
  if (!_uid) return;
  const current = _inventory['potion_red'] || 0;
  if (current <= 0) { alert('빨간약이 없습니다.'); return; }

  try {
    const fn = httpsCallable(functions, 'usePotion');
    const res = await fn();
    _inventory['potion_red'] = res.data.remaining;
    healHp(100);
    showCollectToast('💊 빨간약 사용! HP +100');
    playSound('heal');
    renderInventory();
  } catch (err) {
    alert('사용 실패: ' + err.message);
  }
}

// ── 바우처 레시피 렌더링 ─────────────────────────────────────────────────────
function renderVouchers() {
  const el = $('voucherList');
  if (!el) return;
  if (!_vouchers.length) { el.innerHTML = '<div class="voucher-empty">등록된 조합 레시피가 없습니다.</div>'; return; }

  el.innerHTML = _vouchers.map(v => {
    const reqs = (v.requirements || []).map(r => {
      const isGold = r.type === 'gold' || r.itemId === 'coin';
      const have   = isGold ? getPlayerGold() : (_inventory[String(r.itemId)] || 0);
      const label  = isGold ? '💰 코인' : escHtml(_items[String(r.itemId)]?.name || '#' + r.itemId);
      const ok     = have >= r.count;
      return `<span style="color:${ok?'#86efac':'#fca5a5'}">${label} ×${r.count} (보유:${have})</span>`;
    }).join(' + ');
    const canCraft = (v.requirements||[]).every(r => {
      const isGold = r.type === 'gold' || r.itemId === 'coin';
      return isGold ? getPlayerGold() >= r.count : (_inventory[String(r.itemId)]||0) >= r.count;
    });
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

  const settle = p => p.then(v => ({ ok: true, v })).catch(e => { console.warn('loadInventory query error:', e.message); return { ok: false }; });

  const [invRes, boxRes, vRes] = await Promise.all([
    settle(getDocs(query(collection(db, 'treasure_inventory'), where('uid', '==', _uid)))),
    settle(getDocs(query(collection(db, 'treasure_inventory_boxes'), where('uid', '==', _uid)))),
    settle(getDocs(query(
      collection(db, 'treasure_voucher_logs'),
      where('uid', '==', _uid),
      orderBy('craftedAt', 'desc'),
      limit(50)
    ))),
  ]);

  // items 메타데이터가 아직 안 로드됐으면 여기서 로드
  if (!Object.keys(_items).length) await loadItems();

  _inventory = {};
  if (invRes.ok) invRes.v.forEach(d => {
    const r = d.data();
    if (r.count > 0) _inventory[String(r.itemId)] = r.count;
  });

  _boxInventory = [];
  if (boxRes.ok) boxRes.v.forEach(d => {
    const r = d.data();
    _boxInventory.push({ boxId: r.boxId, boxName: r.boxName });
    _collectedBoxes.add(r.boxId);
  });

  renderBoxInventory();
  renderInventory();
  renderVouchers();
  renderMyVouchers(vRes.ok ? vRes.v.docs.map(d => d.data()) : []);
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
  // battle 모듈 초기화 (ctx와 callbacks 연결)
  initBattle(_ctx, {
    onCheckProximity: checkProximity,
    onLoadInventory:  loadInventory,
    onUpdateDistDisplay: updateDistDisplay,
  });

  // Auth 리스너 (비동기 — 블로킹 없음)
  onAuthStateChanged(auth, async user => {
    _uid       = user?.uid   || null;
    _userEmail = user?.email || null;
    _ctx.uid   = _uid;
    if (_uid) {
      const snap = await getDoc(doc(db, 'admins', _uid));
      _isAdmin = snap.exists() || (_userEmail === 'daguri75@gmail.com');
      _ctx.isAdmin = _isAdmin;
      // 전투 시스템: 플레이어 상태 로드
      loadPlayerState();
    } else {
      _isAdmin = false;
      _ctx.isAdmin = false;
    }
    // 관리자 패널 표시
    const abp = $('adminBattlePanel');
    if (abp) abp.classList.toggle('open', !!_isAdmin);
  });

  // ── Phase 1: 지도 표시에 필요한 것만 병렬 로드 ──────────────────────────────
  const settle1 = p => p.catch(() => null);
  const [, merchantSnap] = await Promise.all([
    settle1(loadMapsScript()),
    settle1(getDocs(collection(db, 'merchants'))),
    settle1(loadTreasureBoxes()),
  ]);

  // 가맹점 데이터 파싱
  allMerchants = [];
  merchantSnap?.forEach(d => {
    const m = d.data();
    if (m.active === false) return;
    const latLng = (m.lat && m.lng) ? { lat: m.lat, lng: m.lng } : parseLatLng(m.gmap);
    allMerchants.push({ id: d.id, ...m, _latLng: latLng });
  });
  allMerchants.sort((a, b) => (b._latLng ? 1 : 0) - (a._latLng ? 1 : 0));

  // 지도 + 카드 즉시 표시
  if (window.google?.maps) {
    initMap();
    renderMarkers(allMerchants);
    renderBoxMarkers();
    fitMapToAllMarkers();
  }
  renderCards(allMerchants);

  // 버튼 이벤트
  $('btnMyLocation')?.addEventListener('click', showMyLocation);
  $('btnInventory')?.addEventListener('click', openInventory);
  $('btnResetDist')?.addEventListener('click', () => {
    _ctx.totalDist = 0; _ctx.lastDistPos = null; updateDistDisplay();
  });
  $('btnCloseInv')?.addEventListener('click', closeInventory);
  $('invModal')?.addEventListener('click', e => { if (e.target === $('invModal')) closeInventory(); });
  $('btnRevealClose')?.addEventListener('click', () => $('itemReveal')?.classList.remove('open'));
  $('itemReveal')?.addEventListener('click', e => { if (e.target === $('itemReveal')) $('itemReveal').classList.remove('open'); });

  // 관리자 전투 배치 패널 버튼
  $('btnPlaceMonster')?.addEventListener('click', () => enterAdminPlaceMode('monster'));
  $('btnPlaceArcherTower')?.addEventListener('click', () => enterAdminPlaceMode('archer_tower'));
  $('btnPlaceCannonTower')?.addEventListener('click', () => enterAdminPlaceMode('cannon_tower'));
  $('btnPlaceDeco')?.addEventListener('click',    () => enterAdminPlaceMode('deco'));
  $('btnGivePotion')?.addEventListener('click', async () => {
    const targetUid = prompt('빨간약 지급할 UID (비우면 본인):', _uid || '') || _uid;
    if (!targetUid) return;
    const count = parseInt(prompt('지급 수량:', '5') || '5');
    if (!count || count < 1) return;
    try {
      const res = await httpsCallable(functions, 'adminGivePotion')({ targetUid, count });
      alert(`✅ ${targetUid.slice(0,8)}… 에게 빨간약 ${res.data.given}병 지급 완료`);
      if (targetUid === _uid) await loadInventory();
    } catch (err) { alert('실패: ' + err.message); }
  });
  $('btnCancelPlace')?.addEventListener('click',  exitAdminPlaceMode);
  $('btnToggleTowerRange')?.addEventListener('click', toggleTowerRanges);

  // 스킬 버튼
  $('skillBtn0')?.addEventListener('click', castLightning);
  $('skillBtn1')?.addEventListener('click', castIceFreeze);
  $('skillBtn2')?.addEventListener('click', castFireStorm);
  $('skillBtnPotion')?.addEventListener('click', usePotion);

  // 키보드 단축키 1/2/3/4
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === '1') castLightning();
    else if (e.key === '2') castIceFreeze();
    else if (e.key === '3') castFireStorm();
    else if (e.key === '4') usePotion();
  });

  // 전투 HUD 클릭 → 접기/펼치기 (모바일: 기본 접힘)
  $('combatHud')?.addEventListener('click', () => $('combatHud')?.classList.toggle('compact'));
  if (window.innerWidth <= 640) $('combatHud')?.classList.add('compact');

  // 보물 근접 감지 + 전투 루프 시작
  startWatchPosition();
  startBattleLoop();
  updateSkillBar();

  // ── Phase 2: 백그라운드에서 나머지 로드 (UI 블로킹 없음) ─────────────────────
  Promise.all([loadPlaces(), loadItems(), loadVouchers(), loadBattleData(), loadDecorations()]).then(() => {
    // 장소 마커 추가
    if (window.google?.maps) {
      renderPlaceMarkers();
      fitMapToAllMarkers();
    }
    // 인벤토리 초기 렌더
    renderBoxInventory();
    renderInventory();
    renderVouchers();
  });
}

init();
