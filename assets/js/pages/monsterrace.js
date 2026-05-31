// monsterrace.js — Monster Skate Race 게임 로직 + 사운드
import { db, auth } from '/assets/js/firebase-init.js';
import { doc, getDoc, updateDoc, increment } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  buildTrack, initRenderer, loadAllSprites, renderScene,
  triggerShake, SEGS, TOTAL_LAPS,
} from './monsterrace.render.js';

// ── 상수 ─────────────────────────────────────────────────────────────────────
const ENTRY_FEE = 100;
const PRIZES    = [500, 250, 150, 50, 30, 20, 10];
const MAX_SPEED = 0.076;
const ACCEL     = 0.0013;
const STEER     = 0.045;
const FALL_DUR  = 5000;
const AI_THINK  = 1100;

// ── 스킬 정의 ────────────────────────────────────────────────────────────────
const SKILLS = {
  // 공격형
  apple:    { name:'사과던지기', mp:10, emoji:'🍎', type:'attack', cd:3000, desc:'전방 속도 -30% / 3초' },
  rock:     { name:'돌멩이투척', mp:15, emoji:'🪨', type:'attack', cd:4000, desc:'전방 차량 뒤집기' },
  web:      { name:'거미줄발사', mp:20, emoji:'🕸️',  type:'attack', cd:5000, desc:'전방 최고속 -40% / 3초' },
  tornado:  { name:'회오리바람', mp:30, emoji:'🌪️', type:'attack', cd:9000, desc:'전방 2대 내 뒤로 날려버림' },
  // 함정형
  banana:   { name:'바나나껍질', mp:10, emoji:'🍌', type:'trap',   cd:3000, desc:'밟으면 스핀+조향불가' },
  oil:      { name:'기름통',    mp:15, emoji:'🛢️',  type:'trap',   cd:4000, desc:'밟으면 속도↑+조향불가' },
  poop:     { name:'몬스터똥', mp:10, emoji:'💩', type:'trap',   cd:3000, desc:'밟으면 2초 감속' },
  ice:      { name:'얼음지대', mp:20, emoji:'🧊', type:'trap',   cd:5000, desc:'밟으면 미끄럼+조향불가' },
  // 이동형
  boost:    { name:'부스트',   mp:20, emoji:'⚡', type:'move',   cd:5000, desc:'속도 x2 / 3초' },
  lightning:{ name:'번개질주', mp:30, emoji:'🌩️', type:'move',   cd:8000, desc:'속도 x2 + 무적 / 5초' },
};

const AI_DEFS = [
  { id:'orc',    imgKey:'orc',     name:'Orc',    color:'#4a7c2f', spd:1.00, skills:['apple','banana','boost'] },
  { id:'pirate', imgKey:'pirate',  name:'Pirate', color:'#7c3a1a', spd:0.98, skills:['rock','oil','boost'] },
  { id:'zombie', imgKey:'zombie1', name:'Zombie', color:'#5a7a3a', spd:0.93, skills:['banana','poop','ice'] },
  { id:'banshee',imgKey:'zombie2', name:'Banshee',color:'#4a3a5a', spd:0.91, skills:['poop','web','banana'] },
  { id:'cabi',   imgKey:'cabi',    name:'Cabi',   color:'#5a00aa', spd:1.05, skills:['web','tornado','apple'] },
  { id:'troll',  imgKey:'troll',   name:'Troll',  color:'#8a8a00', spd:0.96, skills:['rock','ice','boost'] },
];

// ── 사운드 시스템 (Web Audio API) ─────────────────────────────────────────────
let _ac = null;
// 바퀴 굴러가는 소리 노드
let _rollSrc = null, _rollGain = null, _rollFilter = null;
// 오르막/내리막/점프 효과음 타이머
let _terrainSndTs = 0;

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

function noise(dur, vol=0.2, cutoff=400) {
  try {
    const a=ac();
    const buf=a.createBuffer(1,a.sampleRate*dur,a.sampleRate);
    const data=buf.getChannelData(0);
    for(let i=0;i<data.length;i++) data[i]=Math.random()*2-1;
    const src=a.createBufferSource(), gain=a.createGain(), filt=a.createBiquadFilter();
    src.buffer=buf; filt.type='lowpass'; filt.frequency.value=cutoff;
    src.connect(filt); filt.connect(gain); gain.connect(a.destination);
    gain.gain.setValueAtTime(vol,a.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001,a.currentTime+dur);
    src.start(); src.stop(a.currentTime+dur);
  } catch {}
}

