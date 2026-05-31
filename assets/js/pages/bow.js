// bow.js — 활쏘기 몬스터 사냥 미니게임
import { db, auth } from '/assets/js/firebase-init.js';
import { doc, getDoc, updateDoc, increment } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  LW, LH, AX, AY, ROWS,
  initBowRenderer, renderFrame, updateRenderer,
  addHitParticles, addArrowParticle, triggerShake,
} from './bow.render.js';

// ── 상수 ─────────────────────────────────────────────────────────────────────
const ENTRY_FEE = 100;
const GAME_TIME = 60;

// ── 스킬 정의 ────────────────────────────────────────────────────────────────
const SKILLS = {
  triple:    { name:'삼연시',   emoji:'🏹', mp:20, cd:4000, desc:'화살 3발 동시 발사' },
  fire:      { name:'화염시',   emoji:'🔥', mp:15, cd:5000, desc:'다음 화살 데미지 x2' },
  poison:    { name:'독화살',   emoji:'☠️',  mp:20, cd:6000, desc:'해당 줄 몬스터 3초 감속' },
  explode:   { name:'폭발화살', emoji:'💥', mp:25, cd:7000, desc:'범위 폭발 피해' },
  rapidfire: { name:'연사',     emoji:'⚡', mp:30, cd:9000, desc:'5초간 자동 연사' },
  pierce:    { name:'관통시',   emoji:'🪃', mp:20, cd:5000, desc:'화살이 같은 줄 관통' },
};

// ── 몬스터 정의 (HP ×3) ───────────────────────────────────────────────────────
const p3 = n => String(n).padStart(3,'0');
const MON_DEFS = {
  orc: {
    hp:6, pts:40,
    walk: Array.from({length:6},(_,i)=>`/assets/images/monsters/orc3/ORK_03_WALK_${p3(i)}.png`),
    hurt: Array.from({length:6},(_,i)=>`/assets/images/monsters/orc3/ORK_03_HURT_${p3(i)}.png`),
    die:  Array.from({length:6},(_,i)=>`/assets/images/monsters/orc3/ORK_03_DIE_${p3(i)}.png`),
  },
  pirate: {
    hp:3, pts:30,
    walk: Array.from({length:6},(_,i)=>`/assets/images/monsters/pirate3/3_3-PIRATE_WALK_${p3(i)}.png`),
    hurt: Array.from({length:6},(_,i)=>`/assets/images/monsters/pirate3/3_3-PIRATE_HURT_${p3(i)}.png`),
    die:  Array.from({length:6},(_,i)=>`/assets/images/monsters/pirate3/3_3-PIRATE_DIE_${p3(i)}.png`),
  },
  zombie: {
    hp:3, pts:25,
    walk: Array.from({length:8},(_,i)=>`/assets/images/monsters/zombie1/animation/Run${i+1}.png`),
    hurt: Array.from({length:5},(_,i)=>`/assets/images/monsters/zombie1/animation/Hurt${i+1}.png`),
    die:  Array.from({length:8},(_,i)=>`/assets/images/monsters/zombie1/animation/Dead${i+1}.png`),
  },
  dragon: {
    hp:9, pts:100,
    walk: Array.from({length:6},(_,i)=>`/assets/images/monsters/dragon/fly${p3(i)}.png`),
    hurt: Array.from({length:6},(_,i)=>`/assets/images/monsters/dragon/idle${p3(i)}.png`),
    die:  Array.from({length:6},(_,i)=>`/assets/images/monsters/dragon/attak${p3(i)}.png`),
  },
};
const MON_KEYS = ['orc','pirate','zombie','dragon'];

// ── 이미지 캐시 ──────────────────────────────────────────────────────────────
const _spr = {};
const _img = {};

async function loadAssets() {
  const ld = s => new Promise(r=>{ const i=new Image(); i.onload=()=>r(i); i.onerror=()=>r(null); i.src=s; });
  [_img.back,_img.user1,_img.user2] = await Promise.all([
    ld('/assets/images/bow/user/back.png'),
    ld('/assets/images/bow/user/1.png'),
    ld('/assets/images/bow/user/2.png'),
  ]);
  await Promise.all(Object.entries(MON_DEFS).flatMap(([key,def])=>
    ['walk','hurt','die'].map(async anim=>{
      _spr[`${key}_${anim}`]=await Promise.all(def[anim].map(ld));
    })
  ));
}

// ── Firebase ─────────────────────────────────────────────────────────────────
let _uid=null, _playerGP=0, _playerMP=1000, _playerMaxMP=1000;

