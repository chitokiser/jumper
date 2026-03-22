// assets/js/pages/buggy.js
// 버기카 호출 서비스 — 사용자 앱

import { getApps, initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getFirestore, doc, onSnapshot, collection, query, where, limit, getDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { getFunctions, httpsCallable }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { firebaseConfig } from '/assets/js/firebase-config.js';
import { watchAuth }      from '/assets/js/auth.js';

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db  = getFirestore(app);
const fns = getFunctions(app);

const fnRequest     = httpsCallable(fns, 'buggyRequestRide');
const fnCancel      = httpsCallable(fns, 'buggyCancelRide');
const fnGetConfig   = httpsCallable(fns, 'buggyGetConfig');
const fnGetOnChain  = httpsCallable(fns, 'getMyOnChain');

// ── 상태 ────────────────────────────────────────────────────────────────────
let _user     = null;
let _config   = { baseFare: 50000, intervalMinutes: 10, intervalFare: 50000 };
let _rideId   = null;
let _rideSub  = null;         // onSnapshot 해제 함수
let _timerInt = null;
let _map           = null;
let _marker        = null;
let _mapAccepted   = null;
let _mapRiding     = null;
let _driverMarkerA = null;
let _driverMarkerR = null;
let _pickupMarkerA = null;   // 수락됨 지도의 탑승위치 마커
let _driverLocSub  = null;
let _lastRide      = null;   // Maps 로드 전 도착한 라이드 데이터 캐시

let _pickupLat = null;
let _pickupLng = null;
let _destLat   = null;
let _destLng   = null;
let _destMarker   = null;
let _myLocMarker   = null;   // 파란 GPS 내 위치 점
let _dirService    = null;   // DirectionsService
let _dirRendererA  = null;   // DirectionsRenderer (accepted — 기사→탑승위치)
let _dirRendererR  = null;   // DirectionsRenderer (riding  — 기사→목적지)
let _dirRendererA2 = null;   // 탑승위치→목적지 미리보기 (accepted)
let _dirRendererR2 = null;   // 탑승위치→목적지 정적선 (riding)

// ── DOM ─────────────────────────────────────────────────────────────────────
const balAmount   = document.getElementById('balAmount');
const pickupAddrText = document.getElementById('pickupAddrText');
const destInput   = document.getElementById('destInput');
const btnRequest  = document.getElementById('btnRequest');
const btnCancelSearch    = document.getElementById('btnCancelSearch');
const btnCancelAccepted  = document.getElementById('btnCancelAccepted');
const btnNewRide  = document.getElementById('btnNewRide');
const rideTimer   = document.getElementById('rideTimer');
const farePrev    = document.getElementById('farePrev');
const toastEl     = document.getElementById('buggyToast');

// ── 유틸 ────────────────────────────────────────────────────────────────────
function toast(msg, ms = 3000) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), ms);
}

function fmtVnd(n) { return `₫${Number(n || 0).toLocaleString()}`; }

function showSection(id) {
  document.querySelectorAll('.buggy-section').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');

  // map layer management
  const mMain = document.getElementById('buggyMap');
  const mAcc  = document.getElementById('buggyMapAccepted');
  const mRide = document.getElementById('buggyMapRiding');
  if (mMain) mMain.style.display = (id === 'secAccepted' || id === 'secRiding') ? 'none' : '';
  if (mAcc)  mAcc.style.display  = (id === 'secAccepted') ? '' : 'none';
  if (mRide) mRide.style.display = (id === 'secRiding')   ? '' : 'none';

  // Google Maps must be resized after display:none → visible transition
  setTimeout(() => {
    if (!window.google?.maps) return;
    if (id === 'secAccepted' && _mapAccepted) google.maps.event.trigger(_mapAccepted, 'resize');
    if (id === 'secRiding'   && _mapRiding)   google.maps.event.trigger(_mapRiding,   'resize');
    if (id !== 'secAccepted' && id !== 'secRiding' && _map) google.maps.event.trigger(_map, 'resize');
  }, 60);
}

function calcFareLive(startMs) {
  const minutes   = Math.max(0, (Date.now() - startMs) / 60000);
  const intervals = Math.max(1, Math.ceil(minutes / _config.intervalMinutes));
  return intervals * _config.intervalFare;
}