function playCountdown(n) {
  if(n>0) tone(440,'sine',0.22,0.4);
  else { tone(880,'sine',0.15,0.5); tone(1320,'sine',0.28,0.4); }
}
function playBoost()    { tone(200,'sawtooth',0.06,0.2); tone(500,'sawtooth',0.22,0.2); }
function playPickup()   { tone(880,'sine',0.09,0.28); tone(1100,'sine',0.14,0.22); }
function playSkillHit() { tone(400,'square',0.05,0.22); tone(200,'square',0.28,0.18); }
function playFall()     { noise(0.28,0.3,600); tone(80,'sine',0.35,0.25); }
function playFinish()   { [523,659,784,1047,1319,1568].forEach((f,i)=>setTimeout(()=>tone(f,'sine',0.32,0.38),i*75)); }
function playTrap()     { tone(250,'sawtooth',0.05,0.18); tone(150,'sawtooth',0.28,0.18); }

// ── 스케이트보드 바퀴 굴러가는 소리 ──────────────────────────────────────────
// 도로 마찰 노이즈 + 바퀴 클릭/클럭 패턴
function startEngine() {
  try {
    const a = ac();
    if (_rollSrc) return;

    // 바퀴 마찰 노이즈 (지속)
    const bufLen = a.sampleRate * 2;
    const buf    = a.createBuffer(1, bufLen, a.sampleRate);
    const data   = buf.getChannelData(0);
    // 주기적인 클럭 패턴 (바퀴 이음매 소리)
    for (let i=0; i<bufLen; i++) {
      const t    = i / a.sampleRate;
      const roll = Math.random() * 0.4;                 // 기본 노이즈
      const click = Math.abs(Math.sin(t * 18 * Math.PI)) > 0.96 ? 0.6 : 0; // 이음매 클릭
      data[i] = (roll + click) * (Math.random() > 0.5 ? 1 : -1);
    }

    _rollSrc    = a.createBufferSource();
    _rollGain   = a.createGain();
    _rollFilter = a.createBiquadFilter();

    _rollSrc.buffer = buf;
    _rollSrc.loop   = true;

    _rollFilter.type             = 'bandpass';
    _rollFilter.frequency.value  = 900;
    _rollFilter.Q.value          = 1.5;

    _rollSrc.connect(_rollFilter);
    _rollFilter.connect(_rollGain);
    _rollGain.connect(a.destination);
    _rollGain.gain.value = 0;
    _rollSrc.start();
  } catch {}
}

function updateEngine(speed, maxSpeed) {
  if (!_rollGain || !_rollFilter) return;
  try {
    const r  = speed / maxSpeed;
    const a  = ac();
    // 속도 빠를수록: 볼륨 up, 주파수 up (고음 = 빠른 바퀴 회전)
    _rollGain.gain.linearRampToValueAtTime(r > 0.05 ? 0.06 + r * 0.1 : 0, a.currentTime + 0.08);
    _rollFilter.frequency.linearRampToValueAtTime(600 + r * 1400, a.currentTime + 0.08);
    _rollFilter.Q.value = 1.2 + r * 0.8;

    // ── 지형 효과음 (오르막/내리막/점프) ──────────────────────────────────
    const now = Date.now();
    if (now - _terrainSndTs > 1200 && speed > maxSpeed * 0.3) {
      const seg = _track?.[((Math.floor(_player?.pos || 0)) % SEGS + SEGS) % SEGS];
      if (seg) {
        if (seg.hill > 5) {
          // 오르막: 바퀴소리 피치 내려가며 힘든 소리
          tone(300 + r*100, 'sawtooth', 0.3, 0.06, 500+r*200);
          _terrainSndTs = now;
        } else if (seg.hill < -4) {
          // 내리막: 빠르게 올라가는 바람 소리
          tone(800+r*400, 'sine', 0.25, 0.04, 300);
          _terrainSndTs = now;
        }
      }
    }
  } catch {}
}

// 점프 사운드 (점프 구간 진입 시 외부에서 호출)
function playJumpLand() {
  noise(0.12, 0.3, 1200);
  tone(180, 'sine', 0.2, 0.18);
}

