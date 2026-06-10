// relay.js — 이어달리기 메인 컨트롤러
import { db, auth, functions } from '/assets/js/firebase-init.js';
import { doc, getDoc, updateDoc, increment } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { isTelegramMiniApp, loginWithTelegram } from '/assets/js/telegram-auth.js';
import { CW, CH, renderRace, renderNextUp, renderLeaderCrown, renderBatonPass, renderCountdown, launchFireworks, launchBatonSpark, preloadAll } from './relay.render.js';
import { LEGS, LEG_DIST, NUM_TEAMS, SKILL_DEFS, teamGrade, buildTeam, tickRace, playerTap, useSkill, calcPayout, GRADE_ODDS } from './relay.race.js';
import { sfx, tickFootstep } from './relay.sound.js';

// ── 캐릭터 정의 ───────────────────────────────────────────────────────────────
const CHARS = {
  orc1:    { name:'Orc I',      grade:'B', type:'aggressive', color:'#5a8a3a', speed:72, accel:70, stamina:68, luck:45, aggr:80, frameCount:6 },
  orc2:    { name:'Orc II',     grade:'A', type:'aggressive', color:'#3a6a2a', speed:82, accel:78, stamina:75, luck:50, aggr:85, frameCount:6 },
  orc3:    { name:'Orc III',    grade:'S', type:'aggressive', color:'#2a5a1a', speed:92, accel:88, stamina:82, luck:55, aggr:90, frameCount:6 },
  zombie1: { name:'Zombie I',   grade:'C', type:'balanced',   color:'#8aaa4a', speed:62, accel:58, stamina:72, luck:55, aggr:50, frameCount:10 },
  zombie3: { name:'Zombie III', grade:'B', type:'balanced',   color:'#6a8a3a', speed:74, accel:68, stamina:78, luck:58, aggr:55, frameCount:10 },
  pirate1: { name:'Pirate I',   grade:'C', type:'aggressive', color:'#8a5a2a', speed:64, accel:72, stamina:60, luck:65, aggr:75, frameCount:6 },
  pirate2: { name:'Pirate II',  grade:'A', type:'aggressive', color:'#6a3a1a', speed:84, accel:82, stamina:68, luck:68, aggr:82, frameCount:6 },
  pirate3: { name:'Pirate III', grade:'S', type:'aggressive', color:'#4a2a0a', speed:90, accel:92, stamina:72, luck:72, aggr:88, frameCount:6 },
  troll:   { name:'Troll',      grade:'D', type:'defensive',  color:'#7a6a5a', speed:55, accel:45, stamina:95, luck:35, aggr:60, frameCount:10 },
  villager1:{ name:'Villager I', grade:'D',type:'defensive',  color:'#9a8a7a', speed:52, accel:50, stamina:90, luck:40, aggr:30, frameCount:12 },
  villager2:{ name:'Villager II',grade:'D',type:'defensive',  color:'#8a7a6a', speed:56, accel:52, stamina:92, luck:42, aggr:32, frameCount:12 },
  villager3:{ name:'Villager III',grade:'C',type:'defensive', color:'#7a6a5a', speed:65, accel:60, stamina:88, luck:48, aggr:38, frameCount:12 },
  knight1: { name:'Knight I',   grade:'B', type:'balanced',   color:'#7a8aaa', speed:74, accel:72, stamina:76, luck:60, aggr:62, frameCount:10 },
  knight2: { name:'Knight II',  grade:'A', type:'balanced',   color:'#5a6a8a', speed:85, accel:80, stamina:80, luck:65, aggr:68, frameCount:10 },
  knight3: { name:'Knight III', grade:'S', type:'balanced',   color:'#3a4a6a', speed:94, accel:90, stamina:85, luck:70, aggr:72, frameCount:10 },
};

const CHAR_IDS = Object.keys(CHARS);
const AI_POOLS = [
  ['orc1','orc2','pirate1','zombie1'], ['knight1','knight2','zombie3','orc3'],
  ['pirate2','pirate3','troll','villager3'],['knight3','orc2','zombie1','pirate1'],
  ['troll','villager1','villager2','zombie3'],
];
const TEAM_LABELS = ['Team A','Team B','Team C','Team D','Team E','Team F'];
const TEAM_COLORS = ['#e74c3c','#e67e22','#f1c40f','#27ae60','#2980b9','#8e44ad'];

