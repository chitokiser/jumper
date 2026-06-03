// relay.sound.js — 이어달리기 전용 Web Audio 사운드 시스템

let _ac = null;

function ac() {
  if (!_ac || _ac.state === 'closed')
    _ac = new (window.AudioContext || window.webkitAudioContext)();
  if (_ac.state === 'suspended') _ac.resume();
  return _ac;
}

const tone = (freq, vol, dur, t = 0, type = 'sine') => {
  const ctx = ac();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  o.connect(g); g.connect(ctx.destination);
  g.gain.setValueAtTime(vol, ctx.currentTime + t);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + dur);
  o.start(ctx.currentTime + t);
  o.stop(ctx.currentTime + t + dur + 0.01);
};

const noise = (dur, vol = 0.3, lpFreq = 2000) => {
  const ctx = ac();
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lpFreq;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(lp); lp.connect(g); g.connect(ctx.destination);
  src.start(); return src;
};

// ── 사운드 효과 ──────────────────────────────────────────────────────────────

export function sfx(type) {
  try {
    switch (type) {

      // 발소리 (가벼운 탁-탁)
      case 'footstep':
        noise(0.04, 0.22, 400);
        tone(140, 0.18, 0.05, 0, 'sine');
        break;

      // 탭 부스트
      case 'tap':
        tone(520, 0.35, 0.06, 0, 'square');
        tone(780, 0.25, 0.09, 0.03, 'sine');
        noise(0.08, 0.15, 3000);
        break;

      // 바통 전달 (슉 + 짝)
      case 'baton': {
        noise(0.06, 0.45, 5000);
        tone(300, 0.4, 0.04, 0, 'sawtooth');
        tone(180, 0.3, 0.08, 0.04, 'sine');
        // 전달 성공 핑
        tone(880, 0.2, 0.08, 0.07, 'sine');
        tone(1100, 0.15, 0.06, 0.12, 'sine');
        break;
      }

      // 부스트 스킬 (쉬이이이↑)
      case 'skill_boost': {
        const ctx = ac();
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        const g = ctx.createGain();
        o.frequency.setValueAtTime(200, ctx.currentTime);
        o.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.25);
        g.gain.setValueAtTime(0.4, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        o.connect(g); g.connect(ctx.destination);
        o.start(); o.stop(ctx.currentTime + 0.36);
        noise(0.2, 0.2, 8000);
        break;
      }

      // 다리걸기 (탁!)
      case 'skill_trip':
        noise(0.07, 0.5, 500);
        tone(110, 0.5, 0.07, 0, 'square');
        tone(80, 0.35, 0.12, 0.04, 'sine');
        break;

      // 사과 던지기 (탱!)
      case 'skill_apple':
        noise(0.04, 0.3, 3000);
        tone(600, 0.3, 0.04, 0, 'sine');
        tone(400, 0.2, 0.07, 0.03, 'sine');
        tone(250, 0.15, 0.1, 0.06, 'sine');
        break;

      // 질주본능 (심장 박동 + 각성)
      case 'skill_sprint':
        tone(80, 0.5, 0.05, 0, 'sine');
        tone(80, 0.4, 0.05, 0.15, 'sine');
        tone(80, 0.35, 0.05, 0.28, 'sine');
        tone(900, 0.25, 0.15, 0.05, 'sawtooth');
        noise(0.25, 0.2, 1500);
        break;

      // 철인 (방어막 활성)
      case 'skill_iron':
        tone(220, 0.3, 0.1, 0, 'triangle');
        tone(330, 0.25, 0.12, 0.05, 'triangle');
        tone(440, 0.2, 0.15, 0.12, 'triangle');
        tone(550, 0.15, 0.2, 0.2, 'sine');
        break;

      // 미끄러짐 이벤트
      case 'slip':
        noise(0.12, 0.4, 600); {
          const ctx = ac();
          const o = ctx.createOscillator(); o.type = 'sine';
          const g = ctx.createGain();
          o.frequency.setValueAtTime(500, ctx.currentTime);
          o.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.15);
          g.gain.setValueAtTime(0.35, ctx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
          o.connect(g); g.connect(ctx.destination);
          o.start(); o.stop(ctx.currentTime + 0.2);
        }
        break;

      // 관중 응원 버프 (함성)
      case 'crowd_cheer': {
        const ctx = ac();
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.6), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) {
          const env = Math.min(1, i / (ctx.sampleRate * 0.05)) * Math.exp(-i / (ctx.sampleRate * 0.4));
          d[i] = (Math.random() * 2 - 1) * env;
        }
        const s = ctx.createBufferSource(); s.buffer = buf;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.3;
        const g = ctx.createGain(); g.gain.value = 0.6;
        s.connect(bp); bp.connect(g); g.connect(ctx.destination); s.start();
        tone(400, 0.1, 0.5, 0, 'sine');
        tone(500, 0.08, 0.5, 0.05, 'sine');
        break;
      }

      // 골인 팡파레
      case 'finish': {
        // 3-2-1 타격 후 팡파레
        [0, 0.12, 0.24].forEach((t, i) => {
          tone(220 * (i + 1), 0.3, 0.09, t, 'square');
        });
        // 팡파레 멜로디
        [[523,0.4],[659,0.35],[784,0.3],[1047,0.5],[784,0.25],[1047,0.6]].forEach(([f,v],i) => {
          tone(f, v, 0.18, 0.38 + i * 0.13, 'triangle');
        });
        noise(0.8, 0.25, 2000);
        break;
      }

      // 참가비 차감
      case 'entry':
        tone(440, 0.2, 0.06, 0, 'sine');
        tone(330, 0.15, 0.08, 0.07, 'sine');
        break;

      // 오류 / GP 부족
      case 'error':
        tone(180, 0.3, 0.1, 0, 'square');
        tone(140, 0.25, 0.12, 0.08, 'square');
        break;
    }
  } catch { /* 사운드 실패 무시 */ }
}

// 발소리 타이머 (레이스 중 주기적 호출)
let _stepTs = 0;
export function tickFootstep(now, speed) {
  const interval = Math.max(180, 380 - speed * 18); // 빠를수록 빠른 발소리
  if (now - _stepTs > interval) {
    _stepTs = now;
    sfx('footstep');
  }
}
