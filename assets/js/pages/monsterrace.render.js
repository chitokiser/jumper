// monsterrace.render.js — 카트라이더 렌더러 (이미지 스프라이트)

export const SEGS       = 300;
export const TOTAL_LAPS = 3;

// ── 트랙 생성 ─────────────────────────────────────────────────────────────────
export function buildTrack() {
  const t = [];
  const s=(n,h=0)  =>{ for(let i=0;i<n;i++) t.push({curve:0,hill:h,obj:null}); };
  const c=(n,cv,h=0)=>{ for(let i=0;i<n;i++) t.push({curve:cv,hill:h,obj:null}); };
  s(40); c(40,2.5); s(20,12); c(30,-3,9);
  s(15,-5); c(50,2); s(25); c(35,-4); s(20);
  c(25,2.5,6); s(10,-7);
  while(t.length<SEGS) t.push({curve:0,hill:0,obj:null});
  for(let i=0;i<SEGS;i+=6)  t[i].obj  = i%18===0 ? 'lamp' : 'tree';
  for(let i=3;i<SEGS;i+=10) t[i].obj2 = 'tree';
  return t.slice(0,SEGS);
}

// ── 이미지 로딩 ───────────────────────────────────────────────────────────────
const IMG_PATHS = {
  back:    '/assets/images/race/back.png',
  user:    '/assets/images/race/user/user1.png',
  orc:     '/assets/images/race/mon2/orc1.png',
  pirate:  '/assets/images/race/mon3/piet1.png',
  zombie1: '/assets/images/race/mon5/zomb1.png',
  zombie2: '/assets/images/race/mon6/zomg2.png',
  troll:   '/assets/images/race/mon4/trol1.png',
  cabi:    '/assets/images/race/mon1/cabi1.png',
};
const _imgs = {};

export async function loadAllSprites() {
  const ld = src => new Promise(r => {
    const i = new Image(); i.onload=()=>r(i); i.onerror=()=>r(null); i.src=src;
  });
  await Promise.all(Object.entries(IMG_PATHS).map(async([k,v])=>{ _imgs[k]=await ld(v); }));
}
export function getFrame(key) { return _imgs[key]||null; }

// ── 렌더러 초기화 ─────────────────────────────────────────────────────────────
const DRAW_N=160, D_NEAR=420, SEG_D=220, ROAD_HW=0.68;
let _ctx, _W, _H, _shake=0;

export function initRenderer(c){ _ctx=c.getContext('2d'); _W=c.width; _H=c.height; }
export function triggerShake(s=6){ _shake=s; }

function dToY(d){ return _H/2+D_NEAR*(_H/2)/d; }
function dToW(d){ return _W*ROAD_HW*D_NEAR/d; }

// ── 배경 (back.png 커버 + 레인 시차) ─────────────────────────────────────────
function drawBg(playerLane) {
  const img = _imgs.back;
  if (img) {
    const iw=img.naturalWidth, ih=img.naturalHeight;
    const scale=Math.max(_W/iw, _H/ih);
    const dw=iw*scale, dh=ih*scale;
    // 레인에 따라 배경 미세 이동 (시차 효과)
    const dx=(_W-dw)/2 - playerLane*12;
    const dy=(_H-dh)/2;
    _ctx.drawImage(img, dx, dy, dw, dh);
  } else {
    _ctx.fillStyle='#100810'; _ctx.fillRect(0,0,_W,_H);
  }
}

// ── 도로 세그먼트 (할로윈 목재 트랙 컬러) ────────────────────────────────────
function drawSeg(y1,w1,cx1, y2,w2,cx2, road,grass,rumble,alt) {
  if(y1<=y2) return;
  _ctx.fillStyle=grass; _ctx.fillRect(0,y2,_W,Math.min(y1,_H)-y2);
  _ctx.fillStyle=rumble;
  _ctx.beginPath();
  _ctx.moveTo(cx1-w1*1.14,y1); _ctx.lineTo(cx1+w1*1.14,y1);
  _ctx.lineTo(cx2+w2*1.14,y2); _ctx.lineTo(cx2-w2*1.14,y2); _ctx.fill();
  _ctx.fillStyle=road;
  _ctx.beginPath();
  _ctx.moveTo(cx1-w1,y1); _ctx.lineTo(cx1+w1,y1);
  _ctx.lineTo(cx2+w2,y2); _ctx.lineTo(cx2-w2,y2); _ctx.fill();
  // 갓길선 (황금빛 — back.png 화살표 색조와 맞춤)
  _ctx.fillStyle='rgba(200,160,60,0.45)';
  for(const sx of [-1,1]){
    _ctx.beginPath();
    _ctx.moveTo(cx1+sx*w1*.96,y1); _ctx.lineTo(cx1+sx*w1*.88,y1);
    _ctx.lineTo(cx2+sx*w2*.88,y2); _ctx.lineTo(cx2+sx*w2*.96,y2); _ctx.fill();
  }
  if(alt){
    _ctx.fillStyle='rgba(245,158,11,0.65)';
    _ctx.beginPath();
    _ctx.moveTo(cx1-3,y1); _ctx.lineTo(cx1+3,y1);
    _ctx.lineTo(cx2+2,y2); _ctx.lineTo(cx2-2,y2); _ctx.fill();
  }
}

