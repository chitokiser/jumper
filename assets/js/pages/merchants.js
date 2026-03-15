// /assets/js/pages/merchants.js
// 가맹점 지도 + 보물찾기 시스템

import { auth, db, functions } from '/assets/js/firebase-init.js';
import { collection, getDocs, doc, getDoc, query, where, orderBy, limit,
         addDoc, deleteDoc, setDoc, serverTimestamp }
                          from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { onAuthStateChanged }
                          from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable }
                          from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

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
let _locationWatchId    = null;  // watchPosition ID (실시간 추적)
let _totalDist          = 0;     // 누적 이동거리 (미터)
let _lastDistPos        = null;  // 직전 GPS 좌표 {lat, lng}
let _lastHeading        = null;  // 진행 방향 (degrees, 0=북)
let _lastSpeedPos       = null;  // 속도 계산용 {lat, lng, time}
let _lastPos            = null;  // 마지막 GPS 위치 캐시
let _uid            = null;   // 로그인 유저 UID
let _userEmail      = null;   // 로그인 유저 이메일
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

  // HUD 버튼을 Google Maps Custom Control로 등록 (전체화면·확대 시에도 유지)
  const existingHud = $('mapHud');
  if (existingHud) map.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(existingHud);

  // 전투 HUD (LEFT_BOTTOM)
  const combatHud = $('combatHud');
  if (combatHud) map.controls[google.maps.ControlPosition.LEFT_BOTTOM].push(combatHud);

  // 관리자 전투 패널 (LEFT_BOTTOM, combatHud 위)
  const adminBattlePanel = $('adminBattlePanel');
  if (adminBattlePanel) map.controls[google.maps.ControlPosition.LEFT_BOTTOM].push(adminBattlePanel);

  // 전체화면 진입/종료 시 모달을 fullscreen 요소 안으로 이동 (fixed 포지션 유지)
  const MODALS = ['invModal', 'itemReveal'];
  document.addEventListener('fullscreenchange', () => {
    const fs = document.fullscreenElement;
    MODALS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (fs) {
        fs.appendChild(el);   // 전체화면 요소 안으로
      } else {
        document.body.appendChild(el);  // 전체화면 종료 → body로 복귀
      }
    });
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
      // auth.currentUser로 즉시 확인 (async 딜레이 없음)
      const isAdminNow = _isAdmin || (_userEmail === 'daguri75@gmail.com');
      const adminBtn = isAdminNow && !alreadyCollected
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
          <div style="color:${active?'#16a34a':'#dc2626'};font-weight:600;">${active?'✅ 지금 획득가능':'⏰ 현재 비활성'}</div>
          ${active && !isAdminNow ? '<div style="margin-top:6px;color:#555;font-size:12px;">5m 이내로 접근하면 자동 수집!</div>' : ''}
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

