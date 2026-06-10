// monsterrace.js — Monster Skate Race 게임 로직
import { db, auth, functions } from '/assets/js/firebase-init.js';
import { esc } from '/assets/js/esc.js';
import { addSparks, addSmoke, resetParticles } from './monsterrace.fx.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  buildTrack, initRenderer, loadAllSprites, renderScene,
  triggerShake, SEGS, TOTAL_LAPS,
} from './monsterrace.render.js';

// ── 상수 ─────────────────────────────────────────────────────────────────────
const BASE_FEE    = 100;
const FEE_STEP    = 50;
const RESET_MS    = 24 * 60 * 60 * 1000;
const GAME_KEY    = 'raceEntry';
const PRIZES      = [500, 250, 150, 50, 30, 20, 10];

// ── 참가비 상태 ───────────────────────────────────────────────────────────────
let _entryFee     = BASE_FEE;
let _entryCount   = 0;
let _entryResetAt = 0;
const MAX_SPEED  = 0.152;   // ×2 (was 0.076)
const ACCEL      = 0.0026;  // ×2 (was 0.0013)
const STEER      = 0.055;
const LANE_MAX   = 2.3;     // 물리 절대 한계
const ROAD_W     = 0.88;   // 도로 경계 (±이상은 잔디/오프로드)
const AI_THINK   = 2800;    // AI 반응 느리게 (was 1100)
const MAX_KMH    = 280;     // 최대속도 km/h 표시
const RACE_KM    = 3.0;     // 총 레이스 거리 km
const GEARS        = [0.22, 0.42, 0.62, 0.80, 1.0];
const GEAR_ACCEL_M = [2.0,  1.55, 1.25, 1.0,  0.82];

// ── 스킬 정의 ────────────────────────────────────────────────────────────────
const SKILLS = {
  apple:    { name:'Apple Throw',  mp:10, emoji:'🍎', type:'attack', cd:3000, desc:'Front speed -30% / 3s' },
  rock:     { name:'Rock Throw',   mp:15, emoji:'🪨', type:'attack', cd:4000, desc:'Flip the vehicle ahead' },
  web:      { name:'Web Shot',     mp:20, emoji:'🕸️',  type:'attack', cd:5000, desc:'Front max speed -40% / 3s' },
  tornado:  { name:'Tornado',      mp:30, emoji:'🌪️', type:'attack', cd:9000, desc:'Blast 2 vehicles ahead backwards' },
  banana:   { name:'Banana Peel',  mp:10, emoji:'🍌', type:'trap',   cd:3000, desc:'Spin + no steering if hit' },
  oil:      { name:'Oil Drum',     mp:15, emoji:'🛢️',  type:'trap',   cd:4000, desc:'Speed↑ + no steering if hit' },
  poop:     { name:'Monster Poop', mp:10, emoji:'💩', type:'trap',   cd:3000, desc:'2s slow if hit' },
  ice:      { name:'Ice Zone',     mp:20, emoji:'🧊', type:'trap',   cd:5000, desc:'Slip + no steering if hit' },
  boost:    { name:'Boost',        mp:35, emoji:'⚡', type:'move',   cd:9000,  desc:'Speed x1.45 / 2.5s (watch overheat)' },
  lightning:{ name:'Lightning',    mp:50, emoji:'🌩️', type:'move',   cd:15000, desc:'Speed x1.65 + invincible / 3.5s (watch overheat)' },
};

// AI 성향: aggressive(공격적), balanced(균형), defensive(안정)
const AI_DEFS = [
  { id:'orc',    imgKey:'orc',     name:'Orc',    color:'#4a7c2f', spd:0.78, aiStyle:'aggressive', skills:['apple','banana','boost'] },
  { id:'pirate', imgKey:'pirate',  name:'Pirate', color:'#7c3a1a', spd:0.76, aiStyle:'aggressive', skills:['rock','oil','boost'] },
  { id:'zombie', imgKey:'zombie1', name:'Zombie', color:'#5a7a3a', spd:0.72, aiStyle:'balanced',   skills:['banana','poop','ice'] },
  { id:'banshee',imgKey:'zombie2', name:'Banshee',color:'#4a3a5a', spd:0.70, aiStyle:'defensive',  skills:['poop','web','banana'] },
  { id:'cabi',   imgKey:'cabi',    name:'Cabi',   color:'#5a00aa', spd:0.82, aiStyle:'aggressive', skills:['web','tornado','apple'] },
  { id:'troll',  imgKey:'troll',   name:'Troll',  color:'#8a8a00', spd:0.74, aiStyle:'balanced',   skills:['rock','ice','boost'] },
];

// ── 자동차 엔진 사운드 (Web Audio API) ───────────────────────────────────────
let _ac = null;
let _engOsc1 = null, _engOsc2 = null, _engGain = null, _engFilter = null;

function ac() {
  if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
  return _ac;
}

function tone(freq, type, dur, vol=0.25, startFreq=0) {
  try {
    const a=ac(), osc=a.createOscillator(), gain=a.createGain();
    osc.connect(gain); gain.connect(a.destination);
    osc.type=type;
    if(startFreq){ osc.frequency.setValueAtTime(startFreq,a.currentTime); osc.frequency.linearRampToValueAtTime(freq,a.currentTime+dur*.8); }
    else osc.frequency.value=freq;
    gain.gain.setValueAtTime(vol,a.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001,a.currentTime+dur);
    osc.start(); osc.stop(a.currentTime+dur);
  } catch {}
}

function startEngine() {
  try {
    const a = ac();
    if (_engOsc1) return;

    _engGain   = a.createGain();
    _engFilter = a.createBiquadFilter();

    _engOsc1 = a.createOscillator();
    _engOsc2 = a.createOscillator();
    const subGain = a.createGain();

    // 메인 엔진 파형 (sawtooth = 거친 엔진음)
    _engOsc1.type = 'sawtooth';
    _engOsc1.frequency.value = 68;

    // 서브 하모닉 (옥타브 위 — 고rpm 느낌)
    _engOsc2.type = 'square';
    _engOsc2.frequency.value = 136;
    subGain.gain.value = 0.28;

    _engFilter.type = 'lowpass';
    _engFilter.frequency.value = 320;
    _engFilter.Q.value = 2.2;

    _engOsc1.connect(_engFilter);
    _engOsc2.connect(subGain);
    subGain.connect(_engFilter);
    _engFilter.connect(_engGain);
    _engGain.connect(a.destination);

    _engGain.gain.value = 0.02; // idle 볼륨
    _engOsc1.start(); _engOsc2.start();
  } catch {}
}

function updateEngine(speed, maxSpeed) {
  if (!_engGain || !_engFilter || !_engOsc1 || !_engOsc2) return;
  try {
    const r  = speed / maxSpeed;
    const a  = ac();
    const ct = a.currentTime;

    // RPM: 아이들 68Hz → 최고 230Hz
    const freq = 68 + r * 170;
    _engOsc1.frequency.linearRampToValueAtTime(freq, ct + 0.12);
    _engOsc2.frequency.linearRampToValueAtTime(freq * 2.1, ct + 0.12);

    // 필터 컷오프: 고rpm일수록 날카로운 음색
    _engFilter.frequency.linearRampToValueAtTime(260 + r * 1400, ct + 0.10);

    // 볼륨: 공회전 0.02 → 최고 0.09
    const vol = r > 0.04 ? 0.025 + r * 0.065 : 0.02;
    _engGain.gain.linearRampToValueAtTime(vol, ct + 0.09);
  } catch {}
}

