// assets/js/pages/buggy-driver.js
// 버기카 기사 앱

import { getApps, initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot,
  collection, query, where, limit, getDocs, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { getFunctions, httpsCallable }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import {
  getAuth, onAuthStateChanged,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
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
let _uid        = null;
let _driver     = null;
let _config     = { intervalMinutes: 10, intervalFare: 50000 };
let _rideId     = null;
let _rideStatus = null;   // 현재 ride 상태
let _pickupLat  = null;   // 탑승 위치 좌표
let _pickupLng  = null;
let _rideSub    = null;
let _searchSub  = null;
let _timerInt   = null;
let _locInt     = null;
let _map         = null;
let _pickMarker  = null;
let _mapRiding   = null;   // 운행 중 지도
let _myMarker    = null;   // 운행 중 내 위치 마커
let _startingRide = false;

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

// ── Haversine 거리 (미터) ───────────────────────────────────────────
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── 자동 탑승 처리 ──────────────────────────────────────────────────
async function autoStartRide() {
  if (_startingRide || !_rideId) return;
  _startingRide = true;
  toast('📍 탑승자 근접! 탑승 처리 중...', 4000);
  document.getElementById('btnStartManual').disabled = true;
  try {
    await fnStart({ rideId: _rideId });
  } catch (err) {
    toast('탑승 오류: ' + (err.message || err));
    _startingRide = false;
    document.getElementById('btnStartManual').disabled = false;
  }
}

// ── 위치 전송 (Firestore 직접 write → 탑승자 앱에 즉시 반영) ────────────
function startLocationBroadcast() {
  if (_locInt) return;
  _locInt = setInterval(() => {
    if (!navigator.geolocation || !_uid) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      // Firestore 직접 write (Cloud Function 경유 없이 ~100ms 반영)
      setDoc(
        doc(db, 'buggy_driver_locations', _uid),
        { lat, lng, heading: pos.coords.heading || 0, speed: pos.coords.speed || 0, updatedAt: serverTimestamp() },
        { merge: true }
      ).catch(() => {});

      // 도착 후(arriving) 5m 이내 → 자동 탑승
      if (_rideStatus === 'arriving' && _pickupLat && _pickupLng && !_startingRide) {
        const dist = Math.round(distanceM(lat, lng, _pickupLat, _pickupLng));
        const label = document.getElementById('goDistanceLabel');
        const row   = document.getElementById('goDistanceRow');
        if (label && row) {
          row.style.display = '';
          label.textContent = dist < 1000 ? `${dist}m` : `${(dist / 1000).toFixed(1)}km`;
          label.style.color = dist <= 10 ? '#16a34a' : '#f59e0b';
        }
        if (dist <= 5) autoStartRide();
      }

      // 운행 중 → 기사앱 지도에 내 위치 업데이트
      if (_rideStatus === 'riding') {
        if (!_mapRiding) initRidingMap(lat, lng);
        else updateRidingMap(lat, lng);
      }
    }, () => {});
  }, 3000);
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

function initRidingMap(lat, lng) {
  if (!window.google?.maps) return;
  if (_mapRiding) {
    _mapRiding.setCenter({ lat, lng });
    return;
  }
  _mapRiding = new google.maps.Map(document.getElementById('drvMapRiding'), {
    center: { lat, lng }, zoom: 16,
    disableDefaultUI: true,
    gestureHandling: 'greedy',
  });
  _myMarker = new google.maps.Marker({
    map: _mapRiding,
    position: { lat, lng },
    title: '내 위치',
    icon: { url: 'https://maps.google.com/mapfiles/ms/icons/yellow-dot.png' },
  });
}

function updateRidingMap(lat, lng) {
  if (!_mapRiding || !_myMarker) return;
  const pos = { lat, lng };
  _myMarker.setPosition(pos);
  _mapRiding.panTo(pos);
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
    limit(1)
  );
  _searchSub = onSnapshot(q, (snap) => {
    if (_rideId) return; // 이미 수락된 라이드 있음
    if (snap.empty) { showSection('drvSecIdle'); return; }
    const rideDoc = snap.docs[0];
    showIncomingRequest(rideDoc.id, rideDoc.data());
  }, (err) => {
    console.error('[buggy-driver] startSearching error:', err.code, err.message);
    _searchSub = null; // 막힌 구독 해제 → 재시도 가능하게
    // 5초 후 자동 재시도 (rules 배포 후 자동 복구)
    setTimeout(() => {
      if (!_rideId && chkOnline.checked) startSearching();
    }, 5000);
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
    case 'arriving': {
      _rideStatus = ride.status;
      _pickupLat  = ride.pickupLat || null;
      _pickupLng  = ride.pickupLng || null;

      showSection('drvSecGoing');
      document.getElementById('goPickupAddr').textContent = ride.pickupAddress || '-';
      document.getElementById('goUserName').textContent   = ride.userDisplayName || '회원';

      const isArriving = ride.status === 'arriving';
      document.getElementById('goSectionTitle').textContent =
        isArriving ? '📍 탑승 위치 도착 — 탑승자 확인' : '🚗 이동 중 — 탑승 위치로';
      document.getElementById('goStatusBadge').textContent =
        isArriving ? '📍 도착 완료' : '🚗 이동 중';

      // arriving 상태: 수동 탑승 버튼 표시, 탑승자까지 거리 표시 시작
      document.getElementById('btnArrive').style.display     = isArriving ? 'none'  : 'block';
      document.getElementById('btnStartManual').style.display = isArriving ? 'block' : 'none';
      document.getElementById('goDistanceRow').style.display  = isArriving ? ''     : 'none';

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
      break;
    }

    case 'riding':
      _rideStatus   = 'riding';
      _startingRide = false;
      showSection('drvSecRiding');
      document.getElementById('rideUserName').textContent  = ride.userDisplayName || '회원';
      document.getElementById('rideStartedAt').textContent = fmtTime(ride.startedAt);
      document.getElementById('btnStart').style.display = 'none';
      if (ride.startedAt) startTimer(ride.startedAt.toMillis());
      // 현재 GPS로 운행 지도 초기화 (없으면 탑승 위치 기준)
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => initRidingMap(pos.coords.latitude, pos.coords.longitude),
          ()    => { if (ride.pickupLat) initRidingMap(ride.pickupLat, ride.pickupLng); }
        );
      } else if (ride.pickupLat) {
        initRidingMap(ride.pickupLat, ride.pickupLng);
      }
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

// 수동 탑승 시작 (섹션 C — arriving 상태)
document.getElementById('btnStartManual').addEventListener('click', () => autoStartRide());

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

// ── 인앱브라우저 감지 ────────────────────────────────────────────────
(function checkInAppBrowser() {
  const ua = navigator.userAgent;
  const inApp = /KAKAOTALK|KAKAO|Line\/|Instagram|FBAN|FBAV|NaverApp|DaumApps|MicroMessenger/i.test(ua)
    || (/iPhone|iPad/.test(ua) && /WebKit/.test(ua) && !/Safari/.test(ua) && !/CriOS|FxiOS/.test(ua));
  if (!inApp) return;

  const pageUrl = location.href;
  const isAndroid = /Android/i.test(ua);

  const screen = document.getElementById('drvLoginScreen');
  screen.innerHTML = `
    <div style="font-size:3.5rem;margin-bottom:16px;">⚠️</div>
    <h2 style="font-size:1.15rem;font-weight:800;color:#92400e;margin:0 0 10px;">외부 브라우저에서 열어주세요</h2>
    <p style="color:#78716c;font-size:0.88rem;margin:0 0 28px;line-height:1.7;">
      카카오톡 등 인앱브라우저에서는<br>Google 로그인이 지원되지 않습니다.
    </p>
    ${isAndroid ? `
      <a href="intent://${location.hostname}${location.pathname}#Intent;scheme=https;package=com.android.chrome;end"
         style="display:block;background:#f59e0b;color:#fff;border-radius:12px;
                padding:14px 24px;font-size:1rem;font-weight:700;text-decoration:none;
                margin-bottom:14px;text-align:center;box-shadow:0 2px 8px rgba(245,158,11,.3);">
        Chrome으로 열기
      </a>` : `
      <p style="font-size:0.84rem;color:#57534e;background:#fef3c7;border-radius:10px;
                padding:12px 16px;margin-bottom:16px;line-height:1.7;text-align:left;">
        하단 <strong>공유 버튼(□↑)</strong> 탭 →<br><strong>"Safari로 열기"</strong> 를 선택하세요
      </p>`
    }
    <button id="_btnCopyLink"
      style="background:#fff;border:1.5px solid #d6d3d1;color:#57534e;border-radius:10px;
             padding:11px 22px;font-size:0.88rem;cursor:pointer;width:100%;max-width:280px;">
      🔗 링크 복사
    </button>
  `;
  screen.style.display = 'flex';

  document.getElementById('_btnCopyLink').addEventListener('click', () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(pageUrl)
        .then(() => alert('링크가 복사되었습니다.\n브라우저 주소창에 붙여넣으세요.'))
        .catch(() => prompt('아래 링크를 복사하세요:', pageUrl));
    } else {
      prompt('아래 링크를 복사하세요:', pageUrl);
    }
  });
})();

