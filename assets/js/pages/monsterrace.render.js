// monsterrace.render.js — 의사3D 렌더러 + 트랙 + 스프라이트 애니메이션

// ── 트랙 ─────────────────────────────────────────────────────────────────────
export const SEGS       = 300;
export const TOTAL_LAPS = 3;

export function buildTrack() {
  const t = [];
  const str = (n,h=0)  => { for(let i=0;i<n;i++) t.push({curve:0,hill:h}); };
  const cur = (n,c,h=0)=> { for(let i=0;i<n;i++) t.push({curve:c,hill:h}); };
  str(40); cur(40,3); str(20,10); cur(30,-3,8);
  str(15,-4); cur(50,2); str(25); cur(35,-4);
  str(20); cur(25,2,6); str(10,-6);
  while (t.length < SEGS) t.push({curve:0,hill:0});
  return t.slice(0,SEGS);
}

// ── 스프라이트 정의 (AI 몬스터) ──────────────────────────────────────────────
const SPRITE_DEFS = {
  orc3:    { frames: Array.from({length:6},(_,i)=>`/assets/images/monsters/orc3/ORK_03_WALK_${String(i).padStart(3,'0')}.png`) },
  pirate3: { frames: Array.from({length:6},(_,i)=>`/assets/images/monsters/pirate3/3_3-PIRATE_WALK_${String(i).padStart(3,'0')}.png`) },
  zombie1: { frames: Array.from({length:8},(_,i)=>`/assets/images/monsters/zombie1/animation/Run${i+1}.png`) },
  zombie3: { frames: Array.from({length:8},(_,i)=>`/assets/images/monsters/Zombie3/animation/Run${i+1}.png`) },
  dragon:  { frames: Array.from({length:6},(_,i)=>`/assets/images/monsters/dragon/fly${String(i).padStart(3,'0')}.png`) },
  box:     { frames: ['/assets/images/item/box.png'] },
};

// 플레이어 캐릭터 파츠 (골격 애니메이션용)
const PART_SRCS = {
  body:  '/assets/images/monsters/1/1_body.png',
  head:  '/assets/images/monsters/1/1_head.png',
  legL:  '/assets/images/monsters/1/1_leg left.png',
  legR:  '/assets/images/monsters/1/1_leg right.png',
  armL:  '/assets/images/monsters/1/1_arm left.png',
  armR:  '/assets/images/monsters/1/1_arm right.png',
  bow:   '/assets/images/monsters/1/1_bow1.png',
  quiver:'/assets/images/monsters/1/1_quiver.png',
};

const _loaded = {};    // { key: HTMLImageElement[] }
const _parts  = {};    // { body, head, legL, legR, armL, armR, bow, quiver }

export async function loadAllSprites() {
  const load = src => new Promise(res => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });

  // AI 몬스터 프레임
  await Promise.all(Object.entries(SPRITE_DEFS).map(async ([key,def]) => {
    _loaded[key] = await Promise.all(def.frames.map(load));
  }));

  // 플레이어 파츠
  await Promise.all(Object.entries(PART_SRCS).map(async ([key,src]) => {
    _parts[key] = await load(src);
  }));
}

export function getFrame(key, fps, ts) {
  const frames = _loaded[key];
  if (!frames?.length) return null;
  const valid = frames.filter(Boolean);
  if (!valid.length) return null;
  return valid[Math.floor(ts * fps / 1000) % valid.length];
}

// ── 렌더러 ───────────────────────────────────────────────────────────────────
const DRAW_N = 120;
const D_NEAR = 500;
const SEG_D  = 300;
const ROAD_W = 1.1;

let _ctx, _W, _H;
let _shake = 0;

export function initRenderer(canvas) {
  _ctx = canvas.getContext('2d');
  _W   = canvas.width;
  _H   = canvas.height;
}

export function triggerShake(s=6) { _shake = s; }

function dToY(d) { return _H/2 + D_NEAR*(_H/2)/d; }
function dToW(d) { return _W*ROAD_W*D_NEAR/(d*2); }

function drawTrap(y1,w1,cx1, y2,w2,cx2, road,grass,rumble,lane) {
  if (y1<=y2) return;
  _ctx.fillStyle=grass;
  _ctx.fillRect(0,y2,_W,Math.min(y1,_H)-y2);
  _ctx.fillStyle=rumble;
  _ctx.beginPath();
  _ctx.moveTo(cx1-w1*1.12,y1); _ctx.lineTo(cx1+w1*1.12,y1);
  _ctx.lineTo(cx2+w2*1.12,y2); _ctx.lineTo(cx2-w2*1.12,y2);
  _ctx.fill();
  _ctx.fillStyle=road;
  _ctx.beginPath();
  _ctx.moveTo(cx1-w1,y1); _ctx.lineTo(cx1+w1,y1);
  _ctx.lineTo(cx2+w2,y2); _ctx.lineTo(cx2-w2,y2);
  _ctx.fill();
  if (lane) {
    _ctx.fillStyle='#ffffffaa';
    _ctx.beginPath();
    _ctx.moveTo(cx1-2,y1); _ctx.lineTo(cx1+2,y1);
    _ctx.lineTo(cx2+2,y2); _ctx.lineTo(cx2-2,y2);
    _ctx.fill();
  }
}

