// /assets/js/jackpot-anim.js
// 잭팟 슬롯머신 애니메이션 공유 모듈

function pad(n) {
  return String(Math.max(0, Math.min(9999, Math.round(n)))).padStart(4, "0");
}

// ── Web Audio API 사운드 엔진 ──────────────────────────────────────────────────
let _ctx = null;
function getAudioCtx() {
  if (!_ctx) {
    try { _ctx = new (window.AudioContext || window["webkitAudioContext"])(); } catch (_) { }
  }
  if (_ctx && _ctx.state === "suspended") _ctx.resume();
  return _ctx;
}

// 첫 사용자 제스처 시점에 오디오 컨텍스트 unlock
function _unlockAudio() {
  getAudioCtx();
}
document.addEventListener("click", _unlockAudio, { once: true, capture: true });
document.addEventListener("touchstart", _unlockAudio, { once: true, capture: true });

/**
 * 짧은 클릭/틱 사운드
 * @param {number} freq    - 주파수(Hz)
 * @param {number} vol     - 볼륨 (0~1)
 * @param {number} dur     - 지속시간(초)
 * @param {string} type    - 파형 ('sine'|'square'|'sawtooth'|'triangle')
 * @param {number} [when]  - AudioContext 기준 시작 시각 (기본: 지금)
 */
function playTone(freq, vol, dur, type = "sine", when = 0) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const t = when || ctx.currentTime;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);

  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.start(t);
  osc.stop(t + dur + 0.01);
}

/** 스핀 중 틱 사운드 (카지노 드럼 느낌) */
function playSpinTick() {
  playTone(420, 0.4, 0.05, "square");
  if (navigator.vibrate) navigator.vibrate(15);
}

/** 슬로우다운 클릭: 단계가 올라갈수록 더 낮고 묵직하게 */
function playSlowClick(stepIndex) {
  const freq = 380 - stepIndex * 28;
  const vol = 0.4 + stepIndex * 0.05;
  playTone(freq, vol, 0.1, "triangle");
  if (navigator.vibrate) navigator.vibrate(30);
}

/** 최종 번호 착지 '쿵' 소리 */
function playLand() {
  playTone(110, 0.8, 0.35, "sine");
  playTone(880, 0.4, 0.2, "triangle", getAudioCtx()?.currentTime + 0.03);
  if (navigator.vibrate) navigator.vibrate([80, 50, 150]);
}

/** 당첨 팡파레 */
function playWinFanfare() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const notes = [261.63, 329.63, 392.00, 523.25, 1046.5];
  notes.forEach((f, i) => {
    const t = ctx.currentTime + i * 0.15;
    playTone(f, 0.6, 0.4, "sine", t);
  });
  if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
}

/** 꽝 사운드 */
function playLoseTone() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  playTone(220, 0.8, 0.4, "sawtooth");
  playTone(164.81, 0.8, 0.5, "sawtooth", ctx.currentTime + 0.25);
  if (navigator.vibrate) navigator.vibrate([300, 100, 500]);
}

// ── 슬롯머신 초기화 ───────────────────────────────────────────────────────────

/**
 * 슬롯머신 초기화
 * @param {HTMLElement} waitEl  - jp-waiting 엘리먼트
 * @returns {{ stop(finalValue, isWin, onDone): void }}
 */
export function initSlot(waitEl) {
  if (!waitEl) return { stop: (_v, _w, cb) => cb && cb() };

  waitEl.innerHTML = `
    <div class="jp-slot-wrap">
      <div class="jp-slot-header">🎰 잭팟 참여!</div>
      <div class="jp-drum-box">
        <div class="jp-drum-reel">
          <span class="jp-drum-num">0000</span>
        </div>
      </div>
      <div class="jp-slot-sub">행운의 번호 추첨 중...</div>
      <div class="jp-slot-bar"><div class="jp-slot-bar-inner"></div></div>
    </div>
  `;
  waitEl.style.cssText = "";

  const numEl = waitEl.querySelector(".jp-drum-num");
  const subEl = waitEl.querySelector(".jp-slot-sub");
  const barEl = waitEl.querySelector(".jp-slot-bar-inner");

  // 빠른 스핀 + 틱 사운드
  let spinTickCount = 0;
  const spinId = setInterval(() => {
    if (numEl) numEl.textContent = pad(Math.random() * 10000);
    spinTickCount++;
    if (spinTickCount % 5 === 0) playSpinTick(); // ~225ms 마다 틱
  }, 45);

  // 진행바 애니메이션 (30s 기준)
  let barPct = 0;
  const barId = setInterval(() => {
    barPct = Math.min(90, barPct + 0.5);
    if (barEl) barEl.style.width = barPct + "%";
  }, 150);

  return {
    stop(finalValue, isWin, onDone) {
      clearInterval(spinId);
      clearInterval(barId);
      if (barEl) barEl.style.width = "100%";
      if (subEl) subEl.textContent = "번호 확정 중...";

      // 슬로우다운 단계: [딜레이ms, 랜덤범위]
      const steps = [
        [70, 4000],
        [110, 2000],
        [160, 900],
        [220, 380],
        [300, 130],
        [420, 40],
        [580, 8],
        [780, 0],
      ];
      let i = 0;

      (function tick() {
        if (i >= steps.length) {
          // 최종 착지
          if (numEl) {
            numEl.textContent = pad(finalValue);
            numEl.classList.add("jp-drum-land");
          }
          if (subEl) subEl.textContent = isWin ? "🎉 당첨 번호 확정!" : "번호 확정";
          if (barEl) barEl.parentElement.style.display = "none";

          playLand();
          setTimeout(() => {
            if (isWin) playWinFanfare();
            else playLoseTone();
          }, 200);

          setTimeout(() => onDone && onDone(), 750);
          return;
        }
        const [delay, spread] = steps[i];
        playSlowClick(i);
        i++;
        const show = spread > 0
          ? finalValue + Math.round((Math.random() - 0.5) * spread)
          : finalValue;
        if (numEl) numEl.textContent = pad(show);
        setTimeout(tick, delay);
      })();
    },
  };
}
