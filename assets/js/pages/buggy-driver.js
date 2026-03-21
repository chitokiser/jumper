// assets/js/pages/buggy-driver.js
// 버기카 기사 앱

import { getApps, initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getFirestore, doc, getDoc, onSnapshot,
  collection, query, where, orderBy, limit, getDocs,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { getFunctions, httpsCallable }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { getAuth, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { firebaseConfig } from '/assets/js/firebase-config.js';

const app  = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db   = getFirestore(app);
const fns  = getFunctions(app);
const auth = getAuth(app);

const fnAccept    = httpsCallable(fns, 'buggyAcceptRide');
const fnArrive    = httpsCallable(fns, 'buggyDriverArrive');
const fnStart     = httpsCallable(fns, 'buggyStartRide');
const fnEnd       = httpsCallable(fns, 'buggyEndRide');
const fnCancel    = httpsCallable(fns, 'buggyCancelRide');
const fnSetOnline = httpsCallable(fns, 'buggySetDriverOnline');
const fnUpdateLoc = httpsCallable(fns, 'buggyUpdateDriverLocation');
const fnGetConfig = httpsCallable(fns, 'buggyGetConfig');

// ── 상태 ─────────────────────────────────────────────────────────────────
let _uid      = null;
let _driver   = null;
let _config   = { intervalMinutes: 10, intervalFare: 50000 };
let _rideId   = null;
let _rideSub  = null;
let _searchSub = null;
let _timerInt = null;
let _locInt   = null;
let _map      = null;
let _pickMarker = null;

// ── DOM ──────────────────────────────────────────────────────────────────
const toastEl = document.getElementById('drvToast');
const chkOnline = document.getElementById('chkOnline');
const onlineBadge = document.getElementById('onlineBadge');
const onlineLabel = document.getElementById('onlineLabel');
const driverNameLabel = document.getElementById('driverNameLabel');
const driverPlate = document.getElementById('driverPlate');

// ── 유틸 ─────────────────────────────────────────────────────────────────
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

function fmtTime(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString('ko-KR');
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
    document.getElementById('drvTimer').textContent = `${m}:${s}`;
    document.getElementById('drvFarePrev').textContent = fmtVnd(calcFareLive(startMs));
  }, 1000);
}

// ── 위치 전송 ─────────────────────────────────────────────────────────
function startLocationBroadcast() {
  if (_locInt) return;
  _locInt = setInterval(() => {
    if (!navigator.geolocation || !_uid) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      fnUpdateLoc({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        heading: pos.coords.heading || 0,
        speed:   pos.coords.speed   || 0,
      }).catch(() => {});
    }, () => {});
  }, 5000);
}

function stopLocationBroadcast() {
  clearInterval(_locInt);
  _locInt = null;
}

// ── 지도 ────────────────────────────────────────────────────────────────
function initMap(lat, lng) {
  if (!window.google?.maps) return;
  if (_map) return;
  _map = new google.maps.Map(document.getElementById('drvMap'), {
    center: { lat, lng }, zoom: 15,
    disableDefaultUI: true,
    gestureHandling: 'greedy',
  });
  _pickMarker = new google.maps.Marker({ map: _map, title: '탑승 위치' });
}

function loadMaps() {
  if (window.google?.maps) return;
  const key = window.__mapsKey || '';
  const s = document.createElement('script');
  s.src = `https://maps.googleapis.com/maps/api/js?key=${key}`;
  document.head.appendChild(s);
}

// ── 호출 수신 구독 ────────────────────────────────────────────────────
function startSearching() {
  if (_searchSub) return;
  const q = query(
    collection(db, 'buggy_rides'),
    where('status', '==', 'searching'),
    orderBy('requestedAt'),
    limit(1)
  );
  _searchSub = onSnapshot(q, (snap) => {
    if (_rideId) return; // 이미 수락된 라이드 있음
    if (snap.empty) { showSection('drvSecIdle'); return; }
    const rideDoc = snap.docs[0];
    showIncomingRequest(rideDoc.id, rideDoc.data());
  });
}

function stopSearching() {
  if (_searchSub) { _searchSub(); _searchSub = null; }
}