export function renderScene(track, racers, player, items, ts) {
  if (!_ctx) return;
  const W=_W, H=_H;

  // 화면 흔들림
  const shX = _shake>0 ? (Math.random()-.5)*_shake*2 : 0;
  const shY = _shake>0 ? (Math.random()-.5)*_shake : 0;
  _shake = Math.max(0, _shake-0.7);
  _ctx.save();
  _ctx.translate(shX,shY);

  // 하늘
  const sky = _ctx.createLinearGradient(0,0,0,H*.5);
  sky.addColorStop(0,'#080818'); sky.addColorStop(1,'#1a3a6a');
  _ctx.fillStyle=sky; _ctx.fillRect(0,0,W,H*.5);

  // 원경 산
  _ctx.fillStyle='#1a3a14';
  _ctx.beginPath(); _ctx.moveTo(0,H*.49);
  for(let x=0;x<=W;x+=W/10)
    _ctx.lineTo(x, H*.41+Math.sin(x*.018)*H*.05);
  _ctx.lineTo(W,H*.49); _ctx.fill();

  // ── 세그먼트 ──────────────────────────────────────────────────────────────
  const playerSeg = Math.floor(player.pos);
  const segMap = {};
  let curX=0, hillY=0;
  const drawList=[];

  for (let i=DRAW_N; i>=0; i--) {
    const idx = ((playerSeg+i)%SEGS+SEGS)%SEGS;
    const seg = track[idx];
    const d1 = D_NEAR+i*SEG_D, d2=D_NEAR+(i+1)*SEG_D;

    curX  += seg.curve*(D_NEAR/d1)*1.0;
    hillY += seg.hill*(D_NEAR/d1)*.5;

    const y1=Math.min(H, dToY(d2)-hillY);
    const y2=Math.min(H, dToY(d1)-hillY);
    if (y2<H/2) continue;

    const w1=dToW(d2), w2=dToW(d1);
    const cx=W/2+curX;
    const alt=(playerSeg+i)%2===0;

    drawList.push({
      i, y1:Math.max(H/2,y1), w1, cx,
      y2:Math.max(H/2,y2), w2,
      road: alt?'#5a5a5a':'#484848',
      grass:alt?'#2d7a0a':'#226006',
      rumble:alt?'#cc1111':'#eeeeee',
      lane: i%22<11, depth:d1,
    });
    segMap[i]=drawList[drawList.length-1];
  }

  for (const s of drawList)
    drawTrap(s.y2,s.w2,s.cx, s.y1,s.w1,s.cx, s.road,s.grass,s.rumble,s.lane);

  // ── 아이템 박스 ───────────────────────────────────────────────────────────
  const boxImg=_loaded.box?.[0];
  for (const item of items) {
    if (!item.active) continue;
    const dist=item.trackPos-player.pos;
    if (dist<.5||dist>DRAW_N-1) continue;
    const si=segMap[Math.floor(dist)]||segMap[Math.ceil(dist)];
    if (!si) continue;
    const sc=D_NEAR/si.depth, sz=48*sc;
    if (sz<3) continue;
    const bob=Math.sin(ts*.003+item.id)*4*sc;
    const bx=si.cx+item.lane*si.w2*1.4;
    if (boxImg) _ctx.drawImage(boxImg,bx-sz/2,si.y2-sz+bob,sz,sz);
    else { _ctx.fillStyle='#f59e0b'; _ctx.fillRect(bx-sz/2,si.y2-sz+bob,sz,sz); }
  }

  // ── AI 레이서 스프라이트 ──────────────────────────────────────────────────
  const ahead = racers
    .filter(r=>{ const d=r.pos-player.pos; return d>.3&&d<DRAW_N&&!r.finished; })
    .sort((a,b)=>(b.pos-player.pos)-(a.pos-player.pos));

  for (const r of ahead) {
    const dist=r.pos-player.pos;
    const si=segMap[Math.floor(dist)]||segMap[Math.ceil(dist)];
    if (!si) continue;
    const sc=D_NEAR/si.depth, sh=100*sc, sw=sh*.75;
    if (sw<2) continue;

    const fps=4+r.speed/r.maxSpeed*10;
    const frame=getFrame(r.imgKey, fps, ts);
    const bx=si.cx+r.lane*si.w2*1.4, by=si.y2-sh;

    if (r.fallUntil>Date.now()) {
      _ctx.save();
      _ctx.translate(bx,by+sh/2); _ctx.rotate(Math.PI/2);
      if(frame) _ctx.drawImage(frame,-sw/2,-sh/2,sw,sh);
      else { _ctx.fillStyle=r.color; _ctx.fillRect(-sw/2,-sh/2,sw,sh); }
      _ctx.restore();
    } else {
      if(frame) _ctx.drawImage(frame,bx-sw/2,by,sw,sh);
      else { _ctx.fillStyle=r.color; _ctx.fillRect(bx-sw/2,by,sw,sh); }
    }
    if (sh>14) {
      _ctx.fillStyle='#00000088'; _ctx.fillRect(bx-sw/2,by-8,sw,4);
      _ctx.fillStyle=r.hp/r.maxHp>.5?'#22c55e':'#ef4444';
      _ctx.fillRect(bx-sw/2,by-8,sw*(r.hp/r.maxHp),4);
    }
    if (sh>32) {
      _ctx.font=`bold ${Math.max(9,10*sc)}px sans-serif`;
      _ctx.fillStyle='#fff'; _ctx.textAlign='center';
      _ctx.fillText(r.name,bx,by-12);
    }
  }

  // ── 플레이어 스케이터 ─────────────────────────────────────────────────────
  drawSkater(_ctx, W, H, player, ts);

  // ── 트랩 이모지 ───────────────────────────────────────────────────────────
  _ctx.textAlign='center';
  for (const r of [...racers,player]) {
    for (const trap of (r.traps||[])) {
      if (!trap.active) continue;
      const dist=trap.pos-player.pos;
      if (dist<.3||dist>DRAW_N-1) continue;
      const si=segMap[Math.floor(dist)]||segMap[Math.ceil(dist)];
      if (!si) continue;
      const sc=D_NEAR/si.depth, sz=Math.max(10,24*sc);
      const bx=si.cx+trap.lane*si.w2*1.4;
      _ctx.font=`${sz}px serif`;
      _ctx.fillText(trap.emoji,bx,si.y2-4);
    }
  }

  // ── 속도 비네팅 ───────────────────────────────────────────────────────────
  const spd=player.speed/player.maxSpeed;
  if (spd>.65) {
    _ctx.save();
    _ctx.globalAlpha=(spd-.65)*1.4;
    const vg=_ctx.createRadialGradient(W/2,H/2,30,W/2,H/2,W*.8);
    vg.addColorStop(0,'transparent'); vg.addColorStop(1,'#000c');
    _ctx.fillStyle=vg; _ctx.fillRect(0,0,W,H);
    _ctx.restore();
  }

  _ctx.restore();
}