// ── 내 위치 마커 아이콘 생성 (방향 화살표 포함) ──────────────────────────────
function makeLocationIcon(heading) {
  const hasHeading = heading != null && !isNaN(heading) && isFinite(heading);
  const arrow = hasHeading
    ? `<polygon points="20,3 14,17 20,13 26,17" fill="#1a73e8" stroke="white" stroke-width="1.5" transform="rotate(${Math.round(heading)},20,20)"/>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="13" fill="#4285F4" fill-opacity="0.18"/>
    ${arrow}
    <circle cx="20" cy="20" r="8" fill="#4285F4" stroke="white" stroke-width="2.5"/>
    <circle cx="20" cy="20" r="3" fill="white"/>
  </svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(40, 40),
    anchor: new google.maps.Point(20, 20),
  };
}

// ── 이동거리 표시 업데이트 ────────────────────────────────────────────────────
function updateDistDisplay() {
  const panel = $('distPanel');
  const el = $('distValue');
  if (!el) return;
  if (panel && !panel.classList.contains('active')) panel.classList.add('active');
  el.textContent = _totalDist >= 1000
    ? (_totalDist / 1000).toFixed(2) + ' km'
    : Math.round(_totalDist) + ' m';
}

// ── 내 위치 마커 업데이트 (실시간) ───────────────────────────────────────────
function updateMyLocation(lat, lng, accuracy, heading) {
  const latLng = { lat, lng };
  const icon = makeLocationIcon(heading);
  if (myLocationMarker) {
    myLocationMarker.setPosition(latLng);
    myLocationMarker.setIcon(icon);
  } else {
    myLocationMarker = new google.maps.Marker({
      position: latLng, map, title: '내 위치', icon, zIndex: 100,
    });
  }
  const radius = (accuracy && accuracy > 0) ? accuracy : 10;
  if (myLocationAccCircle) {
    myLocationAccCircle.setCenter(latLng);
    myLocationAccCircle.setRadius(radius);
  } else {
    myLocationAccCircle = new google.maps.Circle({
      map, center: latLng, radius,
      fillColor: '#4285F4', fillOpacity: 0.08,
      strokeColor: '#4285F4', strokeOpacity: 0.3, strokeWeight: 1,
    });
  }

  // 방향 업데이트
  if (heading != null && !isNaN(heading)) _lastHeading = heading;

  // 정확도 불량이면 거리/속도 계산 스킵
  if (accuracy && accuracy > 30) { _lastDistPos = { lat, lng }; _lastSpeedPos = { lat, lng, time: Date.now() }; return; }

  if (_lastDistPos) {
    const d = haversine(lat, lng, _lastDistPos.lat, _lastDistPos.lng);
    if (d > 1 && d < 500) {
      _totalDist += d;
      updateDistDisplay();

      // 속도 계산 (km/h)
      const now = Date.now();
      if (_lastSpeedPos) {
        const dt = (now - _lastSpeedPos.time) / 1000;
        if (dt > 0) _currentSpeed = Math.min((d / dt) * 3.6, 200);
      }

      if (_isDead) {
        // 사망 상태: 부활 거리 누적 (속도 무관)
        _reviveWalkDist += d;
        updateCombatHud();
      } else {
        // 생존 상태: HP 회복 (속도 17km/h 이하 + 10m마다 HP+10)
        if (_currentSpeed <= 17) {
          _healAccum += d;
          while (_healAccum >= 10) {
            _healAccum -= 10;
            healHp(10);
          }
        }
      }
    }
  }
  _lastDistPos  = { lat, lng };
  _lastSpeedPos = { lat, lng, time: Date.now() };
  updateCombatHud();
}

// ── 내 위치 버튼: 실시간 추적 시작 + 지도 이동 ───────────────────────────────
function showMyLocation() {
  const btn = $('btnMyLocation');
  if (!navigator.geolocation) { alert('이 브라우저는 위치 서비스를 지원하지 않습니다.'); return; }
  if (btn) btn.textContent = '⏳';

  // 백그라운드 watch가 이미 실행 중 → 마커 표시 + 현재 위치로 이동
  if (_locationWatchId != null) {
    if (_lastPos) {
      updateMyLocation(_lastPos.lat, _lastPos.lng, _lastPos.accuracy, _lastPos.heading);
      map.panTo({ lat: _lastPos.lat, lng: _lastPos.lng });
      map.setZoom(16);
    }
    if (btn) btn.textContent = '📍';
    return;
  }

  let firstFix = true;
  _locationWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude: lat, longitude: lng, accuracy, heading } = pos.coords;
      _lastPos = { lat, lng, accuracy, heading };
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
      _locationWatchId = null;
      alert({ 1:'위치 권한이 거부되었습니다.', 2:'위치를 가져올 수 없습니다.', 3:'위치 요청 시간 초과.' }[err.code] || '위치 오류');
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
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
    if (dist <= 5) {  // 5m 이내 자동 수집
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

// ── 백그라운드 근접 감지 (위치 버튼 누르기 전에도 보물 자동 수집) ──────────────
function startWatchPosition() {
  if (!navigator.geolocation) return;
  if (_locationWatchId != null) return;
  _locationWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude: lat, longitude: lng, accuracy, heading } = pos.coords;
      _lastPos = { lat, lng, accuracy, heading };
      if (myLocationMarker) updateMyLocation(lat, lng, accuracy, heading);
      checkProximity(lat, lng);
    },
    null,
    { enableHighAccuracy: true, maximumAge: 3000 }
  );
}

// ── 인벤토리 렌더링 (4×5 = 20 슬롯) ────────────────────────────────────────
function renderInventory() {
  const grid = $('invGrid');
  if (!grid) return;
  const SLOTS = 20;

  // potion_red 맨 앞, 나머지 숫자 정렬
  const filled = Object.entries(_inventory)
    .filter(([, c]) => c > 0)
    .sort((a, b) => {
      if (a[0] === 'potion_red') return -1;
      if (b[0] === 'potion_red') return 1;
      return Number(a[0]) - Number(b[0]);
    });

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
  if (_player.hp >= _player.maxHp) { alert('HP가 이미 최대입니다.'); return; }

  try {
    const invRef = doc(db, 'treasure_inventory', `${_uid}_potion_red`);
    const newCount = current - 1;
    if (newCount <= 0) {
      await deleteDoc(invRef);
    } else {
      await updateDoc(invRef, { count: newCount, updatedAt: serverTimestamp() });
    }
    _inventory['potion_red'] = newCount;
    healHp(100);
    if (myLocationMarker) {
      const p = myLocationMarker.getPosition();
      showFloat('💊 +100', '#f87171', p.lat(), p.lng());
    }
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

  // 각 쿼리를 독립적으로 실행 — 하나 실패해도 나머지는 정상 표시
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
    if (r.count > 0) _inventory[String(r.itemId)] = r.count;  // 키를 문자열로 통일
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
  // Auth 리스너 (비동기 — 블로킹 없음)
  onAuthStateChanged(auth, async user => {
    _uid       = user?.uid   || null;
    _userEmail = user?.email || null;
    if (_uid) {
      const snap = await getDoc(doc(db, 'admins', _uid));
      _isAdmin = snap.exists() || (_userEmail === 'daguri75@gmail.com');
      // 전투 시스템: 플레이어 상태 로드
      loadPlayerState();
    } else {
      _isAdmin = false;
    }
    // 관리자 패널 표시
    const abp = $('adminBattlePanel');
    if (abp) abp.classList.toggle('open', !!_isAdmin);
  });

  // ── Phase 1: 지도 표시에 필요한 것만 병렬 로드 ──────────────────────────────
  // Maps 스크립트 + 핵심 Firestore 데이터 동시에 시작
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
    _totalDist = 0; _lastDistPos = null; updateDistDisplay();
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

  // 보물 근접 감지 + 전투 루프 시작
  startWatchPosition();
  startBattleLoop();

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

// ════════════════════════════════════════════════════════════════════════════
// ── 위치 기반 전투 시스템 ──────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════

// ── 전투 상태 변수 ────────────────────────────────────────────────────────────
let _player       = { level:1, hp:1000, mp:1000, maxHp:1000, maxMp:1000, xp:0, gold:0 };
let _monsters     = [];        // [{id, name, lat, lng, hp, maxHp, atk, detectRadius, image, active}]
let _towers       = [];        // [{id, name, lat, lng, atk, radius, active}]
let _monsterMarkers  = {};     // { id: Marker }
let _towerMarkers    = {};     // { id: Marker }
let _towerRanges     = {};     // { id: Circle }
let _showTowerRange  = false;
let _battleLoopId    = null;
let _attackCd        = false;  // 유저 공격 쿨다운 (1.5초)
let _clickAtkCd      = {};     // { monsterId: bool } 클릭 공격 쿨다운
let _towerCd         = {};     // { towerId: bool }
let _monsterCd       = {};     // { monsterId: bool }
let _healAccum       = 0;      // HP 회복용 추가 누적거리(m)
let _reviveWalkDist  = 0;      // 사망 후 부활용 누적거리(m)
let _currentSpeed    = 0;      // km/h
let _isDead          = false;
let _goldDrops       = [];     // [{id, lat, lng, amount, marker}]
let _adminPlaceMode  = null;   // 'monster' | 'tower' | 'deco' | null
let _adminMapListener = null;
let _decoMarkers     = [];     // 데코 마커 목록

// ── 사운드 시스템 (Web Audio API) ────────────────────────────────────────────
let _audioCtx = null;
function getAC() {
  if (!_audioCtx || _audioCtx.state === 'closed')
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}
function playSound(type) {
  try {
    const ac = getAC();
    const osc = (freq, type2='sine') => { const o = ac.createOscillator(); o.type = type2; o.frequency.value = freq; return o; };
    const gain = (vol) => { const g = ac.createGain(); g.gain.value = vol; g.connect(ac.destination); return g; };
    const ramp = (node, from, to, dur) => { node.setValueAtTime(from, ac.currentTime); node.exponentialRampToValueAtTime(to, ac.currentTime + dur); };
    const noise = (dur, vol=0.4) => {
      const buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random()*2-1) * (1 - i/d.length);
      const s = ac.createBufferSource(); s.buffer = buf;
      const g = gain(vol); s.connect(g); s.start(); return s;
    };
    const tone = (freq, vol, dur, t=0, type2='sine') => {
      const o = osc(freq, type2), g = gain(0);
      o.connect(g); ramp(g.gain, vol, 0.001, dur); o.start(ac.currentTime+t); o.stop(ac.currentTime+t+dur);
    };
    switch (type) {
      case 'arrow_shot':  tone(700,0.25,0.12); tone(300,0.15,0.1,0.05,'sawtooth'); break;
      case 'tower_shot':
        tone(900,0.35,0.04,0,'square');      // 시위 틱
        tone(600,0.2,0.07,0.02,'sawtooth');  // 발사 긁힘
        noise(0.2,0.18);                     // 화살 바람
        tone(180,0.18,0.18,0.05);            // 중저음
        break;
      case 'cannon_shot': {
        // ① 발사 크랙 (매우 짧은 전음)
        const cbuf = ac.createBuffer(1, Math.floor(ac.sampleRate*0.018), ac.sampleRate);
        const cd = cbuf.getChannelData(0);
        for (let i=0;i<cd.length;i++) cd[i]=(Math.random()*2-1)*Math.pow(1-i/cd.length,2);
        const cs=ac.createBufferSource(); cs.buffer=cbuf;
        const cg=ac.createGain(); cg.gain.value=1.4; cs.connect(cg); cg.connect(ac.destination); cs.start();

        // ② 핵심 붐 — 90→22Hz 급속 피치 다운, 빠른 어택 + 느린 감쇠
        const boom=ac.createOscillator(); boom.type='sine';
        boom.frequency.setValueAtTime(90,ac.currentTime);
        boom.frequency.exponentialRampToValueAtTime(22,ac.currentTime+0.28);
        const bg=ac.createGain();
        bg.gain.setValueAtTime(0,ac.currentTime);
        bg.gain.linearRampToValueAtTime(1.8,ac.currentTime+0.006);
        bg.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+1.0);
        boom.connect(bg); bg.connect(ac.destination); boom.start(); boom.stop(ac.currentTime+1.0);

        // ③ 중저음 바디 — 폭발 질감
        const mb=ac.createOscillator(); mb.type='sawtooth';
        mb.frequency.setValueAtTime(130,ac.currentTime);
        mb.frequency.exponentialRampToValueAtTime(38,ac.currentTime+0.22);
        const mg=ac.createGain();
        mg.gain.setValueAtTime(0.9,ac.currentTime);
        mg.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.28);
        mb.connect(mg); mg.connect(ac.destination); mb.start(); mb.stop(ac.currentTime+0.28);

        // ④ 밴드패스 노이즈 — 폭발 크랙 텍스처
        const nbuf=ac.createBuffer(1,Math.floor(ac.sampleRate*0.45),ac.sampleRate);
        const nd=nbuf.getChannelData(0);
        for(let i=0;i<nd.length;i++) nd[i]=(Math.random()*2-1)*Math.exp(-i/(ac.sampleRate*0.07));
        const ns=ac.createBufferSource(); ns.buffer=nbuf;
        const bpf=ac.createBiquadFilter(); bpf.type='bandpass'; bpf.frequency.value=220; bpf.Q.value=0.6;
        const ng=ac.createGain(); ng.gain.value=1.1;
        ns.connect(bpf); bpf.connect(ng); ng.connect(ac.destination); ns.start();

        // ⑤ 로우패스 럼블 — 긴 저음 여운
        const rbuf=ac.createBuffer(1,Math.floor(ac.sampleRate*1.3),ac.sampleRate);
        const rd=rbuf.getChannelData(0);
        for(let i=0;i<rd.length;i++) rd[i]=(Math.random()*2-1)*Math.exp(-i/(ac.sampleRate*0.38));
        const rs=ac.createBufferSource(); rs.buffer=rbuf;
        const lpf=ac.createBiquadFilter(); lpf.type='lowpass'; lpf.frequency.value=75;
        const rg=ac.createGain(); rg.gain.value=0.75;
        rs.connect(lpf); lpf.connect(rg); rg.connect(ac.destination); rs.start();
        break;
      }
      case 'cannon_hit': {
        // 폭발 임팩트 — 작은 대포소리
        const ibuf=ac.createBuffer(1,Math.floor(ac.sampleRate*0.55),ac.sampleRate);
        const id2=ibuf.getChannelData(0);
        for(let i=0;i<id2.length;i++) id2[i]=(Math.random()*2-1)*Math.exp(-i/(ac.sampleRate*0.09));
        const is=ac.createBufferSource(); is.buffer=ibuf;
        const ibpf=ac.createBiquadFilter(); ibpf.type='bandpass'; ibpf.frequency.value=180; ibpf.Q.value=0.5;
        const ig=ac.createGain(); ig.gain.value=1.3;
        is.connect(ibpf); ibpf.connect(ig); ig.connect(ac.destination); is.start();
        const ib=ac.createOscillator(); ib.type='sine';
        ib.frequency.setValueAtTime(75,ac.currentTime);
        ib.frequency.exponentialRampToValueAtTime(20,ac.currentTime+0.3);
        const ibg=ac.createGain();
        ibg.gain.setValueAtTime(1.2,ac.currentTime);
        ibg.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.35);
        ib.connect(ibg); ibg.connect(ac.destination); ib.start(); ib.stop(ac.currentTime+0.35);
        break;
      }
      case 'monster_atk':
        noise(0.07,0.55);                     // 휘두르는 바람
        tone(160,0.45,0.07,0,'sawtooth');     // 타격 충격
        tone(85,0.3,0.14,0.04);               // 둔탁한 여운
        break;
      case 'critical_hit':
        tone(880,0.5,0.05,0,'square');
        tone(1100,0.4,0.08,0.04,'square');
        noise(0.06,0.6);
        tone(660,0.35,0.12,0.07);
        break;
      case 'arrow_hit':   noise(0.08,0.5); tone(220,0.3,0.1,0,'square'); break;
      case 'player_hit':  tone(120,0.4,0.25,'sawtooth'); noise(0.1,0.3); break;
      case 'monster_die': [440,330,220,165].forEach((f,i)=>tone(f,0.28,0.14,i*0.09)); break;
      case 'player_die':  tone(300,0.5,0.9,'triangle'); tone(80,0.3,0.7,0.1); break;
      case 'heal':        [523,659,784].forEach((f,i)=>tone(f,0.18,0.1,i*0.07)); break;
      case 'revive':      [261,329,392,523,659,784].forEach((f,i)=>tone(f,0.3,0.15,i*0.09)); break;
      case 'gold_drop':   [1047,1319,1568].forEach((f,i)=>tone(f,0.35,0.18,i*0.07,'triangle')); break;
      case 'gold_pickup': [523,784,1047,1319].forEach((f,i)=>tone(f,0.3,0.1,i*0.05)); break;
      case 'error_locked':[200,180].forEach((f,i)=>tone(f,0.25,0.12,i*0.14,'square')); break;
    }
  } catch { /* 오디오 미지원 무시 */ }
}

// ── 화살 발사 애니메이션 ──────────────────────────────────────────────────────
function animateArrow(fromLat, fromLng, toLat, toLng, color, onHit) {
  const overlay = document.getElementById('battleOverlay');
  if (!overlay) { onHit?.(); return; }
  const sp = latLngToPixel(fromLat, fromLng);
  const ep = latLngToPixel(toLat,   toLng);
  if (!sp || !ep) { onHit?.(); return; }

  const angle = Math.atan2(ep.y - sp.y, ep.x - sp.x) * 180 / Math.PI;
  const el = document.createElement('div');
  el.className = 'arrow-proj';
  el.style.cssText = `left:${sp.x}px;top:${sp.y}px;background:${color};
    box-shadow:0 0 5px ${color};transform:translate(-50%,-50%) rotate(${angle}deg)`;
  overlay.appendChild(el);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.left = ep.x + 'px';
    el.style.top  = ep.y + 'px';
  }));

  setTimeout(() => {
    el.remove();
    // 타격 이펙트
    const hit = document.createElement('div');
    hit.className = 'hit-flash';
    hit.style.cssText = `left:${ep.x}px;top:${ep.y}px;background:radial-gradient(circle,${color},transparent)`;
    overlay.appendChild(hit);
    setTimeout(() => hit.remove(), 320);
    onHit?.();
  }, 300);
}

// ── 타워 투사체 애니메이션 ────────────────────────────────────────────────────
function animateTowerShot(fromLat, fromLng, toLat, toLng, onHit) {
  const overlay = document.getElementById('battleOverlay');
  if (!overlay) { onHit?.(); return; }
  const sp = latLngToPixel(fromLat, fromLng);
  const ep = latLngToPixel(toLat,   toLng);
  if (!sp || !ep) { onHit?.(); return; }

  const angle = Math.atan2(ep.y - sp.y, ep.x - sp.x) * 180 / Math.PI;

  // 발사 링 이펙트 (타워 위치)
  const ring = document.createElement('div');
  ring.className = 'tower-launch-ring';
  ring.style.cssText = `left:${sp.x}px;top:${sp.y}px;`;
  overlay.appendChild(ring);
  setTimeout(() => ring.remove(), 400);

  // 투사체
  const proj = document.createElement('div');
  proj.className = 'tower-proj';
  proj.style.cssText = `left:${sp.x}px;top:${sp.y}px;transform:translate(-50%,-50%) rotate(${angle}deg)`;
  overlay.appendChild(proj);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    proj.style.left = ep.x + 'px';
    proj.style.top  = ep.y + 'px';
  }));

  setTimeout(() => {
    proj.remove();
    // 임팩트 이펙트
    const impact = document.createElement('div');
    impact.className = 'tower-impact';
    impact.style.cssText = `left:${ep.x}px;top:${ep.y}px;`;
    overlay.appendChild(impact);
    setTimeout(() => impact.remove(), 420);
    onHit?.();
  }, 340);
}

// ── 대포 투사체 애니메이션 ────────────────────────────────────────────────────
function animateCannonShot(fromLat, fromLng, toLat, toLng, onHit) {
  const overlay = document.getElementById('battleOverlay');
  if (!overlay) { onHit?.(); return; }
  const sp = latLngToPixel(fromLat, fromLng);
  const ep = latLngToPixel(toLat,   toLng);
  if (!sp || !ep) { onHit?.(); return; }

  // 포구 화염
  const muzzle = document.createElement('div');
  muzzle.className = 'cannon-muzzle';
  muzzle.style.cssText = `left:${sp.x}px;top:${sp.y}px;`;
  overlay.appendChild(muzzle);
  setTimeout(() => muzzle.remove(), 280);

  // 포탄
  const proj = document.createElement('div');
  proj.className = 'cannon-proj';
  proj.style.cssText = `left:${sp.x}px;top:${sp.y}px;`;
  overlay.appendChild(proj);

  requestAnimationFrame(() => requestAnimationFrame(() => {
    proj.style.left = ep.x + 'px';
    proj.style.top  = ep.y + 'px';
  }));

  setTimeout(() => {
    proj.remove();
    // 폭발
    const blast = document.createElement('div');
    blast.className = 'cannon-blast';
    blast.style.cssText = `left:${ep.x}px;top:${ep.y}px;`;
    overlay.appendChild(blast);
    setTimeout(() => blast.remove(), 480);
    onHit?.();
  }, 580);
}

// ── 황금토큰 드랍 ─────────────────────────────────────────────────────────────
function dropGoldTokens(mob) {
  if (!window.google?.maps || !map) return;
  const maxDrop = Math.min(Math.floor(mob.maxHp / 20), 10);
  const amount  = Math.max(1, Math.floor(Math.random() * maxDrop) + 1);
  // 몬스터 위치에서 ±1~2m 오프셋
  const lat = mob.lat + (Math.random() - 0.5) * 0.00003;
  const lng = mob.lng + (Math.random() - 0.5) * 0.00003;
  const id  = `gold_${Date.now()}_${Math.random()}`;

  const marker = new google.maps.Marker({
    position: { lat, lng }, map,
    title: `💰 황금토큰 ×${amount}`,
    icon: { url: '/assets/images/item/0.png',
            scaledSize: new google.maps.Size(22, 22),
            anchor: new google.maps.Point(11, 11) },
    zIndex: 25,
  });
  const drop = { id, lat, lng, amount, marker };
  _goldDrops.push(drop);
  showFloat(`💰×${amount}`, '#fbbf24', lat, lng);
  playSound('gold_drop');
  // 5분 후 자동 제거
  setTimeout(() => {
    drop.marker?.setMap(null);
    _goldDrops = _goldDrops.filter(d => d.id !== id);
  }, 300000);
}

function checkGoldPickup() {
  if (_isDead || !myLocationMarker || !_goldDrops.length) return;
  const pos = myLocationMarker.getPosition();
  const myLat = pos.lat(), myLng = pos.lng();
  for (const drop of [..._goldDrops]) {
    if (haversine(myLat, myLng, drop.lat, drop.lng) <= 3) {
      drop.marker?.setMap(null);
      _goldDrops = _goldDrops.filter(d => d.id !== drop.id);
      _player.gold = (_player.gold || 0) + drop.amount;
      showFloat(`💰+${drop.amount}`, '#fbbf24', myLat, myLng);
      playSound('gold_pickup');
      savePlayerState();
    }
  }
}

// ── 좌표 → 픽셀 변환 ─────────────────────────────────────────────────────────
function latLngToPixel(lat, lng) {
  if (!map || !map.getProjection || !map.getProjection() || !map.getBounds()) return null;
  const proj   = map.getProjection();
  const bounds = map.getBounds();
  const scale  = Math.pow(2, map.getZoom());
  const nw = proj.fromLatLngToPoint(
    new google.maps.LatLng(bounds.getNorthEast().lat(), bounds.getSouthWest().lng()));
  const pt = proj.fromLatLngToPoint(new google.maps.LatLng(lat, lng));
  return { x: (pt.x - nw.x) * scale, y: (pt.y - nw.y) * scale };
}

// ── 크리티컬 토스트 ───────────────────────────────────────────────────────────
function showCriticalToast() {
  const el = document.getElementById('criticalToast');
  if (!el) return;
  el.style.animation = 'none';
  el.offsetWidth; // reflow
  el.style.animation = 'critPop 0.9s ease-out forwards';
}

// ── 데미지/힐 숫자 플로팅 ──────────────────────────────────────────────────────
function showFloat(text, color, lat, lng) {
  const overlay = document.getElementById('battleOverlay');
  if (!overlay) return;
  const px = latLngToPixel(lat, lng);
  const x = px ? px.x : overlay.offsetWidth  * 0.5;
  const y = px ? px.y : overlay.offsetHeight * 0.4;
  const el = document.createElement('div');
  el.className = 'dmg-float';
  el.style.cssText = `left:${x}px;top:${y}px;color:${color}`;
  el.textContent = text;
  overlay.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

// ── 전투 HUD 업데이트 ─────────────────────────────────────────────────────────
function updateCombatHud() {
  const p = _player;
  const hpPct = Math.max(0, Math.min(100, (p.hp / p.maxHp) * 100));
  const mpPct = Math.max(0, Math.min(100, (p.mp / p.maxMp) * 100));

  const hpBar = document.getElementById('cHpBar');
  const mpBar = document.getElementById('cMpBar');
  if (hpBar) { hpBar.style.width = hpPct + '%'; hpBar.classList.toggle('low', hpPct < 25); }
  if (mpBar)  mpBar.style.width = mpPct + '%';

  const lv = document.getElementById('cLv');    if (lv)  lv.textContent  = `LV.${p.level}  💰${p.gold||0}`;
  const hv = document.getElementById('cHpVal'); if (hv)  hv.textContent  = `${p.hp} / ${p.maxHp}`;
  const mv = document.getElementById('cMpVal'); if (mv)  mv.textContent  = `${p.mp} / ${p.maxMp}`;
  const sp = document.getElementById('cSpd');   if (sp)  sp.textContent  = `SPD ${_currentSpeed.toFixed(1)} km/h`;
  const dead = document.getElementById('cDead');
  if (dead) {
    if (_isDead) {
      dead.style.display = '';
      dead.textContent = `💀 사망 — 부활까지 ${Math.max(0, Math.round(50 - _reviveWalkDist))}m 남음`;
    } else {
      dead.style.display = 'none';
    }
  }
}

// ── 플레이어 상태 저장/로드 ───────────────────────────────────────────────────
async function loadPlayerState() {
  if (!_uid) return;

  // 1) 온체인 레벨 동기화 (mypage.html과 동일한 Cloud Function)
  try {
    const res = await httpsCallable(functions, 'getMyOnChain')();
    const onChain = res.data;
    if (onChain?.level > 0) {
      _player.level = onChain.level;
      _player.xp    = onChain.exp    || 0;
    }
  } catch { /* 온체인 조회 실패 시 battle_players fallback */ }

  // 2) HP/MP는 battle_players에서 로드 (레벨 기반 maxHp/Mp 재계산)
  try {
    const snap = await getDoc(doc(db, 'battle_players', _uid));
    _player.maxHp = _player.level * 1000;
    _player.maxMp = _player.level * 1000;
    if (snap.exists()) {
      const d = snap.data();
      // 저장된 레벨과 현재 온체인 레벨이 같을 때만 HP 복원
      if ((d.level || 1) === _player.level) {
        _player.hp = Math.min(d.hp ?? _player.maxHp, _player.maxHp);
        _player.mp = Math.min(d.mp ?? _player.maxMp, _player.maxMp);
        _isDead         = d.isDead         === true;
        _reviveWalkDist = d.reviveWalkDist || 0;
      } else {
        // 레벨 변경됨 → 풀 HP, 부활 상태 해제
        _player.hp      = _player.maxHp;
        _player.mp      = _player.maxMp;
        _isDead         = false;
        _reviveWalkDist = 0;
      }
    } else {
      _player.hp = _player.maxHp;
      _player.mp = _player.maxMp;
    }
  } catch { /* 무시 */ }

  updateCombatHud();
}

let _saveTimer = null;
function savePlayerState() {
  if (!_uid) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try {
      await setDoc(doc(db, 'battle_players', _uid), {
        uid: _uid, level: _player.level, xp: _player.xp,
        hp: _player.hp, mp: _player.mp,
        maxHp: _player.maxHp, maxMp: _player.maxMp,
        isDead: _isDead,
        reviveWalkDist: _reviveWalkDist,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch { /* 무시 */ }
  }, 3000);
}

// ── 플레이어 HP/MP 변경 ────────────────────────────────────────────────────────
let _lastHealFloat = 0;
function takeDamage(amount, sourceLat, sourceLng) {
  if (_isDead) return;
  _player.hp = Math.max(0, _player.hp - amount);
  const lat = sourceLat || (myLocationMarker ? myLocationMarker.getPosition().lat() : null);
  const lng = sourceLng || (myLocationMarker ? myLocationMarker.getPosition().lng() : null);
  if (lat && lng) showFloat(`-${amount}`, '#f87171', lat, lng);
  if (_player.hp <= 0) {
    _isDead = true;
    _player.hp = 0;
    _reviveWalkDist = 0;
    playSound('player_die');
    if (lat && lng) showFloat('💀 사망했습니다', '#fbbf24', lat, lng);
  } else {
    playSound('player_hit');
  }
  updateCombatHud();
  savePlayerState();
}

function healHp(amount) {
  if (_isDead) return;
  const prev = _player.hp;
  _player.hp = Math.min(_player.maxHp, _player.hp + amount);
  const gain = _player.hp - prev;
  if (gain > 0) {
    // 힐 사운드는 30초에 1번만 (너무 자주 울리지 않도록)
    const now = Date.now();
    if (now - _lastHealFloat > 30000) { playSound('heal'); _lastHealFloat = now; }
  }
  updateCombatHud();
  savePlayerState();
}

function gainXp(amount) {
  _player.xp += amount;
  // 전투 XP 저장 (레벨업은 mypage.html 온체인에서 처리)
  if (myLocationMarker) {
    const pos = myLocationMarker.getPosition();
    showFloat(`+${amount} XP`, '#a78bfa', pos.lat(), pos.lng());
  }
  updateCombatHud();
  savePlayerState();
}

// ── 배틀 데이터 로드 ──────────────────────────────────────────────────────────
async function loadBattleData() {
  try {
    const [mSnap, tSnap] = await Promise.all([
      getDocs(query(collection(db, 'battle_monsters'), where('active', '==', true))),
      getDocs(query(collection(db, 'battle_towers'),   where('active', '==', true))),
    ]);
    _monsters = mSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    _towers   = tSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (window.google?.maps) {
      renderMonsterMarkers();
      renderTowerMarkers();
    }
  } catch (e) { console.warn('loadBattleData:', e.message); }
}

// ── 데코 마커 로드/렌더/삭제 ──────────────────────────────────────────────────
async function loadDecorations() {
  try {
    const snap = await getDocs(query(collection(db, 'map_decorations'), where('active', '==', true)));
    _decoMarkers.forEach(m => m.marker?.setMap(null));
    _decoMarkers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderDecoMarkers();
  } catch (e) { console.warn('loadDecorations:', e.message); }
}

function renderDecoMarkers() {
  _decoMarkers.forEach(d => {
    if (d.marker) d.marker.setMap(null);
    const size = d.size || 48;
    const marker = new google.maps.Marker({
      position: { lat: d.lat, lng: d.lng }, map,
      title: d.name || '',
      icon: { url: d.imageUrl, scaledSize: new google.maps.Size(size, size), anchor: new google.maps.Point(size/2, size/2) },
      zIndex: 5,
    });
    marker.addListener('click', () => {
      infoWindow.setContent(`
        <div style="font-size:13px;line-height:1.6;">
          <img src="${escHtml(d.imageUrl)}" style="width:80px;height:80px;object-fit:contain;display:block;margin:0 auto 6px;">
          <div style="font-weight:700;text-align:center;">${escHtml(d.name||'데코')}</div>
          ${_isAdmin ? `<button onclick="window.__deleteDeco('${d.id}')" style="margin-top:6px;width:100%;padding:4px;background:#fee2e2;color:#b91c1c;border:none;border-radius:4px;cursor:pointer;">🗑️ 삭제</button>` : ''}
        </div>`);
      infoWindow.open(map, marker);
    });
    d.marker = marker;
  });
}

window.__deleteDeco = async (id) => {
  if (!confirm('이 데코를 삭제하시겠습니까?')) return;
  try {
    await deleteDoc(doc(db, 'map_decorations', id));
    _decoMarkers.filter(d => d.id === id).forEach(d => d.marker?.setMap(null));
    _decoMarkers = _decoMarkers.filter(d => d.id !== id);
    infoWindow.close();
  } catch (e) { alert('삭제 실패: ' + e.message); }
};

// ── 몬스터 마커 ───────────────────────────────────────────────────────────────
function getMonsterIcon(image) {
  if (image && image.startsWith('/')) {
    return { url: image, scaledSize: new google.maps.Size(36,36), anchor: new google.maps.Point(18,18) };
  }
  const emoji = image || '🐉';
  const isEmoji = !image || image.length <= 4;
  if (isEmoji) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="17" fill="rgba(220,38,38,0.85)" stroke="#fff" stroke-width="2"/>
      <text x="18" y="24" font-size="18" text-anchor="middle">${emoji}</text></svg>`;
    return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
             scaledSize: new google.maps.Size(36,36), anchor: new google.maps.Point(18,18) };
  }
  return { url: `/assets/images/monsters/${image}`,
           scaledSize: new google.maps.Size(36,36), anchor: new google.maps.Point(18,18) };
}