async function loadPlayer() {
  if (!_uid) return;
  try {
    const d=(await getDoc(doc(db,'battle_players',_uid))).data()||{};
    _playerGP=d.gold||0; _playerMP=d.mp||1000; _playerMaxMP=_playerMP;
  } catch {}
  $('lobbyGP').textContent=_playerGP;
  $('btnEnter').disabled=_playerGP<ENTRY_FEE;
}

async function deductFee() {
  if (_playerGP<ENTRY_FEE) return false;
  try { await updateDoc(doc(db,'battle_players',_uid),{gold:increment(-ENTRY_FEE)}); _playerGP-=ENTRY_FEE; return true; }
  catch { return false; }
}

async function awardScore(score) {
  const gp=score>=4000?500:score>=2000?250:score>=1000?120:score>=500?50:0;
  if (gp>0&&_uid) try{ await updateDoc(doc(db,'battle_players',_uid),{gold:increment(gp)}); }catch{}
  return gp;
}

// ── 게임 상태 ────────────────────────────────────────────────────────────────
let _phase='loading';
let _score=0, _combo=0, _maxCombo=0, _comboTs=0;
let _timeLeft=GAME_TIME, _timerIv=null;
let _monsters=[], _arrows=[], _effects=[];
let _raf=null, _lastTs=0, _ts=0;
let _rowCount=new Array(ROWS.length).fill(0);
let _spawnNext=new Array(ROWS.length).fill(0);
let _fireMode=false, _pierceMode=false, _rapidUntil=0;
let _selectedSkills=[], _skillCd={};
let _lastShot=0, _lastAim=[LW/2,LH*.45];
let _shootTs=0;
let _ac=null;

const $ = id=>document.getElementById(id);

// ── 사운드 ───────────────────────────────────────────────────────────────────
function sfx(freq,type,dur,vol=0.18){
  try{
    if(!_ac) _ac=new(window.AudioContext||window.webkitAudioContext)();
    const o=_ac.createOscillator(),g=_ac.createGain();
    o.connect(g);g.connect(_ac.destination);
    o.type=type;o.frequency.value=freq;
    g.gain.setValueAtTime(vol,_ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,_ac.currentTime+dur);
    o.start();o.stop(_ac.currentTime+dur);
  }catch{}
}

// ── 몬스터 ───────────────────────────────────────────────────────────────────
function spawnMonster(ri) {
  const row=ROWS[ri];
  // row 0-1 = 하늘: 드래곤 전용 / row 2-4 = 지면: 지상 몬스터만
  const key = ri<=1 ? 'dragon' : ['orc','pirate','zombie'][Math.floor(Math.random()*3)];
  const def=MON_DEFS[key];
  _monsters.push({
    key, ri, x:row.dir===1?-68*row.sc:LW+68*row.sc, dir:row.dir,
    hp:def.hp, maxHp:def.hp,
    anim:'walk', frame:0, fTime:0, hurtLeft:0,
    dead:false, poisonUntil:0,
    id:Math.random()+Date.now(),
  });
  _rowCount[ri]++;
}

function updateMonsters(dt) {
  const now=Date.now();
  for (let r=0;r<ROWS.length;r++) {
    const maxInRow = r<=1 ? 1 : 2;   // 드래곤 열은 동시 1마리만
    if (_rowCount[r]<maxInRow && now>_spawnNext[r]) {
      spawnMonster(r);
      // 드래곤: 3~6초 간격 / 지상: 1~3초 간격
      _spawnNext[r] = now + (r<=1 ? 3000+Math.random()*3000 : 900+Math.random()*2000);
    }
  }
  for (let i=_monsters.length-1;i>=0;i--) {
    const m=_monsters[i];
    const row=ROWS[m.ri];
    const spd=(m.poisonUntil>now)?row.spd*.35:row.spd;
    if (m.dead) {
      m.fTime+=dt;
      if (m.fTime>105){ m.fTime=0; m.frame++;
        if (m.frame>=(_spr[`${m.key}_die`]?.length||6)){ _rowCount[m.ri]--; _monsters.splice(i,1); }
      }
    } else if (m.hurtLeft>0) {
      m.hurtLeft-=dt; m.fTime+=dt;
      if (m.fTime>85){ m.fTime=0; m.frame=(m.frame+1)%(_spr[`${m.key}_hurt`]?.length||6); }
      if (m.hurtLeft<=0){ m.frame=0; m.fTime=0; }
    } else {
      m.x+=m.dir*spd*(dt/16.67); m.fTime+=dt;
      if (m.fTime>115){ m.fTime=0; m.frame=(m.frame+1)%(_spr[`${m.key}_walk`]?.length||6); }
      const edge=100*row.sc;
      if ((m.dir===1&&m.x>LW+edge)||(m.dir===-1&&m.x<-edge)){ _rowCount[m.ri]--; _monsters.splice(i,1); }
    }
  }
}