// ── 환경 오브젝트 (고사목 / 호박 등불) ───────────────────────────────────────
function drawEnvObj(si, side, type) {
  const sc=D_NEAR/si.depth;
  if(sc<0.04) return;
  const ox=si.cx+side*(si.w2*1.55+18*sc), oy=si.y2;
  if(type==='tree') {
    const h=70*sc, tw=28*sc;
    if(h<3) return;
    _ctx.strokeStyle='#1a0800'; _ctx.lineCap='round';
    _ctx.lineWidth=tw*0.24;
    _ctx.beginPath(); _ctx.moveTo(ox,oy); _ctx.lineTo(ox,oy-h*0.6); _ctx.stroke();
    _ctx.lineWidth=tw*0.14;
    _ctx.beginPath(); _ctx.moveTo(ox,oy-h*0.45); _ctx.lineTo(ox-tw*.65,oy-h*.72); _ctx.stroke();
    _ctx.beginPath(); _ctx.moveTo(ox,oy-h*0.5);  _ctx.lineTo(ox+tw*.55,oy-h*.75); _ctx.stroke();
    _ctx.lineWidth=tw*0.07;
    _ctx.beginPath(); _ctx.moveTo(ox-tw*.5,oy-h*.62); _ctx.lineTo(ox-tw*.72,oy-h*.84); _ctx.stroke();
    _ctx.beginPath(); _ctx.moveTo(ox+tw*.4,oy-h*.65); _ctx.lineTo(ox+tw*.62,oy-h*.86); _ctx.stroke();
  } else {
    const h=60*sc;
    if(h<4) return;
    // 나무 기둥
    _ctx.fillStyle='#3a1800'; _ctx.fillRect(ox-sc,oy-h,sc*2,h);
    _ctx.fillStyle='#2a1000'; _ctx.fillRect(ox-sc*.5,oy-h+sc,13*sc,sc*1.4);
    // 호박 등불
    const lx=ox+11*sc, ly=oy-h+2.5*sc;
    _ctx.fillStyle='#c05000';
    _ctx.beginPath(); _ctx.arc(lx,ly,4.5*sc,0,Math.PI*2); _ctx.fill();
    _ctx.fillStyle='#ff7700';
    _ctx.beginPath(); _ctx.arc(lx,ly,3*sc,0,Math.PI*2); _ctx.fill();
    _ctx.fillStyle='#0a0400';
    _ctx.beginPath(); _ctx.arc(lx-1.4*sc,ly-1*sc,1.1*sc,0,Math.PI*2); _ctx.fill();
    _ctx.beginPath(); _ctx.arc(lx+1.4*sc,ly-1*sc,1.1*sc,0,Math.PI*2); _ctx.fill();
    // 주황 빛 오라
    const grd=_ctx.createRadialGradient(lx,ly,0,lx,ly,12*sc);
    grd.addColorStop(0,'rgba(255,130,0,0.38)'); grd.addColorStop(1,'transparent');
    _ctx.fillStyle=grd; _ctx.beginPath(); _ctx.arc(lx,ly,12*sc,0,Math.PI*2); _ctx.fill();
  }
}

