// monsterrace.js — Monster Skate Race 메인 게임 로직
import { db, functions, auth } from '/assets/js/firebase-init.js';
import { doc, getDoc, updateDoc, increment } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import {
  buildTrack, initRenderer, renderScene, SEGS, TOTAL_LAPS,
} from './monsterrace.render.js';

// ── 상수 ─────────────────────────────────────────────────────────────────────
const ENTRY_FEE  = 100;
const PRIZES     = [500, 250, 150, 50, 30, 20, 10];
const MAX_SPEED  = 0.075;   // 세그먼트/프레임 (60fps 기준 → 약 3분 레이스)
const ACCEL      = 0.0012;
const BRAKE      = 0.003;
const STEER_SPD  = 0.04;
const FALL_DUR   = 5000;    // 넘어짐 복귀 시간 (ms)
const AI_THINK   = 1200;    // AI 스킬 판단 주기 (ms)

// ── 스킬 정의 ────────────────────────────────────────────────────────────────
const SKILLS = {
  boost:     { name: '부스트',       mp: 20, emoji: '⚡', type: 'move',   desc: '3초 속도 ×2' },
  apple:     { name: '사과 던지기',  mp: 10, emoji: '🍎', type: 'attack', desc: '전방 속도 -30% 3초' },
  rock:      { name: '돌멩이',       mp: 15, emoji: '🪨', type: 'attack', desc: '명중 시 0.5초 기절' },
  web:       { name: '거미줄',       mp: 20, emoji: '🕸️', type: 'attack', desc: '3초 최고속 -40%' },
  banana:    { name: '바나나',       mp: 10, emoji: '🍌', type: 'trap',   desc: '후방 설치 — 2초 넘어짐' },
  oil:       { name: '기름통',       mp: 15, emoji: '🛢️', type: 'trap',   desc: '후방 설치 — 3초 흔들림' },
  poop:      { name: '몬스터 똥',    mp: 10, emoji: '💩', type: 'trap',   desc: '후방 설치 — 2초 감속' },
  jump_skill:{ name: '점프',         mp: 10, emoji: '🦘', type: 'move',   desc: '함정 무시 2초' },
  lightning: { name: '번개질주',     mp: 30, emoji: '⚡', type: 'move',   desc: '2초 무적+속도 UP' },
};

// ── AI 레이서 정의 ────────────────────────────────────────────────────────────
const AI_DEFS = [
  { id:'orc3',    name:'Orc3',    color:'#4a7c2f', imgKey:'orc3',    speedMod:1.0,  skills:['apple','banana','boost'] },
  { id:'pirate3', name:'Pirate3', color:'#7c3a1a', imgKey:'pirate3', speedMod:0.98, skills:['rock','oil','boost'] },
  { id:'zombie1', name:'Zombie1', color:'#5a7a3a', imgKey:'zombie1', speedMod:0.93, skills:['banana','poop','jump_skill'] },
  { id:'zombie2', name:'Zombie2', color:'#4a6a2a', imgKey:'zombie3', speedMod:0.91, skills:['poop','web','banana'] },
  { id:'dragon',  name:'Dragon',  color:'#8b0000', imgKey:'dragon',  speedMod:1.05, skills:['web','lightning','apple'] },
  { id:'random',  name:'슬라임',  color:'#3a6e3a', imgKey:'slime',   speedMod:0.96, skills:['rock','oil','boost'] },
];

// ── 게임 상태 ─────────────────────────────────────────────────────────────────
let _phase = 'loading';  // loading | lobby | skill-select | countdown | race | finish
let _uid   = null;
let _playerGP = 0, _playerHP = 1000, _playerMaxHP = 1000, _playerMP = 1000, _playerMaxMP = 1000;
let _selectedSkills = [];
let _countdownVal = 3;
let _track  = null;
let _racers = [];     // AI 레이서 배열
let _player = null;  // 플레이어 오브젝트
let _items  = [];    // 랜덤 아이템박스
let _effects= [];    // 진행중 이펙트
let _traps  = [];    // 전체 트랩 목록
let _log    = [];    // 레이스 로그
let _sprites= {};
let _raf    = null;
let _lastTime = 0;
let _aiTimers = {};