// ── 화살 ─────────────────────────────────────────────────────────────────────
const ARROW_SPD = 9.5;

function createArrow(cx,cy,spread=0,fire=false,pierce=false,explode=false){
  const ang=Math.atan2(cy-AY,cx-AX)+spread;
  _arrows.push({
    x:AX, y:AY,
    vx:Math.cos(ang)*ARROW_SPD, vy:Math.sin(ang)*ARROW_SPD,
    fire, pierce, explode, dmg:fire?2:1,
    hitIds:new Set(), active:true,
  });
}

function updateArrows(dt){
  const r=dt/16.67;
  for (let i=_arrows.length-1;i>=0;i--){
    const a=_arrows[i];
    if(!a.active){_arrows.splice(i,1);continue;}
    a.x+=a.vx*r; a.y+=a.vy*r;
    addArrowParticle(a.x,a.y,a.fire,a.pierce);
    if(a.x<-25||a.x>LW+25||a.y<-25||a.y>LH+25) _arrows.splice(i,1);
  }
}

// ── 히트 감지 ────────────────────────────────────────────────────────────────
function checkHits(){
  const now=Date.now();
  for (const a of _arrows){
    if(!a.active) continue;
    for (const m of _monsters){
      if(m.dead||a.hitIds.has(m.id)) continue;
      const row=ROWS[m.ri], sc=row.sc, gy=row.yFr*LH;
      const isDragon=m.key==='dragon';
      const bh=(isDragon?80:49)*sc, bw=(isDragon?62:38)*sc;
      const my=gy-bh*.55;
      if(Math.abs(a.x-m.x)<bw*.52&&Math.abs(a.y-my)<bh*.52){
        a.hitIds.add(m.id);
        if(!a.pierce) a.active=false;
        const mult=1+Math.min(_combo,10)*.3;
        const pts=Math.round(row.pts*a.dmg*mult);
        m.hp-=a.dmg; _combo++; _comboTs=now; _score+=pts;
        if(_combo>_maxCombo) _maxCombo=_combo;
        _effects.push({type:'score',text:'+'+pts,x:m.x,y:gy-bh-8,vy:-1.2,alpha:1});
        // 콤보 5 배수: 특별 메시지
        if(_combo>1&&_combo%5===0)
          _effects.push({type:'msg',text:`🔥${_combo} COMBO!`,x:LW/2,y:LH*.38,vy:-.5,alpha:1.4,big:true});
        if(m.hp<=0){
          m.dead=true; m.frame=0; m.fTime=0;
          const isDragon=m.key==='dragon';
          addHitParticles(m.x,gy-bh*.55,true,isDragon);
          triggerShake(isDragon?12:6);
          _effects.push({type:'flash',x:m.x,y:gy-bh*.5,r:isDragon?75:42,alpha:1.0});
          _effects.push({type:'score',text:'💀KILL',x:m.x,y:gy-bh-24,vy:-1.8,alpha:1,big:false});
          if(a.explode){
            _monsters.forEach(nm=>{
              if(!nm.dead&&nm.id!==m.id&&nm.ri===m.ri&&Math.abs(nm.x-m.x)<110*sc){
                nm.hp-=a.dmg; if(nm.hp<=0){nm.dead=true;nm.frame=0;nm.fTime=0;_score+=row.pts;}
                else{nm.hurtLeft=430;nm.frame=0;}
              }
            });
            a.active=false;
          }
          sfx(isDragon?120:300,'sawtooth',.2,.25);
        } else {
          m.hurtLeft=450; m.frame=0; m.fTime=0;
          addHitParticles(m.x,gy-bh*.55,false);
          triggerShake(2);
          sfx(600,'sine',.09,.12);
        }
        if(!a.active) break;
      }
    }
  }
  if(_combo>0&&now-_comboTs>3000) _combo=0;
}

// ── 화살 발사 ────────────────────────────────────────────────────────────────
function fireArrow(cx,cy){
  const now=Date.now(); if(now-_lastShot<95) return;
  _lastShot=now; _lastAim=[cx,cy]; _shootTs=now;
  const fire=_fireMode; _fireMode=false;
  createArrow(cx,cy,0,fire,_pierceMode,false);
  sfx(fire?280:820,'sine',.055,.10);
  renderHUD();
}

