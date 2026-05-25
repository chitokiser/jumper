// /assets/js/pages/ar-scan.js
// AR 보물 스캐너 — 기존 treasure_boxes 컬렉션 + collectTreasureBox Cloud Function

import { auth, db, functions } from '../firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

// ── 상수 ──────────────────────────────────────────────────────────────────────
const SCAN_RADIUS   = 100;  // m: 이 반경 내 보물 로드
const CLAIM_RADIUS  = 30;   // m: 이 거리 이내여야 획득 가능
const FOV_DEG     = 80;     // 수평 FOV (각도)
const AIM_DEG     = 20;     // 이 각도 이내 → "조준" 판정
const CHEST_BASE  = 72;     // px: 기본 보물상자 크기
const TARGET_FPS  = 20;     // 렌더 루프 상한 FPS (발열 억제)
const FRAME_MS    = 1000 / TARGET_FPS;
const COMPASS_MS  = 80;     // 나침반 이벤트 최소 간격 ms

// ── 보물상자 이미지 프리로드 ──────────────────────────────────────────────────
const chestImg = new Image();
chestImg.src = '/assets/images/item/box.png';

// ── DOM ───────────────────────────────────────────────────────────────────────
const permScreen  = document.getElementById('permScreen');
const permStatus  = document.getElementById('permStatus');
const startBtn    = document.getElementById('startBtn');
const arScreen    = document.getElementById('arScreen');
const arVideo     = document.getElementById('arVideo');
const arCanvas    = document.getElementById('arCanvas');
const arCtx       = arCanvas.getContext('2d');
const radarCanvas = document.getElementById('radarCanvas');
const radarCtx    = radarCanvas.getContext('2d');
const hudBack     = document.getElementById('hudBack');
const hudCount    = document.getElementById('hudCount');
const arStatus    = document.getElementById('arStatus');
const claimPanel  = document.getElementById('claimPanel');
const claimName   = document.getElementById('claimName');
const claimDist   = document.getElementById('claimDist');
const claimBtn    = document.getElementById('claimBtn');
const claimResult = document.getElementById('claimResult');

// ── 상태 ──────────────────────────────────────────────────────────────────────
let currentUser   = null;
let userLat       = null;
let userLng       = null;
let compassHead   = 0;       // degrees: 0=North, CW
let compassReady  = false;
let nearbyBoxes   = [];
let targetBox     = null;
let rafId         = null;
let gpsWatchId    = null;

// ── 수학 헬퍼 ─────────────────────────────────────────────────────────────────
function toRad(d) { return d * Math.PI / 180; }

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function bearing(lat1, lng1, lat2, lng2) {
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1))*Math.sin(toRad(lat2)) - Math.sin(toRad(lat1))*Math.cos(toRad(lat2))*Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// 현재 시각이 박스 운영 시간(Vietnam UTC+7)인지 확인
function isInTimeRange(startHour, endHour) {
  const h = (new Date().getUTCHours() + 7) % 24;
  return startHour <= endHour ? h >= startHour && h < endHour : h >= startHour || h < endHour;
}

// -180 ~ +180 각도 차이
function angleDiff(target, current) {
  let d = (target - current + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

// ── GPS ───────────────────────────────────────────────────────────────────────
function startGpsWatch() {
  gpsWatchId = navigator.geolocation.watchPosition(
    p => { userLat = p.coords.latitude; userLng = p.coords.longitude; },
    () => {},
    { enableHighAccuracy: true }
  );
}

async function getGpsOnce() {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      reject,
      { enableHighAccuracy: true, timeout: 12000 }
    )
  );
}

// ── Firestore: 근처 박스 로드 ─────────────────────────────────────────────────
async function loadNearbyBoxes(lat, lng) {
  const snap = await getDocs(query(collection(db, 'treasure_boxes'), where('active', '==', true)));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(b => b.lat != null && b.lng != null && !b.hiddenBox
      && haversine(lat, lng, b.lat, b.lng) <= (b.scanRadius ?? SCAN_RADIUS));
}

