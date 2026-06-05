// conquest.js — Monster Frontier 메인 (수성전: 성 외부 공격, 도로 이동)
import { db, auth, functions } from '/assets/js/firebase-init.js';
import { doc, getDoc, updateDoc, increment } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { isTelegramMiniApp, loginWithTelegram } from '/assets/js/telegram-auth.js';
import {
  initCamera, resizeCamera, screenToWorld, panBy, zoomBy, moveCamTo,
  makeFogGrid, revealFog, generatePOIs, addRevealAnim, updateRevealAnims,
  CASTLE_WX, CASTLE_WY, POI_DEFS,
} from './conquest.world.js';
import { initRenderer, loadMapAssets, renderScene, isMapObstacle } from './conquest.render.js';
import { UNIT_DEFS, loadSprites, makeUnit, updateUnit, MINES, CASTLE_WALL } from './conquest.units.js';
import { getSpawnPos, getDragonSpawnPos, snapToRoad } from './conquest.path.js';
import { resumeAudio, playSound } from './conquest.audio.js';

// ── 상수 ─────────────────────────────────────────────────────────────────
const GAME_KEY   = 'conquestEntry';
const BASE_FEE   = 100;
const FEE_STEP   = 50;
let   _entryFee  = BASE_FEE;   // 현재 회차 참가비 (서버 응답으로 갱신)
const ENTRY_FEE  = BASE_FEE;   // 하위 호환
const START_GP   = 3000;
const MINE_RATE  = 3000;
const PREP_TIME  = 15000;
const MAX_HP     = 10000;
const WALL_HP    = 3000;
const WALL_REPAIR_COST = 150;
const WALL_REPAIR_AMT  = 800;
const WALL_NAMES = {north:'북벽',south:'남벽',east:'동벽',west:'서벽'};
const HERO_SKILL_CD   = 30000;
const HERO_SKILL_RANGE = 400;

// ── 스킬 정의 ─────────────────────────────────────────────────────────────
// range: 세계 좌표 기준 성 중심으로부터의 반경 (0 = 전체 맵)
// dmg: 피해량, freeze: 빙결 ms, knockback: 밀쳐내기 세계단위
const SKILL_DEFS = {
  fire:   {emoji:'🔥',name:'화염',   cost:200, cd:20000, range:1200, dmg:250, color:'#f97316'},
  ice:    {emoji:'❄️',name:'얼음',   cost:250, cd:30000, range:0,    dmg:80,  freeze:3000, color:'#93c5fd'},
  wind:   {emoji:'🌪️',name:'회오리', cost:200, cd:25000, range:1400, dmg:150, knockback:600, color:'#6ee7b7'},
  meteor: {emoji:'☄️',name:'유성',   cost:350, cd:45000, range:0,    dmg:480, color:'#ea580c'},
};

// ── 웨이브 정의 (10웨이브 + 난이도 가파르게 상승) ──────────────────────────
const WAVES = [
  [{type:'orc',    count:25, side:'rand'}],
  [{type:'orc',    count:30, side:'rand'},{type:'orc2',   count:15, side:'rand'}],
  [{type:'orc2',   count:35, side:'all'}],
  [{type:'orc',    count:25, side:'rand'},{type:'zombie',  count:25, side:'rand'}],
  [{type:'orc2',   count:35, side:'all'}, {type:'zombie',  count:20, side:'rand'},{type:'dragon',count:3, side:'rand'}],
  [{type:'zombie', count:40, side:'all'}, {type:'pirate',  count:18, side:'rand'},{type:'dragon',count:5, side:'rand'}],
  [{type:'pirate', count:45, side:'all'}, {type:'dragon',  count:8,  side:'rand'}],
  [{type:'orc2',   count:40, side:'all'}, {type:'pirate',  count:28, side:'all'},{type:'dragon',count:8, side:'all'}],
  [{type:'zombie', count:50, side:'all'}, {type:'orc2',    count:35, side:'all'},{type:'dragon',count:10,side:'rand'}],
  [{type:'pirate', count:60, side:'all'}, {type:'zombie',  count:50, side:'all'},{type:'dragon',count:12,side:'all'}],
];