// ── 참가비 ────────────────────────────────────────────────────────────────────
const GAME_KEY  = 'relayEntry';
const BASE_FEE  = 100;
const FEE_STEP  = 50;
const RESET_MS  = 24 * 60 * 60 * 1000;

let _uid = null, _playerGP = 0;
let _entryFee = BASE_FEE, _entryCount = 0, _entryResetAt = 0;
let _freeMode = false;

// ── 게임 상태 ─────────────────────────────────────────────────────────────────
let _phase = 'loading';   // loading | lobby | skill | countdown | race | result
let _cdNum = 3;           // 카운트다운 숫자
let _selectedChars = [];  // 플레이어가 선택한 4명
let _selectedSkills = []; // 선택한 스킬 3개
let _teams = [];
let _playerTeamIdx = 0;
let _raf = null, _lastTs = 0;
let _resultData = null;
let _speed = 1;

const $ = id => document.getElementById(id);
const SCREENS = ['loadingScreen','lobbyScreen','skillScreen','raceScreen','resultScreen'];

function showPhase(name) {
  SCREENS.forEach(s => $(`${s}`)?.classList.add('hidden'));
  $(`${name}`)?.classList.remove('hidden');
  _phase = name.replace('Screen','');
}

// ── Firebase ─────────────────────────────────────────────────────────────────
async function loadPlayer() {
  if (!_uid) {
    $('lobbyGP').textContent = 'Guest';
    _updateFeeDisplay();
    return;
  }
  try {
    const d = (await getDoc(doc(db,'battle_players',_uid))).data()||{};
    _playerGP = d.gold || 0;
    const entry = d[GAME_KEY] || {};
    const now = Date.now();
    const rMs = entry.resetAt?.toMillis?.() ?? (typeof entry.resetAt==='number'?entry.resetAt:0);
    if (!rMs || now - rMs > RESET_MS) { _entryCount=0; _entryResetAt=0; }
    else { _entryCount=entry.count||0; _entryResetAt=rMs; }
    _entryFee = BASE_FEE + _entryCount * FEE_STEP;
  } catch {}
  $('lobbyGP').textContent = _playerGP.toLocaleString();
  $('btnEnter').disabled = _playerGP < _entryFee;
  _updateFeeDisplay();
}

function _updateFeeDisplay() {
  const badge = $('feeBadge');
  if (badge) badge.textContent = `Entry fee: ${_entryFee} GP`;
  const info = $('feeInfo');
  if (!info) return;
  if (!_entryCount) info.textContent = 'First entry today · resets in 24h';
  else {
    const h = Math.ceil((_entryResetAt + RESET_MS - Date.now()) / 3_600_000);
    info.textContent = `${_entryCount} entries today · 100GP reset in ${h}h`;
  }
}

async function deductFee() {
  if (!_uid) return false;
  try {
    const res = await httpsCallable(functions,'payGameEntry')({ gameKey: GAME_KEY });
    const { fee, newCount } = res.data;
    _playerGP  -= fee;
    _entryCount = newCount;
    _entryFee   = BASE_FEE + newCount * FEE_STEP;
    return true;
  } catch { return false; }
}

async function awardGP(amount) {
  if (_freeMode || amount <= 0 || !_uid) return;
  try {
    await updateDoc(doc(db, 'battle_players', _uid), { gold: increment(amount) });
  } catch {}
  // GP 생중계
  if (amount >= 50) httpsCallable(functions, 'broadcastGpEvent')({ game: 'relay', amount }).catch(() => {});
}

// ── 로비: 캐릭터 선택 ────────────────────────────────────────────────────────
const GRADE_LIMIT = { S: 1, A: 1, B: 1 }; // 등급별 최대 선택 수

function _gradeCount(grade) {
  return _selectedChars.filter(id => CHARS[id].grade === grade).length;
}