// ── 나침반 ────────────────────────────────────────────────────────────────────
function setupCompass() {
  let lastCompassTs = 0;
  const handler = e => {
    const now = Date.now();
    if (now - lastCompassTs < COMPASS_MS) return;
    lastCompassTs = now;
    compassReady = true;
    if (e.webkitCompassHeading != null) {
      compassHead = e.webkitCompassHeading;
    } else if (e.alpha != null) {
      compassHead = (360 - e.alpha) % 360;
    }
  };
  if (typeof DeviceOrientationEvent !== 'undefined'
      && typeof DeviceOrientationEvent.requestPermission === 'function') {
    // iOS 13+: must be called from user gesture — caller wraps this
    DeviceOrientationEvent.requestPermission()
      .then(s => { if (s === 'granted') window.addEventListener('deviceorientation', handler); })
      .catch(() => {});
  } else {
    window.addEventListener('deviceorientation', handler);
  }
}

// ── 카메라 ────────────────────────────────────────────────────────────────────
async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
  });
  arVideo.srcObject = stream;
  await arVideo.play();
}

// ── Web Audio 성공 사운드 ──────────────────────────────────────────────────────
function playSuccess() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [523, 659, 784, 1047].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine'; o.frequency.value = f;
      const t0 = ctx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.3, t0 + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
      o.start(t0); o.stop(t0 + 0.4);
    });
  } catch (_) {}
}

// ── 파티클 (canvas 위에 DOM 파티클) ──────────────────────────────────────────
function spawnParticles(x, y) {
  const colors = ['#fde68a', '#f59e0b', '#fb923c', '#facc15'];
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('div');
    const angle = (Math.PI * 2 * i) / 20;
    const dist  = 60 + Math.random() * 100;
    p.style.cssText = `
      position:fixed;left:${x}px;top:${y}px;
      width:8px;height:8px;border-radius:50%;
      background:${colors[i % colors.length]};
      pointer-events:none;z-index:99;
      animation:particleFly .9s ease-out forwards;
      --tx:${Math.cos(angle)*dist}px;--ty:${Math.sin(angle)*dist}px;
    `;
    document.body.appendChild(p);
    p.addEventListener('animationend', () => p.remove(), { once: true });
  }
}

// ── 레이더 바 렌더 ────────────────────────────────────────────────────────────
function renderRadar() {
  if (!userLat) return;
  const W = radarCanvas.width  = radarCanvas.offsetWidth;
  const H = radarCanvas.height = 32;
  radarCtx.clearRect(0, 0, W, H);

  // 배경
  radarCtx.fillStyle = 'rgba(0,0,0,.5)';
  radarCtx.roundRect(0, 0, W, H, 8);
  radarCtx.fill();

  // 북쪽 눈금
  const markAt = deg => {
    const x = W/2 + ((angleDiff(deg, compassHead)) / (FOV_DEG/2)) * (W/2);
    if (x < 0 || x > W) return;
    radarCtx.fillStyle = '#fbbf2488';
    radarCtx.fillRect(x - .5, 0, 1, H);
  };
  for (let d = 0; d < 360; d += 45) markAt(d);

  // 보물 마커
  for (const box of nearbyBoxes) {
    const bear = bearing(userLat, userLng, box.lat, box.lng);
    const diff = angleDiff(bear, compassHead);
    if (Math.abs(diff) > 120) continue;
    const x = W/2 + (diff / 120) * (W/2);
    radarCtx.fillStyle = '#f59e0b';
    radarCtx.beginPath();
    radarCtx.arc(x, H/2, 5, 0, Math.PI*2);
    radarCtx.fill();
  }

  // 중앙선
  radarCtx.fillStyle = '#ffffff44';
  radarCtx.fillRect(W/2 - .5, 4, 1, H-8);
}

// ── 메인 AR 렌더 루프 ────────────────────────────────────────────────────────
let animTime = 0;
let lastFrameTs = 0;

