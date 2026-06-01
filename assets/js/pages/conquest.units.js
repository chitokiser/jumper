// conquest.units.js — 유닛 정의 · 스프라이트 · AI (10km 월드 좌표계)
const B = '/assets/images';

// ── 성벽 상수 (월드 좌표 10000계) ─────────────────────────────────────────
export const CASTLE_WX = 5000, CASTLE_WY = 5000;
export const CASTLE_WALL = { l:4910,r:5090,t:4910,b:5090,halfGate:28 };
export const GATES = [
  {x:5000,y:4910,dir:'top'},{x:5000,y:5090,dir:'bot'},
  {x:4910,y:5000,dir:'lft'},{x:5090,y:5000,dir:'rgt'},
];
// 성 주변 광산 (월드 좌표)
export const MINES = [
  {x:4200,y:4200},{x:5800,y:4200},{x:4200,y:5800},{x:5800,y:5800}
];

// ── 프레임 배열 헬퍼 ──────────────────────────────────────────────────────
function mk(prefix,count,{start=0,pad=0,ext='.png',step=1}={}){
  return Array.from({length:count},(_,k)=>{
    const n=start+k*step;
    return prefix+(pad?String(n).padStart(pad,'0'):n)+ext;
  });
}
const VB=(n,a)=>`${B}/villager/Zombie_Villager_${n}/PNG/PNG%20Sequences/${a}/0_Zombie_Villager_${a}_`;

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
};

// ── 유닛 스탯 ────────────────────────────────────────────────────────────
export const UNIT_DEFS = {
  villager:{label:'수비대',cost:50,team:'ally', spriteKey:'villager1',
    hp:150,atk:28,spd:80, range:95, atkRate:900,size:42,color:'#60a5fa'},
  miner:   {label:'광부',  cost:60,team:'ally', spriteKey:'villager2',
    hp:80, atk:0, spd:100,range:0,  atkRate:0,  size:40,color:'#fbbf24'},
  scout:   {label:'정찰대',cost:70,team:'ally', spriteKey:'villager3',
    hp:70, atk:14,spd:140,range:70, atkRate:1000,size:38,color:'#34d399'},
  orc:    {label:'오크',    team:'monster',spriteKey:'orc',
    hp:130,atk:20,spd:65,range:60,atkRate:1100,size:44,color:'#4a7c2f'},
  orc2:   {label:'오크전사',team:'monster',spriteKey:'orc2',
    hp:220,atk:32,spd:55,range:60,atkRate:1000,size:48,color:'#2d5a1e'},
  orc3:   {label:'오크족장',team:'monster',spriteKey:'orc3',
    hp:400,atk:48,spd:42,range:65,atkRate:900, size:54,color:'#1a3a10'},
  zombie: {label:'좀비',    team:'monster',spriteKey:'zombie',
    hp:320,atk:22,spd:36,range:60,atkRate:1300,size:44,color:'#5a7a3a'},
  pirate: {label:'해적',    team:'monster',spriteKey:'pirate',
    hp:280,atk:38,spd:70,range:65,atkRate:950, size:46,color:'#7c3a1a'},
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
    hp:def.hp,maxHp:def.hp,atk:def.atk,spd:def.spd,range:def.range,
    atkRate:def.atkRate,atkCooldown:0,
    animState:'idle',animFrame:0,animTimer:0,
    dying:false,dyingTimer:0,flipH:false,hitFlash:0,
    selected:false,cmdX:null,cmdY:null,events:[],
  };
  if(def.team==='monster'){
    u.gateTarget=_nearestGate(x,y); u.insideCastle=false;
  }
  if(type==='miner'){
    u.minerState='to_mine'; u.mineTarget=_nearestMine(x,y); u.mineTimer=0;
  }
  return u;
}