// ── 스킬 ─────────────────────────────────────────────────────────────────────
function useSkill(id){
  const sk=SKILLS[id]; if(!sk||_playerMP<sk.mp||(_skillCd[id]||0)>Date.now()) return;
  _playerMP-=sk.mp; _skillCd[id]=Date.now()+sk.cd;
  const [cx,cy]=_lastAim, now=Date.now();
  switch(id){
    case 'triple':
      for(const s of [-0.18,0,0.18]) createArrow(cx,cy,s,_fireMode,_pierceMode,false);
      _fireMode=false; sfx(420,'sine',.07,.18);
      break;
    case 'fire':
      _fireMode=true;
      _effects.push({type:'msg',text:'🔥 화염시!',x:LW/2,y:LH*.38,vy:-.4,alpha:1.3,big:true});
      sfx(200,'sawtooth',.12,.2);
      break;
    case 'poison':{
      const ri=ROWS.reduce((b,r,i)=>Math.abs(r.yFr*LH-cy)<Math.abs(ROWS[b].yFr*LH-cy)?i:b,0);
      _monsters.filter(m=>m.ri===ri&&!m.dead).forEach(m=>{m.poisonUntil=now+3000;});
      _effects.push({type:'msg',text:'☠️ 독!',x:LW/2,y:ROWS[ri].yFr*LH,vy:-.5,alpha:1.2,big:false});
      sfx(140,'sine',.28,.14); break;
    }
    case 'explode':
      createArrow(cx,cy,0,false,false,true);
      _effects.push({type:'msg',text:'💥 폭발!',x:LW/2,y:LH*.38,vy:-.4,alpha:1.3,big:true});
      sfx(90,'sawtooth',.2,.2); break;
    case 'rapidfire':
      _rapidUntil=now+5000;
      _effects.push({type:'msg',text:'⚡ 연사!',x:LW/2,y:LH*.38,vy:-.4,alpha:1.3,big:true});
      sfx(520,'square',.07,.18); break;
    case 'pierce':
      _pierceMode=true; setTimeout(()=>{_pierceMode=false;},5000);
      _effects.push({type:'msg',text:'🪃 관통!',x:LW/2,y:LH*.38,vy:-.4,alpha:1.3,big:true});
      sfx(720,'sine',.09,.14); break;
  }
  renderHUD();
}

// ── HUD ──────────────────────────────────────────────────────────────────────
function renderHUD(){
  $('mpFill').style.width=(_playerMP/_playerMaxMP*100)+'%';
  $('scoreTxt').textContent='💰 '+_score.toLocaleString();
  const tEl=$('timerTxt'); tEl.textContent=_timeLeft;
  tEl.classList.toggle('urgent',_timeLeft<=10);
  const cBox=$('comboBox');
  if(_combo>=2){ cBox.style.display='block'; $('comboNum').textContent='×'+_combo; }
  else cBox.style.display='none';
  _selectedSkills.forEach((sk,i)=>{
    const btn=$(`skBtn${i}`); if(!btn) return;
    const cd=(_skillCd[sk]||0)-Date.now();
    btn.style.opacity=(cd>0||_playerMP<(SKILLS[sk]?.mp||0))?'.42':'1';
    btn.classList.toggle('on',(sk==='fire'&&_fireMode)||(sk==='pierce'&&_pierceMode)||(sk==='rapidfire'&&_rapidUntil>Date.now()));
    const cdEl=btn.querySelector('.cd');
    if(cdEl) cdEl.textContent=cd>0?Math.ceil(cd/1000)+'s':'';
  });
}

// ── 게임 루프 ────────────────────────────────────────────────────────────────
function loop(ts){
  _raf=requestAnimationFrame(loop);
  const dt=Math.min(50,ts-_lastTs); _lastTs=ts; _ts+=dt;
  if(_rapidUntil>Date.now()&&Date.now()-_lastShot>175) fireArrow(_lastAim[0],_lastAim[1]);
  updateMonsters(dt);
  updateArrows(dt);
  checkHits();
  updateRenderer(dt);
  renderFrame({
    imgs:_img, sprs:_spr,
    monsters:_monsters, arrows:_arrows, effects:_effects,
    aim:_lastAim, shootTs:_shootTs, ts:_ts,
    fireMode:_fireMode, pierceMode:_pierceMode, rapidUntil:_rapidUntil,
  });
  renderHUD();
}