function renderAR(ts) {
  rafId = requestAnimationFrame(renderAR);
  if (ts - lastFrameTs < FRAME_MS) return;   // FPS 상한 적용
  lastFrameTs = ts;
  animTime = ts;
  const W = arCanvas.width  = arCanvas.offsetWidth;
  const H = arCanvas.height = arCanvas.offsetHeight;
  arCtx.clearRect(0, 0, W, H);

  if (!userLat) { rafId = requestAnimationFrame(renderAR); return; }

  let aimed = null;
  const now = ts / 1000;

  for (const box of nearbyBoxes) {
    const bear  = bearing(userLat, userLng, box.lat, box.lng);
    const diff  = angleDiff(bear, compassHead);

    if (Math.abs(diff) > FOV_DEG / 2) continue;

    const dist         = haversine(userLat, userLng, box.lat, box.lng);
    const claimR       = box.radius ?? CLAIM_RADIUS;
    const inClaimRange = dist <= claimR;

    // 운영 시간 외에는 표시하지 않음
    if (!isInTimeRange(box.startHour ?? 0, box.endHour ?? 24)) continue;

    // 획득 가능 여부에 따라 색상·크기 분기
    const scale    = inClaimRange ? 1.4 : 1.0;
    const ringColor = inClaimRange ? '#4ade80' : '#f59e0b';
    const glowColor = inClaimRange ? '#4ade80' : '#fbbf24';
    const size     = CHEST_BASE * scale;
    const screenX  = W/2 + (diff / (FOV_DEG/2)) * (W/2);
    const bounce   = inClaimRange ? Math.sin(now * 3 + box._phase) * 10 : Math.sin(now * 1.5 + box._phase) * 4;
    const screenY  = H * 0.40 + bounce;

    const isAimed = Math.abs(diff) < AIM_DEG;
    if (isAimed) aimed = box;

    // 펄스 링
    const pulse = 0.4 + 0.6 * Math.abs(Math.sin(now * 3));
    arCtx.save();
    arCtx.globalAlpha = pulse;
    arCtx.strokeStyle = ringColor;
    arCtx.lineWidth = inClaimRange ? 3 : 1.5;
    arCtx.shadowColor = ringColor;
    arCtx.shadowBlur = 8;
    arCtx.beginPath();
    arCtx.arc(screenX, screenY, size * 0.72, 0, Math.PI * 2);
    arCtx.stroke();
    arCtx.restore();

    const pulse2 = 0.2 + 0.3 * Math.abs(Math.sin(now * 1.5 + 1));
    arCtx.save();
    arCtx.globalAlpha = pulse2;
    arCtx.strokeStyle = ringColor;
    arCtx.lineWidth = 1.5;
    arCtx.beginPath();
    arCtx.arc(screenX, screenY, size * 1.05, 0, Math.PI * 2);
    arCtx.stroke();
    arCtx.restore();

    // 조준 글로우
    if (isAimed) {
      const aimPulse = 0.55 + 0.45 * Math.sin(now * 4);
      arCtx.save();
      arCtx.globalAlpha = aimPulse * 0.6;
      const grad = arCtx.createRadialGradient(screenX, screenY, size*0.2, screenX, screenY, size*1.1);
      grad.addColorStop(0, glowColor);
      grad.addColorStop(1, 'transparent');
      arCtx.fillStyle = grad;
      arCtx.beginPath();
      arCtx.arc(screenX, screenY, size*1.1, 0, Math.PI*2);
      arCtx.fill();
      arCtx.restore();
    }

    // 드롭 섀도우
    arCtx.save();
    arCtx.globalAlpha = 0.4 * scale;
    arCtx.fillStyle = 'rgba(0,0,0,.6)';
    arCtx.scale(1, 0.3);
    arCtx.beginPath();
    arCtx.ellipse(screenX, (screenY + size*0.55) / 0.3, size*0.45, size*0.18, 0, 0, Math.PI*2);
    arCtx.fill();
    arCtx.restore();

    // 보물상자 이미지
    arCtx.save();
    arCtx.globalAlpha = inClaimRange ? 1 : 0.65;
    arCtx.shadowColor = glowColor;
    arCtx.shadowBlur = 10;
    if (chestImg.complete && chestImg.naturalWidth > 0) {
      arCtx.drawImage(chestImg, screenX - size/2, screenY - size/2, size, size);
    } else {
      arCtx.font = `${size}px serif`;
      arCtx.textAlign = 'center';
      arCtx.textBaseline = 'middle';
      arCtx.fillText('📦', screenX, screenY);
    }
    arCtx.restore();

    // 거리 라벨
    arCtx.save();
    arCtx.font = `bold ${Math.round(11 * scale)}px sans-serif`;
    arCtx.fillStyle = inClaimRange ? '#4ade80' : '#fbbf24';
    arCtx.strokeStyle = 'rgba(0,0,0,.8)';
    arCtx.lineWidth = 3;
    arCtx.textAlign = 'center';
    arCtx.textBaseline = 'top';
    const label = inClaimRange
      ? `${Math.round(dist)}m ✓ 획득 가능!`
      : `${Math.round(dist)}m (${claimR}m 접근 필요)`;
    arCtx.strokeText(label, screenX, screenY + size*0.55);
    arCtx.fillText(label,   screenX, screenY + size*0.55);
    arCtx.restore();

    // 이름 라벨
    if (box.name) {
      arCtx.save();
      arCtx.font = `${Math.round(10 * scale)}px sans-serif`;
      arCtx.fillStyle = inClaimRange ? '#86efac' : '#fde68a';
      arCtx.strokeStyle = 'rgba(0,0,0,.8)';
      arCtx.lineWidth = 3;
      arCtx.textAlign = 'center';
      arCtx.textBaseline = 'bottom';
      arCtx.strokeText(box.name, screenX, screenY - size*0.55);
      arCtx.fillText(box.name,   screenX, screenY - size*0.55);
      arCtx.restore();
    }
  }

  // crosshair
  drawCrosshair(W, H);

  // compass no-signal indicator
  if (!compassReady) {
    arCtx.save();
    arCtx.font = '12px sans-serif';
    arCtx.fillStyle = '#fbbf2499';
    arCtx.textAlign = 'center';
    arCtx.fillText('🧭 Move device to calibrate compass', W/2, H - 28);
    arCtx.restore();
  }

  renderRadar();

  if (aimed !== targetBox) {
    targetBox = aimed;
    updateClaimPanel();
  }
}