// ── 성벽 유틸 ────────────────────────────────────────────────────────────
function _inside(x,y){ const W=CASTLE_WALL; return x>W.l&&x<W.r&&y>W.t&&y<W.b; }
function _throughGate(ox,oy,nx,ny){
  const W=CASTLE_WALL,H=W.halfGate;
  if(oy<W.t&&ny>=W.t&&Math.abs(nx-CASTLE_WX)<H) return true;
  if(oy>W.b&&ny<=W.b&&Math.abs(nx-CASTLE_WX)<H) return true;
  if(ox<W.l&&nx>=W.l&&Math.abs(ny-CASTLE_WY)<H) return true;
  if(ox>W.r&&nx<=W.r&&Math.abs(ny-CASTLE_WY)<H) return true;
  return false;
}
function _nearestGate(mx,my){
  return GATES.reduce((b,g)=>_d(mx,my,g.x,g.y)<_d(mx,my,b.x,b.y)?g:b);
}
function _nearestMine(mx,my){
  return MINES.reduce((b,m)=>_d(mx,my,m.x,m.y)<_d(mx,my,b.x,b.y)?m:b);
}
function _d(ax,ay,bx,by){ return Math.hypot(ax-bx,ay-by); }

// ── AI 업데이트 ──────────────────────────────────────────────────────────
export function updateUnit(unit,allies,enemies,dt){
  unit.events=[];
  if(unit.dying){ unit.dyingTimer-=dt; _tickAnim(unit,dt); return unit.dyingTimer<=0; }
  unit.atkCooldown=Math.max(0,unit.atkCooldown-dt);
  unit.hitFlash=Math.max(0,unit.hitFlash-dt);
  if(unit.team==='monster') _updateMonster(unit,allies,dt);
  else if(unit.type==='miner') _updateMiner(unit,dt);
  else _updateAlly(unit,enemies,dt);
  _tickAnim(unit,dt); return false;
}

function _updateMonster(u,allies,dt){
  const foe=_nearest(u,allies);
  const inRange=foe&&_d(u.x,u.y,foe.x,foe.y)<=u.range+u.size*.5;
  if(inRange){ u.animState='attack'; u.flipH=foe.x<u.x; if(u.atkCooldown<=0){_hit(u,foe);u.atkCooldown=u.atkRate;} return; }
  const tx=u.insideCastle?CASTLE_WX:u.gateTarget.x;
  const ty=u.insideCastle?CASTLE_WY:u.gateTarget.y;
  const ox=u.x,oy=u.y;
  _moveTo(u,tx,ty,dt);
  if(!u.insideCastle&&_inside(u.x,u.y)){
    if(_throughGate(ox,oy,u.x,u.y)) u.insideCastle=true;
    else { u.x=ox; u.y=oy; }
  }
  u.animState='walk'; u.flipH=tx<u.x;
}

function _updateAlly(u,enemies,dt){
  const foe=_nearest(u,enemies);
  const inRange=foe&&_d(u.x,u.y,foe.x,foe.y)<=u.range+u.size*.5;
  if(inRange){ u.animState='attack'; u.flipH=foe.x<u.x; if(u.atkCooldown<=0){_hit(u,foe);u.atkCooldown=u.atkRate;} return; }
  if(u.cmdX!==null){
    if(_d(u.x,u.y,u.cmdX,u.cmdY)<10){u.cmdX=null;u.cmdY=null;}
    else{_moveTo(u,u.cmdX,u.cmdY,dt);u.animState='walk';return;}
  }
  u.animState='idle';
}

function _updateMiner(u,dt){
  switch(u.minerState){
    case'to_mine':
      if(_d(u.x,u.y,u.mineTarget.x,u.mineTarget.y)<22){u.minerState='mining';u.mineTimer=3500;u.animState='attack';}
      else{_moveTo(u,u.mineTarget.x,u.mineTarget.y,dt);u.animState='walk';}
      break;
    case'mining':
      u.mineTimer-=dt; u.animState='attack';
      if(u.mineTimer<=0) u.minerState='returning';
      break;
    case'returning':{
      const g=GATES[0];
      _moveTo(u,g.x,g.y,dt); u.animState='walk';
      if(_d(u.x,u.y,g.x,g.y)<28){u.events.push({type:'addGP',amount:30});u.minerState='to_mine';u.mineTarget=_nearestMine(u.x,u.y);}
      break;}
  }
}

function _hit(att,tgt){
  tgt.hp-=att.atk; tgt.hitFlash=130;
  if(tgt.hp<=0&&!tgt.dying){tgt.dying=true;tgt.animState='die';tgt.animFrame=0;tgt.dyingTimer=900;}
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
  const img=a[u.animFrame%a.length];
  return(img?.complete&&img.naturalWidth>0)?img:null;
}