// ── 상태 ─────────────────────────────────────────────────────────────────
let _uid=null,_playerGP=0,_freePlay=false;
let _phase='loading';
let _wave=0,_castleHp=MAX_HP,_gp=START_GP;
let _defenders=[],_monsters=[],_fogGrid=null,_pois=[];
let _prepTimer=PREP_TIME,_mineTimer=0,_spawnQ=[],_spawnTimer=0,_waveActive=false;
let _sprites=null,_raf=null,_lastTs=0;
let _placingType='villager',_placing=false,_selected=new Set();
let _dispatchMode=false;
let _heroSkillCd=0;
let _walls={};
let _skillCds={};    // {fire: endTimestamp, ...}
let _skillEffects=[]; // 캔버스 이펙트 목록

let _drag=null;
let _pinch=null;

const $=id=>document.getElementById(id);

const UNIT_EMOJI={villager:'🛡️',miner:'⛏️',scout:'🔍',archer_tower:'🏹',cannon_tower:'💣',hero:'⚔️'};

// ── 화면 전환 ─────────────────────────────────────────────────────────────
function showPhase(n){
  ['loading','lobby','game','gameover'].forEach(p=>$(`${p}Screen`)?.classList.add('hidden'));
  $(`${n}Screen`)?.classList.remove('hidden');
  _phase=n;
}

// ── Firebase ──────────────────────────────────────────────────────────────
async function loadPlayer(){
  if(!_uid){renderLobby();return;}
  try{
    const s=await getDoc(doc(db,'battle_players',_uid));
    if(s.exists()){
      const d=s.data();
      _playerGP=d.gold||0;
      // 현재 회차 참가비 계산 (서버와 동일 로직 — 표시 전용)
      const entry=d[GAME_KEY]||{};
      const now=Date.now();
      const resetAt=typeof entry.resetAt==='number'?entry.resetAt:(entry.resetAt?.toMillis?.()??0);
      const count=(resetAt&&now-resetAt<86400000)?entry.count||0:0;
      _entryFee=BASE_FEE+count*FEE_STEP;
    }
  }catch{}
  renderLobby();
}
function renderLobby(){
  const el=$('lobbyGP');if(el)el.textContent=_uid?`${_playerGP} GP`:'게스트';
  const feeEl=$('lobbyFee');if(feeEl)feeEl.textContent=`${_entryFee} GP`;
  const btn=$('btnPlay');
  if(btn){btn.disabled=_uid&&_playerGP<_entryFee;btn.textContent=`⚔️ ${_entryFee} GP로 출전!`;}
  showPhase('lobby');
}
async function deductEntry(){
  if(_freePlay||!_uid)return true;
  if(_playerGP<_entryFee)return false;
  try{
    const res=await httpsCallable(functions,'payGameEntry')({gameKey:GAME_KEY});
    const {fee,newCount}=res.data;
    _playerGP-=fee;
    _entryFee=BASE_FEE+newCount*FEE_STEP;
    return true;
  }catch(e){
    console.warn('[conquest] 참가비 차감 실패:',e?.message);
    return false;
  }
}
async function awardGP(n){
  if(!_uid||_freePlay||n<=0)return;
  try{ await updateDoc(doc(db,'battle_players',_uid),{gold:increment(n)}); }catch{}
  // GP 생중계 (50GP 이상만)
  if(n>=50) httpsCallable(functions,'broadcastGpEvent')({game:'conquest',amount:n}).catch(()=>{});
}