function _isGradeLocked(id) {
  const grade = CHARS[id].grade;
  if (!GRADE_LIMIT[grade]) return false;
  if (_selectedChars.includes(id)) return false;
  return _gradeCount(grade) >= GRADE_LIMIT[grade];
}

function renderCharGrid() {
  const grid = $('charGrid');
  if (!grid) return;
  grid.innerHTML = '';
  CHAR_IDS.forEach(id => {
    const c = CHARS[id];
    const sel = _selectedChars.includes(id);
    const locked = _isGradeLocked(id);
    const gradeColor = {S:'#ffd700',A:'#c0c0c0',B:'#cd7f32',C:'#8aaa4a',D:'#aaa'}[c.grade]||'#fff';
    const card = document.createElement('button');
    card.className = `char-card${sel?' selected':''}${locked?' grade-locked':''}`;
    card.dataset.id = id;
    card.disabled = locked && !sel;
    card.innerHTML = `
      <div class="char-grade" style="color:${gradeColor}">${c.grade}</div>
      <div class="char-name">${c.name}</div>
      <div class="char-spd">⚡${c.speed}</div>
      ${locked ? '<div class="grade-lock-msg">Limit 1</div>' : ''}`;
    card.addEventListener('click', () => toggleChar(id));
    grid.appendChild(card);
  });
  _renderTeamSlots();
}

function toggleChar(id) {
  if (_selectedChars.includes(id)) {
    _selectedChars = _selectedChars.filter(x => x !== id);
  } else if (_selectedChars.length < 4) {
    if (_isGradeLocked(id)) return;
    _selectedChars.push(id);
  }
  renderCharGrid();
  $('btnConfirmTeam').disabled = _selectedChars.length < 4;
}

function _renderTeamSlots() {
  const slots = $('teamSlots');
  if (!slots) return;
  slots.innerHTML = Array.from({length:4}, (_,i) => {
    const id = _selectedChars[i];
    const c  = id ? CHARS[id] : null;
    return `<div class="team-slot${c?' filled':''}">
      ${c ? `<b>${c.grade}</b> ${c.name.slice(0,8)}` : `Runner ${i+1}`}
    </div>`;
  }).join('');

  // 예상 배당 표시
  if (_selectedChars.length === 4) {
    const g = teamGrade(_selectedChars, CHARS);
    const odds = GRADE_ODDS[g] || 2;
    const oddsEl = $('teamOdds');
    if (oddsEl) oddsEl.textContent = `Team grade ${g} · 1st place payout ×${odds}`;
  }
}

// ── 스킬 선택 화면 ────────────────────────────────────────────────────────────
function renderSkillPicker() {
  const grid = $('skillGrid');
  if (!grid) return;
  grid.innerHTML = '';
  Object.entries(SKILL_DEFS).forEach(([id, sk]) => {
    const sel = _selectedSkills.includes(id);
    const btn = document.createElement('button');
    btn.className = `skill-pick-btn${sel?' selected':''}`;
    btn.innerHTML = `<span class="sk-emoji">${sk.emoji}</span><div class="sk-name">${sk.name}</div><div class="sk-desc">${sk.desc}</div>`;
    btn.addEventListener('click', () => {
      if (_selectedSkills.includes(id)) { _selectedSkills = _selectedSkills.filter(x=>x!==id); }
      else if (_selectedSkills.length < 3) _selectedSkills.push(id);
      renderSkillPicker();
      $('btnStartRace').disabled = _selectedSkills.length < 1;
    });
    grid.appendChild(btn);
  });
  $('skCount').textContent = `${_selectedSkills.length}/3 selected`;
}