// ── 타이머 / 종료 ─────────────────────────────────────────────────────────────
function startTimer(){
  _timeLeft=GAME_TIME;
  _timerIv=setInterval(()=>{ if(--_timeLeft<=0){ clearInterval(_timerIv); endGame(); } },1000);
}

async function endGame(){
  _phase='result'; cancelAnimationFrame(_raf); _raf=null;
  const gp=await awardScore(_score);
  $('resFinalScore').textContent=_score.toLocaleString()+'점';
  $('resGP').textContent=gp>0?`+${gp} GP 획득!`:'GP 없음 (500점 미달)';
  $('resInfo').textContent=`최고 콤보: ×${_maxCombo}`;
  showPhase('result');
}

// ── 캔버스 + 풀스크린 ────────────────────────────────────────────────────────
let _cssFs=false;

function resizeCanvas(){
  const canvas=$('bowCanvas'); if(!canvas) return;
  canvas.width=LW; canvas.height=LH;
  const isFull=!!document.fullscreenElement||!!document.webkitFullscreenElement||_cssFs;
  let cw,ch;
  if(isFull){
    const sw=window.innerWidth,sh=window.innerHeight;
    if(sh/sw>LH/LW){cw=sw;ch=Math.round(sw*LH/LW);}
    else{ch=sh;cw=Math.round(sh*LW/LH);}
  } else {
    cw=Math.min($('canvasWrap')?.clientWidth||window.innerWidth, LW*2);
    ch=Math.round(cw*LH/LW);
  }
  if(cw>0){canvas.style.width=cw+'px';canvas.style.height=ch+'px';}
  initBowRenderer(canvas);
}

function initFullscreen(){
  const btn=$('btnFs'),wrap=$('canvasWrap'),game=$('gameScreen'); if(!btn) return;
  btn.addEventListener('click',()=>{
    if(document.fullscreenElement){document.exitFullscreen?.();return;}
    if(_cssFs){_exitCssFs(btn,wrap,game);return;}
    const req=wrap?.requestFullscreen||wrap?.webkitRequestFullscreen;
    if(req) req.call(wrap).catch(()=>_enterCssFs(btn,wrap,game));
    else _enterCssFs(btn,wrap,game);
  });
  document.addEventListener('fullscreenchange',()=>{
    _syncFsBtn(btn,!!document.fullscreenElement); resizeCanvas();
  });
  document.addEventListener('webkitfullscreenchange',()=>{
    _syncFsBtn(btn,!!document.webkitFullscreenElement); resizeCanvas();
  });
}
function _enterCssFs(btn,wrap,game){
  _cssFs=true; document.body.style.overflow='hidden';
  if(game){game.style.position='fixed';game.style.inset='0';game.style.zIndex='9000';game.style.background='#050510';}
  if(wrap){wrap.style.maxWidth='none';wrap.style.width='100vw';wrap.style.height='100vh';wrap.style.display='flex';wrap.style.alignItems='center';wrap.style.justifyContent='center';}
  _syncFsBtn(btn,true); resizeCanvas();
}
function _exitCssFs(btn,wrap,game){
  _cssFs=false; document.body.style.overflow='';
  if(game){game.style.position='';game.style.inset='';game.style.zIndex='';game.style.background='';}
  if(wrap){wrap.style.maxWidth='';wrap.style.width='';wrap.style.height='';wrap.style.display='';wrap.style.alignItems='';wrap.style.justifyContent='';}
  _syncFsBtn(btn,false); resizeCanvas();
}
function _syncFsBtn(btn,full){btn.textContent=full?'⤡':'⤢';btn.title=full?'화면 축소':'전체 화면';}

// ── 입력 ─────────────────────────────────────────────────────────────────────
function initInput(){
  const canvas=$('bowCanvas');
  const pos=e=>{const r=canvas.getBoundingClientRect();return[(e.clientX-r.left)*(LW/r.width),(e.clientY-r.top)*(LH/r.height)];};
  canvas.addEventListener('click',e=>{if(_phase!=='game')return;const[cx,cy]=pos(e);_lastAim=[cx,cy];fireArrow(cx,cy);});
  canvas.addEventListener('touchstart',e=>{
    if(_phase!=='game')return; e.preventDefault();
    for(const t of e.changedTouches){const[cx,cy]=pos({clientX:t.clientX,clientY:t.clientY});_lastAim=[cx,cy];fireArrow(cx,cy);}
  },{passive:false});
  canvas.addEventListener('touchmove',e=>{
    if(_phase!=='game')return; e.preventDefault();
    const t=e.changedTouches[0]; _lastAim=pos({clientX:t.clientX,clientY:t.clientY});
  },{passive:false});
  canvas.addEventListener('mousemove',e=>{if(_phase!=='game')return;_lastAim=pos(e);});
  document.addEventListener('touchmove',e=>e.preventDefault(),{passive:false});
}

