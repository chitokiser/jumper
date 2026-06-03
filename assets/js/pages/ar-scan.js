// /assets/js/pages/ar-scan.js
// AR 보물 스캐너 — treasure_boxes + user_treasure_npcs

import { auth, db, functions } from '../firebase-init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { collection, getDocs, getDoc, doc, query, where } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const fnCollect = httpsCallable(functions, 'collectTreasureBox');

// ── 상수 ──────────────────────────────────────────────────────────────────────
const SCAN_RADIUS            = 300;  // m: Firestore 로드 반경 (넉넉하게)
const CLAIM_RADIUS           = 30;   // m: 이 거리 이내여야 획득 가능
const DISPLAY_RADIUS_NORMAL  = 30;   // m: 일반 유저 AR 레이더 표시 반경
const DISPLAY_RADIUS_PREMIUM = 100;  // m: 정회원 AR 레이더 표시 반경
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
let currentUser      = null;
let userLat          = null;
let userLng          = null;
let compassHead      = 0;
let compassReady     = false;
let nearbyBoxes      = [];
let targetBox        = null;
let rafId            = null;
let gpsWatchId       = null;
let lastSonarTs      = 0;
let prevAimed        = null;
let isAdminUser      = false;
let isPremiumUser    = false;  // 정회원 여부
let userDisplayRadius = DISPLAY_RADIUS_NORMAL; // 현재 레이더 표시 반경

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

// ── Firestore: 근처 박스 + 개인 보물 NPC 로드 ────────────────────────────────
async function loadNearbyBoxes(lat, lng) {
  const now = Date.now();

  // 관리자 판별
  isAdminUser  = false;
  isPremiumUser = false;
  if (currentUser) {
    const [adminSnap, userSnap] = await Promise.all([
      getDoc(doc(db, 'admins', currentUser.uid)),
      getDoc(doc(db, 'users',  currentUser.uid)),
    ]);
    if (adminSnap.exists()) isAdminUser = true;

    // 정회원 확인 (UTC+7 기준 오늘 날짜와 비교)
    const coopUntil  = (userSnap.data() || {}).coopMemberUntil;
    const todayUtc7  = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
    isPremiumUser    = !!(coopUntil && coopUntil >= todayUtc7);
  }
  userDisplayRadius = isPremiumUser ? DISPLAY_RADIUS_PREMIUM : DISPLAY_RADIUS_NORMAL;

  // ── treasure_boxes (관리자·가맹점 생성 공개 보물만) ────────────────────────
  // hiddenBox: true 인 숨김 보물은 AR에서 제외 — 지도 근접 감지로만 발견 가능
  const boxSnap = await getDocs(
    query(collection(db, 'treasure_boxes'), where('active', '==', true))
  );

  const allBoxes = boxSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(b => b.lat != null && b.lng != null && !b.hiddenBox);

  const combined = [...allBoxes];

  // 관리자: 거리·시간 필터 없이 전부 표시
  if (isAdminUser) return combined;

  // ── 레이더 반경 필터 ─────────────────────────────────────────────────────────
  // 정회원 100m / 일반 30m — box.scanRadius 와 userDisplayRadius 중 작은 값 적용
  const withinRange = combined.filter(b => {
    const effectiveR = Math.min(b.scanRadius ?? SCAN_RADIUS, userDisplayRadius);
    return haversine(lat, lng, b.lat, b.lng) <= effectiveR;
  });

  if (!currentUser || !withinRange.length) return withinRange;

  // 리스폰 로그 체크 (이미 수집한 박스 제외)
  const logs = await Promise.all(
    withinRange.map(b => getDoc(doc(db, 'treasure_logs', `${currentUser.uid}_${b.id}`)))
  );
  return withinRange.filter((b, i) => {
    if (!logs[i].exists()) return true;
    const d = logs[i].data();
    const lastMs    = d.collectedAt?.toMillis?.() || 0;
    const respawnMs = d.respawnIntervalMs ?? b.respawnIntervalMs ?? 86400000;
    return lastMs + respawnMs <= now;
  });
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

// ── 오디오 시스템 ──────────────────────────────────────────────────────────────
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// 소나 핑 — 거리가 가까울수록 고음·짧은 간격, 획득범위 내엔 더블핑
function playSonarPing(dist, claimR) {
  try {
    const ctx = getAudio();
    const inClaim = dist <= claimR;
    const ratio = Math.max(0, 1 - dist / Math.max(claimR * 8, 400));
    const freq = 320 + ratio * 880;
    const makeBeep = (f, startT, vol, dur) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = inClaim ? 'square' : 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, startT);
      g.gain.linearRampToValueAtTime(vol, startT + 0.018);
      g.gain.exponentialRampToValueAtTime(0.001, startT + dur);
      o.start(startT); o.stop(startT + dur + 0.01);
    };
    const t = ctx.currentTime;
    makeBeep(freq, t, inClaim ? 0.28 : 0.12, inClaim ? 0.1 : 0.16);
    if (inClaim) makeBeep(freq * 1.6, t + 0.13, 0.22, 0.09); // 더블 핑
  } catch (_) {}
}