// ── 게임 시작 / 종료 ─────────────────────────────────────────────────────
function startGame(){
  _wave=0;_castleHp=MAX_HP;_gp=START_GP;
  _defenders=[];_monsters=[];_spawnQ=[];
  _fogGrid=makeFogGrid(); _pois=generatePOIs();
  _prepTimer=PREP_TIME;_mineTimer=0;_spawnTimer=0;_waveActive=false;
  _selected=new Set();_placing=false;_dispatchMode=false;_heroSkillCd=0;
  _skillCds={};_skillEffects=[];_updateSkillUI();
  _walls={
    north:{hp:WALL_HP,maxHp:WALL_HP,breached:false},
    south:{hp:WALL_HP,maxHp:WALL_HP,breached:false},
    east: {hp:WALL_HP,maxHp:WALL_HP,breached:false},
    west: {hp:WALL_HP,maxHp:WALL_HP,breached:false},
  };
  moveCamTo(CASTLE_WX,CASTLE_WY);
  showPhase('game'); _resizeCanvas();
  renderHUD(); _lastTs=performance.now();
  _raf=requestAnimationFrame(_loop);
}
async function endGame(won){
  cancelAnimationFrame(_raf);
  if(won) playSound('revive'); else playSound('player_die');

  // 승리: 웨이브당 40 + 기본 150 GP
  // 패배: 완료한 웨이브당 50 GP 위로 보상 (웨이브 1개라도 클리어했으면 지급)
  const winReward  = won && !_freePlay ? Math.floor(150 + _wave * 40) : 0;
  const loseReward = !won && !_freePlay && _wave > 0 ? _wave * 50 : 0;
  const reward = winReward || loseReward;

  if(reward > 0) await awardGP(reward);

  const el=$('gameResult');
  if(el) el.innerHTML = won
    ? `<div style="font-size:26px;color:#fbbf24">승리! 🏆</div>
       <div>${_wave}웨이브 전부 클리어</div>
       <div style="color:#22c55e;font-size:18px">+${reward} GP</div>`
    : `<div style="font-size:26px;color:#ef4444">게임오버 💀</div>
       <div style="color:#9ca3af">${_wave}웨이브까지 방어 — 성이 함락되었습니다</div>
       <div style="color:#fbbf24;font-size:16px;margin-top:6px">${loseReward > 0 ? `+${loseReward} GP 위로 보상` : '웨이브를 클리어해야 보상이 지급됩니다'}</div>`;

  showPhase('gameover');
}

// ── 게임 루프 ─────────────────────────────────────────────────────────────
function _loop(ts){
  _raf=requestAnimationFrame(_loop);
  const dt=Math.min(ts-_lastTs,50);_lastTs=ts;
  _update(dt);
  renderScene({
    defenders:_defenders,monsters:_monsters,
    castleHp:_castleHp,maxCastleHp:MAX_HP,
    walls:_walls,
    fogGrid:_fogGrid,pois:_pois,
    prepCountdown:_prepTimer,wave:_waveActive,phase:_phase,
    skillEffects:_skillEffects,
  },_sprites);
}

function _update(dt){
  _mineTimer+=dt;
  if(_mineTimer>=MINE_RATE){_mineTimer-=MINE_RATE;_addGP(5);}
  if(_heroSkillCd>0) _heroSkillCd=Math.max(0,_heroSkillCd-dt);

  if(!_waveActive){_prepTimer-=dt;if(_prepTimer<=0)_startWave();renderHUD();return;}

  if(_spawnQ.length){_spawnTimer-=dt;if(_spawnTimer<=0){_spawnTimer=180;const s=_spawnQ.shift();_monsters.push(makeUnit(s.type,s.x,s.y));}}

  for(let i=_defenders.length-1;i>=0;i--){
    const dead=updateUnit(_defenders[i],_defenders,_monsters,dt,_walls);
    for(const ev of _defenders[i].events||[]){
      if(ev.type==='addGP'){_addGP(ev.amount);playSound('gold_pickup');}
      if(ev.type==='sound')_sfx(ev.name);
    }
    if(dead){_selected.delete(_defenders[i].id);_defenders.splice(i,1);}
  }

  const now2=Date.now();
  for(let i=_monsters.length-1;i>=0;i--){
    const m=_monsters[i];
    // 빙결 중인 몬스터는 AI 스킵 (위치·이벤트 고정)
    if(m._frozenUntil&&now2<m._frozenUntil){m.hitFlash=Math.max(0,(m.hitFlash||0)-dt);continue;}
    const dead=updateUnit(m,_defenders,_monsters,dt,_walls);
    for(const ev of m.events||[]){
      if(ev.type==='damageCastle') _castleHp-=ev.amount;
      if(ev.type==='damageWall') _damageWall(ev.wall,ev.amount);
      if(ev.type==='sound')_sfx(ev.name);
    }
    if(dead)_monsters.splice(i,1);
  }
  // 만료 이펙트 정리
  _skillEffects=_skillEffects.filter(e=>Date.now()-e.startAt<e.dur);

  // 수비대 주변 안개 해제
  for(const d of _defenders){
    if(d.type==='scout')revealFog(_fogGrid,d.x,d.y,120,_pois).forEach(_onDiscover);
    else revealFog(_fogGrid,d.x,d.y,70,_pois).forEach(_onDiscover);
  }
  // 몬스터는 안개를 걷히지 않음 — 아군만 탐험

  updateRevealAnims(dt);
  if(_castleHp<=0){endGame(false);return;}
  if(_waveActive&&_monsters.length===0&&_spawnQ.length===0){
    _waveActive=false;_prepTimer=PREP_TIME;
    const waveReward=_wave*100;
    _addGP(waveReward);
    _showNotif(`🏆 ${_wave}웨이브 클리어! +${waveReward} GP`);
    if(_wave>=WAVES.length){endGame(true);return;}
  }
  renderHUD();
}