function stopEngine() {
  try { _rollGain?.gain.linearRampToValueAtTime(0, ac().currentTime + 0.3); } catch {}
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
const _keys = {left:false, right:false, gas:false, brake:false};
let _aiTimers = {};

const $ = id => document.getElementById(id);

// ── DB ───────────────────────────────────────────────────────────────────────
async function loadPlayerData() {
  if (!_uid) return;
  try {
    const snap = await getDoc(doc(db,'battle_players',_uid));
    if (snap.exists()) {
      const d = snap.data();
      _playerHP = d.hp || 1000; _playerMaxHP = _playerHP;
      _playerMP = d.mp || 1000; _playerMaxMP = _playerMP;
      _playerGP = d.gold || 0;
    }
  } catch {}
  $('lobbyGP').textContent = _playerGP;
  $('lobbyHP').textContent = _playerHP;
  $('lobbyMP').textContent = _playerMP;
  $('btnEnter').disabled   = _playerGP < ENTRY_FEE;
}

async function deductFee() {
  if (_playerGP < ENTRY_FEE) return false;
  try { await updateDoc(doc(db,'battle_players',_uid), {gold: increment(-ENTRY_FEE)}); _playerGP -= ENTRY_FEE; return true; }
  catch { return false; }
}

async function awardPrize(rank) {
  const gp = PRIZES[Math.min(rank, PRIZES.length-1)] || 10;
  if (_uid) try { await updateDoc(doc(db,'battle_players',_uid), {gold: increment(gp)}); } catch {}
  return gp;
}

// ── 레이서 팩토리 ─────────────────────────────────────────────────────────────
function makeRacer(def, isPlayer) {
  return {
    id:      def.id,
    imgKey:  isPlayer ? 'user' : (def.imgKey || 'orc'),
    name:    def.name, color: def.color,
    pos:     0, lane: 0, speed: 0,
    maxSpeed: MAX_SPEED * (def.spd || 1),
    hp: isPlayer ? _playerHP : 700+Math.random()*500,
    maxHp: isPlayer ? _playerMaxHP : 1000,
    mp: isPlayer ? _playerMP : 500+Math.random()*400,
    maxMp: isPlayer ? _playerMaxMP : 800,
    lap: 0, finished: false, rank: 0, currentRank: 1,
    fallUntil: 0, wobble: 0,
    effects: {},   // { boost, slow, slowMax, stun, jumping, invincible }: timestamp
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
        // 전방 2마리를 내 뒤로 날려버림
        const targets = findFront(racer, 2);
        if (!targets.length) break;
        targets.forEach(t => {
          if ((t.effects.invincible||0)>now) return;
          t.pos = racer.pos - 3 - Math.random();
          t.effects.spin = now + 2500;
          t.speed *= 0.25;
          addLog(`🌪️ ${t.name} 날아감!`);
        });
        triggerShake(7);
        tone(150,'sine',0.5,0.25,400); tone(80,'sawtooth',0.4,0.15);
        break;
      }
      const fwd = findFront(racer, 1)[0];
      if (!fwd || (fwd.effects.invincible||0)>now) break;
      if (id==='apple') { fwd.effects.slow=now+3000; addLog(`🍎 ${fwd.name} 속도 -30%!`); playSkillHit(); }
      if (id==='rock')  { fwd.fallUntil=now+2500; fwd.speed=0; triggerShake(8);
                          addLog(`🪨 ${fwd.name} 뒤집힘!`); playFall(); playSkillHit(); }
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

// ahead=true: 전방, n개 반환
function findFront(racer, n=1) {
  return [_player,..._racers]
    .filter(r=>r.id!==racer.id&&!r.finished&&r.pos>racer.pos)
    .sort((a,b)=>a.pos-b.pos)
    .slice(0, n);
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

  const spinning  = (r.effects.spin||0)>now;
  const oilSlide  = (r.effects.oilSlide||0)>now;
  const iceSlide  = (r.effects.iceSlide||0)>now;
  const anySlide  = spinning || oilSlide || iceSlide;

  if (isPlayer) {
    const vr = Math.min(1, r.speed / r.maxSpeed);

    // ── 스핀 효과 (바나나 — 차량 회전, 조향 불가) ────────────────────────
    if (spinning) {
      r.lane += Math.sin(now * 0.014) * 0.18;
      r.lane = Math.max(-1.8, Math.min(1.8, r.lane));
      r.speed = Math.max(0, r.speed - ACCEL * 0.8);
    }
    // ── 기름 슬라이드 (속도↑ + 조향 불가) ───────────────────────────────
    else if (oilSlide) {
      r.speed = Math.min(r.maxSpeed * 1.6, r.speed + ACCEL * 1.5);
      r.lane += (Math.random()-0.5) * 0.06;
      r.lane = Math.max(-1.8, Math.min(1.8, r.lane));
    }
    // ── 얼음 슬라이드 (미끄럼 + 조향 불가) ──────────────────────────────
    else if (iceSlide) {
      r.speed = Math.max(top * 0.35, r.speed - ACCEL * 0.15);
      r.lane += (Math.random()-0.5) * 0.05;
      r.lane = Math.max(-1.8, Math.min(1.8, r.lane));
    }
    // ── 정상 주행 ─────────────────────────────────────────────────────────
    else {
      // 가속 / 브레이크
      const targetSpeed = _keys.gas ? top : top * 0.6;
      if (r.speed < targetSpeed)      r.speed = Math.min(r.speed + ACCEL, targetSpeed);
      else if (_keys.brake)           r.speed = Math.max(0, r.speed - ACCEL * 3);
      else if (r.speed > targetSpeed) r.speed = Math.max(targetSpeed, r.speed - ACCEL * 0.5);

      // 조향 + 코너링 물리
      const steerInput = (_keys.right ? 1 : 0) - (_keys.left ? 1 : 0);
      if (steerInput !== 0) {
        const effSteer = STEER * (1 - vr * 0.5);
        r.lane = Math.max(-1.8, Math.min(1.8, r.lane + steerInput * effSteer));
        const latG = Math.max(0, vr - 0.3);
        r.speed = Math.max(top * 0.25, r.speed * (1 - latG * latG * 0.009));
      }

      // 트랙 커브 원심력
      const curSeg = _track?.[((Math.floor(r.pos)) % SEGS + SEGS) % SEGS];
      if (curSeg?.curve) {
        const centrifugal = -(curSeg.curve / 3) * vr * vr * 0.015;
        r.lane = Math.max(-1.8, Math.min(1.8, r.lane + centrifugal));
      }
    }

    // 코스 이탈 페널티
    if (Math.abs(r.lane) > 1.3) {
      const offRoad = (Math.abs(r.lane) - 1.3) / 0.5;
      r.speed *= (1 - offRoad * 0.05);
    }
  } else {
    // AI
    if (r.speed < top) r.speed = Math.min(r.speed + ACCEL * 0.92, top);
    if (spinning) {
      r.lane += Math.sin(now * 0.014) * 0.12;
    } else if (oilSlide || iceSlide) {
      r.lane += (Math.random()-0.5) * 0.05;
    } else {
      r.lane += (Math.random()-0.5)*0.015;
      r.lane = r.lane * 0.97;
    }
    r.lane = Math.max(-1.5, Math.min(1.5, r.lane));
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
      case 'banana':
        // 스핀 + 조향 불가 2초
        r.effects.spin = now+2000; r.speed *= 0.6; triggerShake(7);
        addLog(`🍌 ${r.name} 스핀!`); if(r.isPlayer) playFall();
        break;
      case 'oil':
        // 속도↑ + 조향 불가 3초
        r.effects.oilSlide = now+3000;
        addLog(`🛢️ ${r.name} 기름 미끄럼!`); if(r.isPlayer) tone(200,'sawtooth',0.3,0.18);
        break;
      case 'poop':
        // 2초 감속
        r.effects.slow = now+2000;
        addLog(`💩 ${r.name} 감속!`);
        break;
      case 'ice':
        // 미끄럼 + 조향 불가 3초
        r.effects.iceSlide = now+3000;
        addLog(`🧊 ${r.name} 빙판!`); if(r.isPlayer) tone(1200,'sine',0.15,0.12);
        break;
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

// ── AI ───────────────────────────────────────────────────────────────────────
function aiThink(r) {
  const now = Date.now();
  if ((now - (_aiTimers[r.id]||0)) < AI_THINK) return;
  _aiTimers[r.id] = now;
  if (Math.random() < 0.45 && r.skills.length) {
    useSkill(r, r.skills[Math.floor(Math.random()*r.skills.length)]);
  }
}

// ── 완주 / 종료 ───────────────────────────────────────────────────────────────
let _ended = false;
function finishRacer(r) {
  if (_ended) return;
  r.finished = true; r.speed *= 0.3;
  r.rank = _finishOrder.length+1;
  _finishOrder.push(r);
  addLog(`🏁 ${r.name} ${r.rank}위!`);
  if (_finishOrder.length >= 7 || r.isPlayer) endRace(r.rank);
}

async function endRace(rank) {
  if (_ended) return; _ended = true;
  stopEngine();
  cancelAnimationFrame(_raf);
  playFinish();

  const finalRank = _player.rank || (7 - _finishOrder.filter(r=>!r.isPlayer).length);
  const gp = await awardPrize(finalRank - 1);

  setTimeout(() => {
    $('finishRank').textContent = `${finalRank}위 완주!`;
    $('finishGP').textContent   = `+${gp} GP 획득!`;
    showPhase('finish');
  }, 600);
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

  // 순위 정렬
  const active = [_player,..._racers].filter(r=>!r.finished);
  active.sort((a,b)=>b.pos-a.pos);
  active.forEach((r,i)=>r.currentRank=i+1);

  _player.isBraking = _keys.brake;   // 렌더러에 브레이크 상태 전달
  updateEngine(_player.speed, _player.maxSpeed);

  renderScene(_track, _racers, _player, _items, _gameTs);
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
  // 상태 이상 표시
  const now3 = Date.now();
  const statusIcons = [];
  if ((_player.effects?.spin||0)>now3)      statusIcons.push('🌀스핀');
  if ((_player.effects?.oilSlide||0)>now3)  statusIcons.push('🛢️미끄럼');
  if ((_player.effects?.iceSlide||0)>now3)  statusIcons.push('🧊빙판');
  if ((_player.effects?.slow||0)>now3)      statusIcons.push('🐢감속');
  if ((_player.effects?.slowMax||0)>now3)   statusIcons.push('🕸️거미줄');
  if ((_player.effects?.boost||0)>now3)     statusIcons.push('⚡부스트');
  if ((_player.effects?.invincible||0)>now3)statusIcons.push('🛡️무적');
  const stEl = $('statusTxt');
  if (stEl) stEl.textContent = statusIcons.join(' ');
  if ($('rankTxt')) $('rankTxt').textContent = `${_player.currentRank||'?'}위 / 7`;
  if ($('lapTxt'))  $('lapTxt').textContent  = `${Math.min(_player.lap+1,TOTAL_LAPS)}/${TOTAL_LAPS}랩`;
  if ($('gpTxt'))   $('gpTxt').textContent   = `💰${_playerGP}`;

  // 스킬 쿨다운
  _selectedSkills.forEach((sk,i)=>{
    const btn = $(`skBtn${i}`); if (!btn) return;
    const cd = (_player.skillCooldowns[sk]||0) - Date.now();
    const mp = SKILLS[sk]?.mp || 0;
    const off = cd>0 || _player.mp < mp;
    btn.style.opacity = off ? '0.45' : '1';
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
      if (_selectedSkills.includes(id)) {
        _selectedSkills=_selectedSkills.filter(s=>s!==id);
        btn.classList.remove('sel');
      } else if (_selectedSkills.length<3) {
        _selectedSkills.push(id); btn.classList.add('sel');
      }
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
    else     { $('cdNum').textContent = 'GO!'; clearInterval(iv); setTimeout(startRace,500); }
  },1000);
}

function startRace() {
  showPhase('game');
  // 게임화면이 표시된 후 resizeCanvas (숨겨진 상태에서 호출 시 clientWidth=0)
  requestAnimationFrame(() => {
    resizeCanvas();
    buildSkillBar();
    startEngine();
    _lastTs = performance.now();
    _raf = requestAnimationFrame(loop);
    // 캔버스에 포커스 — 키보드 이벤트가 스크롤 컨테이너에 가로채이지 않도록
    const cv = $('raceCanvas');
    if (cv) cv.focus();
  });
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
      case 'ArrowUp':   case 'w': case 'W': case ' ': _keys.gas=false;   break;
      case 'ArrowDown': case 's': case 'S': _keys.brake=false; break;
    }
  });

  const touch=(id,key)=>{
    const el=$(id); if(!el)return;
    el.addEventListener('touchstart',e=>{e.preventDefault();_keys[key]=true;},{passive:false});
    el.addEventListener('touchend',  e=>{e.preventDefault();_keys[key]=false;},{passive:false});
    el.addEventListener('mousedown',()=>_keys[key]=true);
    document.addEventListener('mouseup',()=>{ _keys[key]=false; });
  };
  touch('btnLeft','left');
  touch('btnRight','right');
  touch('btnGas','gas');
  touch('btnBrake','brake');
}

// ── 전체화면 (네이티브 API + CSS 폴백 이중 구조) ──────────────────────────────
// 네이티브: requestFullscreen (Android/Desktop)
// CSS 폴백: .race-css-fs 클래스 (iOS Safari)
let _cssFs = false;

function initFullscreen() {
  const btn  = $('btnFs');
  const wrap = $('canvasWrap');
  const game = $('gameScreen');
  if (!btn) return;

  btn.addEventListener('click', ()=>{
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }
    if (_cssFs) {
      _exitCssFs(btn, wrap, game);
      return;
    }
    // 네이티브 시도 → 실패 시 CSS 폴백
    const req = wrap?.requestFullscreen || wrap?.webkitRequestFullscreen;
    if (req) {
      req.call(wrap).catch(() => _enterCssFs(btn, wrap, game));
    } else {
      _enterCssFs(btn, wrap, game);
    }
  });

  document.addEventListener('fullscreenchange', ()=>{
    if (!document.fullscreenElement && !_cssFs) {
      _syncFsBtn(btn, false);
      resizeCanvas();
    } else if (document.fullscreenElement) {
      _syncFsBtn(btn, true);
      resizeCanvas();
    }
  });
  document.addEventListener('webkitfullscreenchange', ()=>{
    const full = !!document.webkitFullscreenElement;
    _syncFsBtn(btn, full);
    resizeCanvas();
  });
}