// ── 팀 빌드 & 경기 시작 ──────────────────────────────────────────────────────
function buildTeams() {
  _teams = [];
  // 플레이어 팀 (A팀 = 0번)
  _playerTeamIdx = 0;
  _teams.push(buildTeam(_selectedChars, CHARS, 'Team A', TEAM_COLORS[0], true));
  // AI 팀
  for (let i = 0; i < NUM_TEAMS - 1; i++) {
    _teams.push(buildTeam(AI_POOLS[i % AI_POOLS.length], CHARS, TEAM_LABELS[i+1], TEAM_COLORS[i+1], false));
  }
  // 스킬 쿨다운 초기화
  _teams[_playerTeamIdx].skillCd = {};
  // 사운드 콜백
  _firstFinishDone = false;
  _teams.forEach((team, ti) => {
    team.onBaton = () => {
      sfx('baton');
      // 바통 전달 위치에 스파크
      const progress = ((team.legIdx + 1) * LEG_DIST) / (LEGS * LEG_DIST) % 1;
      const { x, y } = { x: CW/2, y: CH/2 }; // 정확한 위치는 render에서 계산
      launchBatonSpark(CW/2 + (Math.random()-0.5)*100, CH/2 + (Math.random()-0.5)*60);
    };
    team.onFinish = (rank) => {
      if (rank === 1) sfx('crowd_cheer');
    };
  });
}

// ── 레이스 루프 ───────────────────────────────────────────────────────────────
const canvas = $('raceCanvas') || document.createElement('canvas');
let ctx;

function initCanvas() {
  const c = $('raceCanvas');
  if (!c) return;
  c.width = CW; c.height = CH;
  ctx = c.getContext('2d');
}

function startRace() {
  showPhase('raceScreen');
  initCanvas();
  preloadAll();
  _cdNum = 3;
  _phase = 'countdown';
  _lastTs = performance.now();
  _raf = requestAnimationFrame(countdownLoop);
}

// ── 카운트다운 루프 ──────────────────────────────────────────────────────────
let _cdStart = 0;
function countdownLoop(ts) {
  if (_phase !== 'countdown') return;
  if (!_cdStart) _cdStart = ts;
  const elapsed = ts - _cdStart;

  // 배경 그리기
  if (!ctx) return;
  ctx.clearRect(0, 0, CW, CH);

  // 트랙 배경만 그리기 (러너 없이)
  const { renderRace: rr } = { renderRace };
  renderCountdown(ctx, _cdNum, ts);

  const step = Math.floor(elapsed / 900);
  if (step >= 4) {
    // GO! → 레이스 시작
    sfx('start_gun');
    _cdStart = 0;
    _phase = 'race';
    _speed = 1;
    _lastTs = performance.now();
    _updateSkillBar();
    _raf = requestAnimationFrame(raceLoop);
    return;
  }
  const newNum = 3 - step;
  if (newNum !== _cdNum) {
    _cdNum = newNum;
    if (_cdNum > 0) sfx('entry'); // 카운트 비프
  }
  _raf = requestAnimationFrame(countdownLoop);
}

let _firstFinishDone = false;

function raceLoop(ts) {
  if (_phase !== 'race') return;
  _raf = requestAnimationFrame(raceLoop);
  const raw = Math.min((ts - _lastTs) / 1000, 0.1);
  _lastTs = ts;
  const dt = raw * _speed;
  const now = performance.now();

  tickRace(_teams, dt, now, CHARS);
  renderRace(ctx, _teams, now, dt);
  renderNextUp(ctx, _teams[_playerTeamIdx], now);
  renderLeaderCrown(ctx, _teams);
  renderBatonPass(ctx, _teams, now);

  // 첫 골인 → 축포
  if (!_firstFinishDone && _teams.some(t => t.finishTime !== null)) {
    _firstFinishDone = true;
    sfx('finish_fanfare');
    launchFireworks(CX, CY - 80);
    setTimeout(() => launchFireworks(CX - 80, CY - 40), 300);
    setTimeout(() => launchFireworks(CX + 80, CY - 40), 600);
    setTimeout(() => launchFireworks(CX, CY + 20), 900);
  }
  // 내 팀 주자 발소리
  const pt = _teams[_playerTeamIdx];
  if (pt && !pt.batonPass) tickFootstep(now, pt.runners[pt.legIdx]?.spd || 0);
  _updateRaceHUD(now);

  // 모두 완주
  if (_teams.every(t => t.finishTime !== null)) {
    cancelAnimationFrame(_raf);
    setTimeout(showResult, 600);
  }
}