function stopEngine() {
  try {
    if (_engGain) _engGain.gain.linearRampToValueAtTime(0, ac().currentTime + 0.45);
    setTimeout(() => {
      try { _engOsc1?.stop(); _engOsc2?.stop(); } catch {}
      _engOsc1 = _engOsc2 = _engGain = _engFilter = null;
    }, 550);
  } catch {}
}

function playCountdown(n) { if(n>0) tone(440,'sine',0.22,0.4); else { tone(880,'sine',0.15,0.5); tone(1320,'sine',0.28,0.4); } }
function playBoost()    { tone(180,'sawtooth',0.05,0.18); tone(480,'sawtooth',0.2,0.18); }
function playPickup()   { tone(880,'sine',0.09,0.28); tone(1100,'sine',0.14,0.22); }
function playSkillHit() { tone(400,'square',0.05,0.22); tone(200,'square',0.28,0.18); }
function playFall()     { try{const a=ac(),buf=a.createBuffer(1,a.sampleRate*.28,a.sampleRate),d=buf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*(1-i/d.length);const s=a.createBufferSource(),g=a.createGain();s.buffer=buf;s.connect(g);g.connect(a.destination);g.gain.value=0.28;s.start();s.stop(a.currentTime+0.28);}catch{} }
function playFinish()   { [523,659,784,1047,1319,1568].forEach((f,i)=>setTimeout(()=>tone(f,'sine',0.32,0.38),i*75)); }
function playTrap()     { tone(250,'sawtooth',0.05,0.18); tone(150,'sawtooth',0.28,0.18); }

// ── 충돌 쿨다운 (프레임마다 재충돌 방지) ────────────────────────────────────
const _colCD = {};

function checkVehicleCollisions() {
  const all = [_player, ..._racers].filter(r => !r.finished);
  const now = Date.now();
  for (let i = 0; i < all.length; i++) {
    for (let j = i+1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const key = a.id < b.id ? `${a.id}_${b.id}` : `${b.id}_${a.id}`;
      if ((_colCD[key]||0) > now) continue;

      const pd = Math.abs(a.pos - b.pos), ld = Math.abs(a.lane - b.lane);
      if (pd > 1.3 || ld > 0.52) continue;

      _colCD[key] = now + 380;
      const relSpd = Math.abs(a.speed - b.speed);
      const impact = Math.max(0.15, Math.min(1, (relSpd * 8) + (0.52 - ld)));

      // 측면 밀어내기
      const dir = a.lane < b.lane ? 1 : -1;
      const push = 0.12 + impact * 0.18;
      a.lane = Math.max(-LANE_MAX, Math.min(LANE_MAX, a.lane - dir * push));
      b.lane = Math.max(-LANE_MAX, Math.min(LANE_MAX, b.lane + dir * push));

      // 감속 (후방 차량이 더 크게)
      const pen = impact * 0.22;
      if (a.pos >= b.pos) { a.speed *= (1-pen*0.5); b.speed *= (1-pen); }
      else                { a.speed *= (1-pen);     b.speed *= (1-pen*0.5); }

      // 흔들림 + 조향 손실
      a.wobble = Math.max(a.wobble||0, impact * 110);
      b.wobble = Math.max(b.wobble||0, impact * 110);
      if (impact > 0.35) {
        const dur = impact * 1400;
        a.steerLossUntil = now + dur;
        b.steerLossUntil = now + dur;
      }

      // 사운드 + 쉐이크
      _playCollision(impact);
      if (impact > 0.18) playTireScreech(impact);
      if (impact > 0.25) triggerShake(Math.ceil(impact * 5));
      addSparks(a.pos, (a.lane + b.lane) * 0.5, impact);
      if (a.isPlayer || b.isPlayer) addLog(`💥 ${a.name}↔${b.name} collision!`);
    }
  }
}

function _playCollision(impact) {
  try {
    const a = ac(), sr = a.sampleRate;
    const len = Math.ceil(sr * 0.16);
    const buf = a.createBuffer(1, len, sr);
    const ch = buf.getChannelData(0);
    for (let i=0;i<len;i++) ch[i]=(Math.random()*2-1)*Math.exp(-i/len*12)*impact;
    const src=a.createBufferSource(), g=a.createGain();
    src.buffer=buf; g.gain.value=0.38; src.connect(g); g.connect(a.destination); src.start();
    tone(85,'sine',0.14,impact*0.22);
    if (impact > 0.4) tone(1100,'sawtooth',0.06,impact*0.09);
  } catch {}
}

