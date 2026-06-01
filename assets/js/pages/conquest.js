// conquest.js — Monster Frontier 메인 (10km 월드·안개탐험·카메라팬)
import { db, auth } from '/assets/js/firebase-init.js';
import { doc, getDoc, updateDoc, increment } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  initCamera, resizeCamera, screenToWorld, panBy, zoomBy, moveCamTo,
  makeFogGrid, revealFog, generatePOIs, addRevealAnim, updateRevealAnims,
  drawMinimap, minimapHit, CASTLE_WX, CASTLE_WY, POI_DEFS,
} from './conquest.world.js';
import { initRenderer, loadMapAssets, renderScene } from './conquest.render.js';
import { UNIT_DEFS, loadSprites, makeUnit, updateUnit, MINES, CASTLE_WALL } from './conquest.units.js';

// ── 상수 ─────────────────────────────────────────────────────────────────
const ENTRY_FEE  = 100;
const START_GP   = 300;
const MINE_RATE  = 3000;
const PREP_TIME  = 15000;
const MAX_HP     = 1000;
const SPAWN_R    = 470;  // 성 중심에서 스폰 반경

const WAVES = [
  [{type:'orc',  count:12,side:'rand'}],
  [{type:'orc',  count:10,side:'rand'},{type:'orc2',  count:8, side:'rand'}],
  [{type:'orc2', count:18,side:'all'}],
  [{type:'orc',  count:10,side:'rand'},{type:'zombie', count:12,side:'rand'}],
  [{type:'orc2', count:15,side:'all'}, {type:'zombie', count:10,side:'rand'}],
  [{type:'zombie',count:20,side:'all'},{type:'pirate', count:8, side:'rand'}],
  [{type:'pirate',count:28,side:'all'}],
];

// ── 상태 ─────────────────────────────────────────────────────────────────
let _uid=null,_playerGP=0,_freePlay=false;
let _phase='loading';
let _wave=0,_castleHp=MAX_HP,_gp=START_GP;
let _defenders=[],_monsters=[],_fogGrid=null,_pois=[];
let _prepTimer=PREP_TIME,_mineTimer=0,_spawnQ=[],_spawnTimer=0,_waveActive=false;
let _sprites=null,_raf=null,_lastTs=0;
let _placingType='villager',_placing=false,_selected=new Set();
let _dispatchMode=false; // 정찰 파견 모드

// 카메라 드래그
let _drag=null;
// 핀치 줌
let _pinch=null;

const $=id=>document.getElementById(id);

// ── 화면 전환 ─────────────────────────────────────────────────────────────
function showPhase(n){
  ['loading','lobby','game','gameover'].forEach(p=>$(`${p}Screen`)?.classList.add('hidden'));
  $(`${n}Screen`)?.classList.remove('hidden');
  _phase=n;
}

// ── Firebase ──────────────────────────────────────────────────────────────
async function loadPlayer(){
  if(!_uid){renderLobby();return;}
  try{const s=await getDoc(doc(db,'battle_players',_uid));if(s.exists())_playerGP=s.data().gold||0;}catch{}
  renderLobby();
}
function renderLobby(){
  const el=$('lobbyGP');if(el)el.textContent=_uid?`${_playerGP} GP`:'게스트';
  const btn=$('btnPlay');if(btn)btn.disabled=_uid&&_playerGP<ENTRY_FEE;
  showPhase('lobby');
}
async function deductEntry(){
  if(_freePlay||!_uid)return true;
  if(_playerGP<ENTRY_FEE)return false;
  try{await updateDoc(doc(db,'battle_players',_uid),{gold:increment(-ENTRY_FEE)});_playerGP-=ENTRY_FEE;return true;}catch{return false;}
}
async function awardGP(n){if(!_uid||_freePlay)return;try{await updateDoc(doc(db,'battle_players',_uid),{gold:increment(n)});}catch{}}

// ── 게임 시작 / 종료 ─────────────────────────────────────────────────────
function startGame(){
  _wave=0;_castleHp=MAX_HP;_gp=START_GP;
  _defenders=[];_monsters=[];_spawnQ=[];
  _fogGrid=makeFogGrid(); _pois=generatePOIs();
  _prepTimer=PREP_TIME;_mineTimer=0;_spawnTimer=0;_waveActive=false;
  _selected=new Set();_placing=false;_dispatchMode=false;
  moveCamTo(CASTLE_WX,CASTLE_WY);
  showPhase('game'); _resizeCanvas();
  renderHUD(); _lastTs=performance.now();
  _raf=requestAnimationFrame(_loop);
}
async function endGame(won){
  cancelAnimationFrame(_raf);
  const reward=won&&!_freePlay?Math.floor(150+_wave*40):0;
  if(won&&reward>0)await awardGP(reward);
  const el=$('gameResult');
  if(el)el.innerHTML=won
    ?`<div style="font-size:26px;color:#fbbf24">승리!</div><div>${_wave}웨이브 클리어</div><div style="color:#22c55e;font-size:18px">+${reward} GP</div>`
    :`<div style="font-size:26px;color:#ef4444">게임오버</div><div style="color:#9ca3af">성이 함락되었습니다</div>`;
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
    fogGrid:_fogGrid,pois:_pois,
    prepCountdown:_prepTimer,wave:_waveActive,phase:_phase,
  },_sprites);
}