function _updateRaceHUD(now) {
  const pt  = _teams[_playerTeamIdx];
  const runner = pt.runners[pt.legIdx];
  const pos  = [..._teams].sort((a,b)=>b.totDist-a.totDist).indexOf(pt)+1;
  $('hudPos')  && ($('hudPos').textContent  = `#${pos}`);
  $('hudLeg')  && ($('hudLeg').textContent  = `${Math.min(pt.legIdx+1,LEGS)}/${LEGS} legs`);
  if (runner) {
    $('hudRunner') && ($('hudRunner').textContent = runner.name);
    $('hudSpd')    && ($('hudSpd').textContent    = (runner.spd||0).toFixed(1)+'m/s');
  }
  // 탭 부스트 게이지 시각화
  const tapPct = Math.min(100, Math.round((pt.tapBonus || 0) * 100));
  const tapBar = $('tapBar');
  const tapPctEl = $('tapPct');
  if (tapBar) tapBar.style.width = tapPct + '%';
  if (tapPctEl) tapPctEl.textContent = tapPct + '%';
  // 탭 영역 텍스트 변경
  const tapArea = $('tapArea');
  if (tapArea) {
    if (tapPct >= 90) tapArea.textContent = '🔥 MAX BOOST!';
    else if (tapPct >= 50) tapArea.textContent = `⚡ ${tapPct}% — keep tapping!`;
    else tapArea.textContent = '👆 Tap to boost!';
  }
  // 스킬 쿨 표시
  _updateSkillBar(now);
}

function _updateSkillBar(now) {
  const pt = _teams[_playerTeamIdx];
  _selectedSkills.forEach((id,i) => {
    const btn = $(`skBtn${i}`);
    if (!btn) return;
    const cdEnd = (pt?.skillCd?.[id] || 0);
    const cdLeft = Math.max(0, Math.ceil((cdEnd - (now||0)) / 1000));
    btn.disabled = cdLeft > 0;
    const cdEl = btn.querySelector('.cd');
    if (cdEl) cdEl.textContent = cdLeft > 0 ? `${cdLeft}s` : '';
    btn.style.opacity = cdLeft > 0 ? '.4' : '1';
  });
}

// ── 결과 화면 ─────────────────────────────────────────────────────────────────
async function showResult() {
  _phase = 'result';
  const sorted = [..._teams].sort((a,b)=>(a.finishTime||Infinity)-(b.finishTime||Infinity));
  sorted.forEach((t,i) => { t.rank = i+1; });

  const playerTeam = _teams[_playerTeamIdx];
  const rank = playerTeam.rank || sorted.indexOf(playerTeam)+1;
  const grade = playerTeam.grade;
  const payout = _freeMode ? 0 : calcPayout(grade, _entryFee, rank);

  _resultData = { rank, grade, payout, sorted };

  // GP 지급
  if (payout > 0) {
    await awardGP(payout);
    _playerGP += payout;
    sfx('finish');
  } else {
    sfx('entry');
  }

  // 결과 화면 렌더
  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣'];
  $('resultRank').textContent   = medals[rank-1] + ` #${rank}`;
  $('resultGrade').textContent  = `Team grade: ${grade} · payout ×${GRADE_ODDS[grade]}`;
  $('resultPayout').textContent = _freeMode ? '🆓 Free Play (no reward)' : payout > 0 ? `+${payout} GP earned!` : 'No reward (3rd or lower)';
  $('resultPayout').style.color = payout > 0 ? '#22c55e' : '#9ca3af';

  const rankList = $('resultRankList');
  if (rankList) {
    rankList.innerHTML = sorted.map((t,i)=>
      `<div class="rank-row${t.isPlayer?' mine':''}">
        <span>${medals[i]} ${t.label}</span>
        <span class="rank-grade">[${t.grade}]</span>
       </div>`).join('');
  }

  showPhase('resultScreen');
}

// ── 입력 처리 ─────────────────────────────────────────────────────────────────
function initRaceInput() {
  const tapArea = $('tapArea');
  if (tapArea) {
    tapArea.addEventListener('click',    () => { if(_phase==='race'){ playerTap(_teams[_playerTeamIdx]); sfx('tap'); } });
    tapArea.addEventListener('touchstart', e => { e.preventDefault(); if(_phase==='race'){ playerTap(_teams[_playerTeamIdx]); sfx('tap'); } }, {passive:false});
  }
  // 배속 버튼
  $('btnSpeed1') && $('btnSpeed1').addEventListener('click', () => { _speed=1; _syncSpeedBtns(); });
  $('btnSpeed2') && $('btnSpeed2').addEventListener('click', () => { _speed=2; _syncSpeedBtns(); });
  $('btnSpeed4') && $('btnSpeed4').addEventListener('click', () => { _speed=4; _syncSpeedBtns(); });
}