function playTireScreech(impact) {
  try {
    const a = ac(), dur = 0.10 + impact * 0.16;
    const osc = a.createOscillator(), g = a.createGain(), f = a.createBiquadFilter();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(900 + impact * 500, a.currentTime);
    osc.frequency.linearRampToValueAtTime(180, a.currentTime + dur);
    f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 4;
    g.gain.setValueAtTime(impact * 0.15, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    osc.connect(f); f.connect(g); g.connect(a.destination);
    osc.start(); osc.stop(a.currentTime + dur);
  } catch {}
}

function _gearAccel(r) {
  const sr = r.speed / r.maxSpeed;
  let g = 0;
  while (g < GEARS.length - 1 && sr > GEARS[g] + 0.04) g++;
  if (r.isPlayer && (r.gear||1) !== g+1 && g+1 > (r.gear||1)) {
    tone(185 + g * 32, 'sine', 0.04, 0.052);
  }
  r.gear = g + 1;
  return ACCEL * GEAR_ACCEL_M[g];
}

// ── AI 엔진 사운드 (거리 기반 볼륨) ─────────────────────────────────────────
const _aiAudio = {};
const _AI_BASE_FREQ = [52, 58, 55, 48, 62, 50];

function initAISounds() {
  try {
    const a = ac();
    _racers.forEach((r, i) => {
      const base = _AI_BASE_FREQ[i] || 55;
      const osc = a.createOscillator(), osc2 = a.createOscillator();
      const g = a.createGain(), g2 = a.createGain();
      const filt = a.createBiquadFilter();
      osc.type='sawtooth'; osc.frequency.value=base;
      osc2.type='square';  osc2.frequency.value=base*2; g2.gain.value=0.24;
      filt.type='lowpass'; filt.frequency.value=300; filt.Q.value=1.8;
      osc.connect(filt); osc2.connect(g2); g2.connect(filt);
      filt.connect(g); g.connect(a.destination);
      g.gain.value=0;
      osc.start(); osc2.start();
      _aiAudio[r.id] = { osc, osc2, g, g2, filt, base };
    });
  } catch {}
}

function updateAISounds() {
  try {
    const a=ac(), ct=a.currentTime;
    for (const r of _racers) {
      const n=_aiAudio[r.id]; if(!n) continue;
      const dist=Math.abs(r.pos-_player.pos);
      const vol=Math.max(0, 0.048 - dist*0.006) * (r.finished?0:1);
      const spd=r.speed/r.maxSpeed;
      const freq=n.base + spd*145;
      n.g.gain.linearRampToValueAtTime(vol, ct+0.1);
      n.osc.frequency.linearRampToValueAtTime(freq, ct+0.14);
      n.osc2.frequency.linearRampToValueAtTime(freq*2.05, ct+0.14);
      n.filt.frequency.linearRampToValueAtTime(270+spd*1200, ct+0.1);
    }
  } catch {}
}

function stopAllAISounds() {
  try {
    const ct = ac().currentTime;
    for (const id in _aiAudio) {
      const n = _aiAudio[id];
      n.g.gain.linearRampToValueAtTime(0, ct+0.4);
      setTimeout(()=>{ try{n.osc.stop();n.osc2.stop();}catch{} },500);
    }
  } catch {}
  Object.keys(_aiAudio).forEach(k=>delete _aiAudio[k]);
}

// ── 백미러 (후방 차량 미니 HUD) ──────────────────────────────────────────────
function initRearview() {
  if (document.getElementById('rearviewCv')) return;
  const cv = document.createElement('canvas');
  cv.id='rearviewCv'; cv.width=160; cv.height=68;
  cv.style.cssText='position:absolute;top:8px;left:50%;transform:translateX(-50%);'
    +'border-radius:10px;border:2px solid rgba(255,255,255,.4);'
    +'background:rgba(0,0,0,.82);z-index:200;pointer-events:none;'
    +'box-shadow:0 2px 12px rgba(0,0,0,.7);';
  document.getElementById('canvasWrap')?.appendChild(cv);
}

function drawRearview() {
  const cv=document.getElementById('rearviewCv'); if(!cv) return;
  const ctx=cv.getContext('2d'), W=cv.width, H=cv.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='rgba(8,8,18,.88)'; ctx.fillRect(0,0,W,H);

  // 중앙선
  ctx.strokeStyle='rgba(255,255,255,.18)'; ctx.setLineDash([3,4]);
  ctx.beginPath(); ctx.moveTo(W/2,0); ctx.lineTo(W/2,H); ctx.stroke();
  ctx.setLineDash([]);

  // 레이블
  ctx.fillStyle='rgba(255,255,255,.38)'; ctx.font='bold 7px sans-serif';
  ctx.textAlign='center'; ctx.fillText('◄ REAR VIEW ►', W/2, 8);

  // 후방 차량 (최대 4대)
  const behind=[..._racers].filter(r=>!r.finished&&_player.pos-r.pos>0&&_player.pos-r.pos<9)
    .sort((a,b)=>b.pos-a.pos).slice(0,4);

  behind.forEach(r=>{
    const prog=(_player.pos-r.pos)/9;
    const ry=12+prog*(H-20);
    const rx=W/2+(r.lane/LANE_MAX)*(W/2-10);
    const cw=Math.max(8,14*(1-prog*.5)), ch=Math.max(5,7*(1-prog*.4));
    ctx.fillStyle=r.color||'#888';
    ctx.shadowColor=r.color; ctx.shadowBlur=5;
    ctx.fillRect(rx-cw/2, ry-ch/2, cw, ch);
    ctx.shadowBlur=0;
    if (prog<0.45) {
      ctx.fillStyle='rgba(255,255,255,.75)';
      ctx.font='6px sans-serif'; ctx.textAlign='center';
      ctx.fillText(r.name.slice(0,5), rx, ry+ch/2+7);
    }
  });

  // 플레이어 표시
  const prx=W/2+(_player.lane/LANE_MAX)*(W/2-10);
  ctx.fillStyle='#60a5fa'; ctx.shadowColor='#3b82f6'; ctx.shadowBlur=6;
  ctx.fillRect(prx-7, H-11, 14, 7);
  ctx.shadowBlur=0;
  ctx.fillStyle='rgba(255,255,255,.8)'; ctx.font='bold 6px sans-serif';
  ctx.textAlign='center'; ctx.fillText('YOU', prx, H-1);
}

// ── 게임 상태 ─────────────────────────────────────────────────────────────────
let _phase = 'loading';
let _uid   = null;
let _freeMode = false;
let _playerGP = 0, _playerHP = 1000, _playerMP = 1000;
let _playerMaxHP = 1000, _playerMaxMP = 1000;
let _selectedSkills = [];
let _track = null, _player = null, _racers = [], _items = [];
let _traps = [], _log = [], _finishOrder = [];
let _raf = null, _lastTs = 0, _gameTs = 0;
let _ended = false;
let _gasLocked = false; // 가스 토글 상태
const _keys = {left:false, right:false, gas:false, brake:false};
let _aiTimers = {};

const $ = id => document.getElementById(id);

// ── DB ───────────────────────────────────────────────────────────────────────
async function loadPlayerData() {
  if (!_uid) {
    $('lobbyGP').textContent = 'Guest';
    $('lobbyHP').textContent = '—';
    $('lobbyMP').textContent = '—';
    $('btnEnter').disabled = false;
    const badge=$('feeBadge'); if(badge) badge.textContent='🆓 Free Trial';
    const info=$('feeInfo'); if(info) info.textContent='Guests can play for free (no GP rewards)';
    return;
  }
  try {
    const snap = await getDoc(doc(db,'battle_players',_uid));
    if (snap.exists()) {
      const d = snap.data();
      _playerHP = d.hp || 1000; _playerMaxHP = _playerHP;
      _playerMP = d.mp || 1000; _playerMaxMP = _playerMP;
      _playerGP = d.gold || 0;

      const entry = d[GAME_KEY] || {};
      const now = Date.now();
      if (!entry.resetAt || now - entry.resetAt > RESET_MS) {
        _entryCount = 0; _entryResetAt = 0;
      } else {
        _entryCount = entry.count || 0; _entryResetAt = entry.resetAt;
      }
      _entryFee = BASE_FEE + _entryCount * FEE_STEP;
    }
  } catch {}
  $('lobbyGP').textContent = _playerGP;
  $('lobbyHP').textContent = _playerHP;
  $('lobbyMP').textContent = _playerMP;
  $('btnEnter').disabled   = _playerGP < _entryFee;
  _updateFeeDisplay();
}

function _updateFeeDisplay() {
  const badge = $('feeBadge');
  if (badge) badge.textContent = `Entry fee: ${_entryFee} GP`;
  const info = $('feeInfo');
  if (!info) return;
  if (_entryCount === 0) {
    info.textContent = 'First entry today · resets in 24h';
  } else {
    const h = Math.ceil((_entryResetAt + RESET_MS - Date.now()) / 3_600_000);
    info.textContent = `${_entryCount} entries today · 100GP reset in ${h}h`;
  }
}

async function deductFee() {
  if (!_uid) return false;
  try {
    const res = await httpsCallable(functions, 'payGameEntry')({ gameKey: GAME_KEY });
    const { fee, newCount } = res.data;
    _playerGP   -= fee;
    _entryCount  = newCount;
    _entryFee    = BASE_FEE + newCount * FEE_STEP;
    return true;
  } catch { return false; }
}

async function awardPrize(rank) {
  if (_freeMode || !_uid) return 0;
  const gp = PRIZES[Math.min(rank, PRIZES.length - 1)] || 10;
  try {
    await httpsCallable(functions, 'claimGameReward')({ gameType: 'race', amount: gp });
    if (gp >= 50) httpsCallable(functions, 'broadcastGpEvent')({ game: 'monsterrace', amount: gp }).catch(() => {});
  } catch {}
  return gp;
}

// ── 레이서 팩토리 ─────────────────────────────────────────────────────────────
function makeRacer(def, isPlayer) {
  return {
    id: def.id,
    imgKey: isPlayer ? 'user' : (def.imgKey || 'orc'),
    name: def.name, color: def.color,
    pos: 0, lane: 0, speed: 0,
    maxSpeed: MAX_SPEED * (def.spd || 1),
    hp: isPlayer ? _playerHP : 700+Math.random()*500,
    maxHp: isPlayer ? _playerMaxHP : 1000,
    mp: isPlayer ? _playerMP : 500+Math.random()*400,
    maxMp: isPlayer ? _playerMaxMP : 800,
    lap: 0, finished: false, rank: 0, currentRank: 1,
    fallUntil: 0, wobble: 0,
    drift: 0, steerLossUntil: 0,
    effects: {},
    gear: 1,
    aiStyle: def.aiStyle || 'balanced',
    skills: def.skills || [],
    skillCooldowns: {},
    traps: [], isPlayer,
  };
}

// ── 스킬 ─────────────────────────────────────────────────────────────────────
function useSkill(racer, id) {
  const sk = SKILLS[id];
  if (!sk || racer.mp < sk.mp) return;
  if ((racer.skillCooldowns[id]||0) > Date.now()) return;
  racer.mp -= sk.mp;
  racer.skillCooldowns[id] = Date.now() + (sk.cd || 3000);
  addLog(`${racer.name} ${sk.emoji} ${sk.name}`);

  const now = Date.now();
  switch (sk.type) {
    case 'move': {
      // 이미 부스트/번개 활성 중이면 중복 사용 금지
      const alreadyBoosted = (racer.effects.boost||0)>now || (racer.effects.lightning||0)>now;
      if (alreadyBoosted) { addLog(`⚠️ ${racer.name} boost already active`); break; }

      if (id==='boost') {
        const endT = now + 2500;
        racer.effects.boost = endT;
        // 과열: 부스트 종료 후 1.8초 속도 80%
        racer.effects.overheat = endT + 1800;
        playBoost();
      }
      if (id==='lightning') {
        const endT = now + 3500;
        racer.effects.lightning   = endT;
        racer.effects.invincible  = endT;
        racer.effects.overheat    = endT + 2200;
        playBoost();
        tone(1200,'sine',0.08,0.3);
        addLog(`⚡ ${racer.name} invincible+sprint!`);
      }
      break;
    }
    case 'attack': {
      if (id==='tornado') {
        const targets = findFront(racer, 2);
        if (!targets.length) break;
        targets.forEach(t => {
          if ((t.effects.invincible||0)>now) return;
          t.pos = racer.pos - 3 - Math.random();
          t.effects.spin = now + 2500; t.speed *= 0.25;
          addLog(`🌪️ ${t.name} blown away!`);
        });
        triggerShake(7);
        tone(150,'sine',0.5,0.25,400); tone(80,'sawtooth',0.4,0.15);
        break;
      }
      const fwd = findFront(racer, 1)[0];
      if (!fwd || (fwd.effects.invincible||0)>now) break;
      if (id==='apple') { fwd.effects.slow=now+3000; addLog(`🍎 ${fwd.name} speed -30%!`); playSkillHit(); }
      if (id==='rock')  { fwd.fallUntil=now+2500; fwd.speed=0; triggerShake(8); addLog(`🪨 ${fwd.name} flipped!`); playFall(); playSkillHit(); }
      if (id==='web')   { fwd.effects.slowMax=now+3000; addLog(`🕸️ ${fwd.name} max speed -40%!`); playSkillHit(); }
      break;
    }
    case 'trap': {
      const emojiMap = {banana:'🍌',oil:'🛢️',poop:'💩',ice:'🧊'};
      const t = { ownerId:racer.id, pos:racer.pos-1,
                  lane:racer.lane+(Math.random()-0.5)*0.3,
                  skillId:id, emoji:emojiMap[id]||'🪤', active:true };
      _traps.push(t); racer.traps.push(t);
      playTrap();
      break;
    }
  }
  if (racer.isPlayer) renderHUD();
}

function findFront(racer, n=1) {
  return [_player,..._racers]
    .filter(r=>r.id!==racer.id&&!r.finished&&r.pos>racer.pos)
    .sort((a,b)=>a.pos-b.pos).slice(0, n);
}
function findNearest(racer, ahead) {
  return [_player,..._racers]
    .filter(r=>r.id!==racer.id&&!r.finished)
    .filter(r=>ahead? r.pos>racer.pos : r.pos<racer.pos)
    .sort((a,b)=>ahead? a.pos-b.pos : b.pos-a.pos)[0]||null;
}

// ── 물리 ─────────────────────────────────────────────────────────────────────
function updateRacer(r, isPlayer) {
  if (r.finished) return;
  const now = Date.now();
  if (r.fallUntil > now) { r.speed *= 0.88; return; }
  if ((r.effects.stun||0) > now) { r.speed *= 0.94; return; }

  const boosted   = (r.effects.boost||0)>now;
  const lightning = (r.effects.lightning||0)>now;
  const overheat  = (r.effects.overheat||0)>now;
  const slowed    = (r.effects.slow||0)>now;
  const slowMax   = (r.effects.slowMax||0)>now;

  // 부스트 배수: 일반부스트 1.45x, 번개질주 1.65x, 과열 0.82x (엔진 쿨다운)
  const boostMult = lightning ? 1.65 : boosted ? 1.45 : 1.0;
  const top = r.maxSpeed
    * boostMult
    * (overheat ? 0.82 : 1.0)
    * (slowed   ? 0.70 : 1.0)
    * (slowMax  ? 0.60 : 1.0)
    * (r.wobble > 0 ? 0.82 : 1.0);

  const spinning = (r.effects.spin||0)>now;
  const oilSlide = (r.effects.oilSlide||0)>now;
  const iceSlide = (r.effects.iceSlide||0)>now;

  if (isPlayer) {
    const vr = Math.min(1, r.speed / r.maxSpeed);

    if (spinning) {
      r.lane += Math.sin(now * 0.014) * 0.18;
      r.lane = Math.max(-LANE_MAX, Math.min(LANE_MAX, r.lane));
      r.speed = Math.max(0, r.speed - ACCEL * 0.8);
    } else if (oilSlide) {
      r.speed = Math.min(r.maxSpeed * 1.6, r.speed + ACCEL * 1.5);
      r.lane += (Math.random()-0.5) * 0.06;
      r.lane = Math.max(-LANE_MAX, Math.min(LANE_MAX, r.lane));
    } else if (iceSlide) {
      r.speed = Math.max(top * 0.35, r.speed - ACCEL * 0.15);
      r.lane += (Math.random()-0.5) * 0.05;
      r.lane = Math.max(-LANE_MAX, Math.min(LANE_MAX, r.lane));
    } else {
      // 가속: _keys.gas = true면 최대속도로, false면 0.55배
      const targetSpeed = _keys.gas ? top : top * 0.55;
      if (r.speed < targetSpeed) {
        r.speed = Math.min(r.speed + _gearAccel(r), targetSpeed);
      } else if (_keys.brake) {
        // 관성법칙: 속도에 따라 제동력 선형 증가 (고속일수록 제동거리 ↑)
        const brakeForce = ACCEL * 1.6 + r.speed * 0.04;
        r.speed = Math.max(0, r.speed - brakeForce);
      } else if (r.speed > targetSpeed) {
        r.speed = Math.max(targetSpeed, r.speed - ACCEL * 0.45);
      }

      const steerInput = (_keys.right ? 1 : 0) - (_keys.left ? 1 : 0);
      const steerLoss = (r.steerLossUntil||0) > now;
      if (steerInput !== 0) {
        // steerLoss: 충돌 후 조향력 감소
        const effSteer = STEER * (1 - vr * 0.45) * (steerLoss ? 0.18 : 1);
        r.lane = Math.max(-LANE_MAX, Math.min(LANE_MAX, r.lane + steerInput * effSteer));
        const latG = Math.max(0, vr - 0.3);
        r.speed = Math.max(top * 0.2, r.speed * (1 - latG * latG * 0.009));
        // 드리프트: 고속 급조향 시 미끄러짐
        if (vr > 0.72) {
          r.drift = Math.max(-1, Math.min(1, (r.drift||0) + steerInput * (vr-0.72) * 0.18));
          r.lane = Math.max(-LANE_MAX, Math.min(LANE_MAX, r.lane + r.drift * 0.04));
          if (Math.abs(r.drift) > 0.22 && Math.random() < 0.12) {
            addSmoke(r.pos, r.lane + steerInput * 0.14);
          }
        }
      } else {
        r.drift = (r.drift||0) * 0.88; // 드리프트 복귀
      }

      const curSeg = _track?.[((Math.floor(r.pos)) % SEGS + SEGS) % SEGS];
      if (curSeg?.curve) {
        const centrifugal = -(curSeg.curve / 3) * vr * vr * 0.015;
        r.lane = Math.max(-LANE_MAX, Math.min(LANE_MAX, r.lane + centrifugal));

        // 커브 미조향 페널티: 커브 강도 > 1.5이고 조향 없으면 고속일수록 강제 감속
        const steerInput = (_keys.right ? 1 : 0) - (_keys.left ? 1 : 0);
        const curveAbs = Math.abs(curSeg.curve);
        if (curveAbs > 1.5 && steerInput === 0 && vr > 0.55) {
          const penalty = (curveAbs - 1.5) / 3.5 * (vr - 0.55) * 0.45;
          r.speed = Math.max(top * 0.45, r.speed * (1 - penalty));
        }
      }
    }

    // 코스 이탈 페널티 강화 (14% → 28%)
    if (Math.abs(r.lane) > ROAD_W) {
      const offRoad = Math.min(1, (Math.abs(r.lane) - ROAD_W) / (LANE_MAX - ROAD_W));
      r.speed *= (1 - offRoad * 0.28);
      r.lane *= 0.97;
    }
  } else {
    // ── AI 레이싱 (코너링·드리프트·추월·관성) ──────────────────────────
    const style = r.aiStyle || 'balanced';
    const vr = r.speed / r.maxSpeed;

    // 1. 전방 5세그먼트 커브 예측
    let maxCurveAhead = 0;
    for (let i = 1; i <= 5; i++) {
      const seg = _track?.[(Math.floor(r.pos) + i) % SEGS];
      if (seg?.curve) maxCurveAhead = Math.max(maxCurveAhead, Math.abs(seg.curve));
    }
    const cornerIntensity = Math.min(1, maxCurveAhead / 5);

    // 2. 성향별 코너 감속 비율
    const brakeM = style === 'aggressive' ? 1 - cornerIntensity * 0.22
                 : style === 'defensive'  ? 1 - cornerIntensity * 0.48
                 :                          1 - cornerIntensity * 0.35;
    const effectiveTop = top * brakeM;

    // 3. 코너 진입 전 감속 / 탈출 후 재가속
    const accelM = style === 'aggressive' ? 0.78 : style === 'defensive' ? 0.62 : 0.70;
    if (r.speed < effectiveTop) r.speed = Math.min(r.speed + ACCEL * accelM, effectiveTop);
    else r.speed = Math.max(effectiveTop, r.speed - ACCEL * 0.38);

    if (spinning) {
      r.lane += Math.sin(now * 0.014) * 0.12;
    } else if (oilSlide || iceSlide) {
      r.lane += (Math.random() - 0.5) * 0.05;
    } else {
      // 4. 현재 세그먼트 커브 값 (양수=우회전, 음수=좌회전)
      const curSeg = _track?.[(Math.floor(r.pos) % SEGS + SEGS) % SEGS];
      const curve = curSeg?.curve || 0;

      // 5. 레이싱 라인: 커브 안쪽 공략 — 도로 경계 안으로 클램프
      const racingM = style === 'aggressive' ? 0.38 : style === 'defensive' ? 0.22 : 0.30;
      const racingLine = Math.max(-0.68, Math.min(0.68, -curve * racingM));

      // 6. 추월: 전방 차량 차단 시 도로 안에서 차선 변경
      const blocker = [_player, ..._racers].find(o =>
        o.id !== r.id && !o.finished &&
        o.pos > r.pos && o.pos - r.pos < 1.6 &&
        Math.abs(o.lane - r.lane) < 0.52
      );
      let targetLane = racingLine;
      if (blocker && style !== 'defensive') {
        const avoidDir = r.lane <= blocker.lane ? -1 : 1;
        targetLane = Math.max(-ROAD_W, Math.min(ROAD_W, blocker.lane + avoidDir * 0.72));
      }

      // 7. 부드러운 조향 (성향별 반응속도)
      const steerRate = style === 'aggressive' ? 0.11 : style === 'defensive' ? 0.065 : 0.088;
      r.lane += (targetLane - r.lane) * steerRate;

      // 8. 고속 코너링 드리프트 (관성)
      if (vr > 0.70 && Math.abs(curve) > 1.5) {
        const driftDir = curve > 0 ? 1 : -1;
        r.drift = (r.drift || 0) * 0.80 + driftDir * (vr - 0.70) * 0.20;
        r.lane += r.drift * 0.028;
        if (Math.abs(r.drift) > 0.22 && Math.random() < 0.13) {
          addSmoke(r.pos, r.lane + driftDir * 0.12);
        }
        if (Math.abs(r.drift) > 0.38 && Math.random() < 0.07) {
          playTireScreech(Math.min(1, Math.abs(r.drift)));
        }
      } else {
        r.drift = (r.drift || 0) * 0.88;
      }
    }

    // 도로 경계 제한 + 오프로드 속도 패널티
    r.lane = Math.max(-LANE_MAX, Math.min(LANE_MAX, r.lane));
    if (Math.abs(r.lane) > ROAD_W) {
      const offRoad = Math.min(1, (Math.abs(r.lane) - ROAD_W) / (LANE_MAX - ROAD_W));
      r.speed *= (1 - offRoad * 0.10);
      r.lane *= 0.95; // 도로로 복귀
    }
  }

  if (r.wobble > 0) { r.lane += Math.sin(now*0.01)*0.09; r.wobble -= 16; }

  r.pos += r.speed;
  if (r.pos >= SEGS * (r.lap+1)) {
    r.lap++;
    if (!r.isPlayer) tone(440+(r.lap*100),'sine',0.2,0.15);
    if (r.lap >= TOTAL_LAPS && !r.finished) finishRacer(r);
  }
}

function checkTraps(r) {
  const now = Date.now();
  for (const t of _traps) {
    if (!t.active || t.ownerId===r.id) continue;
    if (Math.abs(t.pos-r.pos) > 1.5 || Math.abs(t.lane-r.lane) > 0.65) continue;
    if ((r.effects.invincible||0)>now) continue;
    t.active = false;
    switch (t.skillId) {
      case 'banana': r.effects.spin=now+2000; r.speed*=0.6; triggerShake(7); addLog(`🍌 ${r.name} spin!`); if(r.isPlayer)playFall(); break;
      case 'oil':    r.effects.oilSlide=now+3000; addLog(`🛢️ ${r.name} oil slide!`); if(r.isPlayer)tone(200,'sawtooth',0.3,0.18); break;
      case 'poop':   r.effects.slow=now+2000; addLog(`💩 ${r.name} slowed!`); break;
      case 'ice':    r.effects.iceSlide=now+3000; addLog(`🧊 ${r.name} ice slide!`); if(r.isPlayer)tone(1200,'sine',0.15,0.12); break;
    }
    if (r.isPlayer) renderHUD();
  }
}

function checkItems(r) {
  for (const item of _items) {
    if (!item.active) continue;
    if (Math.abs(item.trackPos-r.pos)>1.5 || Math.abs(item.lane-r.lane)>0.9) continue;
    item.active = false;
    if (r.isPlayer) { _playerGP += item.gp; addLog(`💰 GP +${item.gp}!`); playPickup(); renderHUD(); }
    else { r.hp = Math.min(r.maxHp, r.hp+60); }
  }
}

// ── AI (개선: 충돌회피 + 전략적스킬 + 난이도) ────────────────────────────────
const AI_DIFF = {
  Easy:      { ms:3500, skillP:0.12, avoidP:0.35, spdM:0.80 },
  Normal:    { ms:2200, skillP:0.30, avoidP:0.70, spdM:0.92 },
  Hard:      { ms:1400, skillP:0.50, avoidP:0.90, spdM:1.00 },
  Nightmare: { ms:700,  skillP:0.70, avoidP:1.00, spdM:1.10 },
};
const _curDiff = 'Normal';

function aiThink(r) {
  const now=Date.now(), d=AI_DIFF[_curDiff];
  const style = r.aiStyle || 'balanced';
  const thinkMs = style === 'aggressive' ? d.ms * 0.60
                : style === 'defensive'  ? d.ms * 1.35
                : d.ms;
  if ((now-(_aiTimers[r.id]||0)) < thinkMs) return;
  _aiTimers[r.id]=now;

  // 함정 회피 (도로 경계 안에서)
  const nearTrap = _traps.find(t => t.active && Math.abs(t.pos-r.pos)<1.6 && Math.abs(t.lane-r.lane)<0.55);
  if (nearTrap) {
    const trapAway = r.lane < nearTrap.lane ? -1 : 1;
    r.lane = Math.max(-ROAD_W, Math.min(ROAD_W, r.lane + trapAway * 0.22));
    _aiTimers[r.id] = now; return;
  }

  // 충돌 회피: 근접 차량 존재 시 차선 변경 (도로 경계 안에서)
  if (Math.random() < d.avoidP) {
    const near=[_player,..._racers].find(o=>
      o.id!==r.id && !o.finished &&
      Math.abs(o.pos-r.pos)<1.1 && Math.abs(o.lane-r.lane)<0.45
    );
    if (near) {
      const away = r.lane < near.lane ? -1 : 1;
      r.lane = Math.max(-ROAD_W, Math.min(ROAD_W, r.lane + away*(0.18+Math.random()*0.14)));
    }
  }

  if (Math.random() < d.skillP && r.skills.length) {
    const front  = findNearest(r, true);
    const behind = findNearest(r, false);
    const attacks= r.skills.filter(s=>SKILLS[s]?.type==='attack');
    const traps  = r.skills.filter(s=>SKILLS[s]?.type==='trap');
    const moves  = r.skills.filter(s=>SKILLS[s]?.type==='move');

    // 앞에 차량이 가까울 때 공격
    if (front && Math.abs(front.pos-r.pos)<2.5 && attacks.length && Math.random()<0.65) {
      useSkill(r, attacks[Math.floor(Math.random()*attacks.length)]); return;
    }
    // 뒤에 차량이 가까울 때 함정
    if (behind && Math.abs(behind.pos-r.pos)<1.8 && traps.length && Math.random()<0.5) {
      useSkill(r, traps[Math.floor(Math.random()*traps.length)]); return;
    }
    // 순위 뒤처질 때 or 플레이어가 1위일 때 공격적 부스트
    const playerAhead = _player && !_player.finished && _player.pos > r.pos;
    const useBoostP = (r.currentRank||1)>2 ? 0.75 : playerAhead ? 0.55 : 0.30;
    if (moves.length && Math.random() < useBoostP) {
      useSkill(r, moves[Math.floor(Math.random()*moves.length)]); return;
    }
    // 랜덤 사용
    useSkill(r, r.skills[Math.floor(Math.random()*r.skills.length)]);
  }
}

// ── 완주 / 종료 ───────────────────────────────────────────────────────────────
function finishRacer(r) {
  if (_ended) return;
  r.finished = true; r.speed *= 0.3;
  r.rank = _finishOrder.length+1;
  _finishOrder.push(r);
  addLog(`🏁 ${r.name} #${r.rank} finish!`);
  if (_finishOrder.length >= 7 || r.isPlayer) endRace(r.rank);
}

function showFinishOverlay(rank) {
  const el = $('finishOverlay'); if (!el) return;
  const sub = $('finishSubTxt');
  if (sub) sub.textContent = `#${rank} finish!`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 2200);
}