function getTowerIcon(image, type) {
  if (image && image.startsWith('/')) {
    return { url: image, scaledSize: new google.maps.Size(38,38), anchor: new google.maps.Point(19,19) };
  }
  const isCannon = type === 'cannon';
  const emoji = image || (isCannon ? '💣' : '🏹');
  const fill  = isCannon ? 'rgba(180,60,0,0.88)' : 'rgba(124,58,237,0.88)';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 38 38">
    <circle cx="19" cy="19" r="18" fill="${fill}" stroke="#fff" stroke-width="2"/>
    <text x="19" y="26" font-size="20" text-anchor="middle">${emoji}</text></svg>`;
  return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
           scaledSize: new google.maps.Size(38,38), anchor: new google.maps.Point(19,19) };
}

function renderMonsterMarkers() {
  Object.values(_monsterMarkers).forEach(m => m.setMap(null));
  _monsterMarkers = {};
  for (const mob of _monsters) {
    if (!mob.lat || !mob.lng) continue;
    const marker = new google.maps.Marker({
      position: { lat: mob.lat, lng: mob.lng }, map,
      title: mob.name || '몬스터',
      icon: getMonsterIcon(mob.image),
      zIndex: 50,
    });
    marker.addListener('click', () => {
      // 사정거리 내 클릭 공격
      if (!_isDead && myLocationMarker && !_clickAtkCd[mob.id] && mob.hp > 0) {
        const myPos = myLocationMarker.getPosition();
        const dist  = haversine(myPos.lat(), myPos.lng(), mob.lat, mob.lng);
        if (dist <= (mob.detectRadius || 20)) {
          const roll   = Math.floor(Math.random() * 10) + 1; // 1~10
          const isCrit = roll >= 6;
          const dmg    = _player.level * roll;
          _clickAtkCd[mob.id] = true;
          setTimeout(() => { delete _clickAtkCd[mob.id]; }, 800);

          playSound(isCrit ? 'critical_hit' : 'arrow_hit');
          animateArrow(myPos.lat(), myPos.lng(), mob.lat, mob.lng,
            isCrit ? '#ff6600' : '#fbbf24', () => {
              hitMonster(mob.id, dmg);
              showFloat(isCrit ? `💥${dmg}` : `-${dmg}`,
                isCrit ? '#ff6600' : '#fbbf24', mob.lat, mob.lng);
              if (isCrit) showCriticalToast();
            });
          return; // infoWindow 열지 않음
        }
      }
      // 사정거리 밖 or 조건 미충족 → HP 정보창
      const hpPct = Math.round((mob.hp / mob.maxHp) * 100);
      infoWindow.setContent(`
        <div style="font-size:13px;min-width:140px">
          <b>${escHtml(mob.name||'몬스터')}</b>
          <div style="margin:6px 0 2px;font-size:11px;color:#888">HP ${mob.hp} / ${mob.maxHp}</div>
          <div style="height:8px;background:#eee;border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${hpPct}%;background:#ef4444;border-radius:4px"></div></div>
          ${_isAdmin ? `<button onclick="window.__deleteBattleObj('monster','${mob.id}')"
            style="margin-top:8px;padding:3px 8px;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px">🗑 삭제</button>` : ''}
        </div>`);
      infoWindow.open(map, marker);
    });
    _monsterMarkers[mob.id] = marker;
  }
}

function renderTowerMarkers() {
  Object.values(_towerMarkers).forEach(m => m.setMap(null));
  Object.values(_towerRanges).forEach(c => c.setMap(null));
  _towerMarkers = {}; _towerRanges = {};
  for (const tower of _towers) {
    if (!tower.lat || !tower.lng) continue;
    const marker = new google.maps.Marker({
      position: { lat: tower.lat, lng: tower.lng }, map,
      title: tower.name || '방어탑',
      icon: getTowerIcon(tower.image, tower.type), zIndex: 55,
    });
    marker.addListener('click', () => {
      infoWindow.setContent(`
        <div style="font-size:13px">
          <b>🏰 ${escHtml(tower.name||'방어탑')}</b>
          <div style="font-size:11px;color:#888;margin-top:4px">반경 ${tower.radius||30}m · 데미지 ${tower.atk||50}</div>
          ${_isAdmin ? `<button onclick="window.__deleteBattleObj('tower','${tower.id}')"
            style="margin-top:8px;padding:3px 8px;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px">🗑 삭제</button>` : ''}
        </div>`);
      infoWindow.open(map, marker);
    });
    _towerMarkers[tower.id] = marker;

    const circle = new google.maps.Circle({
      map: _showTowerRange ? map : null,
      center: { lat: tower.lat, lng: tower.lng },
      radius: tower.radius || 30,
      fillColor: '#7c3aed', fillOpacity: 0.08,
      strokeColor: '#7c3aed', strokeOpacity: 0.4, strokeWeight: 1,
    });
    _towerRanges[tower.id] = circle;
  }
}

// ── 배틀 루프 ─────────────────────────────────────────────────────────────────
function startBattleLoop() {
  if (_battleLoopId) return;
  _battleLoopId = setInterval(battleTick, 1000);
}

function battleTick() {
  checkMonsterAttacks();
  checkTowerAttacks();
  checkPlayerAutoAttack();
  checkGoldPickup();
  // 사망 후 50m 이동 시 자동 부활
  if (_isDead) {
    if (_reviveWalkDist >= 50) {
      _isDead = false;
      _reviveWalkDist = 0;
      _player.hp = Math.round(_player.maxHp * 0.3);
      _player.mp = Math.round(_player.maxMp * 0.2);
      playSound('revive');
      if (myLocationMarker) {
        const pos = myLocationMarker.getPosition();
        showFloat('✨ 부활!', '#fbbf24', pos.lat(), pos.lng());
      }
      updateCombatHud();
      savePlayerState();
    }
  }
}

// ── 몬스터 돌진 애니메이션 ────────────────────────────────────────────────────
function animateMonsterCharge(mob, myLat, myLng, onHit) {
  const marker = _monsterMarkers[mob.id];
  if (!marker) { onHit?.(); return; }

  const origLat = mob.lat, origLng = mob.lng;
  const midLat  = origLat + (myLat - origLat) * 0.62;
  const midLng  = origLng + (myLng - origLng) * 0.62;

  const CHARGE = 280, RETURN = 420;
  let chargeStart = null;

  function chargeStep(ts) {
    if (!chargeStart) chargeStart = ts;
    const p = Math.min((ts - chargeStart) / CHARGE, 1);
    const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
    marker.setPosition({ lat: origLat + (midLat - origLat) * e,
                         lng: origLng + (midLng - origLng) * e });
    if (p < 1) { requestAnimationFrame(chargeStep); return; }

    // 타격 이펙트 (플레이어 위치)
    const overlay = document.getElementById('battleOverlay');
    const ep = overlay && latLngToPixel(myLat, myLng);
    if (ep) {
      const hit = document.createElement('div');
      hit.className = 'hit-flash';
      hit.style.cssText = `left:${ep.x}px;top:${ep.y}px;background:radial-gradient(circle,#ef4444,transparent)`;
      overlay.appendChild(hit);
      setTimeout(() => hit.remove(), 320);
    }
    onHit?.();

    // 복귀
    let retStart = null;
    function returnStep(ts2) {
      if (!retStart) retStart = ts2;
      const p2 = Math.min((ts2 - retStart) / RETURN, 1);
      const e2 = p2 < 0.5 ? 2*p2*p2 : 1 - Math.pow(-2*p2+2, 2)/2; // ease-in-out
      marker.setPosition({ lat: midLat + (origLat - midLat) * e2,
                           lng: midLng + (origLng - midLng) * e2 });
      if (p2 < 1) requestAnimationFrame(returnStep);
    }
    requestAnimationFrame(returnStep);
  }
  requestAnimationFrame(chargeStep);
}

