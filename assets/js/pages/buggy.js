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

const fnRequest  = httpsCallable(fns, 'buggyRequestRide');
const fnCancel   = httpsCallable(fns, 'buggyCancelRide');
const fnGetConfig= httpsCallable(fns, 'buggyGetConfig');

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
  const defaultPos = { lat: 10.8231, lng: 106.6297 }; // 호치민 기본
  _map = new google.maps.Map(document.getElementById('buggyMap'), {
    center: defaultPos, zoom: 15,
    disableDefaultUI: true,
    gestureHandling: 'greedy',
  });
  _marker = new google.maps.Marker({ map: _map, draggable: true, title: '탑승 위치' });

  // 지도 클릭 → 탑승 위치
  _map.addListener('click', (e) => setPickup(e.latLng.lat(), e.latLng.lng()));
  _marker.addListener('dragend', (e) => setPickup(e.latLng.lat(), e.latLng.lng()));

  // 현재 위치 시도
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        _map.setCenter(ll);
        setPickup(ll.lat, ll.lng);
      },
      () => {}
    );
  }
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

// ── 사용자 HEX 지갑 상태 로드 ────────────────────────────────────────────
async function loadBalance() {
  if (!_user) return;
  const snap    = await getDoc(doc(db, 'users', _user.uid));
  const wallet  = snap.data()?.wallet;
  const balBox  = document.getElementById('balanceBox');
  if (wallet?.address) {
    balAmount.textContent = `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`;
    balBox.title = wallet.address;
    document.querySelector('.bal-label').textContent = 'HEX 지갑 연동됨';
  } else {
    balAmount.textContent = '지갑 없음';
    document.querySelector('.bal-label').textContent = '수탁 지갑 필요';
    balBox.style.borderColor = '#dc2626';
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
      destAddress:   destInput.value.trim() || '',
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