// ── 발견 이벤트 ───────────────────────────────────────────────────────────
function _onDiscover(poi){
  const def=POI_DEFS[poi.type]||{};
  addRevealAnim(poi.x,poi.y,200);
  _addGP(poi.reward||0);
  _showNotif(`✨ ${def.name||poi.type} 발견! +${poi.reward} GP`);
}
function _showNotif(msg){
  const el=$('notifBox'); if(!el) return;
  const item=document.createElement('div');
  item.className='notif-item';item.textContent=msg;
  el.prepend(item);
  setTimeout(()=>item.remove(),3500);
}

// ── 웨이브 ────────────────────────────────────────────────────────────────
function _startWave(){
  playSound('levelup');
  _waveActive=true;
  const def=WAVES[Math.min(_wave,WAVES.length-1)];
  const scale=1+_wave*0.35; // 웨이브마다 35% 병력 증가
  def.forEach(g=>{
    for(let i=0;i<Math.ceil(g.count*scale);i++){
      // 드래곤은 대각선(2시·4시·7시·11시)에서 날아옴
      const pos = g.type==='dragon' ? getDragonSpawnPos() : getSpawnPos(g.side);
      _spawnQ.push({type:g.type,x:pos.x,y:pos.y});
    }
  });
  _spawnQ.sort(()=>Math.random()-.5);
  _spawnTimer=0;_wave++;renderHUD();
}

function _addGP(n){_gp+=n;}

// ── 성벽 피해 처리 ────────────────────────────────────────────────────────
function _damageWall(key,dmg){
  const w=_walls[key];if(!w||w.breached)return;
  w.hp=Math.max(0,w.hp-dmg);
  if(w.hp<=0){
    w.hp=0;w.breached=true;
    playSound('cannon_hit');
    _showNotif(`💥 ${WALL_NAMES[key]} 함락! 몬스터가 침투합니다!`);
    // 해당 성벽에 대기 중인 몬스터 즉시 진입
    for(const m of _monsters){
      if(m.atGate&&m.attackingWall===key) m.insideCastle=true;
    }
  }
}

// ── 성벽 수리 ─────────────────────────────────────────────────────────────
function _repairWalls(){
  if(_gp<WALL_REPAIR_COST)return;
  let repaired=false;
  for(const key of Object.keys(_walls)){
    const w=_walls[key];
    if(w.hp<w.maxHp){
      w.hp=Math.min(w.maxHp,w.hp+WALL_REPAIR_AMT);
      if(w.breached&&w.hp>0) w.breached=false;
      repaired=true;
    }
  }
  if(repaired){_gp-=WALL_REPAIR_COST;playSound('gold_pickup');renderHUD();}
}

// ── 영웅 스킬 ─────────────────────────────────────────────────────────────
function _useHeroSkill(){
  if(_heroSkillCd>0)return;
  const hero=_defenders.find(d=>d.type==='hero'&&d.selected&&!d.dying);
  if(!hero)return;
  let hitCount=0;
  for(const m of _monsters){
    if(!m.dying&&Math.hypot(m.x-hero.x,m.y-hero.y)<=HERO_SKILL_RANGE){
      m.hp-=hero.atk*8; m.hitFlash=400;
      if(m.hp<=0&&!m.dying){m.dying=true;m.animState='die';m.animFrame=0;m.dyingTimer=900;}
      hitCount++;
    }
  }
  _heroSkillCd=HERO_SKILL_CD;
  playSound('skill_lightning');
  addRevealAnim(hero.x,hero.y,HERO_SKILL_RANGE);
  _showNotif(`⚡ 영웅 스킬! ${hitCount}마리 섬광 타격`);
  renderHUD();
}

