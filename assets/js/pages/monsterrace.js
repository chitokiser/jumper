// monsterrace.js — Monster Skate Race 게임 로직
import { db, auth } from '/assets/js/firebase-init.js';
import { addSparks, addSmoke, resetParticles } from './monsterrace.fx.js';
import { doc, getDoc, updateDoc, increment } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
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
const LANE_MAX   = 2.3;     // 도로 끝까지 (was 1.8)
const AI_THINK   = 2800;    // AI 반응 느리게 (was 1100)
const MAX_KMH    = 280;     // 최대속도 km/h 표시
const RACE_KM    = 3.0;     // 총 레이스 거리 km
const GEARS        = [0.22, 0.42, 0.62, 0.80, 1.0];
const GEAR_ACCEL_M = [2.0,  1.55, 1.25, 1.0,  0.82];

// ── 스킬 정의 ────────────────────────────────────────────────────────────────
const SKILLS = {
  apple:    { name:'사과던지기', mp:10, emoji:'🍎', type:'attack', cd:3000, desc:'전방 속도 -30% / 3초' },
  rock:     { name:'돌멩이투척', mp:15, emoji:'🪨', type:'attack', cd:4000, desc:'전방 차량 뒤집기' },
  web:      { name:'거미줄발사', mp:20, emoji:'🕸️',  type:'attack', cd:5000, desc:'전방 최고속 -40% / 3초' },
  tornado:  { name:'회오리바람', mp:30, emoji:'🌪️', type:'attack', cd:9000, desc:'전방 2대 내 뒤로 날려버림' },
  banana:   { name:'바나나껍질', mp:10, emoji:'🍌', type:'trap',   cd:3000, desc:'밟으면 스핀+조향불가' },
  oil:      { name:'기름통',    mp:15, emoji:'🛢️',  type:'trap',   cd:4000, desc:'밟으면 속도↑+조향불가' },
  poop:     { name:'몬스터똥', mp:10, emoji:'💩', type:'trap',   cd:3000, desc:'밟으면 2초 감속' },
  ice:      { name:'얼음지대', mp:20, emoji:'🧊', type:'trap',   cd:5000, desc:'밟으면 미끄럼+조향불가' },
  boost:    { name:'부스트',   mp:20, emoji:'⚡', type:'move',   cd:5000, desc:'속도 x2 / 3초' },
  lightning:{ name:'번개질주', mp:30, emoji:'🌩️', type:'move',   cd:8000, desc:'속도 x2 + 무적 / 5초' },
};

// AI 속도 약화 (was 0.91~1.05)
const AI_DEFS = [
  { id:'orc',    imgKey:'orc',     name:'Orc',    color:'#4a7c2f', spd:0.78, skills:['apple','banana','boost'] },
  { id:'pirate', imgKey:'pirate',  name:'Pirate', color:'#7c3a1a', spd:0.76, skills:['rock','oil','boost'] },
  { id:'zombie', imgKey:'zombie1', name:'Zombie', color:'#5a7a3a', spd:0.72, skills:['banana','poop','ice'] },
  { id:'banshee',imgKey:'zombie2', name:'Banshee',color:'#4a3a5a', spd:0.70, skills:['poop','web','banana'] },
  { id:'cabi',   imgKey:'cabi',    name:'Cabi',   color:'#5a00aa', spd:0.82, skills:['web','tornado','apple'] },
  { id:'troll',  imgKey:'troll',   name:'Troll',  color:'#8a8a00', spd:0.74, skills:['rock','ice','boost'] },
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
      if (a.isPlayer || b.isPlayer) addLog(`💥 ${a.name}↔${b.name} 충돌!`);
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
    $('lobbyGP').textContent = '게스트';
    $('lobbyHP').textContent = '—';
    $('lobbyMP').textContent = '—';
    $('btnEnter').disabled = false;
    const badge=$('feeBadge'); if(badge) badge.textContent='🆓 체험 무료';
    const info=$('feeInfo'); if(info) info.textContent='게스트는 무료 체험 가능 (GP 적립 안 됨)';
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
  if (badge) badge.textContent = `참가비: ${_entryFee} GP`;
  const info = $('feeInfo');
  if (!info) return;
  if (_entryCount === 0) {
    info.textContent = '오늘 첫 참가 · 24시간 후 자동 리셋';
  } else {
    const h = Math.ceil((_entryResetAt + RESET_MS - Date.now()) / 3_600_000);
    info.textContent = `오늘 ${_entryCount}번째 참가 · ${h}시간 후 100GP 리셋`;
  }
}