function _syncSpeedBtns() {
  [1,2,4].forEach(s => {
    const btn = $(`btnSpeed${s}`);
    if (btn) btn.classList.toggle('active', _speed === s);
  });
}

// ── 스킬바 렌더 ───────────────────────────────────────────────────────────────
function buildSkillBar() {
  const bar = $('skillBar');
  if (!bar) return;
  bar.innerHTML = '';
  _selectedSkills.forEach((id, i) => {
    const sk = SKILL_DEFS[id];
    const btn = document.createElement('button');
    btn.id = `skBtn${i}`;
    btn.className = 'sk-btn';
    btn.innerHTML = `${sk.emoji}<small>${sk.name}</small><span class="cd"></span>`;
    btn.addEventListener('click', () => {
      if (_phase !== 'race') return;
      const now = performance.now();
      if (useSkill(id, _teams[_playerTeamIdx], _teams, now)) {
        sfx(`skill_${id}`);
        _updateSkillBar(now);
      }
    });
    bar.appendChild(btn);
  });
}

// ── 헤더 로그인 ───────────────────────────────────────────────────────────────
function _bindLogin() {
  $('gLoginBtn')?.addEventListener('click', async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch {}
  });
}

function _updateHeader(user) {
  const r = $('gHdrRight');
  if (!r) return;
  if (user && !user.isAnonymous) {
    r.innerHTML = `<span class="g-user-chip">👤 ${user.displayName?.split(' ')[0]||'User'}</span>`;
  } else {
    r.innerHTML = `<button class="g-login-btn" id="gLoginBtn">🔑 Google Login</button>`;
    _bindLogin();
  }
}

// ── 초기화 ────────────────────────────────────────────────────────────────────
export async function init() {
  showPhase('loadingScreen');

  // 로비 버튼 바인딩
  $('btnEnter')?.addEventListener('click', async () => {
    if (_selectedChars.length < 4) return;
    if (_uid) { if (!await deductFee()) { alert('Not enough GP'); return; } }
    _freeMode = false;
    buildTeams();
    _selectedSkills = [];
    renderSkillPicker();
    $('btnStartRace').disabled = true;
    showPhase('skillScreen');
  });

  $('btnFreePlay')?.addEventListener('click', () => {
    if (_selectedChars.length < 4) { alert('Please select 4 runners'); return; }
    _freeMode = true;
    buildTeams();
    _selectedSkills = [];
    renderSkillPicker();
    $('btnStartRace').disabled = true;
    showPhase('skillScreen');
  });

  $('btnConfirmTeam')?.addEventListener('click', () => {
    if (_selectedChars.length < 4) return;
    _freeMode = false;
    buildTeams();
    _selectedSkills = [];
    renderSkillPicker();
    showPhase('skillScreen');
  });

  $('btnStartRace')?.addEventListener('click', () => {
    if (_selectedSkills.length < 1) _selectedSkills = ['boost'];
    buildSkillBar();
    startRace();
  });

  $('btnRestart')?.addEventListener('click', () => {
    cancelAnimationFrame(_raf);
    _selectedChars = [];
    _selectedSkills = [];
    renderCharGrid();
    showPhase('lobbyScreen');
    loadPlayer();
  });

  initRaceInput();
  _bindLogin();

  // Telegram Mini App: Firebase 미인증 시 자동 로그인
  if(isTelegramMiniApp() && !auth.currentUser) loginWithTelegram().catch(()=>{});

  onAuthStateChanged(auth, async user => {
    _uid = user?.uid || null;
    await loadPlayer();
    _updateHeader(user);
    if (_phase === 'loading') {
      renderCharGrid();
      showPhase('lobbyScreen');
    }
  });
}

init();