// ── 마법 스킬 (화염·얼음·회오리·유성) ────────────────────────────────────
function _useSkill(type){
  if(_phase!=='game') return;
  const def=SKILL_DEFS[type]; if(!def) return;
  const now=Date.now();
  if(_skillCds[type]&&now<_skillCds[type]){
    _showNotif(`⏳ ${def.name} 쿨다운 중`); return;
  }
  if(_gp<def.cost){
    _showNotif(`💰 GP 부족 (${def.name}: ${def.cost}GP)`); return;
  }
  _gp-=def.cost;
  _skillCds[type]=now+def.cd;
  renderHUD();

  const cx=CASTLE_WX, cy=CASTLE_WY;
  let hitCount=0;
  for(const m of _monsters){
    if(m.dying) continue;
    const dist=Math.hypot(m.x-cx, m.y-cy);
    const inRange=def.range===0||dist<=def.range;
    if(!inRange) continue;
    m.hp-=def.dmg;
    m.hitFlash=500;
    hitCount++;
    if(def.freeze) m._frozenUntil=now+def.freeze;
    if(def.knockback){
      const d=dist||1;
      m.x+=(m.x-cx)/d*def.knockback;
      m.y+=(m.y-cy)/d*def.knockback;
      // 밀쳐낸 후 경로 인덱스 되감기 (자연스러운 복귀)
      if(m.waypointIdx>0) m.waypointIdx=Math.max(0,m.waypointIdx-3);
    }
    if(m.hp<=0&&!m.dying){m.dying=true;m.animState='die';m.animFrame=0;m.dyingTimer=900;}
  }

  _skillEffects.push({type,x:cx,y:cy,startAt:now,
    dur:type==='meteor'?900:type==='ice'?1300:1100,
    color:def.color, range:def.range||2000});

  playSound(`skill_${type}`);
  _showNotif(`${def.emoji} ${def.name}! ${hitCount > 0 ? hitCount+'마리 타격' : 'GP 소모'}`);
  _updateSkillUI();
  // 쿨다운 종료 시 UI 갱신
  setTimeout(_updateSkillUI, def.cd);
}

function _updateSkillUI(){
  const now=Date.now(), inGame=_phase==='game';
  for(const [type,def] of Object.entries(SKILL_DEFS)){
    const btn=$(`sk_${type}`), cdEl=$(`sk_${type}_cd`);
    if(!btn) continue;
    const rem=Math.max(0,(_skillCds[type]||0)-now);
    if(rem>0){
      btn.disabled=true; btn.classList.remove('sk-ready');
      if(cdEl){cdEl.classList.remove('hidden');cdEl.textContent=Math.ceil(rem/1000)+'s';}
    } else {
      btn.disabled=!inGame||_gp<def.cost;
      btn.classList.toggle('sk-ready',inGame&&_gp>=def.cost);
      if(cdEl) cdEl.classList.add('hidden');
    }
  }
}

// ── 사운드 이벤트 → merchants.battle.js 동일 타입으로 매핑 ──────────────
const _SFX_MAP = {
  arrow:       'tower_shot',
  cannon:      'cannon_shot',
  hit:         'arrow_hit',
  death:       'monster_die',
  castle_hit:  'cannon_hit',
  coin:        'gold_pickup',
  mine:        'box_hit',
  dragon_roar: 'dragon_roar',
};
function _sfx(name){ const t=_SFX_MAP[name]||name; playSound(t); }

