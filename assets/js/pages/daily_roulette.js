// /assets/js/pages/daily_roulette.js
// 매일 1회 무료 럭키 룰렛 + 7일 연속 출석 보너스 (베트남 시간 UTC+7 기준 일 1회)

import { auth, db, functions } from "/assets/js/firebase-init.js";
import {
  doc,
  getDoc,
  setDoc,
  increment,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const SEGMENTS = [
  { label: "100 GP", amount: 100, color: "#6366f1", weight: 28 },
  { label: "200 GP", amount: 200, color: "#0ea5e9", weight: 24 },
  { label: "300 GP", amount: 300, color: "#10b981", weight: 18 },
  { label: "500 GP", amount: 500, color: "#f59e0b", weight: 14 },
  { label: "1,000 GP", amount: 1000, color: "#ef4444", weight: 8 },
  { label: "1,500 GP", amount: 1500, color: "#ec4899", weight: 4 },
  { label: "2,000 GP", amount: 2000, color: "#8b5cf6", weight: 2.5 },
  { label: "3,000 GP", amount: 3000, color: "#eab308", weight: 1.5 },
];

const STREAK_BONUS_GP = 2000;
const LOCAL_SPIN_KEY = "bc_daily_roulette_date_v1";

function getVnDateStr(offsetDays = 0) {
  const vnNow = new Date(Date.now() + 7 * 3600 * 1000 + offsetDays * 86400 * 1000);
  return vnNow.toISOString().slice(0, 10);
}

function pickWeightedIndex() {
  const total = SEGMENTS.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (let i = 0; i < SEGMENTS.length; i++) {
    r -= SEGMENTS[i].weight;
    if (r <= 0) return i;
  }
  return 0;
}

function drawWheel(canvas, rotationRad = 0) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  const cx = W / 2;
  const cy = H / 2;
  const radius = Math.min(cx, cy) - 10;
  const n = SEGMENTS.length;
  const arc = (Math.PI * 2) / n;

  ctx.clearRect(0, 0, W, H);

  // 외곽 골드 링
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
  ctx.fillStyle = "#fbbf24";
  ctx.fill();

  for (let i = 0; i < n; i++) {
    const start = rotationRad + i * arc - Math.PI / 2;
    const end = start + arc;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = SEGMENTS[i].color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();

    // 텍스트
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(start + arc / 2);
    ctx.textAlign = "right";
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 17px 'Pretendard', 'Malgun Gothic', sans-serif";
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 4;
    ctx.fillText(SEGMENTS[i].label, radius - 16, 6);
    ctx.restore();
  }

  // 중앙 허브
  ctx.beginPath();
  ctx.arc(cx, cy, 26, 0, Math.PI * 2);
  ctx.fillStyle = "#0f172a";
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#fde047";
  ctx.stroke();

  ctx.fillStyle = "#fde047";
  ctx.font = "900 13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("SPIN", cx, cy + 5);
}