function drawCrosshair(W, H) {
  const cx = W/2, cy = H*0.40;
  arCtx.save();
  arCtx.strokeStyle = 'rgba(251,191,36,.55)';
  arCtx.lineWidth = 1.5;
  arCtx.setLineDash([5, 5]);
  arCtx.beginPath(); arCtx.moveTo(cx-28, cy); arCtx.lineTo(cx+28, cy); arCtx.stroke();
  arCtx.beginPath(); arCtx.moveTo(cx, cy-28); arCtx.lineTo(cx, cy+28); arCtx.stroke();
  arCtx.restore();
}

// ── Claim 패널 갱신 ───────────────────────────────────────────────────────────
function updateClaimPanel() {
  if (targetBox) {
    const dist = userLat ? Math.round(haversine(userLat, userLng, targetBox.lat, targetBox.lng)) : null;
    const claimR = targetBox.radius ?? CLAIM_RADIUS;
    const inRange = dist !== null && dist <= claimR;
    claimName.textContent = `📦 ${targetBox.name || 'Treasure Chest'}`;
    claimDist.textContent = dist !== null
      ? (inRange ? `${dist}m — 획득 가능!` : `${dist}m away (${claimR}m 이내로 접근하세요)`)
      : '위치 확인 중...';
    claimResult.textContent = '';
    claimBtn.disabled = !inRange;
    claimBtn.dataset.boxId = targetBox.id;
    claimPanel.classList.add('visible');
  } else {
    claimPanel.classList.remove('visible');
  }
}