// ── 플레이어 카트 (user1.png 스프라이트) ─────────────────────────────────────
function drawPlayerKart(ctx, W, H, player, ts) {
  const img    = _imgs.user;
  const now2   = Date.now();
  const spd    = Math.min(1, player.speed/player.maxSpeed);
  const boost  = (player.effects?.boost||0)>now2;
  const fallen = player.fallUntil>now2;
  const spinning = (player.effects?.spin||0)>now2;
  const sliding  = (player.effects?.oilSlide||0)>now2 || (player.effects?.iceSlide||0)>now2;
  // 스핀 시 빠른 회전 / 슬라이드 시 좌우 흔들림 / 정상 시 코너링 기울기
  const steer = spinning ? Math.sin(now2*0.015)*1.4
              : sliding  ? player.lane*(0.08+spd*0.07) + Math.sin(now2*0.008)*0.12
              : player.lane*(0.08+spd*0.07);

  // 고속 스트릭
  if(spd>0.5&&!fallen){
    ctx.save(); ctx.globalAlpha=(spd-0.5)*0.55;
    ctx.strokeStyle=boost?'#bfdbfe':'#ffffffaa'; ctx.lineWidth=0.8;
    for(let i=0;i<12;i++){
      const lx=W*0.12+Math.random()*W*0.76;
      ctx.beginPath(); ctx.moveTo(lx,H*0.5); ctx.lineTo(lx,H*0.88); ctx.stroke();
    }
    ctx.restore();
  }

  // 스키드 마크 (고속 코너링)
  if(Math.abs(player.lane)>0.3&&spd>0.55&&!fallen){
    ctx.save();
    ctx.globalAlpha=(spd-0.55)*Math.min(1,Math.abs(player.lane))*0.6;
    ctx.strokeStyle='#1a0800'; ctx.lineWidth=2.2;
    for(const ox of [-13,13]){
      ctx.beginPath(); ctx.moveTo(W/2+ox,H-10);
      ctx.lineTo(W/2+ox+player.lane*9,H+6); ctx.stroke();
    }
    ctx.restore();
  }

  // 스프라이트 (바닥 기준으로 기울여 그리기)
  if(!img) return;
  const imgH = H*0.40;
  const imgW = imgH*(img.naturalWidth/img.naturalHeight);
  ctx.save();
  ctx.translate(W/2, H-2);
  if(fallen) ctx.rotate(Math.PI/2);
  else       ctx.rotate(steer);
  if(boost) ctx.filter='brightness(1.4) saturate(1.7) hue-rotate(210deg)';
  ctx.drawImage(img, -imgW/2, -imgH, imgW, imgH);
  ctx.restore();
}