// ── HUD ──────────────────────────────────────────────────────────────────
const ALL_UNIT_BTNS=['villager','miner','scout','archer_tower','cannon_tower','hero'];
function renderHUD(){
  if($('hudWave'))  $('hudWave').textContent  =`웨이브 ${_wave}`;
  if($('hudGP'))    $('hudGP').textContent    =`💰 ${Math.floor(_gp)}`;
  if($('hudCastle'))$('hudCastle').textContent=`🏰 ${Math.max(0,Math.ceil(_castleHp))}`;
  if($('hudPrep'))  $('hudPrep').textContent  =_waveActive?`웨이브 ${_wave} 진행`:_prepTimer>0?`${Math.ceil(_prepTimer/1000)}s`:'';
  ALL_UNIT_BTNS.forEach(t=>{
    const btn=$(`btn_${t}`);if(!btn)return;
    btn.disabled=_gp<(UNIT_DEFS[t]?.cost||50);
    btn.classList.toggle('active',_placing&&_placingType===t);
  });
  _updateSkillUI();
  const db2=$('btnDispatch');
  if(db2)db2.classList.toggle('active',_dispatchMode);
  // 선택 유닛 상태 표시 (HUD 우측 소형)
  const selEl=$('hudSelected');
  if(selEl) selEl.textContent=_selected.size>0?`${_selected.size}명 선택`:'';

  // 선택 유닛 배너 (캔버스 위 오버레이)
  const banner=$('unitBanner');
  if(banner){
    const first=_defenders.find(d=>d.selected&&!d.dying);
    if(first){
      const def=UNIT_DEFS[first.type]||{};
      const maxHp=def.hp||1;
      const hpPct=Math.max(0,Math.min(100,(first.hp/maxHp)*100));
      const hpColor=hpPct>50?'#22c55e':hpPct>25?'#f59e0b':'#ef4444';
      const mode=first.patrolMode?'🔄 순찰':first.guardMode?'🛡 경계':first.targetId?'⚔️ 공격':'🚶 대기';
      const emoji=UNIT_EMOJI[first.type]||'👤';
      const extra=_selected.size>1?` +${_selected.size-1}명`:'';
      $('ubIcon').textContent=emoji;
      $('ubLabel').textContent=(def.label||first.type)+extra;
      $('ubHpFill').style.width=hpPct+'%';
      $('ubHpFill').style.background=hpColor;
      $('ubHpText').textContent=`${first.hp}/${maxHp}`;
      $('ubMode').textContent=mode;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }
  // 경계 버튼 활성 표시
  const guardBtn=$('btnGuard');
  if(guardBtn){
    const anyGuard=_selected.size>0&&[..._selected].some(id=>{const d=_defenders.find(d=>d.id===id);return d?.guardMode;});
    guardBtn.classList.toggle('active',anyGuard);
  const patrolBtn=$('btnPatrol');
  if(patrolBtn){
    const anyPatrol=_selected.size>0&&[..._selected].some(id=>{const d=_defenders.find(d=>d.id===id);return d?.patrolMode;});
    patrolBtn.classList.toggle('active',anyPatrol);
  }
  }
  // 영웅 스킬 버튼
  const heroSkillBtn=$('btnHeroSkill');
  if(heroSkillBtn){
    const hasHero=_defenders.some(d=>d.type==='hero'&&d.selected&&!d.dying);
    heroSkillBtn.disabled=!hasHero||_heroSkillCd>0;
    const cd=_heroSkillCd>0?` (${Math.ceil(_heroSkillCd/1000)}s)`:'';
    heroSkillBtn.textContent=`⚡ 영웅 스킬${cd}`;
  }
}

// ── 입력: 터치/마우스 ─────────────────────────────────────────────────────
function _onTouchStart(e){
  resumeAudio(); // Chrome 자동재생 정책: 첫 터치에서 AudioContext 활성화
  if(_phase!=='game')return;
  if(e.touches?.length===2){
    _pinch={d:Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY)};
    _drag=null;return;
  }
  const t=e.touches?.[0]||e;
  _drag={x:t.clientX,y:t.clientY,moved:false};
  e.preventDefault();
}
function _onTouchMove(e){
  if(_phase!=='game')return;
  if(e.touches?.length===2&&_pinch){
    const nd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    zoomBy(nd/_pinch.d); _pinch.d=nd; return;
  }
  if(!_drag)return;
  const t=e.touches?.[0]||e;
  const dx=t.clientX-_drag.x, dy=t.clientY-_drag.y;
  if(Math.hypot(dx,dy)>10)_drag.moved=true;
  if(_drag.moved)panBy(dx,dy);
  _drag.x=t.clientX;_drag.y=t.clientY;
  e.preventDefault();
}
function _onTouchEnd(e){
  if(_phase!=='game')return;
  if(_drag&&!_drag.moved){
    const t=e.changedTouches?.[0]||e;
    _handleTap(t.clientX,t.clientY);
  }
  _drag=null;_pinch=null;
}