function startTimer(startMs) {
  clearInterval(_timerInt);
  _timerInt = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startMs) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    rideTimer.textContent = `${m}:${s}`;
    farePrev.textContent  = fmtVnd(calcFareLive(startMs));
  }, 1000);
}

// ── Nominatim (OpenStreetMap) 지오코딩 — API키 불필요 ───────────────────
const NOMINATIM = 'https://nominatim.openstreetmap.org';

async function nominatimReverse(lat, lng) {
  try {
    const res  = await fetch(
      `${NOMINATIM}/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ko,vi,en`,
      { headers: { 'User-Agent': 'BuggyApp/1.0' } }
    );
    const data = await res.json();
    if (data?.display_name) {
      // 짧게 표시: road, suburb, city 순서
      const a = data.address || {};
      const parts = [a.road || a.amenity, a.suburb || a.neighbourhood, a.city || a.town || a.county].filter(Boolean);
      return parts.length ? parts.join(', ') : data.display_name;
    }
  } catch (_) {}
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

async function nominatimSearch(query) {
  try {
    const url = `${NOMINATIM}/search?` + new URLSearchParams({
      q: query, format: 'json', limit: '6',
      'accept-language': 'ko,vi,en', countrycodes: 'vn',
    });
    const res  = await fetch(url, { headers: { 'User-Agent': 'BuggyApp/1.0' } });
    return await res.json();
  } catch (_) { return []; }
}

// ── Google Maps 초기화 ────────────────────────────────────────────────────
function initMap() {
  if (!window.google?.maps) return;
  const defaultPos = { lat: 10.8231, lng: 106.6297 };
  _map = new google.maps.Map(document.getElementById('buggyMap'), {
    center: defaultPos, zoom: 15,
    disableDefaultUI: true,
    gestureHandling: 'greedy',
  });
  _marker = new google.maps.Marker({ map: _map, draggable: true, title: '탑승 위치',
    icon: { url: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png' },
  });
  _dirService = new google.maps.DirectionsService();

  _map.addListener('click', (e) => setPickup(e.latLng.lat(), e.latLng.lng()));
  _marker.addListener('dragend', (e) => setPickup(e.latLng.lat(), e.latLng.lng()));

  initDestSearch();
  document.getElementById('btnMyLocation').addEventListener('click', () => goToMyLocation(false));

  // 지도 완전 렌더링 보장
  setTimeout(() => google.maps.event.trigger(_map, 'resize'), 200);

  // 내 위치 파란점 — 실시간 감시
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        _map.setCenter(ll); _map.setZoom(16);
        setPickup(ll.lat, ll.lng);
        updateMyLocMarker(ll.lat, ll.lng);
      },
      () => {}
    );
    navigator.geolocation.watchPosition(
      (pos) => updateMyLocMarker(pos.coords.latitude, pos.coords.longitude),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
  }
}

// 파란 GPS 점 생성/이동 (내 위치)
function updateMyLocMarker(lat, lng) {
  if (!window.google?.maps || !_map) return;
  if (!_myLocMarker) {
    _myLocMarker = new google.maps.Marker({
      map: _map,
      position: { lat, lng },
      title: '내 위치',
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 9,
        fillColor: '#4285F4',
        fillOpacity: 1,
        strokeColor: '#fff',
        strokeWeight: 2.5,
      },
      zIndex: 10,
    });
  } else {
    _myLocMarker.setPosition({ lat, lng });
  }
}

function goToMyLocation(silent) {
  if (!navigator.geolocation) { if (!silent) toast('위치 서비스를 지원하지 않는 브라우저입니다'); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const ll = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      _map.setCenter(ll);
      _map.setZoom(17);
      setPickup(ll.lat, ll.lng);
      updateMyLocMarker(ll.lat, ll.lng);
    },
    () => { if (!silent) toast('현재 위치를 가져올 수 없습니다'); }
  );
}