async function endRace(rank) {
  if (_ended) return; _ended = true;
  stopEngine();
  stopAllAISounds();
  cancelAnimationFrame(_raf);
  resetParticles();
  playFinish();

  const finalRank = _player.rank || (7 - _finishOrder.filter(r=>!r.isPlayer).length);
  showFinishOverlay(finalRank);

  const gp = await awardPrize(finalRank - 1);
  setTimeout(() => {
    $('finishRank').textContent = `#${finalRank} finish!`;
    $('finishGP').textContent   = _freeMode ? '🆓 Free Play (no reward)' : `+${gp} GP earned!`;
    showPhase('finish');
  }, 1800);
}

// ── 게임 루프 ─────────────────────────────────────────────────────────────────
function loop(ts) {
  _raf = requestAnimationFrame(loop);
  const dt = Math.min(50, ts - _lastTs);
  _lastTs = ts;
  _gameTs += dt;

  updateRacer(_player, true);
  for (const r of _racers) { updateRacer(r, false); aiThink(r); }
  checkTraps(_player);
  checkItems(_player);
  for (const r of _racers) { checkTraps(r); checkItems(r); }
  checkVehicleCollisions();

  const active = [_player,..._racers].filter(r=>!r.finished);
  active.sort((a,b)=>b.pos-a.pos);
  active.forEach((r,i)=>r.currentRank=i+1);

  _player.isBraking = _keys.brake;
  updateEngine(_player.speed, _player.maxSpeed);
  updateAISounds();

  renderScene(_track, _racers, _player, _items, _gameTs);
  drawRearview();
  renderHUD();
}