function _handleTap(cx,cy){
  const cv=$('gameCanvas');
  const rect=cv.getBoundingClientRect();
  const sx=cx-rect.left, sy=cy-rect.top;

  const[wx,wy]=screenToWorld(sx,sy);
  if(wx<0||wx>10000||wy<0||wy>10000)return;

  // 정찰 파견
  if(_dispatchMode){
    const cost=UNIT_DEFS.scout.cost;
    if(_gp<cost)return;
    _gp-=cost;
    const scout=makeUnit('scout',CASTLE_WX,CASTLE_WY);
    const snap=snapToRoad(wx,wy);
    scout.cmdX=snap.x;scout.cmdY=snap.y;
    _defenders.push(scout);
    scout._revealTarget={wx:snap.x,wy:snap.y,r:200};
    addRevealAnim(snap.x,snap.y,200);
    renderHUD();return;
  }

  // ── 우선순위 ①: 기존 아군 탭 → 무조건 선택 (배치 모드 자동 해제) ─────────
  // 배치 모드 중에도 기존 유닛을 탭하면 선택 모드로 전환
  const hit=_defenders.find(u=>!u.dying&&Math.hypot(wx-u.x,wy-u.y)<u.size*5);
  if(hit){
    _placing=false;           // 배치 모드 해제
    _placingType='villager';  // 버튼 active 상태 초기화
    _selected.clear();
    _selected.add(hit.id);
    _defenders.forEach(d=>d.selected=_selected.has(d.id));
    renderHUD();return;
  }

  // ── 우선순위 ②: 배치 모드 → 빈 공간 탭이면 유닛 배치 ───────────────────
  if(_placing){
    const cost=UNIT_DEFS[_placingType]?.cost||50;
    if(_gp<cost)return;
    if(isMapObstacle(wx,wy)){_showNotif('⛔ 건물 위에는 배치 불가');return;}
    _gp-=cost;
    playSound('hit');
    _defenders.push(makeUnit(_placingType,wx,wy));
    revealFog(_fogGrid,wx,wy,80,_pois).forEach(_onDiscover);
    renderHUD();return;
  }

  // ── 우선순위 ③: 선택된 아군이 있을 때 ────────────────────────────────
  if(_selected.size>0){
    // 적 탭 → 공격 타겟 지정
    const enemy=_monsters.find(m=>!m.dying&&Math.hypot(wx-m.x,wy-m.y)<m.size*3);
    if(enemy){
      _defenders.forEach(d=>{
        if(d.selected&&!d.isTower){
          d.targetId=enemy.id;d.guardMode=false;d.cmdX=null;d.cmdY=null;
        }
      });
      renderHUD();return;
    }
    // 빈 공간 탭 → 이동 명령
    _defenders.forEach(d=>{
      if(d.selected&&!d.isTower){
        d.cmdX=wx;d.cmdY=wy;d.targetId=null;d.guardMode=false;
      }
    });
    renderHUD();return;
  }
}

function _onWheel(e){
  e.preventDefault();
  zoomBy(e.deltaY<0?1.15:0.87);
}

// ── 캔버스 ───────────────────────────────────────────────────────────────
function _resizeCanvas(){
  const cv=$('gameCanvas');
  const availW=window.innerWidth;
  const availH=window.innerHeight;
  // 풀스크린 9:16 최대화
  let w=availW, h=Math.round(w*16/9);
  if(h>availH){h=availH;w=Math.round(h*9/16);}
  cv.width=w; cv.height=h;
  cv.style.width=w+'px'; cv.style.height=h+'px';
  initRenderer(cv); initCamera(cv); resizeCamera(w,h);
}

function _openModal(id){ $(id)?.classList.remove('hidden'); }
function _closeModal(id){ $(id)?.classList.add('hidden'); }

function _setPlacing(type){
  if(_placing&&_placingType===type){_placing=false;}
  else{_placing=true;_placingType=type;_dispatchMode=false;_selected.clear();_defenders.forEach(d=>d.selected=false);}
  _closeModal('deployModal');
  renderHUD();
}

