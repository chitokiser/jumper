// conquest.js — Monster Frontier 메인 (수성전: 성 외부 공격, 도로 이동)
import { db, auth, functions } from '/assets/js/firebase-init.js';
import { doc, getDoc, updateDoc, increment } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { isTelegramMiniApp, loginWithTelegram } from '/assets/js/telegram-auth.js';
import { createCashout } from '../game-cashout.js';
import {
  initCamera, resizeCamera, screenToWorld, panBy, zoomBy, moveCamTo,
  makeFogGrid, revealFog, generatePOIs, addRevealAnim, updateRevealAnims,
  CASTLE_WX, CASTLE_WY, POI_DEFS, getScale,
} from './conquest.world.js';
import { initRenderer, loadMapAssets, renderScene, isMapObstacle } from './conquest.render.js';
import { UNIT_DEFS, loadSprites, makeUnit, updateUnit, MINES, CASTLE_WALL, fxQueue, applyImpact, buff } from './conquest.units.js';
import { getSpawnPos, getDragonSpawnPos, snapToRoad, setWaveRoads, GATE_NORTH, GATE_SOUTH, GATE_WEST, GATE_EAST } from './conquest.path.js';
import { resumeAudio, playSound } from './conquest.audio.js';
import { setImpactHandler, resetFx, updateFx, addShake, addShot, addDamage, addSpark, addPuff, addCoin, addBurst, showBanner, WALL_POINT } from './conquest.fx.js';

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
const CASTLE_REPAIR_COST = 200;
const CASTLE_REPAIR_AMT  = 1000;
const WALL_NAMES = {north:'North Wall',south:'South Wall',east:'East Wall',west:'West Wall'};
const HERO_SKILL_CD   = 30000;
const HERO_SKILL_RANGE = 400;

// ── 스킬 정의 ─────────────────────────────────────────────────────────────
// range: 세계 좌표 기준 성 중심으로부터의 반경 (0 = 전체 맵)
// dmg: 피해량, freeze: 빙결 ms, knockback: 밀쳐내기 세계단위
const SKILL_DEFS = {
  fire:   {emoji:'🔥',name:'Fire',       cost:200, cd:20000, range:1200, dmg:250, color:'#f97316'},
  ice:    {emoji:'❄️',name:'Ice',        cost:250, cd:30000, range:0,    dmg:80,  freeze:3000, color:'#93c5fd'},
  wind:   {emoji:'🌪️',name:'Whirlwind', cost:200, cd:25000, range:1400, dmg:150, knockback:600, color:'#6ee7b7'},
  meteor: {emoji:'☄️',name:'Meteor',    cost:350, cd:45000, range:0,    dmg:480, color:'#ea580c'},
};