function checkMonsterAttacks() {
  if (_isDead || !myLocationMarker) return;
  const myPos = myLocationMarker.getPosition();
  const myLat = myPos.lat(), myLng = myPos.lng();
  for (const mob of _monsters) {
    if (!mob.lat || !mob.lng || mob.hp <= 0) continue;
    if (_monsterCd[mob.id]) continue;
    const dist = haversine(myLat, myLng, mob.lat, mob.lng);
    if (dist <= (mob.detectRadius || 20)) {
      playSound('monster_atk');
      animateMonsterCharge(mob, myLat, myLng, () => {
        takeDamage(mob.atk || 10, myLat, myLng);
      });
      _monsterCd[mob.id] = true;
      setTimeout(() => { delete _monsterCd[mob.id]; }, 2500);
    }
  }
}

function checkTowerAttacks() {
  if (_isDead || !myLocationMarker) return;
  const myPos = myLocationMarker.getPosition();
  const myLat = myPos.lat(), myLng = myPos.lng();
  for (const tower of _towers) {
    if (!tower.lat || !tower.lng) continue;
    if (_towerCd[tower.id]) continue;
    const dist = haversine(myLat, myLng, tower.lat, tower.lng);
    if (dist <= (tower.radius || 30)) {
      const isCannon = tower.type === 'cannon';
      if (isCannon) {
        playSound('cannon_shot');
        animateCannonShot(tower.lat, tower.lng, myLat, myLng, () => {
          playSound('cannon_hit');
          takeDamage(tower.atk || 80, myLat, myLng);
        });
      } else {
        playSound('tower_shot');
        animateTowerShot(tower.lat, tower.lng, myLat, myLng, () => {
          takeDamage(tower.atk || 20, myLat, myLng);
        });
      }
      _towerCd[tower.id] = true;
      setTimeout(() => { delete _towerCd[tower.id]; }, isCannon ? 4000 : 2000);
    }
  }
}