let _countdownInt = null;
function showIncomingRequest(rideId, ride) {
  document.getElementById('reqPickupAddr').textContent = ride.pickupAddress || `${ride.pickupLat}, ${ride.pickupLng}`;
  document.getElementById('reqDestAddr').textContent   = ride.destAddress   || '미지정';
  document.getElementById('reqUserName').textContent   = ride.userDisplayName || '회원';
  showSection('drvSecRequest');

  // 카운트다운
  clearInterval(_countdownInt);
  let remaining = 120;
  const countEl = document.getElementById('reqCountdown');
  _countdownInt = setInterval(() => {
    remaining--;
    countEl.textContent = `⏳ ${remaining}초 내 응답해주세요`;
    if (remaining <= 0) {
      clearInterval(_countdownInt);
      showSection('drvSecIdle');
    }
  }, 1000);

  document.getElementById('btnAccept').onclick = async () => {
    clearInterval(_countdownInt);
    document.getElementById('btnAccept').disabled = true;
    try {
      await fnAccept({ rideId });
      _rideId = rideId;
      stopSearching();
      subscribeRide(rideId);
      startLocationBroadcast();
    } catch (err) {
      toast('수락 오류: ' + (err.message || err));
      document.getElementById('btnAccept').disabled = false;
    }
  };

  document.getElementById('btnDecline').onclick = () => {
    clearInterval(_countdownInt);
    showSection('drvSecIdle');
  };
}

// ── 라이드 구독 ───────────────────────────────────────────────────────
function subscribeRide(rideId) {
  if (_rideSub) _rideSub();
  _rideSub = onSnapshot(doc(db, 'buggy_rides', rideId), (snap) => {
    if (!snap.exists()) return;
    handleRideUpdate(rideId, snap.data());
  });
}

function handleRideUpdate(rideId, ride) {
  switch (ride.status) {
    case 'accepted':
    case 'arriving':
      showSection('drvSecGoing');
      document.getElementById('goPickupAddr').textContent = ride.pickupAddress || '-';
      document.getElementById('goUserName').textContent   = ride.userDisplayName || '회원';
      document.getElementById('goStatusBadge').textContent =
        ride.status === 'arriving' ? '📍 탑승 위치 도착' : '🚗 이동 중';

      // 지도에 탑승 위치 표시
      if (ride.pickupLat && ride.pickupLng) {
        const lat = ride.pickupLat, lng = ride.pickupLng;
        if (!_map) {
          setTimeout(() => { initMap(lat, lng); if (_pickMarker) _pickMarker.setPosition({ lat, lng }); }, 500);
        } else {
          _map.setCenter({ lat, lng });
          if (_pickMarker) _pickMarker.setPosition({ lat, lng });
        }
      }

      document.getElementById('btnArrive').style.display =
        ride.status === 'arriving' ? 'none' : 'block';
      break;

    case 'riding':
      showSection('drvSecRiding');
      document.getElementById('rideUserName').textContent  = ride.userDisplayName || '회원';
      document.getElementById('rideStartedAt').textContent = fmtTime(ride.startedAt);
      document.getElementById('btnStart').style.display = 'none';
      if (ride.startedAt) startTimer(ride.startedAt.toMillis());
      break;

    case 'completed':
    case 'payment_failed': {
      clearInterval(_timerInt);
      stopLocationBroadcast();
      if (_rideSub) { _rideSub(); _rideSub = null; }
      _rideId = null;

      document.getElementById('drvDoneMinutes').textContent = `${ride.durationMinutes || 0}분`;
      document.getElementById('drvDoneFare').textContent    = fmtVnd(ride.feeVnd || 0);
      const ps = document.getElementById('drvDonePayStatus');
      if (ride.paymentStatus === 'paid') {
        ps.textContent = '✅ 결제 완료';
        ps.style.color = '#16a34a';
      } else {
        ps.textContent = '⚠️ 결제 실패 (잔액 부족)';
        ps.style.color = '#dc2626';
      }
      showSection('drvSecDone');
      break;
    }

    case 'cancelled_by_user':
    case 'cancelled_by_driver':
    case 'failed':
      clearInterval(_timerInt);
      stopLocationBroadcast();
      if (_rideSub) { _rideSub(); _rideSub = null; }
      _rideId = null;
      toast('호출이 취소되었습니다');
      if (_driver?.isOnline) startSearching();
      showSection('drvSecIdle');
      break;
  }
}