// ── 초기화 ───────────────────────────────────────────────────────────────
async function init(){
  showPhase('loading');
  _sprites=loadSprites();
  await loadMapAssets();

  $('btnPlay')?.addEventListener('click',async()=>{
    _freePlay=false;if(!(await deductEntry())){alert('GP가 부족합니다');return;} startGame();
  });
  $('btnFreePlay')?.addEventListener('click',()=>{_freePlay=true;startGame();});
  $('btnRestart')?.addEventListener('click',()=>showPhase('lobby'));

  // 모달 열기/닫기
  $('btnDeployModal')?.addEventListener('click',()=>_openModal('deployModal'));
  $('btnCommandModal')?.addEventListener('click',()=>_openModal('commandModal'));
  $('btnCloseDeployModal')?.addEventListener('click',()=>_closeModal('deployModal'));
  $('btnCloseCommandModal')?.addEventListener('click',()=>_closeModal('commandModal'));
  // 모달 배경 탭 → 닫기
  $('deployModal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)_closeModal('deployModal');});
  $('commandModal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)_closeModal('commandModal');});

  ALL_UNIT_BTNS.forEach(t=>$(`btn_${t}`)?.addEventListener('click',()=>_setPlacing(t)));
  $('btnHeroSkill')?.addEventListener('click',()=>{_useHeroSkill();_closeModal('commandModal');});
  Object.keys(SKILL_DEFS).forEach(t=>$(`sk_${t}`)?.addEventListener('click',()=>_useSkill(t)));

  $('btnDispatch')?.addEventListener('click',()=>{
    _dispatchMode=!_dispatchMode;_placing=false;_selected.clear();_defenders.forEach(d=>d.selected=false);
    _closeModal('commandModal');renderHUD();
  });
  $('btnGuard')?.addEventListener('click',()=>{
    _defenders.forEach(d=>{
      if(d.selected&&!d.isTower){
        d.guardMode=!d.guardMode;
        if(d.guardMode){d.cmdX=null;d.cmdY=null;d.targetId=null;d.patrolMode=false;}
      }
    });
    _closeModal('commandModal');renderHUD();
  });
  $('btnRepair')?.addEventListener('click',()=>{_repairWalls();_closeModal('commandModal');});
  $('btnPatrol')?.addEventListener('click',()=>{
    _defenders.forEach(d=>{
      if(d.selected&&!d.isTower){
        d.patrolMode=!d.patrolMode;
        if(d.patrolMode){
          d.patrolHome={x:d.x,y:d.y};
          d.patrolTarget=null;d.patrolTimer=0;
          d.guardMode=false;d.cmdX=null;d.cmdY=null;d.targetId=null;
        }
      }
    });
    _closeModal('commandModal');renderHUD();
  });
  $('btnDeselect')?.addEventListener('click',()=>{
    _selected.clear();_defenders.forEach(d=>d.selected=false);_placing=false;_dispatchMode=false;
    _closeModal('commandModal');renderHUD();
  });
  $('btnHome')?.addEventListener('click',()=>moveCamTo(CASTLE_WX,CASTLE_WY));

  const cv=$('gameCanvas');
  cv.addEventListener('touchstart',_onTouchStart,{passive:false});
  cv.addEventListener('touchmove', _onTouchMove, {passive:false});
  cv.addEventListener('touchend',  _onTouchEnd,  {passive:false});
  cv.addEventListener('mousedown', e=>{_onTouchStart(e);});
  cv.addEventListener('mousemove', e=>{if(_drag)_onTouchMove(e);});
  cv.addEventListener('mouseup',   e=>{_onTouchEnd(e);});
  cv.addEventListener('wheel',     _onWheel,{passive:false});

  window.addEventListener('resize',()=>{if(_phase==='game')_resizeCanvas();});

  // Telegram Mini App 최적화
  if(isTelegramMiniApp()){
    const tg=window.Telegram.WebApp;
    tg.ready();
    tg.expand();
    try{ tg.setHeaderColor('#0a0f05'); }catch(_){}
    tg.BackButton?.onClick?.(()=>showPhase('lobby'));
    // Telegram 숫자 ID를 _uid에 직접 대입하지 않음 — Firebase Auth UID와 불일치 버그 방지
    // Firebase 미인증 상태면 자동 로그인 시도
    if(!auth.currentUser) loginWithTelegram().catch(()=>{});
  }

  onAuthStateChanged(auth,async user=>{
    _uid = user?.uid || null;  // Firebase Auth UID 항상 우선
    await loadPlayer();
  });
}

init();