function checkPlayerAutoAttack() {
  if (_isDead || !myLocationMarker || _attackCd) return;
  if (_currentSpeed < 0.3) return; // 정지 상태면 자동공격 없음
  const myPos = myLocationMarker.getPosition();
  const myLat = myPos.lat(), myLng = myPos.lng();

  // 전방 25m 이내 + 진행 방향 ±45° 범위 몬스터 탐지
  let target = null, minDist = Infinity;
  for (const mob of _monsters) {
    if (!mob.lat || !mob.lng || mob.hp <= 0) continue;
    const dist = haversine(myLat, myLng, mob.lat, mob.lng);
    if (dist > 25) continue;
    // heading이 있으면 방향 판정
    if (_lastHeading != null) {
      const bearing = calcBearing(myLat, myLng, mob.lat, mob.lng);
      const diff = Math.abs(((bearing - _lastHeading) + 540) % 360 - 180);
      if (diff > 60) continue; // 전방 120° 범위
    }
    if (dist < minDist) { minDist = dist; target = mob; }
  }

  if (!target) return;
  _attackCd = true;
  setTimeout(() => { _attackCd = false; }, 1500);

  playSound('arrow_shot');
  animateArrow(myLat, myLng, target.lat, target.lng, '#fbbf24', () => {
    playSound('arrow_hit');
    hitMonster(target.id, 5);
  });
}