function _enterCssFs(btn, wrap, game) {
  _cssFs = true;
  document.body.style.overflow = 'hidden';
  if (game) { game.style.position='fixed'; game.style.inset='0'; game.style.zIndex='9000'; game.style.background='#0a0a1a'; }
  if (wrap) { wrap.style.maxWidth='none'; wrap.style.width='100vw'; wrap.style.height='100vh'; wrap.style.display='flex'; wrap.style.alignItems='center'; }
  _syncFsBtn(btn, true);
  resizeCanvas();
}

function _exitCssFs(btn, wrap, game) {
  _cssFs = false;
  document.body.style.overflow = '';
  if (game) { game.style.position=''; game.style.inset=''; game.style.zIndex=''; game.style.background=''; }
  if (wrap) { wrap.style.maxWidth=''; wrap.style.width=''; wrap.style.height=''; wrap.style.display=''; wrap.style.alignItems=''; }
  _syncFsBtn(btn, false);
  resizeCanvas();
}

function _syncFsBtn(btn, isFull) {
  btn.textContent = isFull ? '⤡' : '⤢';
  btn.title       = isFull ? '화면 축소' : '전체 화면';
}

// 논리 해상도 고정 — CSS 스케일로 반응형 처리 (DPR 이슈 없이 단순화)
const LOGIC_W = 640, LOGIC_H = 360;