// ── HUD ──────────────────────────────────────────────────────────────────────
function renderHUD() {
  const hpPct = _player.hp / _player.maxHp;
  const mpPct = _player.mp / _player.maxMp;
  if ($('hpBar'))  $('hpBar').style.width  = (hpPct*100) + '%';
  if ($('mpBar'))  $('mpBar').style.width  = (mpPct*100) + '%';
  if ($('hpVal'))  $('hpVal').textContent  = Math.ceil(_player.hp);
  if ($('mpVal'))  $('mpVal').textContent  = Math.ceil(_player.mp);

  // 상태 이상
  const now3 = Date.now();
  const statusIcons = [];
  if ((_player.effects?.spin||0)>now3)       statusIcons.push('🌀Spin');
  if ((_player.effects?.oilSlide||0)>now3)   statusIcons.push('🛢️Oil');
  if ((_player.effects?.iceSlide||0)>now3)   statusIcons.push('🧊Ice');
  if ((_player.effects?.slow||0)>now3)       statusIcons.push('🐢Slow');
  if ((_player.effects?.slowMax||0)>now3)    statusIcons.push('🕸️Web');
  if ((_player.effects?.boost||0)>now3)      statusIcons.push('⚡Boost');
  if ((_player.effects?.invincible||0)>now3) statusIcons.push('🛡️Shield');
  const stEl = $('statusTxt');
  if (stEl) stEl.textContent = statusIcons.join(' ');

  if ($('rankTxt'))  $('rankTxt').textContent  = `#${_player.currentRank||'?'} / 7`;
  if ($('lapTxt'))   $('lapTxt').textContent   = `${Math.min(_player.lap+1,TOTAL_LAPS)}/${TOTAL_LAPS} laps`;
  if ($('gpTxt'))    $('gpTxt').textContent    = `💰${_playerGP}`;

  // 속도 (km/h)
  const kmh = Math.round(_player.speed / _player.maxSpeed * MAX_KMH);
  if ($('speedTxt')) $('speedTxt').textContent = kmh + ' km/h';

  // 남은 거리
  const totalSegs = SEGS * TOTAL_LAPS;
  const traveled  = Math.min(_player.pos, totalSegs);
  const distKm    = Math.max(0, RACE_KM * (1 - traveled / totalSegs));
  if ($('distTxt')) $('distTxt').textContent = distKm.toFixed(2) + ' km left';

  // 스킬 쿨다운
  _selectedSkills.forEach((sk,i)=>{
    const btn = $(`skBtn${i}`); if (!btn) return;
    const cd  = (_player.skillCooldowns[sk]||0) - Date.now();
    const mp  = SKILLS[sk]?.mp || 0;
    btn.style.opacity = (cd>0 || _player.mp<mp) ? '0.45' : '1';
    const cdEl = btn.querySelector('.cd');
    if (cdEl) cdEl.textContent = cd>0 ? Math.ceil(cd/1000)+'s' : '';
  });
}