// ── 버튼 이벤트 ──────────────────────────────────────────────────────
document.getElementById('btnArrive').addEventListener('click', async () => {
  if (!_rideId) return;
  try { await fnArrive({ rideId: _rideId }); }
  catch (err) { toast('오류: ' + (err.message || err)); }
});

document.getElementById('btnStart').addEventListener('click', async () => {
  if (!_rideId) return;
  document.getElementById('btnStart').disabled = true;
  try {
    await fnStart({ rideId: _rideId });
    startLocationBroadcast();
  } catch (err) {
    toast('오류: ' + (err.message || err));
    document.getElementById('btnStart').disabled = false;
  }
});

document.getElementById('btnEnd').addEventListener('click', async () => {
  if (!_rideId) return;
  if (!confirm('운행을 종료하시겠습니까?')) return;
  document.getElementById('btnEnd').disabled = true;
  try {
    await fnEnd({ rideId: _rideId });
  } catch (err) {
    toast('오류: ' + (err.message || err));
    document.getElementById('btnEnd').disabled = false;
  }
});

document.getElementById('btnCancelGoing').addEventListener('click', async () => {
  if (!_rideId) return;
  if (!confirm('호출을 취소하시겠습니까?')) return;
  try { await fnCancel({ rideId: _rideId, reason: '기사 취소' }); }
  catch (err) { toast('오류: ' + (err.message || err)); }
});

document.getElementById('btnBackToIdle').addEventListener('click', () => {
  showSection('drvSecIdle');
  if (_driver?.isOnline) startSearching();
});

// ── 온라인 토글 ──────────────────────────────────────────────────────
chkOnline.addEventListener('change', async () => {
  const isOnline = chkOnline.checked;
  try {
    await fnSetOnline({ isOnline });
    setOnlineUI(isOnline);
    if (isOnline) {
      startSearching();
      startLocationBroadcast();
    } else {
      stopSearching();
      stopLocationBroadcast();
      showSection('drvSecIdle');
    }
  } catch (err) {
    toast('오류: ' + (err.message || err));
    chkOnline.checked = !isOnline; // 원복
  }
});

function setOnlineUI(isOnline) {
  if (isOnline) {
    onlineBadge.textContent = '🟢 온라인';
    onlineBadge.className   = 'buggy-badge buggy-badge--online';
    onlineLabel.textContent = '온라인';
  } else {
    onlineBadge.textContent = '⚫ 오프라인';
    onlineBadge.className   = 'buggy-badge buggy-badge--offline';
    onlineLabel.textContent = '오프라인';
  }
}

// ── 인증 ─────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = '/login.html';
    return;
  }
  _uid = user.uid;

  // 기사 정보 로드
  const dSnap = await getDoc(doc(db, 'buggy_drivers', _uid));
  if (!dSnap.exists()) {
    document.querySelector('.buggy-wrap').innerHTML =
      '<div class="buggy-empty"><div class="buggy-empty-icon">🚫</div><div>기사 등록 정보가 없습니다.<br>관리자에게 문의하세요.</div></div>';
    return;
  }
  _driver = dSnap.data();
  driverNameLabel.textContent = _driver.name || '기사';
  driverPlate.textContent     = _driver.vehicleNumber || '-';
  chkOnline.checked           = !!_driver.isOnline;
  setOnlineUI(!!_driver.isOnline);

  if (_driver.isOnline) {
    startSearching();
    startLocationBroadcast();
  }

  // 진행 중 라이드 복구
  const q = query(
    collection(db, 'buggy_rides'),
    where('driverId', '==', _uid),
    where('status', 'in', ['accepted', 'arriving', 'riding']),
    limit(1)
  );
  const snap = await getDocs(q);
  if (!snap.empty) {
    _rideId = snap.docs[0].id;
    stopSearching();
    subscribeRide(_rideId);
    startLocationBroadcast();
  }
});

// ── 지도 로드 ─────────────────────────────────────────────────────────
loadMaps();

// ── 설정 로드 ─────────────────────────────────────────────────────────
fnGetConfig({}).then(res => Object.assign(_config, res.data)).catch(() => {});