function resizeCanvas() {
  const canvas = $('raceCanvas');
  if (!canvas) return;

  // 논리 해상도 항상 400×225
  canvas.width  = LOGIC_W;
  canvas.height = LOGIC_H;

  // 표시 크기 계산
  const isFull = !!document.fullscreenElement || !!document.webkitFullscreenElement || _cssFs;
  let cw, ch;
  if (isFull) {
    // 전체화면: 화면 비율에 맞게 최대화 (letterbox)
    const sw = window.innerWidth, sh = window.innerHeight;
    if (sw / sh > LOGIC_W / LOGIC_H) {
      ch = sh; cw = Math.round(sh * LOGIC_W / LOGIC_H);
    } else {
      cw = sw; ch = Math.round(sw * LOGIC_H / LOGIC_W);
    }
  } else {
    const wrap = $('canvasWrap');
    cw = wrap?.clientWidth || window.innerWidth;
    ch = Math.round(cw * LOGIC_H / LOGIC_W);
  }

  if (cw > 0) {
    canvas.style.width  = cw + 'px';
    canvas.style.height = ch + 'px';
  }

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
    if (!_uid) { alert('로그인이 필요합니다'); return; }
    const ok = await deductFee();
    if (!ok)  { alert('GP가 부족합니다 (100 GP 필요)'); return; }
    _selectedSkills = [];
    renderSkillGrid();
    $('skCount').textContent = '0/3 선택';
    $('skConfirm').disabled  = true;
    showPhase('skill');
  });

  $('skConfirm')?.addEventListener('click', startCountdown);
  $('btnRestart')?.addEventListener('click', ()=>location.reload());

  onAuthStateChanged(auth, async user=>{
    _uid = user?.uid || null;
    await loadPlayerData();
    showPhase('lobby');
  });
}

init();
