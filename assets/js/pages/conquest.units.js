// conquest.units.js — 유닛 정의 · 스프라이트 · AI (도로 경로 이동)
import { getMonsterPath, snapToRoad, CX, CY } from './conquest.path.js';
const B = '/assets/images';

// ── 성벽 상수 (맵 이미지 실측: 성벽 3800-6200) ────────────────────────────
export const CASTLE_WX = CX, CASTLE_WY = CY;
export const CASTLE_WALL = {l:3800,r:6200,t:3800,b:6200,halfGate:200};
export const GATES = [
  {x:5000,y:3800,dir:'top'},{x:5000,y:6200,dir:'bot'},
  {x:3800,y:5000,dir:'lft'},{x:6200,y:5000,dir:'rgt'},
];
// 광산: 도로 위 위치 (성벽 밖, 각 접근로 중간)
export const MINES = [
  {x:5000,y:2100},{x:5000,y:7900},
  {x:2100,y:5000},{x:7900,y:5000},
];

// ── 프레임 배열 헬퍼 ──────────────────────────────────────────────────────
function mk(prefix,n,{start=0,pad=0,ext='.png',step=1}={}){
  return Array.from({length:n},(_,k)=>{
    const i=start+k*step;
    return prefix+(pad?String(i).padStart(pad,'0'):i)+ext;
  });
}
const VB=(n,a)=>`${B}/villager/Zombie_Villager_${n}/PNG/PNG%20Sequences/${a}/0_Zombie_Villager_${a}_`;
const TR=(a,n)=>mk(`${B}/troll/PNG/Animation/Troll1/${a}_`,n,{pad:3});
const KN=(v,a)=>mk(`${B}/knight/_PNG/${v}_KNIGHT/Knight_0${v}__${a}_`,10,{pad:3});

// ── 스프라이트 경로 ───────────────────────────────────────────────────────
const SPRITE_DEFS = {
  villager1:{
    idle:  mk(VB(1,'Idle'),   6,{pad:3,step:3}),
    walk:  mk(VB(1,'Walking'),6,{pad:3,step:4}),
    attack:mk(VB(1,'Slashing'),6,{pad:3,step:2}),
    die:   mk(VB(1,'Dying'),  6,{pad:3,step:2}),
  },
  villager2:{
    idle:  mk(VB(2,'Idle'),   6,{pad:3,step:3}),
    walk:  mk(VB(2,'Walking'),6,{pad:3,step:4}),
    attack:mk(VB(2,'Slashing'),6,{pad:3,step:2}),
    die:   mk(VB(2,'Dying'),  6,{pad:3,step:2}),
  },
  villager3:{
    idle:  mk(VB(3,'Idle'),   6,{pad:3,step:3}),
    walk:  mk(VB(3,'Walking'),6,{pad:3,step:4}),
    attack:mk(VB(3,'Slashing'),6,{pad:3,step:2}),
    die:   mk(VB(3,'Dying'),  6,{pad:3,step:2}),
  },
  orc:{
    idle:  mk(`${B}/monsters/orc/ORK_01_IDLE_`, 6,{pad:3}),
    walk:  mk(`${B}/monsters/orc/ORK_01_WALK_`, 6,{pad:3}),
    attack:mk(`${B}/monsters/orc/ORK_01_ATTAK_`,6,{pad:3}),
    die:   mk(`${B}/monsters/orc/ORK_01_DIE_`,  6,{pad:3}),
  },
  orc2:{
    idle:  mk(`${B}/monsters/orc2/ORK_02_IDLE_`, 6,{pad:3}),
    walk:  mk(`${B}/monsters/orc2/ORK_02_WALK_`, 6,{pad:3}),
    attack:mk(`${B}/monsters/orc2/ORK_02_ATTAK_`,6,{pad:3}),
    die:   mk(`${B}/monsters/orc2/ORK_02_DIE_`,  6,{pad:3}),
  },
  orc3:{
    idle:  mk(`${B}/monsters/orc3/ORK_03_IDLE_`, 6,{pad:3}),
    walk:  mk(`${B}/monsters/orc3/ORK_03_WALK_`, 6,{pad:3}),
    attack:mk(`${B}/monsters/orc3/ORK_03_ATTAK_`,6,{pad:3}),
    die:   mk(`${B}/monsters/orc3/ORK_03_DIE_`,  6,{pad:3}),
  },
  zombie:{
    idle:  mk(`${B}/monsters/zombie1/Idle`,  4,{start:1}),
    walk:  mk(`${B}/monsters/zombie1/Walk`,  6,{start:1}),
    attack:mk(`${B}/monsters/zombie1/Attack`,6,{start:1}),
    die:   mk(`${B}/monsters/zombie1/Dead`,  8,{start:1}),
  },
  pirate:{
    idle:  mk(`${B}/monsters/pirate/1_entity_000_IDLE_`, 6,{pad:3}),
    walk:  mk(`${B}/monsters/pirate/1_entity_000_WALK_`, 6,{pad:3}),
    attack:mk(`${B}/monsters/pirate/1_entity_000_ATTACK_`,6,{pad:3}),
    die:   mk(`${B}/monsters/pirate/1_entity_000_DIE_`,  6,{pad:3}),
  },
  troll:{
    idle:  TR('Idle',  8),
    walk:  TR('Walk',  8),
    attack:TR('Attack',8),
    die:   TR('Dead',  8),
  },
  dragon:{
    idle:  mk(`${B}/monsters/dragon/idle`,  6,{pad:3}),
    walk:  mk(`${B}/monsters/dragon/fly`,   6,{pad:3}), // fly = 이동 애니
    attack:mk(`${B}/monsters/dragon/attak`, 6,{pad:3}),
    die:   mk(`${B}/monsters/dragon/idle`,  6,{pad:3}), // die 없음 → idle
  },
  knight:{
    idle:  KN(1,'IDLE'),
    walk:  KN(1,'WALK'),
    attack:KN(1,'ATTACK'),
    die:   KN(1,'DIE'),
  },
};