// ── 인증 ─────────────────────────────────────────────────────────────
const loginScreen = document.getElementById('drvLoginScreen');
const drvMain     = document.getElementById('drvMain');
const loginErrEl  = document.getElementById('drvLoginError');

async function doGoogleLogin() {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
    } else if (e.code !== 'auth/popup-closed-by-user') {
      if (loginErrEl) {
        loginErrEl.textContent = '로그인 오류: ' + (e.message || e.code);
        loginErrEl.style.display = 'block';
      }
    }
  }
}

document.getElementById('btnDrvGoogleLogin')?.addEventListener('click', doGoogleLogin);

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    loginScreen.style.display = 'flex';
    drvMain.style.display     = 'none';
    return;
  }
  loginScreen.style.display = 'none';
  drvMain.style.display     = 'block';
  _uid = user.uid;

  // 기사 정보 로드
  const dSnap = await getDoc(doc(db, 'buggy_drivers', _uid));
  if (!dSnap.exists()) {
    drvMain.innerHTML =
      '<div class="buggy-empty" style="padding:48px 24px;text-align:center;">' +
      '<div style="font-size:3rem;margin-bottom:12px;">🚫</div>' +
      '<div style="font-weight:700;margin-bottom:8px;">기사 등록 정보가 없습니다</div>' +
      '<div style="font-size:0.85rem;color:#78716c;">관리자에게 UID를 전달하여 등록 요청하세요</div>' +
      '<div style="margin-top:12px;padding:8px 12px;background:#f3f4f6;border-radius:8px;font-size:0.78rem;word-break:break-all;color:#374151;">' +
      'UID: ' + _uid + '</div></div>';
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

  // 로그인 & 등록 확인 후 홈화면 추가 배너 표시
  if (window.showDriverInstallBanner) window.showDriverInstallBanner();

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

// ── 매출장부 ──────────────────────────────────────────────────
const fnGetEarnings = httpsCallable(fns, 'buggyGetDriverEarnings');
let _currentEarnPeriod = 'today';

async function loadEarnings(period = _currentEarnPeriod) {
  _currentEarnPeriod = period;
  const earnList  = document.getElementById('earnList');
  const earnEmpty = document.getElementById('earnEmpty');
  const earnRides = document.getElementById('earnTotalRides');
  const earnShare = document.getElementById('earnTotalShare');
  if (!earnList) return;
  earnList.innerHTML = '<div style="text-align:center;padding:20px;color:#a8a29e;">불러오는 중...</div>';

  try {
    const res  = await fnGetEarnings({ period });
    const data = res.data;
    earnRides.textContent = `${data.totalRides}건`;
    earnShare.textContent = `₫${Number(data.totalShare).toLocaleString()}`;

    if (!data.earnings?.length) {
      earnList.innerHTML = '';
      earnEmpty.style.display = 'block';
      return;
    }
    earnEmpty.style.display = 'none';
    earnList.innerHTML = data.earnings.map(e => {
      const date   = e.endedAt ? new Date(e.endedAt).toLocaleDateString('ko-KR') : '-';
      const time   = e.endedAt ? new Date(e.endedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '-';
      const status = e.payoutStatus === 'payment_failed' ? 'failed' : 'paid';
      const statusLabel = status === 'paid' ? '정산대기' : '결제실패';
      return `
        <div class="earn-item">
          <div class="earn-item-header">
            <span style="font-size:0.82rem;color:#57534e;">${date} ${time}</span>
            <span class="earn-item-status ${status}">${statusLabel}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-weight:700;font-size:0.95rem;">₫${Number(e.grossFare||0).toLocaleString()}</div>
              <div style="font-size:0.75rem;color:#78716c;">${e.minutesDriven||0}분 · ${e.pickupAddress||'-'}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:0.82rem;color:#f59e0b;font-weight:700;">내 수익 ₫${Number(e.driverShare||0).toLocaleString()}</div>
              <div style="font-size:0.72rem;color:#a8a29e;">수수료 ₫${Number(e.platformFee||0).toLocaleString()}</div>
            </div>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    earnList.innerHTML = `<div style="text-align:center;color:#dc2626;padding:20px;">오류: ${err.message}</div>`;
  }
}

// 탭 네비게이션
document.querySelectorAll('.drv-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.drv-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (btn.dataset.tab === 'earnings') {
      // Hide active ride section, show earnings
      document.querySelectorAll('.buggy-section').forEach(s => s.classList.remove('active'));
      document.getElementById('drvSecEarnings').classList.add('active');
      loadEarnings();
    } else {
      // Restore home - show idle or current ride section
      document.querySelectorAll('.buggy-section').forEach(s => s.classList.remove('active'));
      document.getElementById('drvSecIdle').classList.add('active');
    }
  });
});

// 기간 필터 버튼
document.querySelectorAll('.earn-period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.earn-period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadEarnings(btn.dataset.period);
  });
});