function addLog(msg) {
  _log.unshift(msg); if (_log.length>5) _log.pop();
  const el = $('logBox');
  if (el) el.innerHTML = _log.map(l=>`<div class="log-line">${l}</div>`).join('');
}

// ── 화면 전환 ─────────────────────────────────────────────────────────────────
const SCREENS = ['loading','lobby','skill','countdown','game','finish'];
function showPhase(name) {
  SCREENS.forEach(s=>$(`${s}Screen`)?.classList.add('hidden'));
  $(`${name}Screen`)?.classList.remove('hidden');
  _phase = name;
}

// ── 스킬 선택 ────────────────────────────────────────────────────────────────
function renderSkillGrid() {
  const grid = $('skillGrid'); if (!grid) return;
  grid.innerHTML = '';
  Object.entries(SKILLS).forEach(([id,sk])=>{
    const btn = document.createElement('button');
    btn.className = 'sp-btn'; btn.dataset.id = id;
    btn.innerHTML = `<span class="sp-emoji">${sk.emoji}</span><div class="sp-name">${sk.name}</div><div class="sp-mp">MP ${sk.mp}</div><div class="sp-desc">${sk.desc||''}</div>`;
    btn.addEventListener('click',()=>{
      if (_selectedSkills.includes(id)) { _selectedSkills=_selectedSkills.filter(s=>s!==id); btn.classList.remove('sel'); }
      else if (_selectedSkills.length<3) { _selectedSkills.push(id); btn.classList.add('sel'); }
      $('skCount').textContent = `${_selectedSkills.length}/3 selected`;
      $('skConfirm').disabled  = _selectedSkills.length<1;
    });
    grid.appendChild(btn);
  });
}