// ── 유닛 스탯 ────────────────────────────────────────────────────────────
export const UNIT_DEFS = {
  // ── 아군 ──
  villager:     {label:'수비대',  cost:50,  team:'ally',spriteKey:'villager1',
    hp:150,atk:28,spd:80, range:95, atkRate:900, size:52,color:'#60a5fa'},
  miner:        {label:'광부',    cost:60,  team:'ally',spriteKey:'villager2',
    hp:80, atk:0, spd:100,range:0,  atkRate:0,   size:48,color:'#fbbf24'},
  scout:        {label:'정찰대',  cost:70,  team:'ally',spriteKey:'villager3',
    hp:70, atk:14,spd:140,range:70, atkRate:1000,size:46,color:'#34d399'},
  // 몬스터 유효 사정거리 = range+size*0.5 ≈ 93~96
  // 타워는 그보다 명확히 길게: archer 220, cannon 160
  archer_tower: {label:'궁수탑',  cost:120, team:'ally',spriteKey:null,tower:true,
    hp:350,atk:45,spd:0,  range:220,atkRate:650, size:68,color:'#a0522d'},
  cannon_tower: {label:'대포탑',  cost:220, team:'ally',spriteKey:null,tower:true,aoe:70,
    hp:500,atk:95,spd:0,  range:160,atkRate:2400,size:76,color:'#555555'},
  hero:         {label:'영웅',    cost:300, team:'ally',spriteKey:'knight',isHero:true,
    hp:1500,atk:280,spd:100,range:150,atkRate:700,size:62,color:'#ffd700'},
  // ── 몬스터 ──
  dragon: {label:'드래곤',  team:'monster',spriteKey:'dragon',flying:true,
    hp:900,atk:90,spd:110,range:120,atkRate:1100,size:85,color:'#cc2200'},
  troll:  {label:'트롤',    team:'monster',spriteKey:'troll',
    hp:150,atk:22,spd:55,range:65,atkRate:1100,size:56,color:'#8a8a00'},
  orc:    {label:'오크',    team:'monster',spriteKey:'orc',
    hp:130,atk:20,spd:65,range:62,atkRate:1100,size:52,color:'#4a7c2f'},
  orc2:   {label:'오크전사',team:'monster',spriteKey:'orc2',
    hp:220,atk:32,spd:55,range:62,atkRate:1000,size:56,color:'#2d5a1e'},
  orc3:   {label:'오크족장',team:'monster',spriteKey:'orc3',
    hp:400,atk:48,spd:42,range:65,atkRate:900, size:62,color:'#1a3a10'},
  zombie: {label:'좀비',    team:'monster',spriteKey:'zombie',
    hp:320,atk:22,spd:36,range:62,atkRate:1300,size:52,color:'#5a7a3a'},
  pirate: {label:'해적',    team:'monster',spriteKey:'pirate',
    hp:280,atk:38,spd:70,range:65,atkRate:950, size:54,color:'#7c3a1a'},
};

