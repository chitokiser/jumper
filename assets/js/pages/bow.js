// bow.js — 활쏘기 몬스터 사냥 미니게임
import { db, auth, functions } from '/assets/js/firebase-init.js';
import { esc } from '/assets/js/esc.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  LW, LH, AX, AY, ROWS,
  initBowRenderer, renderFrame, updateRenderer,
  addHitParticles, addArrowParticle, triggerShake,
} from './bow.render.js';
import { playSound } from './merchants.battle.js';

// ── 상수 ─────────────────────────────────────────────────────────────────────
const BASE_FEE      = 100;
const FEE_STEP      = 50;
const RESET_MS      = 24 * 60 * 60 * 1000;
const GAME_KEY      = 'bowEntry';
const GAME_TIME     = 60;
const MISS_PENALTY  = 15;   // 빗나간 화살 1발당 감점 (명중한 화살은 패널티 없음)

// ── 참가비 상태 ───────────────────────────────────────────────────────────────
let _entryFee     = BASE_FEE;
let _entryCount   = 0;
let _entryResetAt = 0;

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
    hp:18, pts:40,
    walk: Array.from({length:6},(_,i)=>`/assets/images/monsters/orc3/ORK_03_WALK_${p3(i)}.png`),
    hurt: Array.from({length:6},(_,i)=>`/assets/images/monsters/orc3/ORK_03_HURT_${p3(i)}.png`),
    die:  Array.from({length:6},(_,i)=>`/assets/images/monsters/orc3/ORK_03_DIE_${p3(i)}.png`),
  },
  pirate: {
    hp:9, pts:30,
    walk: Array.from({length:6},(_,i)=>`/assets/images/monsters/pirate3/3_3-PIRATE_WALK_${p3(i)}.png`),
    hurt: Array.from({length:6},(_,i)=>`/assets/images/monsters/pirate3/3_3-PIRATE_HURT_${p3(i)}.png`),
    die:  Array.from({length:6},(_,i)=>`/assets/images/monsters/pirate3/3_3-PIRATE_DIE_${p3(i)}.png`),
  },
  zombie: {
    hp:9, pts:25,
    walk: Array.from({length:8},(_,i)=>`/assets/images/monsters/zombie1/animation/Run${i+1}.png`),
    hurt: Array.from({length:5},(_,i)=>`/assets/images/monsters/zombie1/animation/Hurt${i+1}.png`),
    die:  Array.from({length:8},(_,i)=>`/assets/images/monsters/zombie1/animation/Dead${i+1}.png`),
  },
  dragon: {
    hp:27, pts:100,
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
  [_img.back,_img.user1,_img.user2,_img.tower,_img.tower2] = await Promise.all([
    ld('/assets/images/bow/user/back.png'),
    ld('/assets/images/bow/user/1.png'),
    ld('/assets/images/bow/user/2.png'),
    ld('/assets/images/shops/tower.png'),
    ld('/assets/images/shops/tower2.png'),
  ]);
  await Promise.all(Object.entries(MON_DEFS).flatMap(([key,def])=>
    ['walk','hurt','die'].map(async anim=>{
      _spr[`${key}_${anim}`]=await Promise.all(def[anim].map(ld));
    })
  ));
}

// ── Firebase ─────────────────────────────────────────────────────────────────
let _uid=null, _playerGP=0, _playerMP=1000, _playerMaxMP=1000;
let _playerHP=1000, _playerMaxHP=1000, _playerAttack=50, _playerDefense=0;
let _freeMode=false;

async function loadPlayer() {
  if (!_uid) {
    $('lobbyGP').textContent = '게스트';
    $('btnEnter').disabled = false;
    _updateFeeDisplay();
    return;
  }
  try {
    const d=(await getDoc(doc(db,'battle_players',_uid))).data()||{};
    _playerGP    = d.gold||0;
    _playerMP    = d.mp||1000;   _playerMaxMP = d.maxMp||_playerMP;
    _playerHP    = d.hp||1000;   _playerMaxHP = d.maxHp||_playerHP;
    _playerAttack= d.attack||50; _playerDefense= d.defense||0;

    const entry = d[GAME_KEY] || {};
    const now = Date.now();
    // Firestore Timestamp → ms 변환 (서버 저장값이 Timestamp일 수 있음)
    const resetAtMs = entry.resetAt?.toMillis?.() ?? (typeof entry.resetAt === 'number' ? entry.resetAt : 0);
    if (!resetAtMs || now - resetAtMs > RESET_MS) {
      _entryCount = 0; _entryResetAt = 0;
    } else {
      _entryCount = entry.count || 0; _entryResetAt = resetAtMs;
    }
    _entryFee = BASE_FEE + _entryCount * FEE_STEP;
  } catch {}
  $('lobbyGP').textContent = _playerGP;
  _updateFeeDisplay();
  $('btnEnter').disabled = _playerGP < _entryFee;
}