function _update(dt){
  _mineTimer+=dt;
  if(_mineTimer>=MINE_RATE){_mineTimer-=MINE_RATE;_addGP(5);}

  if(!_waveActive){_prepTimer-=dt;if(_prepTimer<=0)_startWave();renderHUD();return;}

  if(_spawnQ.length){_spawnTimer-=dt;if(_spawnTimer<=0){_spawnTimer=360;const s=_spawnQ.shift();_monsters.push(makeUnit(s.type,s.x,s.y));}}

  for(let i=_defenders.length-1;i>=0;i--){
    const dead=updateUnit(_defenders[i],_defenders,_monsters,dt);
    for(const ev of _defenders[i].events||[])if(ev.type==='addGP')_addGP(ev.amount);
    if(dead){_selected.delete(_defenders[i].id);_defenders.splice(i,1);}
  }
  for(let i=_monsters.length-1;i>=0;i--){
    const dead=updateUnit(_monsters[i],_defenders,_monsters,dt);
    if(dead)_monsters.splice(i,1);
  }

  // 수비대·정찰대 주변 안개 해제
  for(const d of _defenders){
    if(d.type==='scout')revealFog(_fogGrid,d.x,d.y,120,_pois).forEach(_onDiscover);
    else revealFog(_fogGrid,d.x,d.y,70,_pois).forEach(_onDiscover);
  }

  // 몬스터 성 내부 데미지
  for(let i=_monsters.length-1;i>=0;i--){
    const m=_monsters[i];if(m.dying||!m.insideCastle)continue;
    if(Math.hypot(m.x-CASTLE_WX,m.y-CASTLE_WY)<38){
      _castleHp-=m.atk*0.05;m.hp=-999;m.dying=true;m.dyingTimer=600;m.animState='die';
    }
  }

  updateRevealAnims(dt);
  if(_castleHp<=0){endGame(false);return;}
  if(_waveActive&&_monsters.length===0&&_spawnQ.length===0){
    _waveActive=false;_prepTimer=PREP_TIME;_addGP(60+_wave*25);
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
  item.className='notif-item';
  item.textContent=msg;
  el.prepend(item);
  setTimeout(()=>item.remove(),3500);
}

// ── 웨이브 ────────────────────────────────────────────────────────────────
function _startWave(){
  _waveActive=true;
  const def=WAVES[Math.min(_wave,WAVES.length-1)];
  const scale=1+_wave*0.28;
  def.forEach(g=>{
    for(let i=0;i<Math.ceil(g.count*scale);i++)
      _spawnQ.push({type:g.type,..._randEdge(g.side)});
  });
  _spawnQ.sort(()=>Math.random()-.5);
  _spawnTimer=0;_wave++;renderHUD();
}
function _randEdge(side){
  const sides=['top','bot','lft','rgt'];
  const s=side==='rand'?sides[Math.floor(Math.random()*4)]:side==='all'?sides[(_spawnQ.length)%4]:side;
  const m=20;
  if(s==='top') return{x:CASTLE_WX-SPAWN_R+m+Math.random()*(SPAWN_R*2-m*2),y:CASTLE_WY-SPAWN_R+m};
  if(s==='bot') return{x:CASTLE_WX-SPAWN_R+m+Math.random()*(SPAWN_R*2-m*2),y:CASTLE_WY+SPAWN_R-m};
  if(s==='lft') return{x:CASTLE_WX-SPAWN_R+m,y:CASTLE_WY-SPAWN_R+m+Math.random()*(SPAWN_R*2-m*2)};
                return{x:CASTLE_WX+SPAWN_R-m,y:CASTLE_WY-SPAWN_R+m+Math.random()*(SPAWN_R*2-m*2)};
}

function _addGP(n){_gp+=n;}

// ── HUD ──────────────────────────────────────────────────────────────────
function renderHUD(){
  if($('hudWave'))  $('hudWave').textContent  =`웨이브 ${_wave}`;
  if($('hudGP'))    $('hudGP').textContent    =`💰 ${Math.floor(_gp)}`;
  if($('hudCastle'))$('hudCastle').textContent=`🏰 ${Math.max(0,Math.ceil(_castleHp))}`;
  if($('hudPrep'))  $('hudPrep').textContent  =_waveActive?`웨이브 ${_wave} 진행`:_prepTimer>0?`${Math.ceil(_prepTimer/1000)}s`:'';
  ['villager','miner','scout'].forEach(t=>{
    const btn=$(`btn_${t}`);if(!btn)return;
    btn.disabled=_gp<(UNIT_DEFS[t]?.cost||50);
    btn.classList.toggle('active',_placing&&_placingType===t);
  });
  const db2=$('btnDispatch');
  if(db2)db2.classList.toggle('active',_dispatchMode);
  if($('hudSelected'))$('hudSelected').textContent=_selected.size>0?`${_selected.size}명 선택`:'';
}

// ── 입력: 캔버스 터치/마우스 ─────────────────────────────────────────────
function _onTouchStart(e){
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
  if(Math.hypot(dx,dy)>6)_drag.moved=true;
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

  // 미니맵 클릭
  const mm=minimapHit(sx,sy,cv.width,cv.height);
  if(mm){moveCamTo(mm.wx,mm.wy);return;}

  const[wx,wy]=screenToWorld(sx,sy);
  if(wx<0||wx>10000||wy<0||wy>10000)return;

  // 정찰 파견 모드
  if(_dispatchMode){
    const cost=UNIT_DEFS.scout.cost;
    if(_gp<cost)return;
    _gp-=cost;
    const scout=makeUnit('scout',CASTLE_WX,CASTLE_WY);
    scout.cmdX=wx;scout.cmdY=wy;
    _defenders.push(scout);
    // 목적지 도착 시 안개 대량 해제
    scout._revealTarget={wx,wy,r:200};
    addRevealAnim(wx,wy,200);
    renderHUD();return;
  }

  // 유닛 선택
  const hit=_defenders.find(u=>!u.dying&&Math.hypot(wx-u.x,wy-u.y)<u.size*.6);
  if(hit){
    if(!e?.shiftKey)_selected.clear();
    if(_selected.has(hit.id))_selected.delete(hit.id);else _selected.add(hit.id);
    _defenders.forEach(d=>d.selected=_selected.has(d.id));
    renderHUD();return;
  }

  // 선택된 유닛 이동 명령
  if(_selected.size>0){
    _defenders.forEach(d=>{if(d.selected){d.cmdX=wx;d.cmdY=wy;}});
    return;
  }

  // 유닛 배치
  if(_placing){
    const cost=UNIT_DEFS[_placingType]?.cost||50;
    if(_gp<cost)return;
    if(Math.hypot(wx-CASTLE_WX,wy-CASTLE_WY)<45)return;
    _gp-=cost;
    _defenders.push(makeUnit(_placingType,wx,wy));
    revealFog(_fogGrid,wx,wy,80,_pois).forEach(_onDiscover);
    renderHUD();
  }
}

// ── 마우스 휠 줌 ─────────────────────────────────────────────────────────
function _onWheel(e){
  e.preventDefault();
  zoomBy(e.deltaY<0?1.15:0.87);
}

// ── 정찰대 목적지 도착 체크 ───────────────────────────────────────────────
function _checkScoutArrival(dt){
  for(const d of _defenders){
    if(d.type!=='scout'||!d._revealTarget)continue;
    const t=d._revealTarget;
    if(d.cmdX===null&&d.cmdY===null){
      const disc=revealFog(_fogGrid,t.wx,t.wy,t.r,_pois);
      disc.forEach(_onDiscover);
      addRevealAnim(t.wx,t.wy,t.r);
      d._revealTarget=null;
    }
  }
}

// ── 캔버스 ───────────────────────────────────────────────────────────────
function _resizeCanvas(){
  const cv=$('gameCanvas');
  const topH=$('gameTop')?.offsetHeight||44;
  const botH=$('gameBot')?.offsetHeight||88;
  cv.width=window.innerWidth;
  cv.height=window.innerHeight-topH-botH;
  initRenderer(cv); initCamera(cv); resizeCamera(cv.width,cv.height);
}

function _setPlacing(type){
  if(_placing&&_placingType===type){_placing=false;}
  else{_placing=true;_placingType=type;_dispatchMode=false;_selected.clear();_defenders.forEach(d=>d.selected=false);}
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

  ['villager','miner','scout'].forEach(t=>$(`btn_${t}`)?.addEventListener('click',()=>_setPlacing(t)));

  $('btnDispatch')?.addEventListener('click',()=>{
    _dispatchMode=!_dispatchMode;_placing=false;_selected.clear();_defenders.forEach(d=>d.selected=false);renderHUD();
  });
  $('btnDeselect')?.addEventListener('click',()=>{
    _selected.clear();_defenders.forEach(d=>d.selected=false);_placing=false;_dispatchMode=false;renderHUD();
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

  onAuthStateChanged(auth,async user=>{_uid=user?.uid||null;await loadPlayer();});
}

init();