// ── 스프라이트 로더 ───────────────────────────────────────────────────────
export function loadSprites(){
  const out={};
  for(const[k,def]of Object.entries(SPRITE_DEFS)){
    out[k]={};
    for(const[a,paths]of Object.entries(def))
      out[k][a]=paths.map(src=>{const i=new Image();i.src=src;return i;});
  }
  return out;
}

// ── 유닛 생성 ────────────────────────────────────────────────────────────
let _uid=0;
export function makeUnit(type,x,y){
  const def=UNIT_DEFS[type];
  const u={
    id:++_uid,type,x,y,team:def.team,spriteKey:def.spriteKey,size:def.size,
    isTower:!!(def.tower),
    hp:def.hp,maxHp:def.hp,atk:def.atk,spd:def.spd,range:def.range,
    atkRate:def.atkRate,atkCooldown:0,
    animState:'idle',animFrame:0,animTimer:0,
    dying:false,dyingTimer:0,flipH:false,hitFlash:0,
    selected:false,cmdX:null,cmdY:null,events:[],
  };
  if(def.team==='monster'){
    u.flying=!!def.flying;
    u.atGate=false;
    u.insideCastle=false;   // 성벽 함락 후 내부 진입 여부
    u.attackingWall=null;   // 'north'|'south'|'east'|'west'
    if(!def.flying){
      u.waypoints=getMonsterPath(x,y);
      u.waypointIdx=0;
    }
  }
  if(def.isHero){
    u.skillCooldown=0;
  }
  if(def.team==='ally'&&!def.tower){
    u.guardMode=false;
    u.targetId=null;
    u.patrolMode=false;
    u.patrolHome=null;
    u.patrolTarget=null;
    u.patrolTimer=0;
  }
  if(type==='miner'){
    u.minerState='to_mine'; u.mineTarget=_nearestMine(x,y); u.mineTimer=0;
  }
  return u;
}

// ── 유틸 ────────────────────────────────────────────────────────────────
function _d(ax,ay,bx,by){return Math.hypot(ax-bx,ay-by);}
function _nearestMine(mx,my){
  return MINES.reduce((b,m)=>_d(mx,my,m.x,m.y)<_d(mx,my,b.x,b.y)?m:b);
}
function _inside(x,y){
  const W=CASTLE_WALL;
  if(!(x>W.l&&x<W.r&&y>W.t&&y<W.b)) return false;
  // 성문 통로(halfGate 범위)는 진입 허용 — 이동 경로가 막히지 않게
  const hg=W.halfGate||200;
  if(Math.abs(x-CX)<=hg&&y<=W.t+hg) return false; // 북문
  if(Math.abs(x-CX)<=hg&&y>=W.b-hg) return false; // 남문
  if(Math.abs(y-CY)<=hg&&x<=W.l+hg) return false; // 서문
  if(Math.abs(y-CY)<=hg&&x>=W.r-hg) return false; // 동문
  return true;
}

// ── AI 업데이트 ──────────────────────────────────────────────────────────
export function updateUnit(u,allies,enemies,dt,walls=null){
  u.events=[];
  if(u.dying){u.dyingTimer-=dt;_tickAnim(u,dt);return u.dyingTimer<=0;}
  u.atkCooldown=Math.max(0,u.atkCooldown-dt);
  u.hitFlash=Math.max(0,u.hitFlash-dt);
  if(u.team==='monster')_updateMonster(u,allies,dt,walls);
  else if(u.isTower)_updateTower(u,enemies,dt);
  else if(u.type==='miner')_updateMiner(u,dt);
  else _updateAlly(u,enemies,dt);
  _tickAnim(u,dt); return false;
}

// ── 어느 성벽 공격 중인지 판별 ────────────────────────────────────────
function _whichWall(u){
  const dx=u.x-CX, dy=u.y-CY;
  if(Math.abs(dy)>=Math.abs(dx)) return dy<0?'north':'south';
  return dx<0?'west':'east';
}