// 조준 로크온 사운드
function playLockOn() {
  try {
    const ctx = getAudio();
    [900, 1100, 1400].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'square'; o.frequency.value = f;
      const t = ctx.currentTime + i * 0.065;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.075);
      o.start(t); o.stop(t + 0.09);
    });
  } catch (_) {}
}

// 획득 성공 사운드 (강화)
function playSuccess() {
  try {
    const ctx = getAudio();
    // 상승 팡파르
    [523, 659, 784, 1047, 1319].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = i < 3 ? 'triangle' : 'sine'; o.frequency.value = f;
      const t0 = ctx.currentTime + i * 0.1;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.35, t0 + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
      o.start(t0); o.stop(t0 + 0.55);
    });
    // 저음 타격감
    const sub = ctx.createOscillator(), sg = ctx.createGain();
    sub.connect(sg); sg.connect(ctx.destination);
    sub.type = 'sine'; sub.frequency.setValueAtTime(120, ctx.currentTime);
    sub.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.3);
    sg.gain.setValueAtTime(0.5, ctx.currentTime);
    sg.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    sub.start(ctx.currentTime); sub.stop(ctx.currentTime + 0.4);
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

  // ── 소나 핑: 가장 가까운 보물 기준 ──────────────────────────────────────────
  let sonarDist = Infinity, sonarClaimR = CLAIM_RADIUS;
  if (userLat) {
    for (const box of nearbyBoxes) {
      const d = haversine(userLat, userLng, box.lat, box.lng);
      if (d < sonarDist) { sonarDist = d; sonarClaimR = box.radius ?? CLAIM_RADIUS; }
    }
  }
  if (sonarDist < Infinity) {
    // 거리에 따라 핑 간격: 클레임범위 밖 400m→2200ms, 30m→600ms / 클레임범위 내→300ms
    const inClaim = sonarDist <= sonarClaimR;
    const sonarInterval = inClaim
      ? 300
      : Math.max(600, 600 + (Math.min(sonarDist, 400) / 400) * 1600);
    if (ts - lastSonarTs > sonarInterval) {
      playSonarPing(sonarDist, sonarClaimR);
      lastSonarTs = ts;
    }
  }

  // ── 획득 범위 내 보물 수 (비네트용) ─────────────────────────────────────────
  let claimableVisible = 0;

  for (const box of nearbyBoxes) {
    const bear  = bearing(userLat, userLng, box.lat, box.lng);
    const diff  = angleDiff(bear, compassHead);

    if (Math.abs(diff) > FOV_DEG / 2) continue;

    const dist         = haversine(userLat, userLng, box.lat, box.lng);
    const claimR       = box.radius ?? CLAIM_RADIUS;
    const inClaimRange = dist <= claimR;

    // 운영 시간 외에는 표시하지 않음 (관리자는 시간 제한 없음)
    if (!isAdminUser && !isInTimeRange(box.startHour ?? 0, box.endHour ?? 24)) continue;

    // 획득 가능 여부에 따라 색상·크기 분기
    const scale    = inClaimRange ? 1.4 : 1.0;
    const ringColor = inClaimRange ? '#4ade80' : '#f59e0b';
    const glowColor = inClaimRange ? '#4ade80' : '#fbbf24';
    const size     = CHEST_BASE * scale;
    const screenX  = W/2 + (diff / (FOV_DEG/2)) * (W/2);
    const bounce   = inClaimRange ? Math.sin(now * 3 + box._phase) * 10 : Math.sin(now * 1.5 + box._phase) * 4;
    const screenY  = H * 0.40 + bounce;

    if (inClaimRange) claimableVisible++;
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
  drawCrosshair(W, H, aimed);

  // 획득 가능 보물이 화면에 있으면 가장자리 비네트
  if (claimableVisible > 0) drawVignette(W, H, now);

  // ── 레이더 범위 배지 (우측 상단) ─────────────────────────────────────────────
  {
    const badgeText = isPremiumUser
      ? `⭐ ${DISPLAY_RADIUS_PREMIUM}m`
      : `🔒 ${DISPLAY_RADIUS_NORMAL}m`;
    const badgeBg  = isPremiumUser ? 'rgba(34,197,94,0.75)' : 'rgba(251,191,36,0.70)';
    arCtx.save();
    arCtx.font = 'bold 11px sans-serif';
    const tw  = arCtx.measureText(badgeText).width;
    const bw  = tw + 16, bh = 22, bx = W - bw - 8, by = 8;
    arCtx.fillStyle = 'rgba(0,0,0,0.45)';
    arCtx.beginPath();
    arCtx.roundRect(bx - 1, by - 1, bw + 2, bh + 2, 5);
    arCtx.fill();
    arCtx.fillStyle = badgeBg;
    arCtx.beginPath();
    arCtx.roundRect(bx, by, bw, bh, 4);
    arCtx.fill();
    arCtx.fillStyle = '#fff';
    arCtx.textAlign = 'center';
    arCtx.textBaseline = 'middle';
    arCtx.fillText(badgeText, bx + bw / 2, by + bh / 2);
    arCtx.restore();

    // 비프리미엄: 화면 하단에 업그레이드 힌트
    if (!isPremiumUser && !nearbyBoxes.length) {
      arCtx.save();
      arCtx.font = '12px sans-serif';
      arCtx.fillStyle = 'rgba(251,191,36,0.85)';
      arCtx.textAlign = 'center';
      arCtx.textBaseline = 'bottom';
      arCtx.fillText('⭐ Premium: 100m 레이더 · 매일 게임코인 3,500GP 충전', W / 2, H - 44);
      arCtx.restore();
    }
  }

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
    if (aimed && !prevAimed) playLockOn();   // 새로 조준
    targetBox = aimed;
    updateClaimPanel();
  }
  prevAimed = aimed;
}