// ── 스킬 그리드 / 바 ─────────────────────────────────────────────────────────
function renderSkillGrid(){
  const grid=$('skillGrid'); if(!grid) return;
  grid.innerHTML='';
  Object.entries(SKILLS).forEach(([id,sk])=>{
    const btn=document.createElement('button');
    btn.className='sp-btn'; btn.dataset.id=id;
    btn.innerHTML=`<span class="sp-emoji">${sk.emoji}</span><div class="sp-name">${sk.name}</div><div class="sp-mp">MP ${sk.mp}</div><div class="sp-desc">${sk.desc}</div>`;
    btn.addEventListener('click',()=>{
      if(_selectedSkills.includes(id)){_selectedSkills=_selectedSkills.filter(s=>s!==id);btn.classList.remove('sel');}
      else if(_selectedSkills.length<3){_selectedSkills.push(id);btn.classList.add('sel');}
      $('skCount').textContent=`${_selectedSkills.length}/3 선택`;
      $('skConfirm').disabled=_selectedSkills.length<1;
    });
    grid.appendChild(btn);
  });
}

function buildSkillBar(){
  const bar=$('skillBar'); if(!bar) return;
  bar.innerHTML='';
  _selectedSkills.forEach((sk,i)=>{
    const s=SKILLS[sk]; if(!s) return;
    const btn=document.createElement('button');
    btn.id=`skBtn${i}`; btn.className='sk-btn';
    btn.innerHTML=`${s.emoji}<small>${s.name}</small><span class="cd"></span>`;
    btn.addEventListener('click',()=>useSkill(sk));
    bar.appendChild(btn);
  });
}

// ── 카운트다운 / 시작 ─────────────────────────────────────────────────────────
function startCountdown(){
  if(!_selectedSkills.length) _selectedSkills=['triple','fire','rapidfire'];
  _score=0;_combo=0;_maxCombo=0;_comboTs=0;
  _monsters=[];_arrows=[];_effects=[];
  _rowCount=new Array(ROWS.length).fill(0);
  _spawnNext=new Array(ROWS.length).fill(0);
  _fireMode=false;_pierceMode=false;_rapidUntil=0;_skillCd={};_playerMP=_playerMaxMP;
  showPhase('countdown');
  let n=3; $('cdNum').textContent=n;
  const iv=setInterval(()=>{
    n--; if(n>0){$('cdNum').textContent=n;}
    else{$('cdNum').textContent='GO!';clearInterval(iv);setTimeout(startGame,500);}
  },1000);
}

function startGame(){
  showPhase('game');
  requestAnimationFrame(()=>{
    resizeCanvas(); buildSkillBar();
    _lastTs=performance.now(); _ts=0;
    _raf=requestAnimationFrame(loop);
    startTimer();
    $('bowCanvas').focus();
  });
}

// ── 화면 전환 ─────────────────────────────────────────────────────────────────
const SCREENS=['loading','lobby','skill','countdown','game','result'];
function showPhase(name){
  SCREENS.forEach(s=>$(`${s}Screen`)?.classList.add('hidden'));
  $(`${name}Screen`)?.classList.remove('hidden');
  _phase=name;
}

// ── 초기화 ───────────────────────────────────────────────────────────────────
async function init(){
  showPhase('loading');
  initInput(); initFullscreen();
  window.addEventListener('resize',resizeCanvas); resizeCanvas();
  await loadAssets();
  $('btnEnter')?.addEventListener('click',async()=>{
    if(!_uid){alert('로그인이 필요합니다');return;}
    if(!await deductFee()){alert('GP가 부족합니다 (100 GP 필요)');return;}
    _selectedSkills=[];renderSkillGrid();$('skCount').textContent='0/3 선택';$('skConfirm').disabled=true;showPhase('skill');
  });
  $('skConfirm')?.addEventListener('click',startCountdown);
  $('btnRestart')?.addEventListener('click',()=>location.reload());
  onAuthStateChanged(auth,async user=>{_uid=user?.uid||null;await loadPlayer();showPhase('lobby');});
}
init();