// ── 몬스터 AI (도로 이동→성벽 공격→함락 시 내부 진입) ────────────────
function _updateMonster(u,allies,dt,walls){
  const foe=_nearest(u,allies);
  const inRange=foe&&_d(u.x,u.y,foe.x,foe.y)<=u.range+u.size*.5;
  if(inRange){
    u.animState='attack';u.flipH=foe.x<u.x;
    if(u.atkCooldown<=0){_hit(u,foe);u.atkCooldown=u.atkRate;}
    return;
  }

  // 성벽 함락 후 내부 진입 → 성 중심으로 이동
  if(u.insideCastle){
    const dist=_d(u.x,u.y,CASTLE_WX,CASTLE_WY);
    if(dist<80){
      u.animState='attack';
      if(u.atkCooldown<=0){
        u.events.push({type:'damageCastle',amount:u.atk});
        u.events.push({type:'sound',name:'castle_hit'});
        u.atkCooldown=u.atkRate;
      }
    } else {
      _moveTo(u,CASTLE_WX,CASTLE_WY,dt);
      u.animState='walk';
    }
    return;
  }

  // 성문 도달 → 성벽 공격
  if(u.atGate){
    // 해당 성벽이 이미 함락됐으면 바로 진입
    if(walls&&u.attackingWall&&walls[u.attackingWall]?.breached){
      u.insideCastle=true;return;
    }
    u.animState='attack';
    if(u.atkCooldown<=0){
      u.events.push({type:'damageWall',wall:u.attackingWall||'north',amount:u.atk});
      u.events.push({type:'sound',name:'castle_hit'});
      u.atkCooldown=u.atkRate;
    }
    return;
  }

  // 비행 유닛(드래곤): 성벽 바깥 1250에서 멈춰 공격
  // → 도로의 타워·수비대·영웅이 요격 가능한 위치
  if(u.flying){
    const dist=_d(u.x,u.y,CASTLE_WX,CASTLE_WY);
    if(dist<=1250){
      if(!u.atGate){u.atGate=true;u.attackingWall=_whichWall(u);}
      // 성벽 함락됐으면 내부 진입
      if(walls&&walls[u.attackingWall]?.breached){
        u.insideCastle=true;u.atGate=false;return;
      }
      u.animState='attack';
      u.flipH=CASTLE_WX<u.x;
      if(u.atkCooldown<=0){
        u.events.push({type:'damageWall',wall:u.attackingWall,amount:u.atk});
        u.events.push({type:'sound',name:'dragon_roar'});
        u.atkCooldown=u.atkRate;
      }
      return;
    }
    _moveTo(u,CASTLE_WX,CASTLE_WY,dt);
    u.animState='walk';
    if(foe) u.flipH=foe.x<u.x; else u.flipH=u.x>CASTLE_WX;
    return;
  }

  // 지상: 도로 경로 이동
  if(u.waypoints&&u.waypointIdx<u.waypoints.length){
    const wp=u.waypoints[u.waypointIdx];
    if(_d(u.x,u.y,wp.x,wp.y)<18){
      u.waypointIdx++;
      if(u.waypointIdx>=u.waypoints.length){
        u.atGate=true;
        u.attackingWall=_whichWall(u);
        // 이미 함락된 성벽이면 바로 진입
        if(walls&&walls[u.attackingWall]?.breached) u.insideCastle=true;
      }
    } else {
      const ox=u.x,oy=u.y;
      _moveTo(u,wp.x,wp.y,dt);
      if(_inside(u.x,u.y)){u.x=ox;u.y=oy;}
    }
  }
  u.animState='walk';
  if(foe) u.flipH=foe.x<u.x;
}

// ── 타워 AI (고정 위치, 자동 공격) ──────────────────────────────────────
function _updateTower(u,enemies,dt){
  u.animState='idle';
  const foe=_nearest(u,enemies);
  if(!foe||_d(u.x,u.y,foe.x,foe.y)>u.range) return;
  u.flipH=foe.x<u.x;
  if(u.atkCooldown>0) return;
  u.atkCooldown=u.atkRate;
  const aoe=UNIT_DEFS[u.type]?.aoe||0;
  if(aoe>0){
    for(const e of enemies){
      if(!e.dying&&_d(foe.x,foe.y,e.x,e.y)<=aoe) _hit(u,e);
    }
    u.events.push({type:'sound',name:'cannon'});
  } else {
    _hit(u,foe);
    u.events.push({type:'sound',name:'arrow'});
  }
}