function drawCrosshair(W, H, aimed) {
  const cx = W/2, cy = H*0.40;
  arCtx.save();
  arCtx.strokeStyle = aimed ? 'rgba(74,222,128,.9)' : 'rgba(251,191,36,.55)';
  arCtx.lineWidth = aimed ? 2 : 1.5;
  arCtx.setLineDash([5, 5]);
  arCtx.beginPath(); arCtx.moveTo(cx-28, cy); arCtx.lineTo(cx+28, cy); arCtx.stroke();
  arCtx.beginPath(); arCtx.moveTo(cx, cy-28); arCtx.lineTo(cx, cy+28); arCtx.stroke();
  // 조준 코너 브래킷
  if (aimed) {
    arCtx.setLineDash([]);
    arCtx.lineWidth = 2.5;
    const r = 22;
    [[cx-r,cy-r,1,1],[cx+r,cy-r,-1,1],[cx-r,cy+r,1,-1],[cx+r,cy+r,-1,-1]].forEach(([x,y,sx,sy]) => {
      arCtx.beginPath(); arCtx.moveTo(x+sx*10,y); arCtx.lineTo(x,y); arCtx.lineTo(x,y+sy*10); arCtx.stroke();
    });
  }
  arCtx.restore();
}

// 획득 가능 보물 존재 시 화면 가장자리 초록 비네트
function drawVignette(W, H, now) {
  const alpha = 0.18 + 0.14 * Math.abs(Math.sin(now * 3.5));
  const grad = arCtx.createRadialGradient(W/2, H/2, H*0.25, W/2, H/2, H*0.85);
  grad.addColorStop(0, 'transparent');
  grad.addColorStop(1, `rgba(74,222,128,${alpha})`);
  arCtx.save();
  arCtx.fillStyle = grad;
  arCtx.fillRect(0, 0, W, H);
  arCtx.restore();
}