// ── Claim 처리 ────────────────────────────────────────────────────────────────
async function handleClaim() {
  const boxId = claimBtn.dataset.boxId;
  if (!boxId || userLat == null) return;

  if (!currentUser) {
    claimResult.textContent = '⚠️ Please log in to claim';
    claimResult.style.color = '#fca5a5';
    return;
  }

  claimBtn.disabled = true;
  claimBtn.textContent = 'Claiming...';
  claimResult.textContent = '';

  try {
    const fn = httpsCallable(functions, 'collectTreasureBox');
    const res = await fn({ boxId, userLat, userLng });

    playSuccess();
    if (navigator.vibrate) navigator.vibrate([200, 100, 300]);
    spawnParticles(window.innerWidth/2, window.innerHeight*0.4);

    const msg = res.data?.message || 'Treasure claimed! 🎉';
    claimResult.textContent = `🎉 ${msg}`;
    claimResult.style.color = '#86efac';

    // 획득한 박스 목록에서 제거
    nearbyBoxes = nearbyBoxes.filter(b => b.id !== boxId);
    hudCount.textContent = `${nearbyBoxes.length} 📦`;
    targetBox = null;
    setTimeout(() => claimPanel.classList.remove('visible'), 3500);

  } catch (err) {
    claimResult.textContent = '⚠️ ' + (err.message || 'Error occurred');
    claimResult.style.color = '#fca5a5';
    claimBtn.disabled = false;
    claimBtn.textContent = '📦 Claim Treasure';
  }
}

// ── 초기화 ────────────────────────────────────────────────────────────────────
async function init() {
  startBtn.disabled = true;
  permStatus.textContent = 'Getting GPS location...';

  try {
    // GPS
    const pos = await getGpsOnce();
    userLat = pos.lat;
    userLng = pos.lng;

    permStatus.textContent = 'Loading nearby treasures...';
    nearbyBoxes = await loadNearbyBoxes(userLat, userLng);

    // 각 박스에 bounce 위상 부여
    nearbyBoxes.forEach((b, i) => { b._phase = i * 1.2; });

    // 카메라
    permStatus.textContent = 'Opening camera...';
    await startCamera();

    // 나침반 (iOS: 이 시점은 이미 user gesture 내부)
    setupCompass();

    // GPS 지속 감시
    startGpsWatch();

    // 화면 전환
    permScreen.classList.add('hidden');
    arScreen.style.display = 'block';

    hudCount.textContent = `${nearbyBoxes.length} 📦`;
    arStatus.textContent  = nearbyBoxes.length
      ? `${nearbyBoxes.length} treasure${nearbyBoxes.length > 1 ? 's' : ''} nearby — scan around!`
      : `📍 No treasures within ${SCAN_RADIUS}m`;

    rafId = requestAnimationFrame(renderAR);

  } catch (err) {
    permStatus.textContent = '⚠️ ' + (err.message || 'Initialization failed');
    startBtn.disabled = false;
  }
}

// ── 이벤트 ────────────────────────────────────────────────────────────────────
// 백그라운드 진입 시 RAF 정지 → 발열·배터리 절약
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  } else if (arScreen.style.display !== 'none') {
    lastFrameTs = 0;
    rafId = requestAnimationFrame(renderAR);
  }
});

startBtn.addEventListener('click', init);
claimBtn.addEventListener('click', handleClaim);
hudBack.addEventListener('click', () => {
  if (rafId) cancelAnimationFrame(rafId);
  if (gpsWatchId != null) navigator.geolocation.clearWatch(gpsWatchId);
  if (arVideo.srcObject) arVideo.srcObject.getTracks().forEach(t => t.stop());
  history.back();
});

// ── Auth ──────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, u => { currentUser = u; });

// ── particle keyframe (DOM) ───────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
  @keyframes particleFly {
    0%   { transform:translate(0,0) scale(1); opacity:1; }
    100% { transform:translate(var(--tx),var(--ty)) scale(0); opacity:0; }
  }
`;
document.head.appendChild(style);