function _updateFeeDisplay() {
  const badge = $('feeBadge');
  if (badge) badge.textContent = `참가비: ${_entryFee} GP`;
  const info = $('feeInfo');
  if (!info) return;
  if (!_entryCount) {
    info.textContent = '오늘 첫 참가 · 24시간 후 자동 리셋';
  } else {
    const h = Math.ceil((_entryResetAt + RESET_MS - Date.now()) / 3_600_000);
    info.textContent = `오늘 ${_entryCount}번째 참가 · ${h}시간 후 100GP 리셋`;
  }
}

function arrowDmg(fire=false) {
  // 보물찾기 DB 공격력 기반: attack/10을 기본 데미지로, 최소 1
  const base = Math.max(1, Math.ceil(_playerAttack / 10));
  return fire ? base * 2 : base;
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

async function awardScore(score) {
  const gp = Math.floor(score / 10);
  if (_freeMode || gp <= 0 || !_uid) return 0;
  try {
    await httpsCallable(functions, 'claimGameReward')({ gameType: 'bow', amount: gp });
    if (gp >= 50) httpsCallable(functions, 'broadcastGpEvent')({ game: 'archery', amount: gp }).catch(() => {});
  } catch {}
  return gp;
}

// ── 게임 상태 ────────────────────────────────────────────────────────────────
let _phase='loading';
let _score=0, _combo=0, _maxCombo=0, _comboTs=0;
let _arrowsFired=0, _arrowsHit=0, _killCount=0;
let _timeLeft=GAME_TIME, _timerIv=null;
let _monsters=[], _arrows=[], _effects=[];
let _raf=null, _lastTs=0, _ts=0;
let _rowCount=new Array(ROWS.length).fill(0);
let _spawnNext=new Array(ROWS.length).fill(0);
let _fireMode=false, _pierceMode=false, _rapidUntil=0;
let _selectedSkills=[], _skillCd={};
let _lastShot=0, _lastAim=[LW/2,LH*.45];
let _shootTs=0;

// 플레이어 이동 + 피격
let _playerX = LW/2;  // 현재 X 위치 (이동 가능)
let _hitFlash = 0;    // 피격 시각 효과 (0→1)

// 대포 시스템
const CANNON_Y_FR = 0.45;  // 산봉우리 레벨 (back.png 좌우 소봉 기준)
const _cannons = [
  { x:14,      nextFire:5000, firing:0 },
  { x:LW-14,   nextFire:8500, firing:0 },
];
let _cannonballs = [];

const $ = id=>document.getElementById(id);

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
const ARROW_T_SPEED = 0.032; // t 증가속도 (1프레임당, ~520ms 비행)

function createArrow(cx,cy,spread=0,fire=false,pierce=false,explode=false){
  const spreadX = spread * 120; // 각도 → 화면 픽셀 좌우 퍼짐
  const initDx = cx - _playerX, initDy = cy - AY;
  const initLen = Math.sqrt(initDx*initDx + initDy*initDy) || 1;
  _arrows.push({
    t: 0, dt: ARROW_T_SPEED,
    startX: _playerX, startY: AY,
    aimX: cx + spreadX, aimY: cy,
    x: _playerX, y: AY, sc: 1.0,
    vx: initDx / initLen, vy: initDy / initLen,
    trail: [],
    fire, pierce, explode, dmg: arrowDmg(fire),
    hitIds: new Set(), active: true, didHit: false,
  });
}

// ── 대포 시스템 ────────────────────────────────────────────────────────────────
function updateCannons(dt) {
  for (const c of _cannons) {
    c.nextFire-=dt;
    if (c.firing>0) c.firing=Math.max(0,c.firing-dt*0.004);
    if (c.nextFire<=0 && _phase==='game') {
      _fireCannonball(c);
      c.nextFire = 3200+Math.random()*3000;
      c.firing = 1.0;
    }
  }

  const horizonY = CANNON_Y_FR*LH;
  const groundY  = AY - 15;

  for (let i=_cannonballs.length-1;i>=0;i--) {
    const cb=_cannonballs[i];
    if (cb.exploding) {
      cb.explodeT+=dt;
      if (cb.explodeT>700) _cannonballs.splice(i,1);
      continue;
    }
    cb.elapsed+=dt;
    cb.t = Math.min(1, cb.elapsed/cb.duration);

    // 포물선 궤도: 지평선→위쪽 호→착탄 지점
    cb.x = cb.sx + (cb.tx-cb.sx)*cb.t;
    cb.y = horizonY + (groundY-horizonY)*cb.t - 85*Math.sin(cb.t*Math.PI);
    cb.r = 3 + 26*cb.t;  // 반경 3→29

    // 착탄 경고 (HUD)
    if (cb.t>0.5) $('cannonWarning')?.classList.add('alert');

    if (cb.t>=1) {
      $('cannonWarning')?.classList.remove('alert');
      // 피해 판정: 착탄점에서 플레이어 거리 기반
      const dist=Math.abs(_playerX-cb.tx);
      const hitR=62;
      if (dist<hitR) {
        const ratio=1-dist/hitR;
        const dmg=Math.round(_playerMaxHP*0.10*ratio);
        if(dmg>0) _takeDamage(dmg);
      }
      // 폭발 전환
      cb.exploding=true; cb.explodeT=0;
      addHitParticles(cb.tx, groundY, true, false);
      triggerShake(7);
      playSound('cannon_hit');
    }
  }
}

function _fireCannonball(cannon) {
  const spread = 28+Math.random()*45;
  const dir    = Math.random()>0.5?1:-1;
  const tx     = Math.max(35, Math.min(LW-35, _playerX + dir*spread*(Math.random()>0.5?1:0.2)));
  _cannonballs.push({
    sx:cannon.x, tx,
    t:0, elapsed:0, duration:2400+Math.random()*700,
    x:cannon.x, y:CANNON_Y_FR*LH, r:3,
    exploding:false, explodeT:0, maxR:29,
  });
  playSound('cannon_shot');
}

function _takeDamage(amount) {
  const reduced=Math.max(1, amount - Math.floor(_playerDefense*0.5));
  _playerHP=Math.max(0, _playerHP-reduced);
  _hitFlash=1.0;
  _effects.push({type:'msg',text:`💥-${reduced}`,x:_playerX,y:AY-115,vy:-.9,alpha:1.3,big:false});
  triggerShake(4);
  playSound('player_hit');
  if (_playerHP<=0) setTimeout(gameOver,350);
}

function updateArrows(dt){
  const r=dt/16.67;
  for (let i=_arrows.length-1;i>=0;i--){
    const a=_arrows[i];
    if(!a.active){_arrows.splice(i,1);continue;}

    a.t = Math.min(1, a.t + r * a.dt);

    // 원근 위치: t^1.5 ease-in → 출발 느리고 멀어질수록 가속
    const pT = Math.pow(a.t, 1.5);
    a.x = a.startX + (a.aimX - a.startX) * pT;
    a.y = a.startY + (a.aimY - a.startY) * pT;

    // 원근 스케일: 1.0 → 0.08
    a.sc = Math.max(0.08, 1.0 - 0.92 * a.t);

    // 방향 벡터 (t^1.5 미분 = 1.5*t^0.5 방향)
    const dPT = 1.5 * Math.sqrt(Math.max(0.01, a.t));
    a.vx = dPT * (a.aimX - a.startX);
    a.vy = dPT * (a.aimY - a.startY);

    // 잔상 트레일 저장
    a.trail.unshift({x: a.x, y: a.y, sc: a.sc});
    if(a.trail.length > 10) a.trail.pop();

    addArrowParticle(a.x, a.y, a.fire, a.pierce, a.sc);

    if(a.t >= 1) a.active = false;
    if(a.x < -30 || a.x > LW+30 || a.y < -30) a.active = false;
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
        // 명중 추적 (화살당 최초 1회만)
        if(!a.didHit){ a.didHit=true; _arrowsHit++; }
        // 공격력 곱 제거: row.pts × 콤보배율만 사용
        const mult=1+Math.min(_combo,15)*.15;
        const pts=Math.round(row.pts*mult);
        m.hp-=a.dmg; _combo++; _comboTs=now; _score+=pts;
        if(_combo>_maxCombo) _maxCombo=_combo;
        _effects.push({type:'score',text:'+'+pts,x:m.x,y:gy-bh-8,vy:-1.2,alpha:1});
        // 콤보 5 배수: 특별 메시지
        if(_combo>1&&_combo%5===0)
          _effects.push({type:'msg',text:`🔥${_combo} COMBO!`,x:LW/2,y:LH*.38,vy:-.5,alpha:1.4,big:true});
        if(m.hp<=0){
          m.dead=true; m.frame=0; m.fTime=0; _killCount++;
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
          playSound(isDragon?'monster_atk_dragon':'monster_die');
        } else {
          m.hurtLeft=450; m.frame=0; m.fTime=0;
          addHitParticles(m.x,gy-bh*.55,false);
          triggerShake(2);
          playSound('arrow_hit');
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
  _arrowsFired++;
  triggerShake(3); // 발사 반동
  playSound('arrow_shot');
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
      _arrowsFired+=3; _fireMode=false; playSound('arrow_shot');
      break;
    case 'fire':
      _fireMode=true;
      _effects.push({type:'msg',text:'🔥 화염시!',x:LW/2,y:LH*.38,vy:-.4,alpha:1.3,big:true});
      playSound('skill_fire');
      break;
    case 'poison':{
      const ri=ROWS.reduce((b,r,i)=>Math.abs(r.yFr*LH-cy)<Math.abs(ROWS[b].yFr*LH-cy)?i:b,0);
      _monsters.filter(m=>m.ri===ri&&!m.dead).forEach(m=>{m.poisonUntil=now+3000;});
      _effects.push({type:'msg',text:'☠️ 독!',x:LW/2,y:ROWS[ri].yFr*LH,vy:-.5,alpha:1.2,big:false});
      playSound('skill_ice'); break;
    }
    case 'explode':
      createArrow(cx,cy,0,false,false,true);
      _arrowsFired++;
      _effects.push({type:'msg',text:'💥 폭발!',x:LW/2,y:LH*.38,vy:-.4,alpha:1.3,big:true});
      playSound('cannon_shot'); break;
    case 'rapidfire':
      _rapidUntil=now+5000;
      _effects.push({type:'msg',text:'⚡ 연사!',x:LW/2,y:LH*.38,vy:-.4,alpha:1.3,big:true});
      playSound('tower_shot'); break;
    case 'pierce':
      _pierceMode=true; setTimeout(()=>{_pierceMode=false;},5000);
      _effects.push({type:'msg',text:'🪃 관통!',x:LW/2,y:LH*.38,vy:-.4,alpha:1.3,big:true});
      playSound('arrow_shot'); break;
  }
  renderHUD();
}

// ── HUD ──────────────────────────────────────────────────────────────────────
function renderHUD(){
  // HP 바
  const hpPct=(_playerHP/_playerMaxHP*100).toFixed(1);
  $('hpFill').style.width=hpPct+'%';
  $('hpBox')?.classList.toggle('danger',_playerHP/_playerMaxHP<0.3);

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
  updateCannons(dt);
  if(_hitFlash>0) _hitFlash=Math.max(0,_hitFlash-dt*0.006);
  updateRenderer(dt);
  renderFrame({
    imgs:_img, sprs:_spr,
    monsters:_monsters, arrows:_arrows, effects:_effects,
    cannons:_cannons, cannonballs:_cannonballs,
    aim:_lastAim, shootTs:_shootTs, ts:_ts,
    playerX:_playerX, hitFlash:_hitFlash,
    fireMode:_fireMode, pierceMode:_pierceMode, rapidUntil:_rapidUntil,
  });
  renderHUD();
}

// ── 타이머 / 종료 ─────────────────────────────────────────────────────────────
function startTimer(){
  _timeLeft=GAME_TIME;
  _timerIv=setInterval(()=>{ if(--_timeLeft<=0){ clearInterval(_timerIv); endGame(); } },1000);
}

function gameOver(){
  clearInterval(_timerIv);
  endGame();
}

async function endGame(){
  _phase='result'; cancelAnimationFrame(_raf); _raf=null;
  $('cannonWarning')?.classList.remove('alert');
  const missed   = Math.max(0, _arrowsFired - _arrowsHit);
  const penalty  = missed * MISS_PENALTY;
  const finalScore = Math.max(0, _score - penalty);
  const accuracy = _arrowsFired > 0 ? Math.round(_arrowsHit / _arrowsFired * 100) : 0;
  const gp = await awardScore(finalScore);

  $('resFinalScore').textContent = finalScore.toLocaleString() + 'pts';

  const gpEl = $('resGP');
  if (_freeMode) {
    gpEl.textContent = '🆓 Free play — no reward';
    gpEl.style.color = '#6b7280';
  } else if (gp > 0) {
    gpEl.innerHTML = `+${gp} GP  <span style="font-size:13px;color:#6b7280">(${finalScore.toLocaleString()} ÷ 10)</span>`;
    gpEl.style.color = '#22c55e';
  } else {
    gpEl.textContent = 'No GP (score too low)';
    gpEl.style.color = '#ef4444';
  }

  const tier = finalScore>=8000?'🏆 Legend':finalScore>=5000?'⭐ Excellent':finalScore>=3000?'👍 Good':finalScore>=1500?'🙂 Average':finalScore>=500?'🌱 Beginner':'💀 Try again';
  $('resInfo').innerHTML =
    `${tier}<br>` +
    `Kills <b>${_killCount}</b> · Accuracy <b>${accuracy}%</b> (${_arrowsHit}/${_arrowsFired}) · Max Combo ×<b>${_maxCombo}</b><br>` +
    `<span style="color:#6b7280;font-size:11px">Raw ${_score.toLocaleString()} − miss penalty ${penalty.toLocaleString()} = ${finalScore.toLocaleString()}</span>`;

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
    const t=e.changedTouches[0];
    const [cx,cy]=pos({clientX:t.clientX,clientY:t.clientY});
    _lastAim=[cx,cy];
    // 터치 이동으로 플레이어 좌우 회피
    _playerX=Math.max(30,Math.min(LW-30,cx));
  },{passive:false});
  canvas.addEventListener('mousemove',e=>{
    if(_phase!=='game')return;
    const [cx,cy]=pos(e); _lastAim=[cx,cy];
    // 마우스 이동으로 플레이어 좌우 회피
    _playerX=Math.max(30,Math.min(LW-30,cx));
  });
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
  _score=0;_combo=0;_maxCombo=0;_comboTs=0;_arrowsFired=0;_arrowsHit=0;_killCount=0;
  _monsters=[];_arrows=[];_effects=[];
  _rowCount=new Array(ROWS.length).fill(0);
  _spawnNext=new Array(ROWS.length).fill(0);
  _fireMode=false;_pierceMode=false;_rapidUntil=0;_skillCd={};
  _playerMP=_playerMaxMP;
  _playerX=LW/2; _hitFlash=0;
  _cannonballs=[];
  _cannons[0].nextFire=3800; _cannons[0].firing=0;
  _cannons[1].nextFire=6000; _cannons[1].firing=0;
  $('cannonWarning')?.classList.remove('alert');
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
  // 에셋 로드 완료 즉시 로비 표시 — Firebase auth 응답 대기 없이 버튼 즉시 활성화
  showPhase('lobby');
  $('btnEnter')?.addEventListener('click',async()=>{
    if(_uid){if(!await deductFee()){alert('GP가 부족합니다');return;}}
    _freeMode=false;
    _selectedSkills=[];renderSkillGrid();$('skCount').textContent='0/3 선택';$('skConfirm').disabled=true;showPhase('skill');
  });
  $('btnFreePlay')?.addEventListener('click',()=>{
    _freeMode=true;
    _selectedSkills=[];renderSkillGrid();$('skCount').textContent='0/3 선택';$('skConfirm').disabled=true;showPhase('skill');
  });
  $('skConfirm')?.addEventListener('click',startCountdown);
  $('btnRestart')?.addEventListener('click',()=>location.reload());

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
      r.innerHTML=`<span class="g-user-chip">👤 ${esc(user.displayName||'유저')}</span>`;
    } else {
      r.innerHTML=`<button class="g-login-btn" id="gLoginBtn">🔑 Google 로그인</button>`;
      _bindHdrLogin();
    }
  }
  _bindHdrLogin();

  // auth는 백그라운드에서 GP·헤더만 업데이트 (화면 전환 없음)
  onAuthStateChanged(auth,async user=>{
    _uid=user?.uid||null;
    await loadPlayer();
    _updateHdr(user);
    if(_phase==='loading') showPhase('lobby');
  });
}
init();
