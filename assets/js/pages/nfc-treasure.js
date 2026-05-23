// /assets/js/pages/nfc-treasure.js
// NFC 보물 감지 — 유저 페이지

import { auth, functions } from '../firebase-init.js';
import { login } from '../auth.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

// ── DOM 캐싱 ──────────────────────────────────────────────────────────────────
const scanScreen   = document.getElementById('scanScreen');
const foundScreen  = document.getElementById('foundScreen');
const errorScreen  = document.getElementById('errorScreen');
const scanStatus   = document.getElementById('scanStatus');
const chestIcon    = document.getElementById('chestIcon');
const messageBox   = document.getElementById('messageBox');
const messageText  = document.getElementById('messageText');
const rewardInfo   = document.getElementById('rewardInfo');
const rewardText   = document.getElementById('rewardText');
const claimBtn       = document.getElementById('claimBtn');
const claimResult    = document.getElementById('claimResult');
const loginPrompt    = document.getElementById('loginPrompt');
const loginGoogleBtn = document.getElementById('loginGoogleBtn');
const errorMsg       = document.getElementById('errorMsg');
const starField      = document.getElementById('starField');

let currentUser = null;
let tagId = null;
let deviceFingerprint = null;
let tagData = null;

// ── 별 배경 ───────────────────────────────────────────────────────────────────
function buildStars() {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 80; i++) {
    const s = document.createElement('div');
    s.className = 'star';
    s.style.cssText = `left:${Math.random()*100}%;top:${Math.random()*100}%;animation-delay:${Math.random()*3}s;animation-duration:${2+Math.random()*3}s`;
    frag.appendChild(s);
  }
  starField.appendChild(frag);
}

// ── 기기 지문 생성 ────────────────────────────────────────────────────────────
async function getDeviceFingerprint() {
  const raw = [
    navigator.userAgent,
    navigator.language,
    `${screen.width}x${screen.height}`,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency || 0,
    navigator.platform || '',
    navigator.maxTouchPoints || 0,
  ].join('|');

  const buf = new TextEncoder().encode(raw);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── 진동 ──────────────────────────────────────────────────────────────────────
function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// ── Web Audio 사운드 ──────────────────────────────────────────────────────────
function playDiscoverySound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.12);
      gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + i * 0.12 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.4);

      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.4);
    });
  } catch (_) {}
}

function playSuccessSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [784, 1047, 1319, 1568];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.5);
      osc.start(ctx.currentTime + i * 0.1);
      osc.stop(ctx.currentTime + i * 0.1 + 0.5);
    });
  } catch (_) {}
}

// ── 파티클 폭발 ───────────────────────────────────────────────────────────────
function spawnParticles(x, y) {
  const colors = ['#fde68a', '#f59e0b', '#fb923c', '#facc15', '#fff'];
  for (let i = 0; i < 24; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const angle = (Math.PI * 2 * i) / 24;
    const dist  = 80 + Math.random() * 120;
    p.style.cssText = `
      left:${x}px; top:${y}px;
      background:${colors[Math.floor(Math.random()*colors.length)]};
      --tx:${Math.cos(angle)*dist}px;
      --ty:${Math.sin(angle)*dist}px;
      animation-duration:${0.8+Math.random()*0.7}s;
    `;
    document.body.appendChild(p);
    p.addEventListener('animationend', () => p.remove(), { once: true });
  }
}

// ── 타이핑 효과 ───────────────────────────────────────────────────────────────
function typewrite(el, text, speed = 40) {
  el.textContent = '';
  let i = 0;
  const tick = setInterval(() => {
    el.textContent += text[i++];
    if (i >= text.length) clearInterval(tick);
  }, speed);
}

