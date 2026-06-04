// conquest.audio.js — 메인 보물찾기 게임(merchants.battle.js)과 동일한 Web Audio 사운드 패턴
let _audioCtx = null;
function getAC() {
  if (!_audioCtx || _audioCtx.state === 'closed')
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}
export function resumeAudio(){ try{ getAC(); }catch(_){} }

export function playSound(type) {
  try {
    const ac = getAC();
    const osc = (freq, t2='sine') => { const o=ac.createOscillator(); o.type=t2; o.frequency.value=freq; return o; };
    const gain = (vol) => { const g=ac.createGain(); g.gain.value=vol; g.connect(ac.destination); return g; };
    const ramp = (node, from, to, dur) => { node.setValueAtTime(from,ac.currentTime); node.exponentialRampToValueAtTime(to,ac.currentTime+dur); };
    const noise = (dur, vol=0.4) => {
      const buf=ac.createBuffer(1,ac.sampleRate*dur,ac.sampleRate);
      const d=buf.getChannelData(0);
      for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*(1-i/d.length);
      const s=ac.createBufferSource(); s.buffer=buf;
      const g=gain(vol); s.connect(g); s.start(); return s;
    };
    const tone = (freq, vol, dur, t=0, t2='sine') => {
      const o=osc(freq,t2), g=gain(0);
      o.connect(g); ramp(g.gain,vol,0.001,dur); o.start(ac.currentTime+t); o.stop(ac.currentTime+t+dur);
    };

    switch(type){

      // ── 궁수탑 ────────────────────────────────────────────────────────────
      case 'tower_shot':
        tone(900,0.35,0.04,0,'square');
        tone(600,0.2,0.07,0.02,'sawtooth');
        noise(0.2,0.18);
        tone(180,0.18,0.18,0.05);
        break;

      // ── 대포탑 ────────────────────────────────────────────────────────────
      case 'cannon_shot': {
        const cbuf=ac.createBuffer(1,Math.floor(ac.sampleRate*0.018),ac.sampleRate);
        const cd=cbuf.getChannelData(0);
        for(let i=0;i<cd.length;i++) cd[i]=(Math.random()*2-1)*Math.pow(1-i/cd.length,2);
        const cs=ac.createBufferSource(); cs.buffer=cbuf;
        const cg=gain(1.4); cs.connect(cg); cs.start();
        const boom=ac.createOscillator(); boom.type='sine';
        boom.frequency.setValueAtTime(90,ac.currentTime);
        boom.frequency.exponentialRampToValueAtTime(22,ac.currentTime+0.28);
        const bg=gain(0); bg.gain.setValueAtTime(0,ac.currentTime);
        bg.gain.linearRampToValueAtTime(1.8,ac.currentTime+0.006);
        bg.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+1.0);
        boom.connect(bg); boom.start(); boom.stop(ac.currentTime+1.0);
        const nbuf=ac.createBuffer(1,Math.floor(ac.sampleRate*0.45),ac.sampleRate);
        const nd=nbuf.getChannelData(0);
        for(let i=0;i<nd.length;i++) nd[i]=(Math.random()*2-1)*Math.exp(-i/(ac.sampleRate*0.07));
        const ns=ac.createBufferSource(); ns.buffer=nbuf;
        const bpf=ac.createBiquadFilter(); bpf.type='bandpass'; bpf.frequency.value=220; bpf.Q.value=0.6;
        const ng=gain(1.1); ns.connect(bpf); bpf.connect(ng); ns.start();
        break;
      }

      // ── 성벽 피격 (무거운 충격) ───────────────────────────────────────────
      case 'cannon_hit': {
        const ibuf=ac.createBuffer(1,Math.floor(ac.sampleRate*0.55),ac.sampleRate);
        const id2=ibuf.getChannelData(0);
        for(let i=0;i<id2.length;i++) id2[i]=(Math.random()*2-1)*Math.exp(-i/(ac.sampleRate*0.09));
        const is=ac.createBufferSource(); is.buffer=ibuf;
        const ibpf=ac.createBiquadFilter(); ibpf.type='bandpass'; ibpf.frequency.value=180; ibpf.Q.value=0.5;
        const ig=gain(1.3); is.connect(ibpf); ibpf.connect(ig); is.start();
        const ib=ac.createOscillator(); ib.type='sine';
        ib.frequency.setValueAtTime(75,ac.currentTime);
        ib.frequency.exponentialRampToValueAtTime(20,ac.currentTime+0.3);
        const ibg=gain(0); ibg.gain.setValueAtTime(1.2,ac.currentTime);
        ibg.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.35);
        ib.connect(ibg); ib.start(); ib.stop(ac.currentTime+0.35);
        break;
      }

      // ── 화살 피격 ─────────────────────────────────────────────────────────
      case 'arrow_hit':
        noise(0.14,1.0);
        tone(180,0.6,0.09,0,'square');
        tone(110,0.4,0.15,0.03,'sine');
        break;

      // ── 몬스터 피격 ───────────────────────────────────────────────────────
      case 'melee_hit':
        noise(0.035,0.9);
        tone(480,0.55,0.04,0,'sawtooth');
        tone(240,0.4,0.09,0.02,'square');
        tone(140,0.25,0.18,0.03);
        break;

      // ── 몬스터 사망 ───────────────────────────────────────────────────────
      case 'monster_die': [440,330,220,165].forEach((f,i)=>tone(f,0.28,0.14,i*0.09)); break;

      // ── 몬스터 공격 소리 ──────────────────────────────────────────────────
      case 'monster_atk':
        noise(0.12,0.6);
        tone(160,0.5,0.09,0,'sawtooth');
        tone(85,0.35,0.18,0.04);
        break;

      // ── 영웅 스킬: 번개 ───────────────────────────────────────────────────
      case 'skill_lightning':
        noise(0.25,0.12);
        tone(80,0.6,0.5,0.05);
        tone(140,0.4,0.3,0);
        [1800,1200,900].forEach((f,i)=>tone(f,0.3,0.06,i*0.03,'square'));
        break;

      // ── 스킬: 화염 ────────────────────────────────────────────────────────
      case 'skill_fire':
        noise(0.35,0.18);
        tone(60,0.6,0.5,0,'sawtooth');
        [220,180,140].forEach((f,i)=>tone(f,0.45,0.35,i*0.06,'sawtooth'));
        tone(800,0.2,0.15,0.05,'square');
        break;

      // ── 스킬: 얼음 ────────────────────────────────────────────────────────
      case 'skill_ice':
        [2093,1760,1319,880].forEach((f,i)=>tone(f,0.22,0.3,i*0.06,'triangle'));
        tone(440,0.18,0.6,0.1,'sine');
        noise(0.08,0.08);
        break;

      // ── 스킬: 회오리 ──────────────────────────────────────────────────────
      case 'skill_wind': {
        const wg=gain(0.28);
        const wo=ac.createOscillator(); wo.type='sawtooth';
        wo.frequency.setValueAtTime(200,ac.currentTime);
        wo.frequency.linearRampToValueAtTime(600,ac.currentTime+0.4);
        wo.frequency.linearRampToValueAtTime(100,ac.currentTime+0.9);
        wg.gain.setValueAtTime(0.28,ac.currentTime);
        wg.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.9);
        wo.connect(wg); wo.start(); wo.stop(ac.currentTime+0.9);
        noise(0.18,0.7);
        break;
      }

      // ── 스킬: 유성 ────────────────────────────────────────────────────────
      case 'skill_meteor':
        noise(0.5,0.6);
        tone(40,0.8,0.6,0,'sawtooth');
        tone(80,0.5,0.5,0.05,'sawtooth');
        [1200,800,500].forEach((f,i)=>tone(f,0.3,0.2,i*0.08,'square'));
        tone(60,0.6,0.8,0.1,'sine');
        break;

      // ── 웨이브 시작 (levelup 팡파르) ──────────────────────────────────────
      case 'levelup':
        [523,659,784,1047,1319,1568].forEach((f,i)=>tone(f,0.35,0.2,i*0.07,'triangle'));
        tone(2093,0.4,0.4,0.4,'sine');
        break;

      // ── GP 획득 ───────────────────────────────────────────────────────────
      case 'gold_pickup': [523,784,1047,1319].forEach((f,i)=>tone(f,0.3,0.1,i*0.05)); break;

      // ── 유닛 배치 (맑은 핑) ──────────────────────────────────────────────
      case 'hit': {
        const hg=gain(0.28);
        const ho=ac.createOscillator(); ho.type='sine'; ho.frequency.value=880;
        ho.frequency.exponentialRampToValueAtTime(1320,ac.currentTime+0.06);
        hg.gain.setValueAtTime(0.28,ac.currentTime);
        hg.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.22);
        ho.connect(hg); ho.start(); ho.stop(ac.currentTime+0.22);
        tone(1760,0.12,0.1,0.04,'triangle');
        break;
      }

      // ── 광부 채광 ─────────────────────────────────────────────────────────
      case 'box_hit': {
        const bh=ac.createBuffer(1,Math.floor(ac.sampleRate*0.08),ac.sampleRate);
        const bhd=bh.getChannelData(0);
        for(let i=0;i<bhd.length;i++) bhd[i]=(Math.random()*2-1)*Math.exp(-i/(ac.sampleRate*0.012));
        const bhs=ac.createBufferSource(); bhs.buffer=bh;
        const bhf=ac.createBiquadFilter(); bhf.type='lowpass'; bhf.frequency.value=420; bhf.Q.value=5.5;
        const bhg=gain(1.8); bhs.connect(bhf); bhf.connect(bhg); bhs.start();
        tone(120,0.6,0.07,0,'sine'); tone(80,0.35,0.12,0.01,'sine');
        break;
      }

      // ── 승리 ──────────────────────────────────────────────────────────────
      case 'revive': [261,329,392,523,659,784].forEach((f,i)=>tone(f,0.3,0.15,i*0.09)); break;

      // ── 게임오버 ──────────────────────────────────────────────────────────
      case 'player_die': {
        const pdOsc=ac.createOscillator(); pdOsc.type='sawtooth';
        pdOsc.frequency.setValueAtTime(500,ac.currentTime);
        pdOsc.frequency.exponentialRampToValueAtTime(70,ac.currentTime+0.85);
        const pdBpf=ac.createBiquadFilter(); pdBpf.type='bandpass'; pdBpf.frequency.value=950; pdBpf.Q.value=2.5;
        const pdG=gain(0); pdG.gain.setValueAtTime(0.001,ac.currentTime);
        pdG.gain.linearRampToValueAtTime(0.65,ac.currentTime+0.02);
        pdG.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+0.85);
        pdOsc.connect(pdBpf); pdBpf.connect(pdG); pdOsc.start(); pdOsc.stop(ac.currentTime+0.85);
        tone(80,0.3,0.7,0.1);
        break;
      }

      // ── 드래곤 포효 ──────────────────────────────────────────────────────
      case 'dragon_roar': {
        const dr=ac.createOscillator(); dr.type='sawtooth';
        dr.frequency.setValueAtTime(130,ac.currentTime);
        dr.frequency.exponentialRampToValueAtTime(22,ac.currentTime+1.0);
        const drG=gain(0); drG.gain.setValueAtTime(0,ac.currentTime);
        drG.gain.linearRampToValueAtTime(1.3,ac.currentTime+0.06);
        drG.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+1.0);
        dr.connect(drG); dr.start(); dr.stop(ac.currentTime+1.0);
        const dr2=ac.createOscillator(); dr2.type='sine';
        dr2.frequency.setValueAtTime(65,ac.currentTime);
        dr2.frequency.exponentialRampToValueAtTime(18,ac.currentTime+1.1);
        const dr2G=gain(0.9); dr2G.gain.exponentialRampToValueAtTime(0.001,ac.currentTime+1.1);
        dr2.connect(dr2G); dr2.start(); dr2.stop(ac.currentTime+1.1);
        noise(0.18,0.75);
        break;
      }

      default: break;
    }
  } catch(_) {}
}