// ── 도착지 검색 (Nominatim, 무료) ───────────────────────────────────────
function initDestSearch() {
  const input      = document.getElementById('destInput');
  const suggestBox = document.getElementById('destSuggestions');
  let _debounce    = null;

  input.addEventListener('input', () => {
    clearTimeout(_debounce);
    const val = input.value.trim();
    if (!val) { suggestBox.style.display = 'none'; return; }
    _debounce = setTimeout(async () => {
      const results = await nominatimSearch(val);
      suggestBox.innerHTML = '';
      if (!results.length) { suggestBox.style.display = 'none'; return; }
      results.forEach((r) => {
        const item = document.createElement('div');
        item.style.cssText = 'padding:10px 14px;cursor:pointer;font-size:0.88rem;border-bottom:1px solid #f3f4f6;line-height:1.4;';
        // 짧은 이름 표시
        const a = r.address || {};
        const name = r.namedetails?.name || r.name || '';
        const sub  = [a.road || a.amenity, a.suburb, a.city || a.town].filter(Boolean).join(', ');
        item.innerHTML = `<div style="font-weight:600;color:#111;">${name || r.display_name.split(',')[0]}</div>`
                       + `<div style="font-size:0.78rem;color:#9ca3af;">${sub || r.display_name}</div>`;
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          const displayName = name || r.display_name.split(',')[0];
          input.value = displayName;
          suggestBox.style.display = 'none';
          setDest(parseFloat(r.lat), parseFloat(r.lon), displayName);
        });
        suggestBox.appendChild(item);
      });
      suggestBox.style.display = 'block';
    }, 350);
  });

  input.addEventListener('blur', () => setTimeout(() => { suggestBox.style.display = 'none'; }, 150));
}

function setDest(lat, lng, address) {
  _destLat = lat;
  _destLng = lng;

  // 도착지 마커
  if (!_destMarker) {
    _destMarker = new google.maps.Marker({
      map: _map, title: '도착지',
      icon: { url: 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png' },
    });
  }
  _destMarker.setPosition({ lat, lng });

  // UI 업데이트
  document.getElementById('destAddrText').textContent = address;
  document.getElementById('destBox').style.display    = 'flex';
  const clearBtn = document.getElementById('btnClearDest');
  if (clearBtn) clearBtn.style.display = 'block';

  // 탑승/도착 둘 다 보이도록 지도 fit
  if (_pickupLat && _pickupLng) {
    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat: _pickupLat, lng: _pickupLng });
    bounds.extend({ lat, lng });
    _map.fitBounds(bounds, { top: 40, bottom: 40, left: 20, right: 20 });
  }
}

function clearDest() {
  _destLat = null;
  _destLng = null;
  if (_destMarker) { _destMarker.setMap(null); _destMarker = null; }
  document.getElementById('destInput').value          = '';
  document.getElementById('destBox').style.display    = 'none';
  document.getElementById('destAddrText').textContent = '-';
  const clearBtn = document.getElementById('btnClearDest');
  if (clearBtn) clearBtn.style.display = 'none';
}

async function setPickup(lat, lng) {
  _pickupLat = lat;
  _pickupLng = lng;
  _marker.setPosition({ lat, lng });
  _map.panTo({ lat, lng });
  btnRequest.disabled = !_user;

  // Nominatim 역지오코딩 (Google Geocoding API 불필요)
  pickupAddrText.textContent = '위치 확인 중...';
  nominatimReverse(lat, lng).then(addr => {
    pickupAddrText.textContent = addr;
  });
}