// ── 수비대 AI (이동·공격·경계·순찰 4모드) ───────────────────────────────
function _updateAlly(u,enemies,dt){
  let foe=u.targetId
    ? enemies.find(e=>e.id===u.targetId&&!e.dying)||null
    : null;
  if(!foe){u.targetId=null;foe=_nearest(u,enemies);}

  const inRange=foe&&_d(u.x,u.y,foe.x,foe.y)<=u.range+u.size*.5;
  if(inRange){
    u.animState='attack';u.flipH=foe.x<u.x;
    if(u.atkCooldown<=0){_hit(u,foe);u.atkCooldown=u.atkRate;}
    return;
  }

  if(u.guardMode){u.animState='idle';return;}

  // 순찰 모드
  if(u.patrolMode&&u.patrolHome){
    _doPatrol(u,dt);
    if(foe)u.flipH=foe.x<u.x;
    return;
  }

  if(u.targetId&&foe){_moveTo(u,foe.x,foe.y,dt);u.animState='walk';return;}

  if(u.cmdX!==null){
    if(_d(u.x,u.y,u.cmdX,u.cmdY)<12){u.cmdX=null;u.cmdY=null;}
    else{_moveTo(u,u.cmdX,u.cmdY,dt);u.animState='walk';return;}
  }
  u.animState='idle';
}

// 순찰 AI: 홈 반경 내 랜덤 포인트 순회
const PATROL_RADIUS={villager:100,scout:100,miner:80,hero:200};
function _doPatrol(u,dt){
  u.patrolTimer-=dt;
  const r=PATROL_RADIUS[u.type]||100;
  if(!u.patrolTarget||u.patrolTimer<=0||_d(u.x,u.y,u.patrolTarget.x,u.patrolTarget.y)<18){
    const ang=Math.random()*Math.PI*2;
    const dist=30+Math.random()*r;
    u.patrolTarget={
      x:u.patrolHome.x+Math.cos(ang)*dist,
      y:u.patrolHome.y+Math.sin(ang)*dist,
    };
    u.patrolTimer=1500+Math.random()*2500;
  }
  _moveTo(u,u.patrolTarget.x,u.patrolTarget.y,dt);
  u.animState='walk';
}

// ── 광부 AI ──────────────────────────────────────────────────────────────
function _updateMiner(u,dt){
  switch(u.minerState){
    case'to_mine':
      if(_d(u.x,u.y,u.mineTarget.x,u.mineTarget.y)<22){
        u.minerState='mining';u.mineTimer=3500;
      } else {_moveTo(u,u.mineTarget.x,u.mineTarget.y,dt);u.animState='walk';}
      break;
    case'mining':
      u.mineTimer-=dt;u.animState='attack';
      if(u.mineTimer<=0)u.minerState='returning';
      break;
    case'returning':{
      const g=GATES[0];
      _moveTo(u,g.x,g.y,dt);u.animState='walk';
      if(_d(u.x,u.y,g.x,g.y)<30){
        u.events.push({type:'addGP',amount:30});
        u.minerState='to_mine';u.mineTarget=_nearestMine(u.x,u.y);
      }
      break;}
  }
}

function _hit(att,tgt){
  tgt.hp-=att.atk;tgt.hitFlash=130;
  tgt.events.push({type:'sound',name:'hit'});
  if(tgt.hp<=0&&!tgt.dying){
    tgt.dying=true;tgt.animState='die';tgt.animFrame=0;tgt.dyingTimer=900;
    tgt.events.push({type:'sound',name:'death'});
  }
}
function _nearest(u,list){
  let best=null,bd=Infinity;
  for(const f of list){if(f.dying)continue;const d=_d(u.x,u.y,f.x,f.y);if(d<bd){bd=d;best=f;}}
  return best;
}
function _moveTo(u,tx,ty,dt){
  const dx=tx-u.x,dy=ty-u.y,d=Math.hypot(dx,dy)||1,spd=u.spd*dt/1000;
  u.x+=dx/d*spd;u.y+=dy/d*spd;u.flipH=dx<0;
}
function _tickAnim(u,dt){
  u.animTimer+=dt;
  const fps=u.animState==='die'?80:u.animState==='attack'?90:110;
  if(u.animTimer>=fps){u.animTimer=0;u.animFrame++;}
}

export function getFrame(u,sprites){
  const s=sprites[u.spriteKey];if(!s)return null;
  const a=s[u.animState]||s.idle;if(!a?.length)return null;
  const start=u.animFrame%a.length;
  for(let i=0;i<a.length;i++){
    const img=a[(start+i)%a.length];
    if(img?.complete&&img.naturalWidth>0)return img;
  }
  return null;
}