// ── 화면 전환 ─────────────────────────────────────────────────────────────────
function showFound(tag) {
  tagData = tag;
  scanScreen.classList.add('hidden');
  errorScreen.classList.add('hidden');
  foundScreen.classList.remove('hidden');

  // 애니메이션
  const chest = chestIcon;
  chest.classList.remove('treasure-pop');
  void chest.offsetWidth; // reflow
  chest.classList.add('treasure-pop');

  // 아이콘 결정
  const iconMap = { item: '📦', points: '✨', voucher: '🎫', none: '🔮' };
  chest.textContent = iconMap[tag.rewardType] || '📦';

  // 숨겨진 메시지
  if (tag.message) {
    messageBox.classList.remove('hidden');
    typewrite(messageText, tag.message);
  }

  // 보상 미리보기
  if (tag.rewardType !== 'none') {
    rewardInfo.classList.remove('hidden');
    if (tag.rewardType === 'item') {
      rewardText.textContent = `아이템 ${tag.rewardItemCount || 1}개`;
    } else if (tag.rewardType === 'points') {
      rewardText.textContent = `포인트 +${tag.rewardPoints}`;
    } else if (tag.rewardType === 'voucher') {
      rewardText.textContent = '특별 바우처';
    }
  }

  // 파티클 + 진동 + 사운드
  vibrate([100, 50, 200, 50, 300]);
  playDiscoverySound();
  const rect = chest.getBoundingClientRect();
  spawnParticles(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function showError(msg) {
  scanScreen.classList.add('hidden');
  foundScreen.classList.add('hidden');
  errorScreen.classList.remove('hidden');
  errorMsg.textContent = msg;
}

// ── URL에서 tagId 파싱 ────────────────────────────────────────────────────────
function getTagIdFromUrl() {
  return new URLSearchParams(location.search).get('tag');
}

// ── 태그 정보 조회 (Firestore 직접 읽기) ──────────────────────────────────────
async function fetchTagPublicData(id) {
  const { db } = await import('../firebase-init.js');
  const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const snap = await getDoc(doc(db, 'nfc_tags', id));
  if (!snap.exists()) return null;
  return snap.data();
}

// ── 수령 처리 ─────────────────────────────────────────────────────────────────
async function handleClaim() {
  if (!currentUser) {
    claimBtn.classList.add('hidden');
    loginPrompt.classList.remove('hidden');
    return;
  }

  loginPrompt.classList.add('hidden');
  claimBtn.disabled = true;
  claimBtn.textContent = '처리 중...';

  try {
    const fn = httpsCallable(functions, 'claimNfcTreasure');
    const res = await fn({ tagId, deviceFingerprint });
    const { reward, message: msg } = res.data;

    // 성공
    vibrate([200, 100, 200, 100, 400]);
    playSuccessSound();

    const rect = chestIcon.getBoundingClientRect();
    spawnParticles(rect.left + rect.width / 2, rect.top + rect.height / 2);
    spawnParticles(window.innerWidth / 2, window.innerHeight / 2);

    chestIcon.textContent = '🎉';

    // 메시지 갱신
    if (msg && !messageBox.classList.contains('hidden')) {
      typewrite(messageText, msg);
    }

    // 결과 표시
    let resultHtml = '';
    if (reward.type === 'item') {
      resultHtml = `🎁 아이템 ${reward.count}개를 획득했습니다!`;
    } else if (reward.type === 'points') {
      resultHtml = `✨ 포인트 ${reward.points}점을 획득했습니다!`;
    } else {
      resultHtml = '✅ 보물을 획득했습니다!';
    }

    claimResult.textContent = resultHtml;
    claimResult.className = 'w-full max-w-sm p-4 rounded-xl text-sm font-bold text-center bg-green-900/50 border border-green-500/40 text-green-300';
    claimResult.classList.remove('hidden');
    claimBtn.classList.add('hidden');

  } catch (err) {
    const code = err.code || '';
    let msg = err.message || '오류가 발생했습니다';
    if (code === 'functions/resource-exhausted') msg = err.message;
    if (code === 'functions/permission-denied')  msg = err.message;

    claimResult.textContent = '⚠️ ' + msg;
    claimResult.className = 'w-full max-w-sm p-4 rounded-xl text-sm font-bold text-center bg-red-900/50 border border-red-500/40 text-red-300';
    claimResult.classList.remove('hidden');
    claimBtn.disabled = false;
    claimBtn.textContent = '다시 시도';
  }
}

// ── 메인 초기화 ───────────────────────────────────────────────────────────────
async function init() {
  buildStars();

  tagId = getTagIdFromUrl();
  if (!tagId) {
    showError('유효하지 않은 NFC 태그입니다. URL에 tag 파라미터가 없습니다.');
    return;
  }

  // 기기 지문
  deviceFingerprint = await getDeviceFingerprint();

  // Auth 상태
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;

    if (!user) {
      // 비로그인이어도 발견 화면은 보여줌, 수령 시 로그인 유도
      scanStatus.textContent = '태그를 확인하는 중...';
    }

    // 태그 공개 정보 로드
    try {
      const tag = await fetchTagPublicData(tagId);
      if (!tag) {
        showError('이 NFC 태그는 존재하지 않거나 삭제된 보물입니다.');
        return;
      }
      if (!tag.active) {
        showError('이 NFC 보물은 현재 비활성화 상태입니다.');
        return;
      }

      // 발견 화면으로 전환
      showFound(tag);

    } catch (err) {
      showError('태그 정보를 불러오는 중 오류가 발생했습니다: ' + err.message);
    }
  });

  // 수령 버튼
  claimBtn.addEventListener('click', handleClaim);

  // Google 로그인 버튼 — 팝업 로그인 후 자동 수령
  loginGoogleBtn.addEventListener('click', async () => {
    loginGoogleBtn.disabled = true;
    loginGoogleBtn.textContent = '로그인 중...';
    try {
      await login();
      // onAuthStateChanged 콜백이 currentUser를 갱신할 때까지 잠깐 대기
      await new Promise(r => setTimeout(r, 800));
      loginPrompt.classList.add('hidden');
      claimBtn.classList.remove('hidden');
      claimBtn.disabled = false;
      claimBtn.textContent = '보물 수령하기';
      handleClaim();
    } catch (e) {
      loginGoogleBtn.disabled = false;
      loginGoogleBtn.textContent = 'Google로 로그인 후 수령';
    }
  });
}

init();