function calcBearing(lat1, lng1, lat2, lng2) {
  const toRad = d => d * Math.PI / 180;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
          - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

async function hitMonster(monsterId, damage) {
  const mob = _monsters.find(m => m.id === monsterId);
  if (!mob || mob.hp <= 0) return;
  mob.hp = Math.max(0, mob.hp - damage);

  // Firestore 업데이트
  try {
    await setDoc(doc(db, 'battle_monsters', monsterId), { hp: mob.hp }, { merge: true });
  } catch { /* 무시 */ }

  // 마커 infoWindow 갱신 (열려 있을 때)
  const marker = _monsterMarkers[monsterId];
  if (marker) marker.setTitle(`${mob.name||'몬스터'} HP:${mob.hp}`);

  if (mob.hp <= 0) {
    playSound('monster_die');
    showFloat('💀 처치!', '#fbbf24', mob.lat, mob.lng);
    gainXp(mob.dropExp || 20);
    dropGoldTokens(mob);

    // 드랍 아이템 (treasure_inventory에 추가) — 옵션
    if (mob.dropItems?.length && _uid) {
      const drop = mob.dropItems[Math.floor(Math.random() * mob.dropItems.length)];
      if (drop?.itemId) {
        try {
          const invRef = doc(db, 'treasure_inventory', `${_uid}_${drop.itemId}`);
          const invSnap = await getDoc(invRef);
          const cur = invSnap.exists() ? (invSnap.data().count || 0) : 0;
          await setDoc(invRef, { uid: _uid, itemId: String(drop.itemId), count: cur + 1,
            updatedAt: serverTimestamp() }, { merge: true });
          showFloat(`📦 ${drop.itemId}`, '#86efac', mob.lat, mob.lng);
        } catch { /* 무시 */ }
      }
    }

    // 리스폰 (기본 60초)
    const respawnMs = (mob.respawnMinutes || 1) * 60000;
    if (_monsterMarkers[monsterId]) {
      _monsterMarkers[monsterId].setMap(null);
      delete _monsterMarkers[monsterId];
    }
    setTimeout(async () => {
      // Firestore에서 maxHp로 복구
      try {
        await setDoc(doc(db, 'battle_monsters', monsterId),
          { hp: mob.maxHp, active: true }, { merge: true });
        mob.hp = mob.maxHp;
        if (window.google?.maps) {
          const m = new google.maps.Marker({
            position: { lat: mob.lat, lng: mob.lng }, map,
            title: mob.name, icon: getMonsterIcon(mob.image), zIndex: 50,
          });
          _monsterMarkers[monsterId] = m;
        }
      } catch { /* 무시 */ }
    }, respawnMs);
  }
}

// ── 관리자 배치 모드 ──────────────────────────────────────────────────────────
function enterAdminPlaceMode(type) {
  _adminPlaceMode = type;
  document.getElementById('btnPlaceMonster')?.classList.toggle('placing', type === 'monster');
  document.getElementById('btnPlaceArcherTower')?.classList.toggle('placing', type === 'archer_tower');
  document.getElementById('btnPlaceCannonTower')?.classList.toggle('placing', type === 'cannon_tower');
  document.getElementById('btnPlaceDeco')?.classList.toggle('placing', type === 'deco');
  document.getElementById('btnCancelPlace').style.display = '';
  if (map) map.setOptions({ draggableCursor: 'crosshair' });

  _adminMapListener = map.addListener('click', async (e) => {
    const lat = e.latLng.lat(), lng = e.latLng.lng();
    if (_adminPlaceMode === 'monster') {
      const name   = prompt('몬스터 이름:', '슬라임') || '슬라임';
      const maxHp  = parseInt(prompt('최대 HP:', '30') || '30');
      const atk    = parseInt(prompt('공격력:', '5') || '5');
      const radius = parseInt(prompt('탐지 반경(m):', '20') || '20');
      const image  = prompt('이미지 (이모지 or 경로, 예: /assets/images/monsters/10.png)', '🐉') || '🐉';
      try {
        const ref = await addDoc(collection(db, 'battle_monsters'), {
          name, lat, lng, hp: maxHp, maxHp, atk,
          detectRadius: radius, image, active: true,
          dropExp: 20, respawnMinutes: 1,
          createdAt: serverTimestamp(),
        });
        _monsters.push({ id: ref.id, name, lat, lng, hp: maxHp, maxHp, atk,
          detectRadius: radius, image, active: true, dropExp: 20, respawnMinutes: 1 });
        renderMonsterMarkers();
        alert(`✅ 몬스터 "${name}" 배치 완료`);
      } catch (err) { alert('오류: ' + err.message); }

    } else if (_adminPlaceMode === 'archer_tower' || _adminPlaceMode === 'cannon_tower') {
      const towerType = _adminPlaceMode === 'cannon_tower' ? 'cannon' : 'archer';
      const defName   = towerType === 'cannon' ? '대포 타워' : '아처 타워';
      const defAtk    = towerType === 'cannon' ? '80' : '20';
      const defRadius = towerType === 'cannon' ? '20' : '30';
      const defEmoji  = towerType === 'cannon' ? '💣' : '🏹';
      const name   = prompt('타워 이름:', defName) || defName;
      const atk    = parseInt(prompt('데미지:', defAtk) || defAtk);
      const radius = parseInt(prompt('공격 반경(m):', defRadius) || defRadius);
      const image  = prompt('이미지 (이모지 or 경로, 예: /assets/images/shops/arms.png)', defEmoji) || defEmoji;
      try {
        const ref = await addDoc(collection(db, 'battle_towers'), {
          name, lat, lng, atk, radius, image, type: towerType, active: true,
          createdAt: serverTimestamp(),
        });
        _towers.push({ id: ref.id, name, lat, lng, atk, radius, image, type: towerType, active: true });
        renderTowerMarkers();
        alert(`✅ ${name} 설치 완료`);
      } catch (err) { alert('오류: ' + err.message); }

    } else if (_adminPlaceMode === 'deco') {
      const name     = prompt('데코 이름:', '해적선') || '해적선';
      const imageUrl = prompt('이미지 경로 (예: /assets/images/monsters/10.png):', '') || '';
      if (!imageUrl) { exitAdminPlaceMode(); return; }
      const size = parseInt(prompt('크기 (픽셀, 기본 48):', '48') || '48');
      try {
        const ref = await addDoc(collection(db, 'map_decorations'), {
          name, lat, lng, imageUrl, size, active: true,
          createdAt: serverTimestamp(),
        });
        const newDeco = { id: ref.id, name, lat, lng, imageUrl, size, active: true };
        _decoMarkers.push(newDeco);
        renderDecoMarkers();
        alert(`✅ 데코 "${name}" 배치 완료`);
      } catch (err) { alert('오류: ' + err.message); }
    }
    exitAdminPlaceMode();
  });
}

function exitAdminPlaceMode() {
  _adminPlaceMode = null;
  if (_adminMapListener) { google.maps.event.removeListener(_adminMapListener); _adminMapListener = null; }
  if (map) map.setOptions({ draggableCursor: null });
  document.getElementById('btnPlaceMonster')?.classList.remove('placing');
  document.getElementById('btnPlaceArcherTower')?.classList.remove('placing');
  document.getElementById('btnPlaceCannonTower')?.classList.remove('placing');
  document.getElementById('btnPlaceDeco')?.classList.remove('placing');
  document.getElementById('btnCancelPlace').style.display = 'none';
}

window.__deleteBattleObj = async (type, id) => {
  if (!confirm('삭제하시겠습니까?')) return;
  try {
    await deleteDoc(doc(db, type === 'monster' ? 'battle_monsters' : 'battle_towers', id));
    if (type === 'monster') {
      _monsters = _monsters.filter(m => m.id !== id);
      if (_monsterMarkers[id]) { _monsterMarkers[id].setMap(null); delete _monsterMarkers[id]; }
    } else {
      _towers = _towers.filter(t => t.id !== id);
      if (_towerMarkers[id])  { _towerMarkers[id].setMap(null);  delete _towerMarkers[id]; }
      if (_towerRanges[id])   { _towerRanges[id].setMap(null);   delete _towerRanges[id]; }
    }
    infoWindow.close();
  } catch (err) { alert('삭제 실패: ' + err.message); }
};

// ── 방어탑 범위 토글 ──────────────────────────────────────────────────────────
function toggleTowerRanges() {
  _showTowerRange = !_showTowerRange;
  Object.values(_towerRanges).forEach(circle => {
    circle.setMap(_showTowerRange ? map : null);
  });
  document.getElementById('btnToggleTowerRange').textContent =
    _showTowerRange ? '🙈 범위 숨기기' : '👁 범위 표시';
}

init();