// ── 메인 렌더 ────────────────────────────────────────────────────────────────
export function renderScene(track, racers, player, items, ts) {
  if(!_ctx) return;
  const W=_W, H=_H;
  const spd=player.speed/player.maxSpeed;

  const shX=_shake>0?(Math.random()-.5)*_shake*2:0;
  const shY=_shake>0?(Math.random()-.5)*_shake:0;
  _shake=Math.max(0,_shake-.6);
  _ctx.save(); _ctx.translate(shX,shY);

  drawBg(player.lane);

  const pSeg=Math.floor(player.pos);
  const segMap={};
  let curX=-player.lane*W*0.06, hillY=0;
  const dl=[];

  for(let i=DRAW_N;i>=0;i--){
    const idx=((pSeg+i)%SEGS+SEGS)%SEGS;
    const seg=track[idx];
    const d1=D_NEAR+i*SEG_D, d2=D_NEAR+(i+1)*SEG_D;
    curX+=seg.curve*(D_NEAR/d1)*.9;
    hillY+=seg.hill*(D_NEAR/d1)*.45;
    const y1=Math.min(H,dToY(d2)-hillY);
    const y2=Math.min(H,dToY(d1)-hillY);
    if(y2<H/2) continue;
    const w1=dToW(d2), w2=dToW(d1), cx=W/2+curX;
    const alt=(pSeg+i)%2===0;
    dl.push({i, y1:Math.max(H/2,y1), w1, cx, y2:Math.max(H/2,y2), w2,
      road:   alt?'#7a4a18':'#6a3e10',
      grass:  alt?'#0c0701':'#080401',
      rumble: alt?'#6d28d9':'#c8c8c8',
      alt, depth:d1, seg});
    segMap[i]=dl[dl.length-1];
  }

  // 도로 + 환경
  for(const s of dl){
    drawSeg(s.y2,s.w2,s.cx, s.y1,s.w1,s.cx, s.road,s.grass,s.rumble,s.alt);
    if(s.seg.obj)  { drawEnvObj(s,-1,s.seg.obj);  drawEnvObj(s,1,s.seg.obj);  }
    if(s.seg.obj2) { drawEnvObj(s,-1.4,s.seg.obj2); }
  }

  // 아이템 박스 (해골 상자)
  for(const item of items){
    if(!item.active) continue;
    const dist=item.trackPos-player.pos;
    if(dist<.5||dist>DRAW_N-1) continue;
    const si=segMap[Math.floor(dist)]||segMap[Math.ceil(dist)];
    if(!si) continue;
    const sc=D_NEAR/si.depth, sz=18*sc;
    if(sz<3) continue;
    const bob=Math.sin(ts*.003+item.id)*4*sc;
    const bx=si.cx+item.lane*si.w2*1.35, by=si.y2-sz-bob;
    _ctx.save();
    _ctx.fillStyle='#4c1d95'; _rr(_ctx,bx-sz/2,by,sz,sz,2*sc); _ctx.fill();
    _ctx.fillStyle='rgba(167,139,250,0.28)'; _rr(_ctx,bx-sz/2,by,sz,sz*.44,2*sc); _ctx.fill();
    _ctx.fillStyle='#f5f0ff'; _ctx.font=`bold ${sz*.7}px sans-serif`; _ctx.textAlign='center';
    _ctx.fillText('💀',bx,by+sz*.82);
    _ctx.restore();
  }

  // AI 카트 스프라이트
  racers
    .filter(r=>{ const d=r.pos-player.pos; return d>.3&&d<DRAW_N&&!r.finished; })
    .sort((a,b)=>(b.pos-player.pos)-(a.pos-player.pos))
    .forEach(r=>{
      const dist=r.pos-player.pos;
      const si=segMap[Math.floor(dist)]||segMap[Math.ceil(dist)];
      if(!si) return;
      const sc=D_NEAR/si.depth;
      if(sc<0.05) return;
      const img=_imgs[r.imgKey];
      const sh=130*sc;
      const sw=img?sh*(img.naturalWidth/img.naturalHeight):sh;
      const bx=si.cx+r.lane*si.w2*1.35;
      // 그림자
      _ctx.fillStyle='rgba(0,0,0,0.3)';
      _ctx.beginPath(); _ctx.ellipse(bx,si.y2-2,sw*.38,sh*.06,0,0,Math.PI*2); _ctx.fill();
      // 스프라이트
      _ctx.save();
      _ctx.translate(bx, si.y2);
      if(r.fallUntil>Date.now()) _ctx.rotate(Math.PI/2);
      else _ctx.rotate(r.lane*0.06);
      if(img) _ctx.drawImage(img,-sw/2,-sh,sw,sh);
      _ctx.restore();
      // 이름
      if(sc>0.22){
        _ctx.font=`bold ${Math.max(8,10*sc)}px sans-serif`;
        _ctx.fillStyle='#fff'; _ctx.textAlign='center';
        _ctx.strokeStyle='rgba(0,0,0,0.7)'; _ctx.lineWidth=2;
        _ctx.strokeText(r.name,bx,si.y2-sh-2*sc);
        _ctx.fillText(r.name,bx,si.y2-sh-2*sc);
      }
    });

  // 트랩
  _ctx.textAlign='center';
  for(const r of [...racers,player]){
    for(const trap of (r.traps||[])){
      if(!trap.active) continue;
      const dist=trap.pos-player.pos;
      if(dist<.3||dist>DRAW_N-1) continue;
      const si=segMap[Math.floor(dist)]||segMap[Math.ceil(dist)];
      if(!si) continue;
      const sc=D_NEAR/si.depth, sz=Math.max(10,26*sc);
      _ctx.font=`${sz}px serif`;
      _ctx.fillText(trap.emoji,si.cx+trap.lane*si.w2*1.35,si.y2-4);
    }
  }

  // 플레이어 카트
  drawPlayerKart(_ctx,W,H,player,ts);

  // 속도 비네팅
  if(spd>.6){
    _ctx.save(); _ctx.globalAlpha=(spd-.6)*1.2;
    const vg=_ctx.createRadialGradient(W/2,H/2,40,W/2,H/2,W*.85);
    vg.addColorStop(0,'transparent'); vg.addColorStop(1,'#000c');
    _ctx.fillStyle=vg; _ctx.fillRect(0,0,W,H); _ctx.restore();
  }

  _ctx.restore();
}

function _rr(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
  ctx.arcTo(x+w,y,x+w,y+r,r); ctx.lineTo(x+w,y+h-r);
  ctx.arcTo(x+w,y+h,x+w-r,y+h,r); ctx.lineTo(x+r,y+h);
  ctx.arcTo(x,y+h,x,y+h-r,r); ctx.lineTo(x,y+r);
  ctx.arcTo(x,y,x+r,y,r); ctx.closePath();
}