// ── 입력 ─────────────────────────────────────────────────────────────────────
const _keys = { left: false, right: false, brake: false };

// ── DOM 캐시 ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── 스프라이트 로딩 ───────────────────────────────────────────────────────────
function loadImg(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function loadSprites() {
  const frames = (base, prefix, ext, n) =>
    Array.from({length: n}, (_, i) => loadImg(`${base}${prefix}${String(i).padStart(3,'0')}${ext}`));

  const [orc3, pirate3, zombie1, zombie3, dragonImg, heroImg, boxImg] = await Promise.all([
    loadImg('/assets/images/monsters/orc3/ORK_03_WALK_001.png'),
    loadImg('/assets/images/monsters/pirate3/3_3-PIRATE_WALK_001.png'),
    loadImg('/assets/images/monsters/zombie1/animation/Run3.png'),
    loadImg('/assets/images/monsters/Zombie3/animation/Run3.png'),
    loadImg('/assets/images/monsters/dragon/fly002.png'),
    loadImg('/assets/images/hero/1.png'),
    loadImg('/assets/images/item/box.png'),
  ]);

  _sprites = {
    orc3, pirate3, zombie1, zombie3, dragon: dragonImg,
    slime: zombie1,   // 슬라임은 zombie 대체
    player: heroImg,
    box: boxImg,
  };
}

// ── Firebase / DB ─────────────────────────────────────────────────────────────
async function loadPlayerData() {
  if (!_uid) return;
  try {
    const bp = await getDoc(doc(db, 'battle_players', _uid));
    if (bp.exists()) {
      const d = bp.data();
      _playerHP    = d.hp    || 1000;
      _playerMaxHP = _playerHP;
      _playerMP    = d.mp    || 1000;
      _playerMaxMP = _playerMP;
      _playerGP    = d.gold  || 0;
    }
  } catch (_) {}
  updateLobbyUI();
}

async function deductEntryFee() {
  if (_playerGP < ENTRY_FEE) return false;
  try {
    await updateDoc(doc(db, 'battle_players', _uid), { gold: increment(-ENTRY_FEE) });
    _playerGP -= ENTRY_FEE;
    return true;
  } catch { return false; }
}

async function awardPrize(rank) {
  const gp = PRIZES[Math.min(rank, PRIZES.length - 1)] || 10;
  if (!_uid) return gp;
  try {
    await updateDoc(doc(db, 'battle_players', _uid), { gold: increment(gp) });
  } catch {}
  return gp;
}

// ── 레이서 오브젝트 생성 ───────────────────────────────────────────────────────
function makeRacer(def, isPlayer) {
  return {
    id:      def.id,
    name:    def.name,
    color:   def.color,
    imgKey:  def.imgKey,
    pos:     0,          // 트랙 위치 (세그먼트 단위)
    lane:    (Math.random() - 0.5) * 1.6,
    speed:   0,
    maxSpeed: MAX_SPEED * (def.speedMod || 1.0),
    hp:      isPlayer ? _playerHP : 800 + Math.random() * 400,
    maxHp:   isPlayer ? _playerMaxHP : 1000,
    mp:      isPlayer ? _playerMP  : 600 + Math.random() * 400,
    maxMp:   isPlayer ? _playerMaxMP : 800,
    lap:     0,
    finished:false,
    rank:    0,
    fallUntil: 0,
    isPlayer,
    wobble:  0,
    effects: {},    // { slow, stun, wobble, boost, invincible } end timestamps
    skills:  def.skills || [],
    traps:   [],
    skillCooldowns: {},
  };
}

// ── 게임 초기화 ───────────────────────────────────────────────────────────────
function initRace() {
  _track = buildTrack();
  _items = spawnItems();
  _effects = [];
  _traps = [];
  _log = [];

  _player = makeRacer({ id:'player', name:'Player', color:'#3b82f6', imgKey:'player', speedMod:1.0 }, true);
  _player.skills = _selectedSkills;

  _racers = AI_DEFS.map(def => makeRacer(def, false));

  // 출발 위치 분산
  const all = [_player, ..._racers];
  all.forEach((r, i) => {
    r.pos = -i * 0.3;  // 약간 뒤에서 시작
    r.lane = (i % 3 - 1) * 0.7 + (Math.random() - 0.5) * 0.3;
  });

  _aiTimers = {};
  updateHUD();
}

function spawnItems() {
  const items = [];
  for (let i = 0; i < TOTAL_LAPS * 8; i++) {
    items.push({
      id: i,
      trackPos: 20 + Math.random() * (SEGS - 20),
      lane: (Math.random() - 0.5) * 1.4,
      active: true,
      gp: [10, 20, 50][Math.floor(Math.random() * 3)],
    });
  }
  return items;
}

// ── 스킬 실행 ─────────────────────────────────────────────────────────────────
function useSkill(racer, skillId) {
  const skill = SKILLS[skillId];
  if (!skill || racer.mp < skill.mp) return;
  if ((racer.skillCooldowns[skillId] || 0) > Date.now()) return;
  racer.mp -= skill.mp;
  racer.skillCooldowns[skillId] = Date.now() + 3000;

  const now = Date.now();
  addLog(`${racer.name} ${skill.emoji} ${skill.name}`);

  switch (skill.type) {
    case 'move':
      if (skillId === 'boost' || skillId === 'lightning') {
        racer.effects.boost = now + 3000;
        if (skillId === 'lightning') racer.effects.invincible = now + 2000;
      } else if (skillId === 'jump_skill') {
        racer.effects.jumping = now + 2000;
      }
      break;

    case 'attack': {
      const ahead = findNearest(racer, true);
      if (!ahead) break;
      if (racer.effects.invincible > now) break;
      if (skillId === 'apple') { ahead.effects.slow = now + 3000; addLog(`${ahead.name} 속도 감소!`); }
      if (skillId === 'rock')  { ahead.effects.stun = now + 500;  addLog(`${ahead.name} 기절!`); }
      if (skillId === 'web')   { ahead.effects.slowMax = now + 3000; addLog(`${ahead.name} 거미줄!`); }
      if (skillId === 'poop') {
        const behind = findNearest(racer, false);
        if (behind) { behind.effects.slowMax = now + 2000; addLog(`${behind.name} 감속!`); }
      }
      break;
    }

    case 'trap': {
      const emoji = { banana: '🍌', oil: '🛢️', poop: '💩', ice: '🧊' }[skillId] || '🪤';
      _traps.push({ ownerId: racer.id, pos: racer.pos - 1, lane: racer.lane, skillId, emoji, active: true });
      racer.traps.push(_traps[_traps.length - 1]);
      break;
    }
  }
  if (racer.isPlayer) updateHUD();
}

function findNearest(racer, ahead) {
  const all = [_player, ..._racers].filter(r => r.id !== racer.id && !r.finished);
  return all
    .filter(r => ahead ? r.pos > racer.pos : r.pos < racer.pos)
    .sort((a, b) => ahead ? a.pos - b.pos : b.pos - a.pos)[0] || null;
}

// ── 물리 업데이트 ──────────────────────────────────────────────────────────────
function updateRacer(racer, dt, isPlayer) {
  const now = Date.now();
  if (racer.finished) return;

  // 넘어짐 상태
  if (racer.fallUntil > now) { racer.speed *= 0.9; return; }

  // 스턴
  if ((racer.effects.stun || 0) > now) { racer.speed *= 0.95; return; }

  const boosted     = (racer.effects.boost || 0) > now;
  const slowed      = (racer.effects.slow  || 0) > now;
  const slowMax     = (racer.effects.slowMax || 0) > now;

  const topSpeed = racer.maxSpeed
    * (boosted  ? 2.0 : 1.0)
    * (slowed   ? 0.7 : 1.0)
    * (slowMax  ? 0.6 : 1.0)
    * (racer.wobble > 0 ? 0.8 : 1.0);

  if (isPlayer) {
    // 자동 가속 (항상)
    if (racer.speed < topSpeed) racer.speed = Math.min(racer.speed + ACCEL, topSpeed);

    // 조향
    if (_keys.left)  racer.lane = Math.max(-1.8, racer.lane - STEER_SPD);
    if (_keys.right) racer.lane = Math.min(1.8,  racer.lane + STEER_SPD);

    // 코스 이탈 감속
    if (Math.abs(racer.lane) > 1.5) racer.speed *= 0.97;
  } else {
    // AI 가속
    if (racer.speed < topSpeed) racer.speed = Math.min(racer.speed + ACCEL * 0.9, topSpeed);
    // AI 조향 (트랙 중앙 유지 + 약간의 흔들림)
    racer.lane += (Math.random() - 0.5) * 0.01;
    racer.lane *= 0.98;
    racer.lane = Math.max(-1.5, Math.min(1.5, racer.lane));
  }

  // 흔들림 처리
  if (racer.wobble > 0) {
    racer.lane += Math.sin(now * 0.01) * 0.08;
    racer.wobble -= dt;
  }

  racer.pos += racer.speed;

  // 랩 체크
  const seg = Math.floor(racer.pos);
  if (seg >= SEGS * (racer.lap + 1)) {
    racer.lap++;
    if (racer.lap >= TOTAL_LAPS && !racer.finished) {
      finishRacer(racer);
    }
  }
}

function checkTrapHit(racer) {
  const now = Date.now();
  for (const trap of _traps) {
    if (!trap.active || trap.ownerId === racer.id) continue;
    if (Math.abs(trap.pos - racer.pos) > 1.5) continue;
    if (Math.abs(trap.lane - racer.lane) > 0.6) continue;
    if ((racer.effects.jumping || 0) > now) continue;  // 점프로 회피
    if ((racer.effects.invincible || 0) > now) continue;

    trap.active = false;
    addLog(`${racer.name} 함정에 걸림!`);

    switch (trap.skillId) {
      case 'banana':
        racer.fallUntil = now + 2000;
        racer.speed = 0;
        addLog(`${racer.name} 넘어짐!`);
        break;
      case 'oil':
        racer.wobble = 3000;
        break;
      case 'poop':
        racer.effects.slow = now + 2000;
        break;
    }
    if (racer.isPlayer) updateHUD();
  }
}

function checkItemPickup(racer) {
  for (const item of _items) {
    if (!item.active) continue;
    if (Math.abs(item.trackPos - racer.pos) > 1.5) continue;
    if (Math.abs(item.lane - racer.lane) > 0.8) continue;
    item.active = false;
    if (racer.isPlayer) {
      _playerGP += item.gp;
      addLog(`💰 GP +${item.gp} 획득!`);
      updateHUD();
    } else {
      racer.hp = Math.min(racer.maxHp, racer.hp + 50);
    }
  }
}

// ── AI 스킬 사용 ─────────────────────────────────────────────────────────────
function aiThink(racer) {
  const now = Date.now();
  const lastThink = _aiTimers[racer.id] || 0;
  if (now - lastThink < AI_THINK) return;
  _aiTimers[racer.id] = now;

  if (Math.random() < 0.4 && racer.skills.length) {
    const skill = racer.skills[Math.floor(Math.random() * racer.skills.length)];
    useSkill(racer, skill);
  }
}

// ── 레이스 완주 ──────────────────────────────────────────────────────────────
let _finishOrder = [];
function finishRacer(racer) {
  racer.finished = true;
  racer.rank = _finishOrder.length + 1;
  _finishOrder.push(racer);
  addLog(`🏁 ${racer.name} ${racer.rank}위 완주!`);
  if (_finishOrder.length >= 7) endRace();
  if (racer.isPlayer) endRace();
}

async function endRace() {
  if (_phase === 'finish') return;
  _phase = 'finish';
  cancelAnimationFrame(_raf);

  const playerRank = _player.rank || _finishOrder.findIndex(r => r.isPlayer) + 1 || 7;
  const gp = await awardPrize(playerRank - 1);

  $('finishRank').textContent = `${playerRank}위 완주!`;
  $('finishGP').textContent   = `+${gp} GP 획득`;
  $('finishScreen').classList.remove('hidden');
}

// ── 메인 게임 루프 ─────────────────────────────────────────────────────────────
function gameLoop(ts) {
  if (_phase !== 'race') return;
  _raf = requestAnimationFrame(gameLoop);
  const dt = Math.min(50, ts - _lastTime);
  _lastTime = ts;

  const all = [_player, ..._racers];

  // 물리 업데이트
  updateRacer(_player, dt, true);
  for (const r of _racers) {
    updateRacer(r, dt, false);
    aiThink(r);
  }

  // 충돌 체크
  for (const r of all) {
    checkTrapHit(r);
    checkItemPickup(r);
  }

  // 순위 계산 (미완주자)
  const active = all.filter(r => !r.finished);
  active.sort((a, b) => b.pos - a.pos);
  active.forEach((r, i) => r.currentRank = i + 1);

  // 렌더
  renderScene(
    _track,
    _racers.filter(r => !r.finished),
    _player.pos,
    { ..._sprites, ...Object.fromEntries(_racers.map(r => [r.id, _sprites[r.imgKey]])) },
    _items.filter(i => i.active)
  );

  updateHUD();
}

// ── HUD 업데이트 ─────────────────────────────────────────────────────────────
function updateHUD() {
  if ($('hpBar')) $('hpBar').style.width = (_player.hp / _player.maxHp * 100) + '%';
  if ($('mpBar')) $('mpBar').style.width = (_player.mp / _player.maxMp * 100) + '%';
  if ($('hpVal')) $('hpVal').textContent = Math.ceil(_player.hp);
  if ($('mpVal')) $('mpVal').textContent = Math.ceil(_player.mp);

  const rank = _player.currentRank || '?';
  const total = 7 - _finishOrder.filter(r => !r.isPlayer).length;
  if ($('rankDisplay'))  $('rankDisplay').textContent  = `${rank}위`;
  if ($('lapDisplay'))   $('lapDisplay').textContent   = `${_player.lap + 1} / ${TOTAL_LAPS} 랩`;
  if ($('gpDisplay'))    $('gpDisplay').textContent    = `GP: ${_playerGP}`;

  // 스킬 쿨다운 표시
  _selectedSkills.forEach((sk, i) => {
    const btn = $(`skillBtn${i}`);
    if (!btn) return;
    const cd = (_player.skillCooldowns[sk] || 0) - Date.now();
    btn.classList.toggle('on-cd', cd > 0);
    btn.querySelector('.cd')?.remove();
    if (cd > 0) {
      const s = document.createElement('span');
      s.className = 'cd';
      s.textContent = Math.ceil(cd / 1000) + 's';
      btn.appendChild(s);
    }
  });
}

function addLog(msg) {
  _log.unshift(msg);
  if (_log.length > 6) _log.pop();
  const el = $('raceLog');
  if (el) el.innerHTML = _log.map(l => `<div>${l}</div>`).join('');
}

function updateLobbyUI() {
  if ($('lobbyGP'))  $('lobbyGP').textContent  = _playerGP;
  if ($('lobbyHP'))  $('lobbyHP').textContent  = _playerHP;
  if ($('lobbyMP'))  $('lobbyMP').textContent  = _playerMP;
  if ($('btnEnter')) $('btnEnter').disabled = _playerGP < ENTRY_FEE;
}

// ── 페이즈 전환 ──────────────────────────────────────────────────────────────
function showPhase(name) {
  ['loadingScreen','lobbyScreen','skillScreen','countdownScreen','gameScreen','finishScreen']
    .forEach(id => $('id' in ($(id)||{}) ? id : id)?.classList.add('hidden'));
  $(`${name}Screen`)?.classList.remove('hidden');
  _phase = name === 'game' ? 'race' : name;
}

async function goLobby() {
  showPhase('lobby');
  await loadPlayerData();
}

async function goSkillSelect() {
  if (!_uid) { alert('로그인 필요'); return; }
  const ok = await deductEntryFee();
  if (!ok) { alert('GP가 부족합니다 (100 GP 필요)'); return; }
  _selectedSkills = [];
  renderSkillList();
  showPhase('skill');
}

function renderSkillList() {
  const grid = $('skillGrid');
  if (!grid) return;
  grid.innerHTML = '';
  Object.entries(SKILLS).forEach(([id, sk]) => {
    const btn = document.createElement('button');
    btn.className = 'skill-pick-btn';
    btn.dataset.id = id;
    btn.innerHTML = `<span>${sk.emoji}</span><div>${sk.name}</div><div class="mp-cost">MP ${sk.mp}</div>`;
    btn.addEventListener('click', () => toggleSkillPick(id, btn));
    grid.appendChild(btn);
  });
}

function toggleSkillPick(id, btn) {
  if (_selectedSkills.includes(id)) {
    _selectedSkills = _selectedSkills.filter(s => s !== id);
    btn.classList.remove('selected');
  } else if (_selectedSkills.length < 3) {
    _selectedSkills.push(id);
    btn.classList.add('selected');
  }
  $('skillConfirmBtn').disabled = _selectedSkills.length < 1;
  $('skillCount').textContent = `${_selectedSkills.length} / 3 선택`;
}

function startCountdown() {
  if (_selectedSkills.length < 1) _selectedSkills = ['boost'];
  showPhase('countdown');
  _countdownVal = 3;
  $('cdNum').textContent = _countdownVal;
  initRace();
  const cd = setInterval(() => {
    _countdownVal--;
    if (_countdownVal > 0) {
      $('cdNum').textContent = _countdownVal;
    } else {
      clearInterval(cd);
      $('cdNum').textContent = 'GO!';
      setTimeout(startRace, 500);
    }
  }, 1000);
}

function startRace() {
  showPhase('game');
  _finishOrder = [];
  renderSkillButtons();
  _lastTime = performance.now();
  _raf = requestAnimationFrame(gameLoop);
}

function renderSkillButtons() {
  const bar = $('skillBar');
  if (!bar) return;
  bar.innerHTML = '';
  _selectedSkills.forEach((sk, i) => {
    const skill = SKILLS[sk];
    if (!skill) return;
    const btn = document.createElement('button');
    btn.id = `skillBtn${i}`;
    btn.className = 'skill-btn-race';
    btn.innerHTML = `${skill.emoji}<small>${skill.name}</small>`;
    btn.addEventListener('click', () => useSkill(_player, sk));
    bar.appendChild(btn);
  });
}

// ── 입력 이벤트 ──────────────────────────────────────────────────────────────
function initInput() {
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  _keys.left  = true;
    if (e.key === 'ArrowRight') _keys.right = true;
  });
  document.addEventListener('keyup', e => {
    if (e.key === 'ArrowLeft')  _keys.left  = false;
    if (e.key === 'ArrowRight') _keys.right = false;
  });

  // 터치 버튼
  const bindTouch = (id, key) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('touchstart', e => { e.preventDefault(); _keys[key] = true;  }, { passive: false });
    el.addEventListener('touchend',   e => { e.preventDefault(); _keys[key] = false; }, { passive: false });
    el.addEventListener('mousedown',  () => _keys[key] = true);
    el.addEventListener('mouseup',    () => _keys[key] = false);
  };
  bindTouch('btnLeft',  'left');
  bindTouch('btnRight', 'right');
}

// ── 시작점 ────────────────────────────────────────────────────────────────────
export async function init() {
  const canvas = $('raceCanvas');
  if (!canvas) return;
  canvas.width  = 400;
  canvas.height = 250;
  initRenderer(canvas);
  initInput();

  $('btnEnter')?.addEventListener('click', goSkillSelect);
  $('skillConfirmBtn')?.addEventListener('click', startCountdown);
  $('btnRestart')?.addEventListener('click', () => location.reload());

  onAuthStateChanged(auth, async user => {
    _uid = user?.uid || null;
    await loadSprites();
    await loadPlayerData();
    showPhase('lobby');
  });
}

init();