function mountRouletteModal() {
  if (document.getElementById("bcRouletteBackdrop")) return;

  const style = document.createElement("style");
  style.textContent = `
    .bc-rl-backdrop {
      position: fixed;
      inset: 0;
      z-index: 10020;
      background: rgba(15, 23, 42, 0.72);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .bc-rl-backdrop.is-open { display: flex; }
    .bc-rl-modal {
      width: min(400px, 100%);
      max-height: 92vh;
      overflow-y: auto;
      background: linear-gradient(180deg, #1e1b4b 0%, #0f172a 100%);
      color: #fff;
      border: 2px solid #fbbf24;
      border-radius: 24px;
      padding: 20px;
      text-align: center;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
    }
    .bc-rl-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .bc-rl-head h3 { margin: 0; font-size: 1.08rem; font-weight: 900; color: #fde047; }
    .bc-rl-close {
      background: rgba(255,255,255,0.14);
      border: none;
      color: #fff;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      cursor: pointer;
      font-weight: 800;
    }
    .bc-rl-streak {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 4px;
      margin: 10px 0 14px;
    }
    .bc-rl-day {
      padding: 6px 2px;
      border-radius: 10px;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.12);
      font-size: 0.7rem;
      font-weight: 800;
      color: #cbd5e1;
    }
    .bc-rl-day.is-done {
      background: linear-gradient(135deg, #f59e0b, #ea580c);
      border-color: #fde047;
      color: #fff;
    }
    .bc-rl-wheel-wrap {
      position: relative;
      width: 280px;
      height: 280px;
      margin: 6px auto 14px;
    }
    .bc-rl-pointer {
      position: absolute;
      top: -10px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 12px solid transparent;
      border-right: 12px solid transparent;
      border-top: 22px solid #fde047;
      filter: drop-shadow(0 3px 6px rgba(0,0,0,0.6));
      z-index: 2;
      transform-origin: 50% 0%;
      transition: transform 0.06s ease;
    }
    .bc-rl-pointer.is-tick {
      transform: translateX(-50%) rotate(-18deg);
    }
    .bc-rl-head-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .bc-rl-btn {
      width: 100%;
      padding: 13px 16px;
      border-radius: 14px;
      border: none;
      background: linear-gradient(135deg, #fde047 0%, #f59e0b 60%, #ea580c 100%);
      color: #0f172a;
      font-size: 0.98rem;
      font-weight: 900;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(245, 158, 11, 0.45);
    }
    .bc-rl-btn:disabled { opacity: 0.45; cursor: not-allowed; }
    .bc-rl-msg {
      margin-top: 10px;
      font-size: 0.84rem;
      font-weight: 700;
      color: #86efac;
      min-height: 1.4em;
      line-height: 1.5;
    }
  `;
  document.head.appendChild(style);

  // ── Web Audio API 아케이드 사운드 엔진 (외부 파일 없이 즉시 재생) ──
  const SOUND_MUTE_KEY = "bc_roulette_muted_v1";
  let _audioCtx = null;
  let _muted = false;
  try { _muted = localStorage.getItem(SOUND_MUTE_KEY) === "1"; } catch (_) {}

  function ensureAudio() {
    if (_muted) return null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!_audioCtx) _audioCtx = new AC();
      if (_audioCtx.state === "suspended") _audioCtx.resume();
      return _audioCtx;
    } catch (_) {
      return null;
    }
  }

  function playStartSpin() {
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(760, now + 0.22);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  function playWheelTick(progress) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    // 회전이 느려질수록 묵직하고 긴장감 있는 핀 클릭음
    const freq = 980 - Math.min(340, progress * 320);
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.45, now + 0.045);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  function playWinFanfare(isJackpot) {
    const ctx = ensureAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = isJackpot
      ? [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5, 1567.98]
      : [523.25, 659.25, 783.99, 1046.5];
    const step = isJackpot ? 0.095 : 0.11;

    notes.forEach((freq, idx) => {
      const t = now + idx * step;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = isJackpot ? "sawtooth" : "triangle";
      osc.frequency.setValueAtTime(freq, t);

      const dur = idx === notes.length - 1 ? 0.55 : 0.18;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(isJackpot ? 0.14 : 0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    });
  }

  const el = document.createElement("div");
  el.id = "bcRouletteBackdrop";
  el.className = "bc-rl-backdrop";
  el.innerHTML = `
    <div class="bc-rl-modal" role="dialog" aria-modal="true" aria-label="오늘의 무료 럭키 룰렛">
      <div class="bc-rl-head">
        <h3>🎰 오늘의 무료 럭키 룰렛</h3>
        <div class="bc-rl-head-actions">
          <button type="button" class="bc-rl-close" id="bcRlMute" title="사운드 켜기/끄기">${_muted ? "🔇" : "🔊"}</button>
          <button type="button" class="bc-rl-close" id="bcRlClose">✕</button>
        </div>
      </div>
      <div style="font-size:0.78rem;color:#cbd5e1;">매일 1회 100% 당첨 · 7일 연속 출석 시 <b style="color:#fde047;">+2,000 GP</b> 추가!</div>
      <div class="bc-rl-streak" id="bcRlStreak"></div>
      <div class="bc-rl-wheel-wrap">
        <div class="bc-rl-pointer" id="bcRlPointer"></div>
        <canvas id="bcRlCanvas" width="280" height="280"></canvas>
      </div>
      <button type="button" class="bc-rl-btn" id="bcRlSpinBtn">🎯 무료 룰렛 돌리기!</button>
      <div class="bc-rl-msg" id="bcRlMsg"></div>
    </div>
  `;
  document.body.appendChild(el);

  const canvas = document.getElementById("bcRlCanvas");
  const pointerEl = document.getElementById("bcRlPointer");
  const muteBtn = document.getElementById("bcRlMute");
  const streakEl = document.getElementById("bcRlStreak");
  const spinBtn = document.getElementById("bcRlSpinBtn");
  const msgEl = document.getElementById("bcRlMsg");
  const closeBtn = document.getElementById("bcRlClose");

  let currentRotation = 0;
  let spinning = false;
  let state = { lastDate: "", streak: 0, alreadySpun: false };

  drawWheel(canvas, 0);

  muteBtn?.addEventListener("click", () => {
    _muted = !_muted;
    muteBtn.textContent = _muted ? "🔇" : "🔊";
    try { localStorage.setItem(SOUND_MUTE_KEY, _muted ? "1" : "0"); } catch (_) {}
    if (!_muted) playWheelTick(0.2);
  });

  const renderStreak = (streak) => {
    if (!streakEl) return;
    streakEl.innerHTML = [1, 2, 3, 4, 5, 6, 7]
      .map((d) => `<div class="bc-rl-day${d <= streak ? " is-done" : ""}">${d === 7 ? "7일🎁" : `${d}일`}</div>`)
      .join("");
  };

  const refreshState = async () => {
    const today = getVnDateStr(0);
    const yesterday = getVnDateStr(-1);
    const user = auth?.currentUser;

    if (!user || user.isAnonymous) {
      state = { lastDate: "", streak: 0, alreadySpun: false };
      renderStreak(0);
      spinBtn.disabled = false;
      spinBtn.textContent = "🔐 로그인하고 무료 룰렛 돌리기";
      msgEl.textContent = "로그인 회원은 매일 1회 무료 GP를 받을 수 있습니다.";
      msgEl.style.color = "#fde047";
      return;
    }

    try {
      const snap = await getDoc(doc(db, "battle_players", user.uid));
      const r = snap.exists() ? (snap.data()?.dailyRoulette || {}) : {};
      const lastDate = String(r.lastDate || "");
      let streak = Number(r.streak || 0);
      if (lastDate !== today && lastDate !== yesterday) streak = 0;
      const alreadySpun = lastDate === today || localStorage.getItem(`${LOCAL_SPIN_KEY}_${user.uid}`) === today;

      state = { lastDate, streak, alreadySpun };
      renderStreak(streak);

      if (alreadySpun) {
        spinBtn.disabled = true;
        spinBtn.textContent = "✅ 오늘 출석 룰렛 완료! (내일 다시 도전)";
        msgEl.textContent = r.lastPrize ? `오늘 획득 보상: +${Number(r.lastPrize).toLocaleString()} GP (${streak}일 연속 출석 중!)` : "오늘 이미 참여하셨습니다.";
        msgEl.style.color = "#86efac";
      } else {
        spinBtn.disabled = false;
        spinBtn.textContent = "🎯 무료 룰렛 돌리기!";
        msgEl.textContent = streak > 0 ? `🔥 현재 ${streak}일 연속 출석 중! 오늘 돌리면 ${streak + 1}일차!` : "버튼을 눌러 오늘의 GP를 받아가세요!";
        msgEl.style.color = "#e0e7ff";
      }
    } catch (_) {
      renderStreak(0);
      spinBtn.disabled = false;
      spinBtn.textContent = "🎯 무료 룰렛 돌리기!";
    }
  };

  const openModal = async () => {
    el.classList.add("is-open");
    await refreshState();
  };

  window.openBestClubRoulette = openModal;

  closeBtn?.addEventListener("click", () => { if (!spinning) el.classList.remove("is-open"); });
  el.addEventListener("click", (e) => { if (e.target === el && !spinning) el.classList.remove("is-open"); });

  spinBtn?.addEventListener("click", async () => {
    const user = auth?.currentUser;
    if (!user || user.isAnonymous) {
      location.href = "/register.html";
      return;
    }
    if (spinning || state.alreadySpun) return;

    // 사용자 클릭 제스처 시점에 오디오 컨텍스트 활성화 (모바일 iOS/Android 필수)
    ensureAudio();

    spinning = true;
    spinBtn.disabled = true;
    spinBtn.textContent = "🎰 서버 추첨 중...";
    msgEl.style.color = "#e0e7ff";
    msgEl.textContent = "서버에서 공정하게 추첨하고 있습니다... ✨";

    let result = null;
    try {
      const res = await httpsCallable(functions, "spinDailyRoulette")();
      result = res?.data || null;
    } catch (err) {
      spinning = false;
      spinBtn.disabled = false;
      spinBtn.textContent = "🎯 무료 룰렛 돌리기!";
      msgEl.style.color = "#fca5a5";
      msgEl.textContent = "추첨 요청 실패: " + (err?.message || "잠시 후 다시 시도해 주세요.");
      return;
    }

    if (!result || !result.granted) {
      state.alreadySpun = true;
      spinning = false;
      if (result?.streak) renderStreak(result.streak);
      spinBtn.disabled = true;
      spinBtn.textContent = "✅ 오늘 출석 룰렛 완료! (내일 다시 도전)";
      msgEl.style.color = "#86efac";
      msgEl.textContent = result?.lastPrize
        ? `오늘 이미 참여하셨습니다! (+${Number(result.lastPrize).toLocaleString()} GP 수령 완료)`
        : "오늘 이미 출석 룰렛을 완료하셨습니다.";
      try { localStorage.setItem(`${LOCAL_SPIN_KEY}_${user.uid}`, getVnDateStr(0)); } catch (_) {}
      return;
    }

    const winIdx = Number.isInteger(result.segmentIndex) ? result.segmentIndex : 0;
    spinBtn.textContent = "🎰 돌아가는 중...";
    msgEl.textContent = "행운을 빕니다! ✨";
    playStartSpin();

    const n = SEGMENTS.length;
    const arc = (Math.PI * 2) / n;
    const targetSectorAngle = -(winIdx * arc + arc / 2);
    const extraSpins = Math.PI * 2 * 6;
    const startRot = currentRotation % (Math.PI * 2);
    const delta = extraSpins + ((targetSectorAngle - startRot) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    const startTime = performance.now();
    const duration = 3800;
    let lastTickSector = Math.floor(startRot / arc);

    const animate = (now) => {
      const t = Math.min(1, (now - startTime) / duration);
      const ease = 1 - Math.pow(1 - t, 4);
      currentRotation = startRot + delta * ease;
      drawWheel(canvas, currentRotation);

      // 칸 경계를 지날 때마다 룰렛 핀 클릭음 + 포인터 튕김 효과
      const curSector = Math.floor(currentRotation / arc);
      if (curSector !== lastTickSector) {
        lastTickSector = curSector;
        playWheelTick(t);
        if (pointerEl) {
          pointerEl.classList.add("is-tick");
          setTimeout(() => pointerEl.classList.remove("is-tick"), 55);
        }
      }

      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        finishSpin(user, result);
      }
    };
    requestAnimationFrame(animate);
  });

  function finishSpin(user, result) {
    const today = result.today || getVnDateStr(0);
    const newStreak = Number(result.streak) || 1;
    const bonus = Number(result.streakBonus) || 0;
    const totalPrize = Number(result.totalPrize) || 0;
    const segLabel = result.label || `${Number(result.prize || 0).toLocaleString()} GP`;
    const isJackpot = totalPrize >= 1000 || bonus > 0;

    playWinFanfare(isJackpot);

    try {
      localStorage.setItem(`${LOCAL_SPIN_KEY}_${user.uid}`, today);
    } catch (_) {}

    state.alreadySpun = true;
    state.streak = newStreak;
    renderStreak(newStreak);
    spinning = false;
    spinBtn.textContent = "✅ 오늘 보상 수령 완료!";
    msgEl.style.color = "#fde047";
    msgEl.innerHTML = bonus > 0
      ? `🎉 대박! <b>${segLabel}</b> + 7일 개근 <b>+${bonus.toLocaleString()} GP</b> = 총 <b>+${totalPrize.toLocaleString()} GP</b> 지급!`
      : `🎉 축하합니다! <b>+${totalPrize.toLocaleString()} GP</b>가 계정에 지급되었습니다! (${newStreak}일 연속 출석)`;
  }
}

function _bootDailyRoulette() {
  mountRouletteModal();
  const trigger = document.getElementById("bcUtilRouletteBtn");
  if (trigger && !trigger.dataset.rlBound) {
    trigger.dataset.rlBound = "1";
    trigger.addEventListener("click", () => {
      if (window.openBestClubRoulette) window.openBestClubRoulette();
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _bootDailyRoulette);
} else {
  _bootDailyRoulette();
}