// ── 스케이터 (골격 애니메이션 + 보드 방향) ────────────────────────────────────
function drawSkater(ctx, W, H, player, ts) {
  const spd    = player.speed / player.maxSpeed;
  const braking= player.isBraking || false;
  const boost  = (player.effects?.boost||0) > Date.now();
  const fallen = player.fallUntil > Date.now();
  const steer  = player.lane * 0.15;       // 조향 기울기
  const phase  = ts * spd * 0.006;         // 달리기 위상

  const cx = W / 2;
  const cy = H - 38;

  ctx.save();
  ctx.translate(cx, cy);

  // 넘어졌을 때: 전체 가로로 눕힘
  if (fallen) {
    ctx.rotate(Math.PI/2 + Math.sin(ts*.012)*.25);
    _drawBoard(ctx, true, false, spd);
    _drawCharBody(ctx, 0, 0, spd, phase, true);
    ctx.restore();
    return;
  }

  // 방향 기울기
  ctx.rotate(steer * 0.2);

  // ── 속도 트레일 ──────────────────────────────────────────────────────────
  if (spd > .25) {
    ctx.save();
    ctx.globalAlpha = spd * .55;
    const col = boost ? '#60a5fa' : '#ffffff';
    for (let i=0;i<4;i++) {
      ctx.strokeStyle = col;
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      const ox = -15+i*10;
      ctx.moveTo(ox, 14);
      ctx.lineTo(ox+(Math.random()-.5)*3, 14+18+spd*20);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── 보드 (브레이크=가로, 달리기=세로) ─────────────────────────────────────
  _drawBoard(ctx, braking, boost, spd);

  // ── 캐릭터 본체 ──────────────────────────────────────────────────────────
  _drawCharBody(ctx, phase, steer, spd, phase, false);

  ctx.restore();
}

// 보드 드로잉: 브레이크=가로(wide), 달리기=세로(narrow)
function _drawBoard(ctx, braking, boost, spd) {
  const boardColor = boost ? '#1d4ed8' : '#7c2d12';
  const gripColor  = boost ? '#3b82f6' : '#431407';

  ctx.save();
  if (braking) {
    // 가로 (full-length side view: wide horizontal bar)
    ctx.rotate(Math.PI/2);  // 90° 회전
  }

  // 바퀴 (뒷바퀴 2개)
  ctx.fillStyle='#111';
  [[-22,8],[22,8]].forEach(([ox,oy])=>{
    ctx.beginPath(); ctx.ellipse(ox,oy,7,4.5,0,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#444'; ctx.lineWidth=1; ctx.stroke();
  });

  // 데크 (세로일 때: 좁고 길게, 가로일 때: 회전으로 인해 넓어 보임)
  if (braking) {
    // 브레이크: 세로로 그리면 회전으로 가로가 됨
    ctx.fillStyle=boardColor;
    _roundRect(ctx,-10,-4,20,60,5); ctx.fill();
    ctx.fillStyle=gripColor;
    _roundRect(ctx,-8,-3,16,56,4); ctx.fill();
  } else {
    // 달리기: 세로 (앞뒤로 긴 보드를 뒤에서 본 좁은 모습)
    ctx.fillStyle=boardColor;
    _roundRect(ctx,-14,-4,28,52,5); ctx.fill();
    ctx.fillStyle=gripColor;
    _roundRect(ctx,-11,-3,22,48,4); ctx.fill();
    // 센터 스트라이프
    ctx.fillStyle='#fff3'; ctx.fillRect(-4,-2,8,2);
  }

  ctx.restore();
}

// 캐릭터 파츠 합성 드로잉
function _drawCharBody(ctx, phase, steer, spd, _phase, fallen) {
  const legSwing = Math.sin(phase) * (fallen ? 0.3 : 0.5);
  const armSwing = -legSwing;
  const scale    = 1.2;  // 캐릭터 크기
  const S        = k => (n=>n||0)(scale*k);

  // ── 다리 (뒤쪽) ──────────────────────────────────────────────────────────
  _drawPart(ctx, _parts.legR, S(18), S(-10), S(34), S(40),  legSwing,  0.5, 0.05);
  _drawPart(ctx, _parts.legL, S(-18),S(-10), S(34), S(40), -legSwing,  0.5, 0.05);

  // ── 몸통 ─────────────────────────────────────────────────────────────────
  _drawPart(ctx, _parts.body,  0, S(-60), S(52), S(55), 0, 0.5, 0.05);

  // ── 활통 (등에) ───────────────────────────────────────────────────────────
  _drawPart(ctx, _parts.quiver, S(22), S(-65), S(18), S(30), 0.2, 0, 0);

  // ── 팔 ───────────────────────────────────────────────────────────────────
  _drawPart(ctx, _parts.armR, S(28), S(-70), S(22), S(38),  armSwing, 0.5, 0.05);
  _drawPart(ctx, _parts.armL, S(-28),S(-70), S(22), S(38), -armSwing, 0.5, 0.05);

  // ── 머리 ─────────────────────────────────────────────────────────────────
  _drawPart(ctx, _parts.head,  0, S(-108), S(44), S(44), steer*0.3, 0.5, 0.9);

  // ── 활 (앞에) ─────────────────────────────────────────────────────────────
  _drawPart(ctx, _parts.bow, S(-30), S(-85), S(24), S(56), armSwing*0.5, 0.5, 0.5);
}

// 파츠 드로잉 헬퍼 (x, y = 앵커 중심에서 오프셋, pivotX/pivotY = 회전 기준 0~1)
function _drawPart(ctx, img, x, y, w, h, rot, pivX, pivY) {
  if (!img) return;
  ctx.save();
  ctx.translate(x, y);
  if (rot) {
    ctx.translate(w*pivX, h*pivY);
    ctx.rotate(rot);
    ctx.translate(-w*pivX, -h*pivY);
  }
  ctx.drawImage(img, 0, 0, w, h);
  ctx.restore();
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
  ctx.arcTo(x+w,y,x+w,y+r,r); ctx.lineTo(x+w,y+h-r);
  ctx.arcTo(x+w,y+h,x+w-r,y+h,r); ctx.lineTo(x+r,y+h);
  ctx.arcTo(x,y+h,x,y+h-r,r); ctx.lineTo(x,y+r);
  ctx.arcTo(x,y,x+r,y,r); ctx.closePath();
}