function buildSkillBar() {
  const bar = $('skillBar'); if (!bar) return;
  bar.innerHTML='';
  _selectedSkills.forEach((sk,i)=>{
    const s = SKILLS[sk]; if (!s) return;
    const btn = document.createElement('button');
    btn.id=`skBtn${i}`; btn.className='sk-btn';
    btn.innerHTML=`${s.emoji}<small>${s.name}</small><span class="cd"></span>`;
    btn.addEventListener('click',()=>useSkill(_player,sk));
    bar.appendChild(btn);
  });
}

// ── 카운트다운 ────────────────────────────────────────────────────────────────
function startCountdown() {
  if (!_selectedSkills.length) _selectedSkills=['boost'];
  _track   = buildTrack();
  _items   = makeItems();
  _traps   = []; _log = []; _finishOrder = []; _ended = false;
  _gameTs  = 0;
  _gasLocked = false; _keys.gas = false;

  _player = makeRacer({id:'player',imgKey:'player',name:'Player',color:'#3b82f6',spd:1.0,skills:_selectedSkills},true);
  _racers = AI_DEFS.map(d=>makeRacer(d,false));

  [_player,..._racers].forEach((r,i)=>{
    r.pos  = -(i*0.35);
    r.lane = (i%3-1)*0.6 + (Math.random()-0.5)*0.2;
  });

  showPhase('countdown');
  let n = 3;
  $('cdNum').textContent = n;
  playCountdown(n);
  const iv = setInterval(()=>{
    n--;
    playCountdown(n);
    if (n>0) { $('cdNum').textContent = n; }
    else     { $('cdNum').textContent = 'GO!'; clearInterval(iv); setTimeout(startRace, 500); }
  }, 1000);
}

function startRace() {
  showPhase('game');
  requestAnimationFrame(() => {
    resizeCanvas();
    buildSkillBar();
    initRearview();
    startEngine();
    initAISounds();
    _lastTs = performance.now();
    _raf = requestAnimationFrame(loop);
    const cv = $('raceCanvas');
    if (cv) cv.focus();
    // 자동 풀스크린
    autoFullscreen();
  });
}

function autoFullscreen() {
  const btn = $('btnFs'), wrap = $('canvasWrap'), game = $('gameScreen');
  if (!btn || _cssFs) return;
  const req = wrap?.requestFullscreen || wrap?.webkitRequestFullscreen;
  if (req) req.call(wrap).catch(() => _enterCssFs(btn, wrap, game));
  else _enterCssFs(btn, wrap, game);
}

function makeItems() {
  return Array.from({length: TOTAL_LAPS*9},(_,i)=>({
    id:i, trackPos:15+Math.random()*(SEGS-15),
    lane:(Math.random()-0.5)*1.4, active:true,
    gp:[10,20,50][Math.floor(Math.random()*3)],
  }));
}