async function deductFee() {
  if (_playerGP < _entryFee) return false;
  try {
    const now = Date.now();
    const isReset    = !_entryResetAt || now - _entryResetAt > RESET_MS;
    const newCount   = isReset ? 1 : _entryCount + 1;
    const newResetAt = isReset ? now : _entryResetAt;
    await updateDoc(doc(db,'battle_players',_uid), {
      gold: increment(-_entryFee),
      [`${GAME_KEY}.count`]:   newCount,
      [`${GAME_KEY}.resetAt`]: newResetAt,
    });
    _playerGP    -= _entryFee;
    _entryCount   = newCount;
    _entryResetAt = newResetAt;
    _entryFee     = BASE_FEE + _entryCount * FEE_STEP;
    return true;
  } catch { return false; }
}

async function awardPrize(rank) {
  const gp = PRIZES[Math.min(rank, PRIZES.length-1)] || 10;
  if (_uid) try { await updateDoc(doc(db,'battle_players',_uid), {gold: increment(gp)}); } catch {}
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
    case 'move':
      if (id==='boost')     { racer.effects.boost=now+3000; playBoost(); }
      if (id==='lightning') { racer.effects.boost=now+5000; racer.effects.invincible=now+5000; playBoost();
                              tone(1200,'sine',0.08,0.3); addLog(`⚡ ${racer.name} 무적+질주!`); }
      break;
    case 'attack': {
      if (id==='tornado') {
        const targets = findFront(racer, 2);
        if (!targets.length) break;
        targets.forEach(t => {
          if ((t.effects.invincible||0)>now) return;
          t.pos = racer.pos - 3 - Math.random();
          t.effects.spin = now + 2500; t.speed *= 0.25;
          addLog(`🌪️ ${t.name} 날아감!`);
        });
        triggerShake(7);
        tone(150,'sine',0.5,0.25,400); tone(80,'sawtooth',0.4,0.15);
        break;
      }
      const fwd = findFront(racer, 1)[0];
      if (!fwd || (fwd.effects.invincible||0)>now) break;
      if (id==='apple') { fwd.effects.slow=now+3000; addLog(`🍎 ${fwd.name} 속도 -30%!`); playSkillHit(); }
      if (id==='rock')  { fwd.fallUntil=now+2500; fwd.speed=0; triggerShake(8); addLog(`🪨 ${fwd.name} 뒤집힘!`); playFall(); playSkillHit(); }
      if (id==='web')   { fwd.effects.slowMax=now+3000; addLog(`🕸️ ${fwd.name} 최고속 -40%!`); playSkillHit(); }
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

  const boosted = (r.effects.boost||0)>now;
  const slowed  = (r.effects.slow||0)>now;
  const slowMax = (r.effects.slowMax||0)>now;
  const top = r.maxSpeed
    * (boosted ? 2.0:1.0)
    * (slowed  ? 0.7:1.0)
    * (slowMax ? 0.6:1.0)
    * (r.wobble>0 ? 0.82:1.0);

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
      }
    }

    // 코스 이탈 페널티 (경계 확장)
    if (Math.abs(r.lane) > 1.9) {
      const offRoad = (Math.abs(r.lane) - 1.9) / 0.5;
      r.speed *= (1 - offRoad * 0.06);
    }
  } else {
    // AI — 속도 및 반응 약화
    if (r.speed < top) r.speed = Math.min(r.speed + ACCEL * 0.60, top);
    if (spinning) {
      r.lane += Math.sin(now * 0.014) * 0.12;
    } else if (oilSlide || iceSlide) {
      r.lane += (Math.random()-0.5) * 0.05;
    } else {
      r.lane += (Math.random()-0.5) * 0.018;
      r.lane = r.lane * 0.97;
    }
    r.lane = Math.max(-1.6, Math.min(1.6, r.lane));
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
      case 'banana': r.effects.spin=now+2000; r.speed*=0.6; triggerShake(7); addLog(`🍌 ${r.name} 스핀!`); if(r.isPlayer)playFall(); break;
      case 'oil':    r.effects.oilSlide=now+3000; addLog(`🛢️ ${r.name} 기름 미끄럼!`); if(r.isPlayer)tone(200,'sawtooth',0.3,0.18); break;
      case 'poop':   r.effects.slow=now+2000; addLog(`💩 ${r.name} 감속!`); break;
      case 'ice':    r.effects.iceSlide=now+3000; addLog(`🧊 ${r.name} 빙판!`); if(r.isPlayer)tone(1200,'sine',0.15,0.12); break;
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
  Easy:      { ms:3500, skillP:0.09, avoidP:0.3,  spdM:0.72 },
  Normal:    { ms:2500, skillP:0.20, avoidP:0.60, spdM:0.82 },
  Hard:      { ms:1500, skillP:0.38, avoidP:0.85, spdM:0.93 },
  Nightmare: { ms:800,  skillP:0.58, avoidP:1.0,  spdM:1.04 },
};
const _curDiff = 'Normal';