// ── 웨이브 정의 (20웨이브, 5·10·15·20은 보스 웨이브, 8·12·15·18·20은 흑화 영웅) ─────────
const W=(type,count,side='rand',boss=false)=>boss?{type,count,side,boss:true}:{type,count,side};
const WAVES = [
  [W('orc',25)],
  [W('orc',30),W('orc2',15)],
  [W('orc2',35,'all')],
  [W('orc',25),W('zombie',25)],
  [W('orc2',35,'all'),W('zombie',20),W('dragon',3),W('boss_orc',1,'rand',true)],
  [W('zombie',40,'all'),W('pirate',18),W('dragon',5)],
  [W('pirate',45,'all'),W('dragon',8)],
  [W('orc2',40,'all'),W('pirate',28,'all'),W('dragon',8,'all'),W('dark_hero',1,'rand',true)],
  [W('zombie',50,'all'),W('orc2',35,'all'),W('dragon',10)],
  [W('pirate',60,'all'),W('zombie',50,'all'),W('dragon',12,'all'),W('boss_dragon',1,'rand',true)],
  [W('orc3',24),W('pirate',30),W('zombie',24)],
  [W('zombie',36),W('orc3',24),W('dragon',10),W('dark_hero',1,'rand',true)],
  [W('pirate',40,'all'),W('orc3',28),W('dragon',12)],
  [W('zombie',40,'all'),W('orc2',36),W('orc3',24),W('dragon',12)],
  [W('orc3',32,'all'),W('pirate',36),W('dragon',14),W('boss_orc',2,'rand',true),W('dark_hero',1,'rand',true)],
  [W('zombie',44,'all'),W('pirate',36),W('orc3',30)],
  [W('orc3',40,'all'),W('orc2',36),W('dragon',16)],
  [W('pirate',44,'all'),W('zombie',40),W('orc3',32),W('dragon',16),W('dark_hero',2,'rand',true)],
  [W('orc3',44,'all'),W('zombie',44),W('pirate',36),W('dragon',18)],
  [W('orc3',44,'all'),W('pirate',44),W('zombie',36),W('dragon',18),W('boss_dragon',2,'rand',true),W('dark_hero',2,'rand',true)],
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
let _blessOpen=false;
let _streak=0,_lastKillAt=0,_lastCoinSnd=0,_lastCastleShake=0;   // 연속 처치 / 연출 쓰로틀

const $=id=>document.getElementById(id);

// 게임 도중 결산하고 나가기 (이미 클리어한 웨이브 × 50 GP)
const _clearedWaves=()=>_waveActive?Math.max(0,_wave-1):_wave;
const _cashout=createCashout({
  getReward:()=>_freePlay?0:_clearedWaves()*50,
  onConfirm:()=>{ if(_phase!=='game') return; return endGame(false,true); },
  corner:'tr',
});

const UNIT_EMOJI={villager:'🛡️',miner:'⛏️',scout:'🔍',archer_tower:'🏹',cannon_tower:'💣',hero:'⚔️'};

// ── 화면 전환 ─────────────────────────────────────────────────────────────
function showPhase(n){
  ['loading','lobby','game','gameover'].forEach(p=>$(`${p}Screen`)?.classList.add('hidden'));
  $(`${n}Screen`)?.classList.remove('hidden');
  _phase=n;
  _cashout.setVisible(n==='game');
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
  const el=$('lobbyGP');if(el)el.textContent=_uid?`${_playerGP} GP`:'Guest';
  const feeEl=$('lobbyFee');if(feeEl)feeEl.textContent=`${_entryFee} GP`;
  const btn=$('btnPlay');
  if(btn){btn.disabled=_uid&&_playerGP<_entryFee;btn.textContent=`⚔️ Enter for ${_entryFee} GP!`;}
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
  resetFx();fxQueue.length=0;_streak=0;_lastKillAt=0;
  buff.tower=1;buff.ally=1;_blessOpen=false;_closeModal('blessModal');
  setImpactHandler(p=>applyImpact(p,_monsters));
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
async function endGame(won,cash=false){
  cancelAnimationFrame(_raf);
  if(cash) _phase='cashout';   // 결산 처리 중 중복 호출 방지
  if(won) playSound('revive'); else if(!cash) playSound('player_die');

  // 승리: 웨이브당 40 + 기본 150 GP
  // 패배: 완료한 웨이브당 50 GP 위로 보상 (웨이브 1개라도 클리어했으면 지급)
  const winReward  = won && !_freePlay ? Math.floor(150 + _wave * 40) : 0;
  const clearedWaves = cash ? _clearedWaves() : _wave;
  const loseReward = !won && !_freePlay && clearedWaves > 0 ? clearedWaves * 50 : 0;
  const reward = winReward || loseReward;

  if(reward > 0) await awardGP(reward);

  if(cash){
    const elc=$('gameResult');
    if(elc) elc.innerHTML=`<div style="font-size:26px;color:#fbbf24">Cashed Out 💰</div>
       <div style="color:#9ca3af">${clearedWaves} waves cleared</div>
       <div style="color:#22c55e;font-size:18px">${reward>0?`+${reward} GP`:'No reward yet'}</div>`;
    showPhase('gameover');
    return;
  }

  const el=$('gameResult');
  if(el) el.innerHTML = won
    ? `<div style="font-size:26px;color:#fbbf24">Victory! 🏆</div>
       <div>All ${_wave} waves cleared</div>
       <div style="color:#22c55e;font-size:18px">+${reward} GP</div>`
    : `<div style="font-size:26px;color:#ef4444">Game Over 💀</div>
       <div style="color:#9ca3af">Defended to wave ${_wave} — Castle has fallen</div>
       <div style="color:#fbbf24;font-size:16px;margin-top:6px">${loseReward > 0 ? `+${loseReward} GP consolation reward` : 'Clear a wave to earn rewards'}</div>`;

  showPhase('gameover');
}

// ── 게임 루프 ─────────────────────────────────────────────────────────────
function _loop(ts){
  _raf=requestAnimationFrame(_loop);
  const dt=Math.min(ts-_lastTs,50);_lastTs=ts;
  _update(dt);
  _drainFx();
  updateFx(dt,{walls:_walls,castleRatio:_castleHp/MAX_HP});
  renderScene({
    defenders:_defenders,monsters:_monsters,
    castleHp:_castleHp,maxCastleHp:MAX_HP,
    walls:_walls,
    fogGrid:_fogGrid,pois:_pois,
    prepCountdown:_prepTimer,wave:_waveActive,phase:_phase,
    skillEffects:_skillEffects,waveNo:_wave,
  },_sprites);
}

function _update(dt){
  _mineTimer+=dt;
  if(_mineTimer>=MINE_RATE){_mineTimer-=MINE_RATE;_addGP(5);}
  if(_heroSkillCd>0) _heroSkillCd=Math.max(0,_heroSkillCd-dt);

  if(!_waveActive){if(!_blessOpen){_prepTimer-=dt;if(_prepTimer<=0)_startWave();}renderHUD();return;}

  if(_spawnQ.length){_spawnTimer-=dt;if(_spawnTimer<=0){_spawnTimer=180;const s=_spawnQ.shift();const mu=makeUnit(s.type,s.x,s.y);if(s.hm){mu.hp=mu.maxHp=Math.round(mu.maxHp*s.hm);mu.atk=Math.round(mu.atk*s.am);}if(s.brk)mu.role='breaker';_monsters.push(mu);}}

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
      if(ev.type==='damageCastle'){
        _castleHp-=ev.amount;
        const tn=performance.now();
        if(tn-_lastCastleShake>260){_lastCastleShake=tn;addShake(2.2);addSpark(CASTLE_WX+(Math.random()-.5)*160,CASTLE_WY-40,'#fca5a5',3);}
      }
      if(ev.type==='damageWall'){
        _damageWall(ev.wall,ev.amount);
        const wp=WALL_POINT[ev.wall];
        if(wp&&ev.fly) addShot({kind:'fire',sx:m.x,sy:m.y-60,tx:wp[0]+(Math.random()-.5)*160,ty:wp[1]+(Math.random()-.5)*160,dur:520});
        else if(wp&&Math.random()<0.35) addSpark(m.x,m.y-30,'#d6b27a',2);
      }
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
    const waveReward=_wave*100+Math.max(0,_wave-10)*50;
    _addGP(waveReward);
    _showNotif(`🏆 Wave ${_wave} cleared! +${waveReward} GP`);
    if(_wave>=WAVES.length){endGame(true);return;}
    _openBless();
  }
  renderHUD();
}

// ── 전투 연출 큐 처리 / 처치 코인·연속 처치 ─────────────────────────────────
function _drainFx(){
  for(const ev of fxQueue){
    if(ev.t==='dmg') addDamage(ev.x,ev.y,ev.amount,ev.crit,ev.ally);
    else if(ev.t==='spark') addSpark(ev.x,ev.y,ev.crit?'#fbbf24':'#fde68a',ev.crit?7:3);
    else if(ev.t==='shot') addShot(ev);
    else if(ev.t==='shock'){ addBurst(ev.x,ev.y); addShake(ev.cry?4:8); playSound(ev.cry?'dragon_roar':'cannon_hit'); }
    else if(ev.t==='kill'){ addPuff(ev.unit.x,ev.unit.y,4,'dust'); _onKill(ev.unit); }
  }
  fxQueue.length=0;
}
// 몬스터 처치: 코인(인게임 GP) + 3초 안에 이어 잡으면 연속 처치, 10마리마다 보너스
function _onKill(m){
  if(!m||m.team!=='monster'||m._killCounted) return;
  m._killCounted=true;
  const def=UNIT_DEFS[m.type]; if(!def) return;
  const now=performance.now();
  const coin=Math.max(1,Math.round(def.hp/150));
  _addGP(coin); addCoin(m.x,m.y,coin);
  if(def.boss){
    _addGP(400); for(let i=0;i<6;i++) addCoin(m.x+(Math.random()-.5)*160,m.y+(Math.random()-.5)*80,coin);
    showBanner(`🏆 ${def.label} 처치!  +${400+coin} GP`); playSound('streak'); addShake(10);
  }
  if(now-_lastCoinSnd>120){playSound('coin');_lastCoinSnd=now;}
  _streak=(now-_lastKillAt<3000)?_streak+1:1; _lastKillAt=now;
  if(_streak>=10&&_streak%10===0){
    const bonus=_streak; _addGP(bonus);
    showBanner(`🔥 KILLSTREAK ×${_streak}  +${bonus} GP`);
    playSound('streak'); addShake(3);
  }
}

// ── 발견 이벤트 ───────────────────────────────────────────────────────────
function _onDiscover(poi){
  const def=POI_DEFS[poi.type]||{};
  addRevealAnim(poi.x,poi.y,200);
  _addGP(poi.reward||0);
  _showNotif(`✨ ${def.name||poi.type} discovered! +${poi.reward} GP`);
}
function _showNotif(msg){
  const el=$('notifBox'); if(!el) return;
  const item=document.createElement('div');
  item.className='notif-item';item.textContent=msg;
  el.prepend(item);
  setTimeout(()=>item.remove(),3500);
}

// ── 웨이브 ────────────────────────────────────────────────────────────────
// 이번 웨이브가 공격할 도로 선택: 6웨이브부터는 방어가 가장 약한 쪽을 반드시 포함
const GATES={north:GATE_NORTH,south:GATE_SOUTH,west:GATE_WEST,east:GATE_EAST};
function _pickWaveRoads(wn){
  const keys=['north','south','west','east'];
  const score=k=>{
    const g=GATES[k]; let sc=0;
    for(const d of _defenders){
      if(d.dying)continue;
      if(Math.hypot(d.x-g.x,d.y-g.y)<1000) sc+=d.isTower?2:d.type==='hero'?3:1;
    }
    return sc+Math.random()*0.5;
  };
  const n=wn<=3?(Math.random()<.5?1:2):wn<=12?2:3;
  const order=keys.slice().sort((a,b)=>score(a)-score(b));
  let picks;
  if(wn>=6){
    const rest=order.slice(1).sort(()=>Math.random()-.5);
    picks=[order[0],...rest.slice(0,n-1)];
  } else picks=keys.sort(()=>Math.random()-.5).slice(0,n);
  return picks;
}
const ROAD_LABEL={north:'북쪽',south:'남쪽',west:'서쪽',east:'동쪽'};

function _startWave(){
  playSound('levelup');playSound('horn');
  _waveActive=true;
  const wn=_wave+1;
  const def=WAVES[Math.min(_wave,WAVES.length-1)];
  // 10웨이브까지는 병력 수가 늘고, 이후는 수를 완만하게 유지하는 대신 몬스터가 더 강해진다
  const scale=_wave<10?1+_wave*0.35:3.2+(_wave-10)*0.04;
  const roads=_pickWaveRoads(wn); setWaveRoads(roads);
  const darkHero=def.some(g=>g.type==='dark_hero');
  if(def.some(g=>g.boss)){
    showBanner(darkHero?'☠ 흑화된 영웅 출현 ☠':'☠ BOSS WAVE ☠');playSound('streak');addShake(8);
  } else showBanner(`⚠ ${roads.map(r=>ROAD_LABEL[r]).join('·')} 방향 침공!`);
  if(def.some(g=>g.boss)) _showNotif(`⚠ ${roads.map(r=>ROAD_LABEL[r]).join('·')} 방향 침공!`);
  def.forEach(g=>{
    const n=g.boss?g.count:Math.ceil(g.count*scale);   // 보스·영웅은 병력 배율을 받지 않는다
    // 웨이브가 갈수록 일반 몬스터·보스 모두 체력/공격력 증가
    const hm=g.boss?1+Math.max(0,wn-5)*0.1:1+Math.max(0,wn-2)*0.06;
    const am=g.boss?1+Math.max(0,wn-5)*0.06:1+Math.max(0,wn-2)*0.03;
    for(let i=0;i<n;i++){
      // 드래곤은 대각선(2시·4시·7시·11시)에서 날아옴
      const pos = UNIT_DEFS[g.type]?.flying ? getDragonSpawnPos() : getSpawnPos(g.side);
      _spawnQ.push({type:g.type,x:pos.x,y:pos.y,hm,am,brk:wn>=10&&!g.boss&&/^orc/.test(g.type)&&Math.random()<.3});
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
    playSound('cannon_hit');playSound('wall_crumble');addShake(10);
    {const wp=WALL_POINT[key];if(wp){addBurst(wp[0],wp[1]);addBurst(wp[0]+120,wp[1]+60);}}
    _showNotif(`💥 ${WALL_NAMES[key]} breached! Monsters are invading!`);
    // 해당 성벽에 대기 중인 몬스터 즉시 진입
    for(const m of _monsters){
      if(m.atGate&&m.attackingWall===key) m.insideCastle=true;
    }
  }
}

// ── 웨이브 클리어 축복 (3택 1) ────────────────────────────────────────────
const BLESSINGS=[
  {icon:'🏹',name:'타워 강화',   desc:'모든 타워 공격력 +25%',   fn:()=>{buff.tower*=1.25;}},
  {icon:'⚔️',name:'수비대 단련', desc:'수비대·영웅 공격력 +20%', fn:()=>{buff.ally*=1.2;}},
  {icon:'🧱',name:'성벽 복구',   desc:'모든 성벽 체력 완전 회복',fn:()=>{for(const w of Object.values(_walls)){w.hp=w.maxHp;w.breached=false;}}},
  {icon:'🏰',name:'성 수리',     desc:'성 체력 +2000',           fn:()=>{_castleHp=Math.min(MAX_HP,_castleHp+2000);}},
  {icon:'💰',name:'전리품',      desc:'+400 GP',                 fn:()=>{_addGP(400);}},
  {icon:'💚',name:'치유의 빛',   desc:'모든 아군 체력 완전 회복',fn:()=>{for(const d of _defenders){if(!d.dying)d.hp=d.maxHp;}}},
];
function _openBless(){
  const box=$('blessCards'); if(!box) return;
  const picks=[...BLESSINGS].sort(()=>Math.random()-.5).slice(0,3);
  box.innerHTML='';
  picks.forEach(b=>{
    const el=document.createElement('button');
    el.className='cmd-btn bless-card';
    el.innerHTML=`<div class="bc-icon">${b.icon}</div><div class="bc-name">${b.name}</div><div class="bc-desc">${b.desc}</div>`;
    el.addEventListener('click',()=>{
      b.fn(); playSound('levelup'); _showNotif(`${b.icon} ${b.name} 적용`);
      _blessOpen=false; _closeModal('blessModal'); renderHUD();
    });
    box.appendChild(el);
  });
  _blessOpen=true; _openModal('blessModal');
}

// ── 타워 업그레이드 / 판매 / 수리 ──────────────────────────────────────────
const TOWER_MAX_LV=3;
function _selTower(){ return _defenders.find(d=>d.selected&&d.isTower&&!d.dying)||null; }
function _towerUpCost(t){
  const base=UNIT_DEFS[t.type].cost;
  return t.lvl>=TOWER_MAX_LV?0:Math.round(base*(t.lvl===1?0.8:1.4));
}
function _towerRepairCost(t){
  if(t.hp>=t.maxHp) return 0;
  return Math.max(10,Math.ceil((1-t.hp/t.maxHp)*UNIT_DEFS[t.type].cost*0.5));
}
function _towerSellValue(t){ return Math.round(t.spent*0.6); }
function _upgradeTower(){
  const t=_selTower(); if(!t||t.lvl>=TOWER_MAX_LV) return;
  const cost=_towerUpCost(t); if(_gp<cost) return;
  _gp-=cost; t.spent+=cost; t.lvl++;
  const def=UNIT_DEFS[t.type], k=t.lvl-1, oldMax=t.maxHp;
  t.atk=Math.round(def.atk*(1+0.5*k));
  t.maxHp=Math.round(def.hp*(1+0.4*k));
  t.hp=Math.min(t.maxHp,t.hp+(t.maxHp-oldMax));
  t.range=Math.round(def.range*(1+0.08*k));
  t.atkRate=Math.round(def.atkRate*(1-0.08*k));
  addBurst(t.x,t.y-t.size*1.5); playSound('levelup');
  _showNotif(`⬆️ ${def.label} Lv${t.lvl}`);
  renderHUD();
}
function _sellTower(){
  const t=_selTower(); if(!t) return;
  const v=_towerSellValue(t); _addGP(v);
  _defenders=_defenders.filter(d=>d!==t); _selected.delete(t.id);
  addCoin(t.x,t.y-t.size,v); playSound('coin');
  _showNotif(`💰 ${UNIT_DEFS[t.type].label} 판매 +${v} GP`);
  renderHUD();
}
function _repairTower(){
  const t=_selTower(); if(!t) return;
  const cost=_towerRepairCost(t); if(!cost||_gp<cost) return;
  _gp-=cost; t.hp=t.maxHp; playSound('gold_pickup');
  _showNotif(`🔨 ${UNIT_DEFS[t.type].label} 수리`); renderHUD();
}
// 다음 웨이브 미리보기 문구
function _previewText(){
  if(_wave>=WAVES.length) return '';
  const scale=_wave<10?1+_wave*0.35:3.2+(_wave-10)*0.04, ICON={orc:'👹',orc2:'👹',orc3:'👹',zombie:'🧟',pirate:'🏴‍☠️',dragon:'🐉',boss_orc:'☠',boss_dragon:'☠',dark_hero:'😈'};
  const sum={};
  for(const g of WAVES[_wave]){
    const k=ICON[g.type]||'👾';
    sum[k]=(sum[k]||0)+(g.boss?g.count:Math.ceil(g.count*scale));
  }
  const boss=WAVES[_wave].filter(g=>g.boss);
  return `다음 ${_wave+1}/${WAVES.length}웨이브 ` + Object.entries(sum).map(([k,n])=>`${k}${n}`).join(' ') + (boss.length?` · BOSS ${boss.map(g=>UNIT_DEFS[g.type].label+(g.count>1?'×'+g.count:'')).join('+')}`:'') + ' · 공격 방향 무작위';
}
function _callWaveEarly(){
  if(_waveActive||_blessOpen||_wave>=WAVES.length) return;
  const bonus=Math.floor(_prepTimer/1000)*4;
  _addGP(bonus); _showNotif(`⏩ 조기 호출 +${bonus} GP`);
  _prepTimer=0; _startWave();
}

// ── 메인 성 수리 ──────────────────────────────────────────────────────────
function _repairCastle(){
  if(_castleHp>=MAX_HP||_gp<CASTLE_REPAIR_COST) return;
  _gp-=CASTLE_REPAIR_COST;
  const add=Math.min(CASTLE_REPAIR_AMT,MAX_HP-_castleHp);
  _castleHp+=add;
  playSound('gold_pickup'); showBanner(`🏰 성 수리 +${Math.round(add)}`);
  renderHUD();
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
      addDamage(m.x,m.y-60,hero.atk*8,true,false);
      if(m.hp<=0&&!m.dying){m.dying=true;m.animState='die';m.animFrame=0;m.dyingTimer=900;_onKill(m);}
      hitCount++;
    }
  }
  _heroSkillCd=HERO_SKILL_CD;
  playSound('skill_lightning');addShake(7);
  addRevealAnim(hero.x,hero.y,HERO_SKILL_RANGE);
  _showNotif(`⚡ Hero Skill! ${hitCount} monsters struck`);
  renderHUD();
}

// ── 마법 스킬 (화염·얼음·회오리·유성) ────────────────────────────────────
function _useSkill(type){
  if(_phase!=='game') return;
  const def=SKILL_DEFS[type]; if(!def) return;
  const now=Date.now();
  if(_skillCds[type]&&now<_skillCds[type]){
    _showNotif(`⏳ ${def.name} on cooldown`); return;
  }
  if(_gp<def.cost){
    _showNotif(`💰 Not enough GP (${def.name}: ${def.cost}GP)`); return;
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
    addDamage(m.x,m.y-60,def.dmg,false,false);
    hitCount++;
    if(def.freeze) m._frozenUntil=now+def.freeze;
    if(def.knockback){
      const d=dist||1;
      m.x+=(m.x-cx)/d*def.knockback;
      m.y+=(m.y-cy)/d*def.knockback;
      // 밀쳐낸 후 경로 인덱스 되감기 (자연스러운 복귀)
      if(m.waypointIdx>0) m.waypointIdx=Math.max(0,m.waypointIdx-3);
    }
    if(m.hp<=0&&!m.dying){m.dying=true;m.animState='die';m.animFrame=0;m.dyingTimer=900;_onKill(m);}
  }

  _skillEffects.push({type,x:cx,y:cy,startAt:now,
    dur:type==='meteor'?900:type==='ice'?1300:1100,
    color:def.color, range:def.range||2000});

  playSound(`skill_${type}`);addShake({fire:6,ice:3,wind:5,meteor:12}[type]||4);
  _showNotif(`${def.emoji} ${def.name}! ${hitCount > 0 ? hitCount+' hit' : 'GP spent'}`);
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
  if($('hudWave'))  $('hudWave').textContent  =`Wave ${_wave}/${WAVES.length}`;
  if($('hudGP'))    $('hudGP').textContent    =`💰 ${Math.floor(_gp)}`;
  if($('hudCastle'))$('hudCastle').textContent=`🏰 ${Math.max(0,Math.ceil(_castleHp))}`;
  if($('hudPrep'))  $('hudPrep').textContent  =_waveActive?`Wave ${_wave} in progress`:_prepTimer>0?`${Math.ceil(_prepTimer/1000)}s`:'';
  ALL_UNIT_BTNS.forEach(t=>{
    const btn=$(`btn_${t}`);if(!btn)return;
    btn.disabled=_gp<(UNIT_DEFS[t]?.cost||50);
    btn.classList.toggle('active',_placing&&_placingType===t);
  });
  _updateSkillUI();
  {
    const wb=$('waveBar');
    if(wb){
      const bosses=_waveActive?_monsters.filter(m=>m.boss&&!m.dying):[];
      const boss=bosses[0]||null;
      $('wavePreview').textContent=_waveActive?'':_previewText();
      $('btnCallWave').classList.toggle('hidden',_waveActive||_blessOpen||_wave>=WAVES.length);
      $('bossBar').classList.toggle('hidden',!boss);
      if(boss){
        const hp=bosses.reduce((a,b)=>a+Math.max(0,b.hp),0),mx=bosses.reduce((a,b)=>a+b.maxHp,0);
        $('bossName').textContent=bosses.length>1?`☠ 보스 ${bosses.length}기`:`☠ ${UNIT_DEFS[boss.type].label}`;
        $('bossFill').style.width=Math.max(0,hp/mx*100)+'%';
      }
      wb.classList.toggle('hidden',_waveActive&&!boss);
    }
    const cr=$('btnCastleRepair');
    if(cr) cr.disabled=_castleHp>=MAX_HP||_gp<CASTLE_REPAIR_COST;
    const t=_selTower();
    const up=$('btnTowerUp'),sell=$('btnTowerSell'),rp=$('btnTowerRepair');
    if(up){
      up.disabled=!t||t.lvl>=TOWER_MAX_LV||_gp<_towerUpCost(t);
      up.textContent=!t?'⬆️ 타워 업그레이드':t.lvl>=TOWER_MAX_LV?'⬆️ 최대 레벨':`⬆️ 업그레이드 ${_towerUpCost(t)}GP`;
      sell.disabled=!t; sell.textContent=t?`💰 판매 +${_towerSellValue(t)}GP`:'💰 타워 판매';
      rp.disabled=!t||!_towerRepairCost(t)||_gp<_towerRepairCost(t);
      rp.textContent=t&&_towerRepairCost(t)?`🔨 타워 수리 ${_towerRepairCost(t)}GP`:'🔨 타워 수리';
    }
  }
  const db2=$('btnDispatch');
  if(db2)db2.classList.toggle('active',_dispatchMode);
  // 선택 유닛 상태 표시 (HUD 우측 소형)
  const selEl=$('hudSelected');
  if(selEl) selEl.textContent=_selected.size>0?`${_selected.size} selected`:'';

  // 선택 유닛 배너 (캔버스 위 오버레이)
  const banner=$('unitBanner');
  if(banner){
    const first=_defenders.find(d=>d.selected&&!d.dying);
    if(first){
      const def=UNIT_DEFS[first.type]||{};
      const maxHp=def.hp||1;
      const hpPct=Math.max(0,Math.min(100,(first.hp/maxHp)*100));
      const hpColor=hpPct>50?'#22c55e':hpPct>25?'#f59e0b':'#ef4444';
      const mode=first.patrolMode?'🔄 Patrol':first.guardMode?'🛡 Guard':first.targetId?'⚔️ Attack':'🚶 Idle';
      const emoji=UNIT_EMOJI[first.type]||'👤';
      const extra=_selected.size>1?` +${_selected.size-1} more`:'';
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
    heroSkillBtn.textContent=`⚡ Hero Skill${cd}`;
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

// 유닛은 발(위치) 위로 크게 그려지므로(DR=5배) 몸통 중심을 기준으로 정밀하게 판정한다
function _bodyCenter(u){
  const dsz=u.size*(u.isTower?10/3:5);
  return [u.x, u.y-dsz*(0.5+(u.flying?0.25:0))];
}
const _pxToWorld=px=>px/Math.max(getScale(),0.05);
// 반경 안에서 '가장 가까운' 한 개만 고른다 (겹쳐 있어도 탭한 쪽이 선택됨)
function _pickNearest(list,wx,wy,radiusOf){
  let best=null,bd=Infinity;
  for(const u of list){
    if(u.dying) continue;
    const[bx,by]=_bodyCenter(u);
    const d=Math.hypot(wx-bx,wy-by);
    if(d<=radiusOf(u)&&d<bd){bd=d;best=u;}
  }
  return best;
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
  // 배치 모드에서는 반경을 더 좁혀서, 다른 유닛 바로 옆에도 정밀하게 놓을 수 있다
  const hit=_pickNearest(_defenders,wx,wy,_placing
    ? (u=>Math.max(u.size*0.45,_pxToWorld(12)))
    : (u=>Math.max(u.size*1.1,_pxToWorld(22))));
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
    if(isMapObstacle(wx,wy)){_showNotif('⛔ Cannot place on a building');return;}
    _gp-=cost;
    playSound('hit');
    _defenders.push(makeUnit(_placingType,wx,wy));
    revealFog(_fogGrid,wx,wy,80,_pois).forEach(_onDiscover);
    renderHUD();return;
  }

  // ── 우선순위 ③: 선택된 아군이 있을 때 ────────────────────────────────
  if(_selected.size>0){
    // 적 탭 → 공격 타겟 지정
    const enemy=_pickNearest(_monsters,wx,wy,m=>Math.max(m.size*1.2,_pxToWorld(26)));
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
    _freePlay=false;if(!(await deductEntry())){alert('Not enough GP');return;} startGame();
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
  $('btnCastleRepair')?.addEventListener('click',_repairCastle);
  $('btnTowerUp')?.addEventListener('click',_upgradeTower);
  $('btnTowerSell')?.addEventListener('click',()=>{_sellTower();_closeModal('commandModal');});
  $('btnTowerRepair')?.addEventListener('click',_repairTower);
  $('btnCallWave')?.addEventListener('click',_callWaveEarly);
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