// ── 입력 ─────────────────────────────────────────────────────────────────────
function initInput() {
  document.addEventListener('keydown',e=>{
    switch(e.key){
      case 'ArrowLeft': case 'a': case 'A': e.preventDefault(); _keys.left=true;  break;
      case 'ArrowRight':case 'd': case 'D': e.preventDefault(); _keys.right=true; break;
      case 'ArrowUp':   case 'w': case 'W': case ' ': e.preventDefault(); _keys.gas=true;   break;
      case 'ArrowDown': case 's': case 'S': e.preventDefault(); _keys.brake=true; break;
    }
  });
  document.addEventListener('keyup',e=>{
    switch(e.key){
      case 'ArrowLeft': case 'a': case 'A': _keys.left=false;  break;
      case 'ArrowRight':case 'd': case 'D': _keys.right=false; break;
      case 'ArrowUp':   case 'w': case 'W': case ' ':
        // 키보드 gas: gasLocked 아닐 때만 해제
        if (!_gasLocked) _keys.gas=false;
        break;
      case 'ArrowDown': case 's': case 'S': _keys.brake=false; break;
    }
  });

  // 좌/우/브레이크: 누르는 동안 유지 (hold)
  for (const [id, key] of [['btnLeft','left'],['btnRight','right'],['btnBrake','brake']]) {
    const el = $(id); if (!el) continue;
    el.addEventListener('touchstart',e=>{e.preventDefault();_keys[key]=true;},{passive:false});
    el.addEventListener('touchend',  e=>{e.preventDefault();_keys[key]=false;},{passive:false});
    el.addEventListener('mousedown', ()=>_keys[key]=true);
    document.addEventListener('mouseup', ()=>_keys[key]=false);
  }

  // 가스: 터치 시 토글 (1번 → AUTO ON, 2번 → OFF)
  const gasEl = $('btnGas');
  if (gasEl) {
    gasEl.addEventListener('touchstart', e => {
      e.preventDefault();
      _gasLocked = !_gasLocked;
      _keys.gas = _gasLocked;
      gasEl.classList.toggle('auto-on', _gasLocked);
      gasEl.innerHTML = _gasLocked ? '▲<small>AUTO ●</small>' : '▲<small>GAS</small>';
    }, {passive:false});
    // 마우스: hold 동작
    gasEl.addEventListener('mousedown', () => _keys.gas = true);
    document.addEventListener('mouseup', () => { if (!_gasLocked) _keys.gas = false; });
  }
}

// ── 전체화면 ──────────────────────────────────────────────────────────────────
let _cssFs = false;

function initFullscreen() {
  const btn  = $('btnFs');
  const wrap = $('canvasWrap');
  const game = $('gameScreen');
  if (!btn) return;
  btn.addEventListener('click', ()=>{
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    if (_cssFs) { _exitCssFs(btn, wrap, game); return; }
    const req = wrap?.requestFullscreen || wrap?.webkitRequestFullscreen;
    if (req) req.call(wrap).catch(()=>_enterCssFs(btn,wrap,game));
    else _enterCssFs(btn,wrap,game);
  });
  document.addEventListener('fullscreenchange', ()=>{
    if (!document.fullscreenElement && !_cssFs) { _syncFsBtn(btn,false); resizeCanvas(); }
    else if (document.fullscreenElement) { _syncFsBtn(btn,true); resizeCanvas(); }
  });
  document.addEventListener('webkitfullscreenchange', ()=>{
    _syncFsBtn(btn, !!document.webkitFullscreenElement); resizeCanvas();
  });
}
function _enterCssFs(btn,wrap,game){
  _cssFs=true; document.body.style.overflow='hidden';
  if(game){game.style.position='fixed';game.style.inset='0';game.style.zIndex='9000';game.style.background='#0a0a1a';}
  if(wrap){wrap.style.maxWidth='none';wrap.style.width='100vw';wrap.style.height='100vh';wrap.style.display='flex';wrap.style.alignItems='center';}
  _syncFsBtn(btn,true); resizeCanvas();
}
function _exitCssFs(btn,wrap,game){
  _cssFs=false; document.body.style.overflow='';
  if(game){game.style.position='';game.style.inset='';game.style.zIndex='';game.style.background='';}
  if(wrap){wrap.style.maxWidth='';wrap.style.width='';wrap.style.height='';wrap.style.display='';wrap.style.alignItems='';}
  _syncFsBtn(btn,false); resizeCanvas();
}
function _syncFsBtn(btn,full){ btn.textContent=full?'⤡':'⤢'; btn.title=full?'Exit Fullscreen':'Fullscreen'; }

// ── 캔버스 리사이즈 (9:16) ───────────────────────────────────────────────────
const LOGIC_W = 360, LOGIC_H = 640;  // 9:16 세로

function resizeCanvas() {
  const canvas = $('raceCanvas');
  if (!canvas) return;

  canvas.width  = LOGIC_W;
  canvas.height = LOGIC_H;

  const isFull = !!document.fullscreenElement || !!document.webkitFullscreenElement || _cssFs;
  let cw, ch;
  if (isFull) {
    const sw = window.innerWidth, sh = window.innerHeight;
    if (sh / sw > LOGIC_H / LOGIC_W) { cw = sw; ch = Math.round(sw * LOGIC_H / LOGIC_W); }
    else { ch = sh; cw = Math.round(sh * LOGIC_W / LOGIC_H); }
  } else {
    const wrap = $('canvasWrap');
    cw = wrap?.clientWidth  || window.innerWidth;
    ch = Math.round(cw * LOGIC_H / LOGIC_W);
  }

  if (cw > 0) { canvas.style.width = cw+'px'; canvas.style.height = ch+'px'; }
  initRenderer(canvas);
}

// ── 초기화 ───────────────────────────────────────────────────────────────────
async function init() {
  showPhase('loading');
  initInput();
  initFullscreen();
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  await loadAllSprites();

  $('btnEnter')?.addEventListener('click', async ()=>{
    if (_uid) {
      const ok = await deductFee();
      if (!ok) { alert('Not enough GP'); return; }
    }
    _freeMode = false;
    _selectedSkills = [];
    renderSkillGrid();
    $('skCount').textContent = '0/3 selected';
    $('skConfirm').disabled  = true;
    showPhase('skill');
  });

  $('btnFreePlay')?.addEventListener('click', ()=>{
    _freeMode = true;
    _selectedSkills = [];
    renderSkillGrid();
    $('skCount').textContent = '0/3 selected';
    $('skConfirm').disabled  = true;
    showPhase('skill');
  });

  $('skConfirm')?.addEventListener('click', startCountdown);
  $('btnRestart')?.addEventListener('click', ()=>location.reload());

  // 헤더 Google 로그인
  function _bindHdrLogin(){
    $('gLoginBtn')?.addEventListener('click',async()=>{
      try{
        const btn=$('gLoginBtn'); if(btn) btn.textContent='Signing in...';
        await signInWithPopup(auth,new GoogleAuthProvider());
      }catch(e){
        const btn=$('gLoginBtn'); if(btn) btn.textContent='🔑 Google Login';
        if(!e.message?.includes('popup-closed')) alert('Login error: '+e.message);
      }
    });
  }
  function _updateHdr(user){
    const r=$('gHdrRight'); if(!r) return;
    if(user&&!user.isAnonymous){
      r.innerHTML=`<span class="g-user-chip">👤 ${esc(user.displayName||'User')}</span>`;
    } else {
      r.innerHTML=`<button class="g-login-btn" id="gLoginBtn">🔑 Google Login</button>`;
      _bindHdrLogin();
    }
  }
  _bindHdrLogin();

  onAuthStateChanged(auth, async user=>{
    _uid = user?.uid || null;
    await loadPlayerData();
    _updateHdr(user);
    showPhase('lobby');
  });
}

init();