function aiThink(r) {
  const now=Date.now(), d=AI_DIFF[_curDiff];
  if ((now-(_aiTimers[r.id]||0)) < d.ms) return;
  _aiTimers[r.id]=now;

  // 함정 회피
  const nearTrap = _traps.find(t => t.active && Math.abs(t.pos-r.pos)<1.6 && Math.abs(t.lane-r.lane)<0.55);
  if (nearTrap) {
    const trapAway = r.lane < nearTrap.lane ? -1 : 1;
    r.lane = Math.max(-1.6, Math.min(1.6, r.lane + trapAway * 0.24));
    _aiTimers[r.id] = now; return;
  }

  // 충돌 회피: 근접 차량 존재 시 차선 변경
  if (Math.random() < d.avoidP) {
    const near=[_player,..._racers].find(o=>
      o.id!==r.id && !o.finished &&
      Math.abs(o.pos-r.pos)<1.1 && Math.abs(o.lane-r.lane)<0.45
    );
    if (near) {
      const away = r.lane < near.lane ? -1 : 1;
      r.lane = Math.max(-1.6, Math.min(1.6, r.lane + away*(0.18+Math.random()*0.15)));
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
    // 순위 뒤처질 때 부스트
    if ((r.currentRank||1)>3 && moves.length && Math.random()<0.55) {
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
  addLog(`🏁 ${r.name} ${r.rank}위!`);
  if (_finishOrder.length >= 7 || r.isPlayer) endRace(r.rank);
}

function showFinishOverlay(rank) {
  const el = $('finishOverlay'); if (!el) return;
  const sub = $('finishSubTxt');
  if (sub) sub.textContent = `${rank}위 완주!`;
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
    $('finishRank').textContent = `${finalRank}위 완주!`;
    $('finishGP').textContent   = `+${gp} GP 획득!`;
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
  if ((_player.effects?.spin||0)>now3)       statusIcons.push('🌀스핀');
  if ((_player.effects?.oilSlide||0)>now3)   statusIcons.push('🛢️미끄럼');
  if ((_player.effects?.iceSlide||0)>now3)   statusIcons.push('🧊빙판');
  if ((_player.effects?.slow||0)>now3)       statusIcons.push('🐢감속');
  if ((_player.effects?.slowMax||0)>now3)    statusIcons.push('🕸️거미줄');
  if ((_player.effects?.boost||0)>now3)      statusIcons.push('⚡부스트');
  if ((_player.effects?.invincible||0)>now3) statusIcons.push('🛡️무적');
  const stEl = $('statusTxt');
  if (stEl) stEl.textContent = statusIcons.join(' ');

  if ($('rankTxt'))  $('rankTxt').textContent  = `${_player.currentRank||'?'}위 / 7`;
  if ($('lapTxt'))   $('lapTxt').textContent   = `${Math.min(_player.lap+1,TOTAL_LAPS)}/${TOTAL_LAPS}랩`;
  if ($('gpTxt'))    $('gpTxt').textContent    = `💰${_playerGP}`;

  // 속도 (km/h)
  const kmh = Math.round(_player.speed / _player.maxSpeed * MAX_KMH);
  if ($('speedTxt')) $('speedTxt').textContent = kmh + ' km/h';

  // 남은 거리
  const totalSegs = SEGS * TOTAL_LAPS;
  const traveled  = Math.min(_player.pos, totalSegs);
  const distKm    = Math.max(0, RACE_KM * (1 - traveled / totalSegs));
  if ($('distTxt')) $('distTxt').textContent = distKm.toFixed(2) + ' km 남음';

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
      $('skCount').textContent = `${_selectedSkills.length}/3 선택`;
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
function _syncFsBtn(btn,full){ btn.textContent=full?'⤡':'⤢'; btn.title=full?'화면 축소':'전체 화면'; }

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
      if (!ok) { alert('GP가 부족합니다'); return; }
    }
    _selectedSkills = [];
    renderSkillGrid();
    $('skCount').textContent = '0/3 선택';
    $('skConfirm').disabled  = true;
    showPhase('skill');
  });

  $('skConfirm')?.addEventListener('click', startCountdown);
  $('btnRestart')?.addEventListener('click', ()=>location.reload());

  // 헤더 Google 로그인
  function _bindHdrLogin(){
    $('gLoginBtn')?.addEventListener('click',async()=>{
      try{
        const btn=$('gLoginBtn'); if(btn) btn.textContent='로그인 중...';
        await signInWithPopup(auth,new GoogleAuthProvider());
      }catch(e){
        const btn=$('gLoginBtn'); if(btn) btn.textContent='🔑 Google 로그인';
        if(!e.message?.includes('popup-closed')) alert('로그인 오류: '+e.message);
      }
    });
  }
  function _updateHdr(user){
    const r=$('gHdrRight'); if(!r) return;
    if(user&&!user.isAnonymous){
      r.innerHTML=`<span class="g-user-chip">👤 ${user.displayName||'유저'}</span>`;
    } else {
      r.innerHTML=`<button class="g-login-btn" id="gLoginBtn">🔑 Google 로그인</button>`;
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
