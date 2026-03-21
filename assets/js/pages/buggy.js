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
let _map      = null;
let _marker   = null;
let _driverMarker = null;
let _driverLocSub = null;

let _pickupLat = null;
let _pickupLng = null;
let _destLat   = null;
let _destLng   = null;
let _destMarker = null;
let _autocomplete = null;

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

  _map.addListener('click', (e) => setPickup(e.latLng.lat(), e.latLng.lng()));
  _marker.addListener('dragend', (e) => setPickup(e.latLng.lat(), e.latLng.lng()));

  // 도착지 Places Autocomplete
  initPlacesSearch();

  // 현재 위치 버튼
  document.getElementById('btnMyLocation').addEventListener('click', goToMyLocation);

  // 초기 현재 위치
  goToMyLocation(true);
}

function goToMyLocation(silent) {
  if (!navigator.geolocation) { if (!silent) toast('위치 서비스를 지원하지 않는 브라우저입니다'); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const ll = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      _map.setCenter(ll);
      _map.setZoom(16);
      setPickup(ll.lat, ll.lng);
    },
    () => { if (!silent) toast('현재 위치를 가져올 수 없습니다'); }
  );
}

// ── Places 키워드 검색 (도착지) ──────────────────────────────────────────
function initPlacesSearch() {
  const input      = document.getElementById('destInput');
  const suggestBox = document.getElementById('destSuggestions');
  const service    = new google.maps.places.AutocompleteService();
  const geocoder   = new google.maps.Geocoder();
  let _debounce    = null;

  input.addEventListener('input', () => {
    clearTimeout(_debounce);
    const val = input.value.trim();
    if (!val) { suggestBox.style.display = 'none'; return; }
    _debounce = setTimeout(() => {
      service.getPlacePredictions(
        { input: val, language: 'ko', region: 'VN' },
        (predictions, status) => {
          suggestBox.innerHTML = '';
          if (status !== google.maps.places.PlacesServiceStatus.OK || !predictions?.length) {
            suggestBox.style.display = 'none';
            return;
          }
          predictions.slice(0, 5).forEach((p) => {
            const item = document.createElement('div');
            item.style.cssText = 'padding:10px 14px;cursor:pointer;font-size:0.88rem;border-bottom:1px solid #f3f4f6;';
            item.textContent   = p.description;
            item.addEventListener('mousedown', (e) => {
              e.preventDefault();
              input.value = p.description;
              suggestBox.style.display = 'none';
              // place_id → 좌표
              geocoder.geocode({ placeId: p.place_id }, (res, st) => {
                if (st !== 'OK' || !res[0]) { toast('좌표를 가져올 수 없습니다'); return; }
                const loc = res[0].geometry.location;
                setDest(loc.lat(), loc.lng(), p.description);
              });
            });
            suggestBox.appendChild(item);
          });
          suggestBox.style.display = 'block';
        }
      );
    }, 300);
  });

  // 포커스 아웃 시 닫기
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
}

async function setPickup(lat, lng) {
  _pickupLat = lat;
  _pickupLng = lng;
  _marker.setPosition({ lat, lng });
  _map.panTo({ lat, lng });
  btnRequest.disabled = !_user;

  // Reverse geocode
  try {
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (res, status) => {
      if (status === 'OK' && res[0]) {
        pickupAddrText.textContent = res[0].formatted_address;
      } else {
        pickupAddrText.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      }
    });
  } catch (_) {
    pickupAddrText.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
}

// ── Google Maps 로드 ─────────────────────────────────────────────────────
function loadMaps() {
  if (window.google?.maps) { initMap(); return; }
  const key = window.__mapsKey || '';
  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
  s.onload = initMap;
  document.head.appendChild(s);
}

// ── 사용자 HEX 잔액 로드 ─────────────────────────────────────────────────
async function loadBalance() {
  if (!_user) return;
  const balBox = document.getElementById('balanceBox');
  try {
    const res = await fnGetOnChain();
    const d   = res.data;
    if (d?.walletHexWei && BigInt(d.walletHexWei) > 0n) {
      // ex) "229,402원 / $152.82 / 3,992,988 VND"
      const parts = [];
      if (d.walletHexKrw != null) parts.push(Number(d.walletHexKrw).toLocaleString() + '원');
      if (d.walletHexUsd != null) parts.push('$' + Number(d.walletHexUsd).toFixed(2));
      if (d.walletHexVnd != null) parts.push(Number(d.walletHexVnd).toLocaleString() + ' VND');
      balAmount.textContent = parts.length ? parts.join(' / ') : (d.walletHexDisplay || '-');
      balAmount.style.fontSize = '0.78rem';
    } else {
      balAmount.textContent = '0 HEX';
    }
    document.querySelector('.bal-label').textContent = '보유 HEX';
  } catch (_) {
    // 지갑 없음 fallback
    const snap   = await getDoc(doc(db, 'users', _user.uid));
    const wallet = snap.data()?.wallet;
    if (wallet?.address) {
      balAmount.textContent = `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`;
      document.querySelector('.bal-label').textContent = 'HEX 지갑 연동됨';
    } else {
      balAmount.textContent = '지갑 없음';
      document.querySelector('.bal-label').textContent = '수탁 지갑 필요';
      balBox.style.borderColor = '#dc2626';
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
      subscribeDriverLocation(ride.driverId);
      break;

    case 'riding':
      showSection('secRiding');
      document.getElementById('ridingDrvName').textContent  = ride.driverName  || '기사';
      document.getElementById('ridingDrvPlate').textContent = ride.vehicleNumber || '-';
      if (ride.startedAt) {
        startTimer(ride.startedAt.toMillis());
      }
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
function subscribeDriverLocation(driverId) {
  if (!driverId) return;
  if (_driverLocSub) _driverLocSub();
  _driverLocSub = onSnapshot(
    doc(db, 'buggy_driver_locations', driverId),
    (snap) => {
      if (!snap.exists() || !window.google?.maps) return;
      const { lat, lng } = snap.data();
      const pos = { lat, lng };
      if (!_driverMarker) {
        _driverMarker = new google.maps.Marker({
          position: pos,
          icon: { url: 'https://maps.google.com/mapfiles/ms/icons/cabs/cab.png', scaledSize: new google.maps.Size(40, 40) },
          title: '기사',
        });
        // 기사 마커를 현재 활성 지도에 표시
        const activeMap = _map;
        if (activeMap) _driverMarker.setMap(activeMap);
      }
      _driverMarker.setPosition(pos);
    }
  );
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

// ── 인증 감시 ────────────────────────────────────────────────────────────
watchAuth(async ({ loggedIn, profile }) => {
  _user = loggedIn ? profile : null;
  btnRequest.disabled = !(_user && _pickupLat);
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