// ── Claim 패널 갱신 ───────────────────────────────────────────────────────────
function updateClaimPanel() {
  if (targetBox) {
    const dist    = userLat ? Math.round(haversine(userLat, userLng, targetBox.lat, targetBox.lng)) : null;
    const claimR  = targetBox.radius ?? CLAIM_RADIUS;
    const inRange = dist !== null && dist <= claimR;

    claimName.textContent = `📦 ${targetBox.name || 'Treasure Chest'}`;
    claimDist.textContent = dist !== null
      ? (inRange ? `${dist}m — 획득 가능!` : `${dist}m (${claimR}m 이내로 접근하세요)`)
      : '위치 확인 중...';
    claimResult.textContent = '';

    claimBtn.disabled = !inRange;
    claimBtn.textContent = '📦 Claim Treasure';
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
  claimBtn.textContent = '⏳ Claiming...';
  claimResult.textContent = '';

  const box = nearbyBoxes.find(b => b.id === boxId);

  try {
    const res = await fnCollect({ boxId, userLat, userLng });
    const msg = res.data?.message || 'Treasure claimed! 🎉';

    playSuccess();
    if (navigator.vibrate) navigator.vibrate([200, 100, 300]);
    spawnParticles(window.innerWidth/2, window.innerHeight*0.4);

    claimResult.textContent = `🎉 ${msg}`;
    claimResult.style.color = '#86efac';

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
    const radarTag = isPremiumUser
      ? `⭐ ${DISPLAY_RADIUS_PREMIUM}m Premium Radar`
      : `🔒 ${DISPLAY_RADIUS_NORMAL}m | ⭐ Upgrade→${DISPLAY_RADIUS_PREMIUM}m`;
    arStatus.textContent = nearbyBoxes.length
      ? `${nearbyBoxes.length} treasure${nearbyBoxes.length > 1 ? 's' : ''} nearby — ${radarTag}`
      : `No treasures within ${userDisplayRadius}m — ${radarTag}`;

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

startBtn.addEventListener('click', () => {
  // 사용자 제스처 컨텍스트에서 즉시 풀스크린 진입
  // (await 이후엔 브라우저가 제스처 체인을 끊어 requestFullscreen 거부)
  const fsTarget = document.documentElement;
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    (fsTarget.requestFullscreen ?? fsTarget.webkitRequestFullscreen)
      ?.call(fsTarget).catch(() => {});
  }
  init();
});
claimBtn.addEventListener('click', handleClaim);
hudBack.addEventListener('click', () => {
  if (rafId) cancelAnimationFrame(rafId);
  if (gpsWatchId != null) navigator.geolocation.clearWatch(gpsWatchId);
  if (arVideo.srcObject) arVideo.srcObject.getTracks().forEach(t => t.stop());
  const exitFs = document.exitFullscreen ?? document.webkitExitFullscreen;
  const back   = () => history.back();
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    exitFs?.call(document).then(back).catch(back);
  } else {
    back();
  }
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