// ── Google Maps 로드 ─────────────────────────────────────────────────────
function loadMaps() {
  if (window.google?.maps) { onMapsLoaded(); return; }
  const key = window.__mapsKey || '';
  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${key}`;
  s.onload = onMapsLoaded;
  document.head.appendChild(s);
}

function onMapsLoaded() {
  initMap();
  // Maps 로드 전에 라이드 상태가 이미 도착한 경우 지도 재초기화
  if (_lastRide) {
    const r = _lastRide;
    if ((r.status === 'accepted' || r.status === 'arriving') && r.pickupLat) {
      ensureAcceptedMap(r.pickupLat, r.pickupLng, r);
    }
    if (r.status === 'riding' && r.pickupLat) {
      ensureRidingMap(r.pickupLat, r.pickupLng);
    }
  }
}

// ── 사용자 HEX 잔액 로드 ─────────────────────────────────────────────────
async function loadBalance() {
  if (!_user) return;
  const balBox = document.getElementById('balanceBox');
  try {
    const res = await fnGetOnChain();
    const d   = res.data;
    let shortText = '...';
    if (d?.walletHexWei && BigInt(d.walletHexWei) > 0n) {
      const parts = [];
      if (d.walletHexKrw != null) parts.push(Number(d.walletHexKrw).toLocaleString() + '원');
      if (d.walletHexUsd != null) parts.push('$' + Number(d.walletHexUsd).toFixed(2));
      if (d.walletHexVnd != null) parts.push(Number(d.walletHexVnd).toLocaleString() + ' VND');
      const fullText = parts.length ? parts.join(' / ') : (d.walletHexDisplay || '0 HEX');
      if (balAmount) { balAmount.textContent = fullText; balAmount.style.fontSize = '0.78rem'; }
      shortText = d.walletHexVnd != null
        ? Number(d.walletHexVnd).toLocaleString() + ' VND'
        : (parts[0] || '0 HEX');
    } else {
      if (balAmount) balAmount.textContent = '0 HEX';
      shortText = '0 HEX';
    }
    const tbBal = document.getElementById('topBarBalance');
    if (tbBal) tbBal.textContent = shortText;
    const lbl = document.querySelector('.bal-label');
    if (lbl) lbl.textContent = '보유 HEX';
  } catch (_) {
    const snap   = await getDoc(doc(db, 'users', _user.uid));
    const wallet = snap.data()?.wallet;
    const tbBal  = document.getElementById('topBarBalance');
    if (wallet?.address) {
      const short = `${wallet.address.slice(0,6)}...${wallet.address.slice(-4)}`;
      if (balAmount) balAmount.textContent = short;
      if (tbBal) tbBal.textContent = '지갑 연동됨';
      const lbl = document.querySelector('.bal-label');
      if (lbl) lbl.textContent = 'HEX 지갑 연동됨';
    } else {
      if (balAmount) balAmount.textContent = '지갑 없음';
      if (tbBal) tbBal.textContent = '지갑 없음';
      const lbl = document.querySelector('.bal-label');
      if (lbl) lbl.textContent = '수탁 지갑 필요';
      if (balBox) balBox.style.borderColor = '#dc2626';
    }
  }
}

// ── 진행 중 라이드 복구 ──────────────────────────────────────────────────
async function checkActiveRide() {
  if (!_user) return;
  const q = query(
    collection(db, 'buggy_rides'),
    where('userId', '==', _user.uid),
    where('status', 'in', ['searching', 'accepted', 'arriving', 'riding']),
    limit(1)
  );
  const snap = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js')
    .then(({ getDocs }) => getDocs(q));
  if (!snap.empty) {
    const rideDoc = snap.docs[0];
    _rideId = rideDoc.id;
    subscribeRide(_rideId);
  }
}

// ── 라이드 구독 ──────────────────────────────────────────────────────────
function subscribeRide(rideId) {
  if (_rideSub) _rideSub();
  _rideSub = onSnapshot(doc(db, 'buggy_rides', rideId), (snap) => {
    if (!snap.exists()) return;
    handleRideUpdate(snap.data());
  });
}

function handleRideUpdate(ride) {
  _lastRide = ride; // Maps 로드 전 도착 시 onMapsLoaded에서 재초기화용

  switch (ride.status) {
    case 'searching':
      showSection('secSearching');
      break;

    case 'accepted':
    case 'arriving':
      showSection('secAccepted');
      document.getElementById('drvName').textContent  = ride.driverName  || '기사';
      document.getElementById('drvPlate').textContent = ride.vehicleNumber || '-';
      document.getElementById('accPickupAddr').textContent = ride.pickupAddress || '-';
      document.getElementById('rideStatusBadge').textContent =
        ride.status === 'arriving' ? '🚗 도착 중' : '✅ 수락됨';
      document.getElementById('rideStatusBadge').className =
        `buggy-badge buggy-badge--${ride.status}`;
      if (ride.pickupLat) ensureAcceptedMap(ride.pickupLat, ride.pickupLng, ride);
      subscribeDriverLocation(ride.driverId);
      break;

    case 'riding':
      showSection('secRiding');
      document.getElementById('ridingDrvName').textContent  = ride.driverName  || '기사';
      document.getElementById('ridingDrvPlate').textContent = ride.vehicleNumber || '-';
      if (ride.startedAt) startTimer(ride.startedAt.toMillis());
      if (ride.pickupLat) ensureRidingMap(ride.pickupLat, ride.pickupLng);
      subscribeDriverLocation(ride.driverId);
      break;

    case 'completed':
    case 'payment_failed': {
      clearInterval(_timerInt);
      if (_driverLocSub) { _driverLocSub(); _driverLocSub = null; }
      if (_rideSub)      { _rideSub();       _rideSub = null; }
      _rideId = null;

      document.getElementById('doneMinutes').textContent =
        `${ride.durationMinutes || 0}분`;
      document.getElementById('doneFare').textContent =
        fmtVnd(ride.feeVnd || 0);
      const ps = document.getElementById('donePayStatus');
      if (ride.paymentStatus === 'paid') {
        ps.textContent = '✅ 결제 완료';
        ps.style.color = '#16a34a';
      } else {
        ps.textContent = '❌ 결제 실패 — 잔액 부족';
        ps.style.color = '#dc2626';
      }
      showSection('secDone');
      loadBalance();
      break;
    }

    case 'cancelled_by_user':
    case 'cancelled_by_driver':
    case 'failed':
      clearInterval(_timerInt);
      if (_driverLocSub) { _driverLocSub(); _driverLocSub = null; }
      if (_rideSub)      { _rideSub();       _rideSub = null; }
      _rideId = null;
      toast('호출이 취소되었습니다');
      showSection('secIdle');
      break;
  }
}

// ── 기사 실시간 위치 ─────────────────────────────────────────────────────
const CAB_ICON_URL    = 'https://maps.google.com/mapfiles/ms/icons/cabs/cab.png';
const PICKUP_ICON_URL = 'https://maps.google.com/mapfiles/ms/icons/red-dot.png';

// Haversine 직선 거리 (m)
function haversineDist(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function fmtDist(m) {
  return m < 1000 ? `${Math.round(m)}m` : `${(m/1000).toFixed(1)}km`;
}

let _lastDirReqA = 0; // throttle DirectionsService calls
let _lastDirReqR = 0;

function makeCabMarker(map, pos) {
  return new google.maps.Marker({
    position: pos, map, title: '기사',
    icon: { url: CAB_ICON_URL, scaledSize: new google.maps.Size(40, 40) },
  });
}

function placeOrMoveMarker(markerRef, map, pos) {
  if (!markerRef) return makeCabMarker(map, pos);
  markerRef.setPosition(pos);
  return markerRef;
}

// 경로선 + 거리: DirectionsService (throttled to 1 req/8s)
function drawRoute(map, dirRenderer, origin, destination, distElId, icon, now, lastRef) {
  if (!_dirService || !dirRenderer || !map) return now; // unchanged
  const distEl = document.getElementById(distElId);
  const straightM = haversineDist(origin.lat, origin.lng, destination.lat, destination.lng);
  if (distEl) {
    const label = icon === '🚗' ? `기사까지 약 ${fmtDist(straightM)}` : `목적지까지 약 ${fmtDist(straightM)}`;
    distEl.textContent = label;
    distEl.closest('.route-eta') && (distEl.closest('.route-eta').style.display = 'flex');
  }
  if (Date.now() - lastRef < 8000) return lastRef; // throttle
  _dirService.route({
    origin, destination,
    travelMode: google.maps.TravelMode.DRIVING,
  }, (result, status) => {
    if (status === 'OK') {
      dirRenderer.setDirections(result);
      const leg = result.routes[0]?.legs[0];
      if (distEl && leg) {
        const label = icon === '🚗'
          ? `기사까지 ${leg.distance.text} (약 ${leg.duration.text})`
          : `목적지까지 ${leg.distance.text}`;
        distEl.textContent = label;
      }
    }
  });
  return Date.now();
}

function subscribeDriverLocation(driverId) {
  if (!driverId) return;
  if (_driverLocSub) _driverLocSub();
  _driverLocSub = onSnapshot(
    doc(db, 'buggy_driver_locations', driverId),
    (snap) => {
      if (!snap.exists() || !window.google?.maps) return;
      const { lat, lng } = snap.data();
      const driverPos = { lat, lng };

      // 수락됨/도착 중 지도
      if (_mapAccepted) {
        _driverMarkerA = placeOrMoveMarker(_driverMarkerA, _mapAccepted, driverPos);
        _mapAccepted.panTo(driverPos);
        if (_lastRide?.pickupLat) {
          const pickupPos = { lat: _lastRide.pickupLat, lng: _lastRide.pickupLng };
          _lastDirReqA = drawRoute(_mapAccepted, _dirRendererA, driverPos, pickupPos,
            'drvDistText', '🚗', Date.now(), _lastDirReqA);
        }
      }

      // 탑승 중 지도
      if (_mapRiding) {
        _driverMarkerR = placeOrMoveMarker(_driverMarkerR, _mapRiding, driverPos);
        _mapRiding.panTo(driverPos);
        const destLat = _lastRide?.destLat || _destLat;
        const destLng = _lastRide?.destLng || _destLng;
        if (destLat && destLng) {
          const destPos = { lat: destLat, lng: destLng };
          const etaEl = document.getElementById('etaRiding');
          if (etaEl) etaEl.style.display = 'flex';
          _lastDirReqR = drawRoute(_mapRiding, _dirRendererR, driverPos, destPos,
            'ridingDistText', '📍', Date.now(), _lastDirReqR);
        }
      }
    }
  );
}

function ensureAcceptedMap(lat, lng, ride) {
  if (!window.google?.maps) return;
  if (!_mapAccepted) {
    _mapAccepted = new google.maps.Map(document.getElementById('buggyMapAccepted'), {
      center: { lat, lng }, zoom: 15,
      disableDefaultUI: true, gestureHandling: 'greedy',
    });
    _dirRendererA = new google.maps.DirectionsRenderer({
      suppressMarkers: false,
      polylineOptions: { strokeColor: '#2563eb', strokeWeight: 5, strokeOpacity: 0.85 },
    });
    _dirRendererA.setMap(_mapAccepted);
    setTimeout(() => google.maps.event.trigger(_mapAccepted, 'resize'), 80);
  }
  if (!_pickupMarkerA && ride?.pickupLat) {
    _pickupMarkerA = new google.maps.Marker({
      position: { lat: ride.pickupLat, lng: ride.pickupLng },
      map: _mapAccepted, title: '탑승 위치',
      icon: { url: PICKUP_ICON_URL },
    });
  }
  // 탑승위치→목적지 미리보기선 (연한 파란선)
  const dLat = _destLat || ride?.destLat;
  const dLng = _destLng || ride?.destLng;
  if (!_dirRendererA2 && dLat && dLng && _pickupLat && _pickupLng && _dirService) {
    _dirRendererA2 = new google.maps.DirectionsRenderer({
      suppressMarkers: true,
      polylineOptions: { strokeColor: '#93c5fd', strokeWeight: 4, strokeOpacity: 0.55 },
    });
    _dirRendererA2.setMap(_mapAccepted);
    _dirService.route({
      origin:      { lat: _pickupLat, lng: _pickupLng },
      destination: { lat: dLat, lng: dLng },
      travelMode:  google.maps.TravelMode.DRIVING,
    }, (result, status) => {
      if (status === 'OK' && _dirRendererA2) _dirRendererA2.setDirections(result);
    });
  }
}

function ensureRidingMap(lat, lng) {
  if (_mapRiding || !window.google?.maps) return;
  _mapRiding = new google.maps.Map(document.getElementById('buggyMapRiding'), {
    center: { lat, lng }, zoom: 15,
    disableDefaultUI: true, gestureHandling: 'greedy',
  });
  _dirRendererR = new google.maps.DirectionsRenderer({
    suppressMarkers: false,
    polylineOptions: { strokeColor: '#2563eb', strokeWeight: 5, strokeOpacity: 0.85 },
  });
  _dirRendererR.setMap(_mapRiding);
  // 탑승위치→목적지 정적선 (연한 파란선)
  const dLat = _destLat || _lastRide?.destLat;
  const dLng = _destLng || _lastRide?.destLng;
  if (dLat && dLng && _pickupLat && _pickupLng && _dirService) {
    _dirRendererR2 = new google.maps.DirectionsRenderer({
      suppressMarkers: true,
      polylineOptions: { strokeColor: '#bfdbfe', strokeWeight: 4, strokeOpacity: 0.5 },
    });
    _dirRendererR2.setMap(_mapRiding);
    _dirService.route({
      origin:      { lat: _pickupLat, lng: _pickupLng },
      destination: { lat: dLat, lng: dLng },
      travelMode:  google.maps.TravelMode.DRIVING,
    }, (result, status) => {
      if (status === 'OK' && _dirRendererR2) _dirRendererR2.setDirections(result);
    });
  }
  setTimeout(() => google.maps.event.trigger(_mapRiding, 'resize'), 80);
}

// ── 이벤트 ──────────────────────────────────────────────────────────────
btnRequest.addEventListener('click', async () => {
  if (!_user) { toast('로그인이 필요합니다'); return; }
  if (!_pickupLat || !_pickupLng) { toast('탑승 위치를 선택하세요'); return; }

  btnRequest.disabled = true;
  btnRequest.textContent = '호출 중...';
  try {
    const res = await fnRequest({
      pickupLat:     _pickupLat,
      pickupLng:     _pickupLng,
      pickupAddress: pickupAddrText.textContent,
      destLat:       _destLat   || null,
      destLng:       _destLng   || null,
      destAddress:   document.getElementById('destAddrText').textContent !== '-'
                       ? document.getElementById('destAddrText').textContent
                       : (destInput.value.trim() || ''),
    });
    _rideId = res.data.rideId;
    subscribeRide(_rideId);
    showSection('secSearching');
  } catch (err) {
    toast('오류: ' + (err.message || err));
    btnRequest.disabled = false;
    btnRequest.textContent = '🚗 버기카 호출하기';
  }
});

async function doCancel() {
  if (!_rideId) return;
  try {
    await fnCancel({ rideId: _rideId, reason: '사용자 취소' });
  } catch (err) {
    toast('취소 오류: ' + (err.message || err));
  }
}

btnCancelSearch.addEventListener('click', async () => {
  btnCancelSearch.disabled = true;
  await doCancel();
  btnCancelSearch.disabled = false;
});

btnCancelAccepted.addEventListener('click', async () => {
  if (!confirm('정말 취소하시겠습니까?')) return;
  btnCancelAccepted.disabled = true;
  await doCancel();
  btnCancelAccepted.disabled = false;
});

document.getElementById('btnClearDest').addEventListener('click', clearDest);

btnNewRide.addEventListener('click', () => {
  btnRequest.disabled = !(_user && _pickupLat);
  btnRequest.textContent = '🚗 버기카 호출하기';
  showSection('secIdle');
});

// ── 지도 확대 FAB ────────────────────────────────────────────────────
document.getElementById('btnMapFull').addEventListener('click', () => {
  const app = document.getElementById('buggyApp');
  const btn = document.getElementById('btnMapFull');
  const isExpanded = app.classList.toggle('map-expanded');
  btn.textContent = isExpanded ? '✕' : '⛶';
  btn.title       = isExpanded ? '지도 축소' : '지도 전체 보기';
  setTimeout(() => {
    if (_map)        google.maps.event.trigger(_map,        'resize');
    if (_mapAccepted) google.maps.event.trigger(_mapAccepted, 'resize');
    if (_mapRiding)   google.maps.event.trigger(_mapRiding,   'resize');
  }, 320);
});

// ── 드로어 메뉴 ──────────────────────────────────────────────────────────────────
function openDrawer() {
  document.getElementById('drawerOverlay').classList.add('open');
  document.getElementById('drawerMenu').classList.add('open');
}
function closeDrawer() {
  document.getElementById('drawerOverlay').classList.remove('open');
  document.getElementById('drawerMenu').classList.remove('open');
}
document.getElementById('btnMenu').addEventListener('click', openDrawer);
document.getElementById('drawerOverlay').addEventListener('click', closeDrawer);
document.getElementById('topBarBalance').addEventListener('click', openDrawer);

// ── 인증 감시 ────────────────────────────────────────────────────────────
watchAuth(async ({ loggedIn, profile }) => {
  _user = loggedIn ? profile : null;
  btnRequest.disabled = !(_user && _pickupLat);
  const nameEl  = document.getElementById('drawerUserName');
  const emailEl = document.getElementById('drawerUserEmail');
  if (nameEl)  nameEl.textContent  = loggedIn ? (profile.displayName || profile.email || '사용자') : '로그인이 필요합니다';
  if (emailEl) emailEl.textContent = loggedIn ? (profile.email || '') : '';
  if (loggedIn) {
    await loadBalance();
    await checkActiveRide();
  }
});

// ── 초기화 ──────────────────────────────────────────────────────────────
(async () => {
  try {
    const res = await fnGetConfig({});
    Object.assign(_config, res.data);
  } catch (_) {}
  loadMaps();
})();
