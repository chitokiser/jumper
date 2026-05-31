// monsterrace.render.js — 의사3D 레이싱 렌더러

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
  // 나무/가로등 배치
  for(let i=0;i<SEGS;i+=6)  t[i].obj   = i%18===0 ? 'lamp' : 'tree';
  for(let i=3;i<SEGS;i+=10) t[i].obj2  = 'tree';
  return t.slice(0,SEGS);
}

// ── 스프라이트 (AI 몬스터용) ──────────────────────────────────────────────────
const DEFS = {
  orc3:   {frames:Array.from({length:6},(_,i)=>`/assets/images/monsters/orc3/ORK_03_WALK_${String(i).padStart(3,'0')}.png`)},
  pirate3:{frames:Array.from({length:6},(_,i)=>`/assets/images/monsters/pirate3/3_3-PIRATE_WALK_${String(i).padStart(3,'0')}.png`)},
  zombie1:{frames:Array.from({length:8},(_,i)=>`/assets/images/monsters/zombie1/animation/Run${i+1}.png`)},
  zombie3:{frames:Array.from({length:8},(_,i)=>`/assets/images/monsters/Zombie3/animation/Run${i+1}.png`)},
  dragon: {frames:Array.from({length:6},(_,i)=>`/assets/images/monsters/dragon/fly${String(i).padStart(3,'0')}.png`)},
  box:    {frames:['/assets/images/item/box.png']},
};
const _imgs = {};

export async function loadAllSprites() {
  const ld = s => new Promise(r=>{ const i=new Image(); i.onload=()=>r(i); i.onerror=()=>r(null); i.src=s; });
  await Promise.all(Object.entries(DEFS).map(async([k,d])=>{ _imgs[k]=await Promise.all(d.frames.map(ld)); }));
}

export function getFrame(key,fps,ts) {
  const f=_imgs[key]; if(!f?.length) return null;
  const v=f.filter(Boolean); if(!v.length) return null;
  return v[Math.floor(ts*fps/1000)%v.length];
}

// ── 렌더러 ───────────────────────────────────────────────────────────────────
const DRAW_N=130, D_NEAR=480, SEG_D=280, ROAD_HW=0.55;
let _ctx,_W,_H,_shake=0;

export function initRenderer(c){ _ctx=c.getContext('2d'); _W=c.width; _H=c.height; }
export function triggerShake(s=6){ _shake=s; }

function dToY(d){ return _H/2+D_NEAR*(_H/2)/d; }
function dToW(d){ return _W*ROAD_HW*D_NEAR/d; }

// ── 배경 ─────────────────────────────────────────────────────────────────────
function drawBg(ts,spd) {
  // 하늘
  const sky=_ctx.createLinearGradient(0,0,0,_H*.5);
  sky.addColorStop(0,'#0d0d2b'); sky.addColorStop(0.6,'#1a3a8a'); sky.addColorStop(1,'#3a6ec4');
  _ctx.fillStyle=sky; _ctx.fillRect(0,0,_W,_H*.5);
  // 구름 (시차 스크롤)
  _ctx.fillStyle='rgba(255,255,255,0.12)';
  for(let i=0;i<5;i++){
    const cx=(_W*(i*.22)+ts*(0.02+i*.005)*spd)%_W;
    const cy=_H*.1+i*_H*.05;
    const r =20+i*8;
    _ctx.beginPath(); _ctx.arc(cx,cy,r,0,Math.PI*2); _ctx.fill();
    _ctx.beginPath(); _ctx.arc(cx+r*.8,cy+2,r*.65,0,Math.PI*2); _ctx.fill();
    _ctx.beginPath(); _ctx.arc(cx-r*.7,cy+3,r*.55,0,Math.PI*2); _ctx.fill();
  }
  // 원경 산
  _ctx.fillStyle='#16351a';
  _ctx.beginPath(); _ctx.moveTo(0,_H*.49);
  for(let x=0;x<=_W;x+=_W/12)
    _ctx.lineTo(x,_H*.4+Math.sin(x*.015)*_H*.06+Math.sin(x*.04)*_H*.025);
  _ctx.lineTo(_W,_H*.49); _ctx.fill();
}

// ── 도로 세그먼트 ─────────────────────────────────────────────────────────────
function drawSeg(y1,w1,cx1, y2,w2,cx2, road,grass,rumble,alt) {
  if(y1<=y2) return;
  // 잔디
  _ctx.fillStyle=grass; _ctx.fillRect(0,y2,_W,Math.min(y1,_H)-y2);
  // 럼블 스트립 (빨강/흰 교대)
  _ctx.fillStyle=rumble;
  _ctx.beginPath();
  _ctx.moveTo(cx1-w1*1.14,y1); _ctx.lineTo(cx1+w1*1.14,y1);
  _ctx.lineTo(cx2+w2*1.14,y2); _ctx.lineTo(cx2-w2*1.14,y2); _ctx.fill();
  // 도로
  _ctx.fillStyle=road;
  _ctx.beginPath();
  _ctx.moveTo(cx1-w1,y1); _ctx.lineTo(cx1+w1,y1);
  _ctx.lineTo(cx2+w2,y2); _ctx.lineTo(cx2-w2,y2); _ctx.fill();
  // 흰색 갓길선
  _ctx.fillStyle='#ffffffcc';
  for(const sx of [-1,1]) {
    _ctx.beginPath();
    _ctx.moveTo(cx1+sx*w1*.96,y1); _ctx.lineTo(cx1+sx*w1*.88,y1);
    _ctx.lineTo(cx2+sx*w2*.88,y2); _ctx.lineTo(cx2+sx*w2*.96,y2); _ctx.fill();
  }
  // 중앙 노란 점선 (alt 교대)
  if(alt) {
    _ctx.fillStyle='#fbbf24dd';
    _ctx.beginPath();
    _ctx.moveTo(cx1-3,y1); _ctx.lineTo(cx1+3,y1);
    _ctx.lineTo(cx2+2,y2); _ctx.lineTo(cx2-2,y2); _ctx.fill();
  }
}

// ── 환경 오브젝트 (나무/가로등) ───────────────────────────────────────────────
function drawEnvObj(si, side, type) {
  const sc  = D_NEAR / si.depth;
  if(sc<0.04) return;
  const gap = si.w2 * 1.55;
  const ox  = si.cx + side * (gap + 18*sc);
  const oy  = si.y2;

  if(type==='tree') {
    const h=70*sc, tw=36*sc;
    if(h<3) return;
    // 나무 줄기
    _ctx.fillStyle='#4a2c0a';
    _ctx.fillRect(ox-tw*.08,oy-h*.42,tw*.16,h*.42);
    // 수풀 (3단)
    [[0,-.48,tw*.52,'#1a5e0a'],[0,-.62,tw*.42,'#236e0e'],[0,-.76,tw*.3,'#2d8012']].forEach(([dx,dy,r,col])=>{
      _ctx.fillStyle=col; _ctx.beginPath();
      _ctx.arc(ox+dx*tw,oy+dy*h,r,0,Math.PI*2); _ctx.fill();
    });
  } else {
    const h=65*sc;
    if(h<4) return;
    // 가로등 기둥
    _ctx.fillStyle='#888';
    _ctx.fillRect(ox-sc*.8,oy-h,sc*1.6,h);
    // 팔
    _ctx.fillStyle='#666';
    _ctx.fillRect(ox-sc*.5,oy-h,12*sc,sc*1.2);
    // 등
    _ctx.fillStyle='#fffde7';
    _ctx.beginPath(); _ctx.arc(ox+10*sc,oy-h+sc,4*sc,0,Math.PI*2); _ctx.fill();
    _ctx.fillStyle='rgba(255,253,200,0.15)';
    _ctx.beginPath(); _ctx.arc(ox+10*sc,oy-h+sc,10*sc,0,Math.PI*2); _ctx.fill();
  }
}

// ── 메인 렌더 ────────────────────────────────────────────────────────────────
export function renderScene(track, racers, player, items, ts) {
  if(!_ctx) return;
  const W=_W, H=_H;
  const spd=player.speed/player.maxSpeed;

  const shX=_shake>0?(Math.random()-.5)*_shake*2:0;
  const shY=_shake>0?(Math.random()-.5)*_shake:0;
  _shake=Math.max(0,_shake-.6);
  _ctx.save();
  _ctx.translate(shX,shY);

  drawBg(ts,spd);

  const pSeg=Math.floor(player.pos);
  const segMap={};
  let curX=0,hillY=0;
  const dl=[];

  for(let i=DRAW_N;i>=0;i--) {
    const idx=((pSeg+i)%SEGS+SEGS)%SEGS;
    const seg=track[idx];
    const d1=D_NEAR+i*SEG_D, d2=D_NEAR+(i+1)*SEG_D;
    curX +=seg.curve*(D_NEAR/d1)*.9;
    hillY+=seg.hill*(D_NEAR/d1)*.45;
    const y1=Math.min(H,dToY(d2)-hillY);
    const y2=Math.min(H,dToY(d1)-hillY);
    if(y2<H/2) continue;
    const w1=dToW(d2), w2=dToW(d1), cx=W/2+curX;
    const alt=(pSeg+i)%2===0;
    dl.push({i,y1:Math.max(H/2,y1),w1,cx,y2:Math.max(H/2,y2),w2,
      road:alt?'#4e4e4e':'#424242',
      grass:alt?'#337010':'#286009',
      rumble:alt?'#cc1111':'#eeeeee',
      alt, depth:d1, seg });
    segMap[i]=dl[dl.length-1];
  }

  // ── 도로 + 환경 ──────────────────────────────────────────────────────────
  for(const s of dl) {
    drawSeg(s.y2,s.w2,s.cx, s.y1,s.w1,s.cx, s.road,s.grass,s.rumble,s.alt);
    if(s.seg.obj)  { drawEnvObj(s,-1,s.seg.obj);  drawEnvObj(s,1,s.seg.obj);  }
    if(s.seg.obj2) { drawEnvObj(s,-1.4,s.seg.obj2); }
  }

  // ── 아이템 박스 ───────────────────────────────────────────────────────────
  const boxImg=_imgs.box?.[0];
  for(const item of items) {
    if(!item.active) continue;
    const dist=item.trackPos-player.pos;
    if(dist<.5||dist>DRAW_N-1) continue;
    const si=segMap[Math.floor(dist)]||segMap[Math.ceil(dist)];
    if(!si) continue;
    const sc=D_NEAR/si.depth, sz=52*sc;
    if(sz<4) continue;
    const bob=Math.sin(ts*.003+item.id)*4*sc;
    const bx=si.cx+item.lane*si.w2*1.35;
    if(boxImg) {
      _ctx.save();
      // 회전 빛남
      _ctx.shadowColor='#f59e0b'; _ctx.shadowBlur=8*sc;
      _ctx.drawImage(boxImg,bx-sz/2,si.y2-sz+bob,sz,sz);
      _ctx.shadowBlur=0; _ctx.restore();
    }
  }

  // ── AI 레이서 ─────────────────────────────────────────────────────────────
  racers
    .filter(r=>{ const d=r.pos-player.pos; return d>.3&&d<DRAW_N&&!r.finished; })
    .sort((a,b)=>(b.pos-player.pos)-(a.pos-player.pos))
    .forEach(r=>{
      const dist=r.pos-player.pos;
      const si=segMap[Math.floor(dist)]||segMap[Math.ceil(dist)];
      if(!si) return;
      const sc=D_NEAR/si.depth, sh=110*sc, sw=sh*.7;
      if(sw<3) return;
      const fps=4+r.speed/r.maxSpeed*10;
      const frame=getFrame(r.imgKey,fps,ts);
      const bx=si.cx+r.lane*si.w2*1.35, by=si.y2-sh;
      // 그림자
      _ctx.fillStyle='rgba(0,0,0,0.25)';
      _ctx.beginPath(); _ctx.ellipse(bx,si.y2-2,sw*.45,sw*.1,0,0,Math.PI*2); _ctx.fill();
      if(r.fallUntil>Date.now()) {
        _ctx.save(); _ctx.translate(bx,by+sh/2); _ctx.rotate(Math.PI/2);
        if(frame) _ctx.drawImage(frame,-sw/2,-sh/2,sw,sh);
        else { _ctx.fillStyle=r.color; _ctx.fillRect(-sw/2,-sh/2,sw,sh); }
        _ctx.restore();
      } else {
        if(frame) _ctx.drawImage(frame,bx-sw/2,by,sw,sh);
        else { _ctx.fillStyle=r.color; _ctx.fillRect(bx-sw/2,by,sw,sh); }
      }
      // HP바
      if(sh>16) {
        _ctx.fillStyle='#00000099'; _ctx.fillRect(bx-sw/2,by-9,sw,5);
        _ctx.fillStyle=r.hp/r.maxHp>.5?'#22c55e':'#ef4444';
        _ctx.fillRect(bx-sw/2,by-9,sw*(r.hp/r.maxHp),5);
      }
      if(sh>36) {
        _ctx.font=`bold ${Math.max(9,11*sc)}px sans-serif`;
        _ctx.fillStyle='#fff'; _ctx.textAlign='center';
        _ctx.fillText(r.name,bx,by-13);
      }
    });

  // ── 트랩 ─────────────────────────────────────────────────────────────────
  _ctx.textAlign='center';
  for(const r of [...racers,player]) {
    for(const trap of (r.traps||[])) {
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

  // ── 플레이어 스케이터 ─────────────────────────────────────────────────────
  drawSkater(_ctx,W,H,player,ts);

  // ── 속도 비네팅 ───────────────────────────────────────────────────────────
  if(spd>.6) {
    _ctx.save(); _ctx.globalAlpha=(spd-.6)*1.2;
    const vg=_ctx.createRadialGradient(W/2,H/2,40,W/2,H/2,W*.85);
    vg.addColorStop(0,'transparent'); vg.addColorStop(1,'#000c');
    _ctx.fillStyle=vg; _ctx.fillRect(0,0,W,H); _ctx.restore();
  }
  // 모션 블러 선 (최고속 시)
  if(spd>.85) {
    _ctx.save(); _ctx.globalAlpha=(spd-.85)*.5;
    _ctx.strokeStyle='#fff'; _ctx.lineWidth=.5;
    for(let i=0;i<12;i++) {
      const lx=Math.random()*W;
      _ctx.beginPath(); _ctx.moveTo(lx,0); _ctx.lineTo(lx,H); _ctx.stroke();
    }
    _ctx.restore();
  }

  _ctx.restore();
}

// ── 스케이터 드로잉 (Canvas 직접, 리얼 프로포션) ─────────────────────────────
function drawSkater(ctx,W,H,player,ts) {
  const spd    = player.speed/player.maxSpeed;
  const braking= player.isBraking||false;
  const boost  = (player.effects?.boost||0)>Date.now();
  const fallen = player.fallUntil>Date.now();
  const steer  = (player.lane||0)*0.12;
  const phase  = ts*spd*.007;
  const crouch = spd*14;          // 빠를수록 낮게 앉음

  const cx=W/2, cy=H-50;
  ctx.save();
  ctx.translate(cx,cy);

  if(fallen) {
    ctx.rotate(Math.PI/2+Math.sin(ts*.01)*.25);
    _board(ctx,true,boost,spd);
    _rider(ctx,0,0,0,false,boost);
    ctx.restore(); return;
  }

  ctx.rotate(steer*.18);

  // 속도 트레일
  if(spd>.2) {
    ctx.save(); ctx.globalAlpha=spd*.5;
    const col=boost?'#93c5fd':'#e2e8f0';
    for(let i=0;i<5;i++) {
      ctx.strokeStyle=col; ctx.lineWidth=1+i*.3;
      ctx.beginPath();
      const ox=-16+i*8;
      ctx.moveTo(ox,10); ctx.lineTo(ox+(Math.random()-.5)*3,10+20+spd*22+i*4);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 그림자
  ctx.fillStyle='rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(0,12,26,6,0,0,Math.PI*2); ctx.fill();

  _board(ctx,braking,boost,spd);
  _rider(ctx,phase,crouch,steer,braking,boost);

  // 부스트 불꽃
  if(boost) {
    ctx.save(); ctx.globalAlpha=.7;
    for(let i=0;i<6;i++) {
      const fx=(Math.random()-.5)*20, fy=10+Math.random()*20;
      const fr=3+Math.random()*5;
      ctx.fillStyle=`hsl(${30+Math.random()*30},100%,${50+Math.random()*30}%)`;
      ctx.beginPath(); ctx.arc(fx,fy,fr,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  ctx.restore();
}

// ── 스케이트보드 ─────────────────────────────────────────────────────────────
function _board(ctx,braking,boost,spd) {
  ctx.save();
  if(braking) ctx.rotate(Math.PI/2); // 브레이크=가로

  const col   = boost?'#2563eb':'#7c2d12';
  const grip  = boost?'#1d4ed8':'#431407';

  // 바퀴 4개
  [[-16,-6],[-16,6],[16,-6],[16,6]].forEach(([ox,oy])=>{
    ctx.fillStyle='#1a1a1a';
    ctx.beginPath(); ctx.ellipse(ox,oy,5.5,4,braking?0:Math.PI/8,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle='#444'; ctx.lineWidth=.8; ctx.stroke();
    // 바퀴 회전 선
    if(spd>.1) {
      ctx.strokeStyle='#555'; ctx.lineWidth=.5;
      ctx.beginPath(); ctx.arc(ox,oy,3.5,0,Math.PI*spd*2); ctx.stroke();
    }
  });
  // 트럭 (금속 부품)
  ctx.fillStyle='#9ca3af';
  [[-15,0],[15,0]].forEach(([ox])=>ctx.fillRect(ox-7,-1.5,14,3));

  // 데크
  ctx.fillStyle=col; _rr(ctx,-22,-5,44,10,5); ctx.fill();
  ctx.fillStyle=grip; _rr(ctx,-19,-4,38,8,4); ctx.fill();
  // 스트라이프
  ctx.fillStyle='rgba(255,255,255,0.18)'; ctx.fillRect(-6,-3,12,2);
  // 킥테일 (앞뒤 올라간 부분)
  ctx.fillStyle=col;
  ctx.beginPath();
  ctx.moveTo(-22,-5); ctx.quadraticCurveTo(-26,-8,-24,-4);
  ctx.moveTo(22,-5);  ctx.quadraticCurveTo(26,-8,24,-4);
  ctx.fill();

  ctx.restore();
}

// ── 라이더 본체 ──────────────────────────────────────────────────────────────
function _rider(ctx,phase,crouch,steer,braking,boost) {
  const legSwing = Math.sin(phase)*.38;
  const armSwing = -legSwing;
  const brakeLean= braking ? .55 : 0;  // 브레이크 시 뒤로 기울기
  const bodyY    = -(44+crouch);

  ctx.save();
  if(braking) ctx.rotate(brakeLean);

  // ── 다리 ──
  ctx.fillStyle='#1e3a5f';
  // 오른쪽 다리
  ctx.save(); ctx.translate(8,-14-crouch*.3);
  ctx.rotate(-legSwing); _rr(ctx,-4,0,9,22+crouch*.6,3); ctx.fill();
  // 무릎 관절
  ctx.fillStyle='#2563eb'; ctx.beginPath(); ctx.arc(0,14+crouch*.3,4,0,Math.PI*2); ctx.fill();
  ctx.restore();
  // 왼쪽 다리
  ctx.fillStyle='#1e3a5f';
  ctx.save(); ctx.translate(-8,-14-crouch*.3);
  ctx.rotate(legSwing); _rr(ctx,-4,0,9,22+crouch*.6,3); ctx.fill();
  ctx.fillStyle='#2563eb'; ctx.beginPath(); ctx.arc(0,14+crouch*.3,4,0,Math.PI*2); ctx.fill();
  ctx.restore();

  // ── 몸통 ──
  ctx.fillStyle=boost?'#1d4ed8':'#2563eb';
  _rr(ctx,-13,bodyY,26,23,6); ctx.fill();
  // 재킷 줄무늬
  ctx.fillStyle='rgba(255,255,255,0.15)';
  ctx.fillRect(-13,bodyY+5,26,3);
  // 가슴 번호
  ctx.font='bold 7px monospace'; ctx.fillStyle='#fff';
  ctx.textAlign='center'; ctx.fillText('01',0,bodyY+16);

  // ── 팔 (균형 팔) ──
  const aL=armSwing+steer*.5+(braking?.8:0);
  const aR=-armSwing+steer*.5-(braking?.8:0);
  ctx.fillStyle=boost?'#1d4ed8':'#2563eb';
  // 왼팔
  ctx.save(); ctx.translate(-13,bodyY+5);
  ctx.rotate(aL); _rr(ctx,-14,0,10,19,4); ctx.fill();
  // 왼손
  ctx.fillStyle='#fcd34d'; ctx.beginPath(); ctx.arc(-9,19,4,0,Math.PI*2); ctx.fill();
  ctx.restore();
  // 오른팔
  ctx.save(); ctx.translate(13,bodyY+5);
  ctx.rotate(aR); _rr(ctx,4,0,10,19,4); ctx.fill();
  ctx.fillStyle='#fcd34d'; ctx.beginPath(); ctx.arc(9,19,4,0,Math.PI*2); ctx.fill();
  ctx.restore();

  // ── 헬멧 ──
  const hy=bodyY-18;
  // 헬멧 본체
  ctx.fillStyle='#dc2626';
  ctx.beginPath(); ctx.arc(0,hy,16,0,Math.PI*2); ctx.fill();
  // 헬멧 챙
  ctx.fillStyle='#b91c1c';
  ctx.beginPath(); ctx.ellipse(0,hy+13,19,5,0,0,Math.PI); ctx.fill();
  // 고글 렌즈
  ctx.fillStyle='#fbbf24';
  _rr(ctx,-13,hy-6,26,8,3); ctx.fill();
  ctx.fillStyle='rgba(30,30,60,0.85)';
  _rr(ctx,-12,hy-5,10,6,2); ctx.fill();
  _rr(ctx,2,hy-5,10,6,2); ctx.fill();
  // 고글 콧등
  ctx.fillStyle='#fbbf24'; ctx.fillRect(-1,hy-4,2,4);
  // 헬멧 벤트
  ctx.fillStyle='rgba(255,255,255,0.15)';
  [-5,0,5].forEach(ox=>{ _rr(ctx,ox-1,hy-14,2,6,1); ctx.fill(); });

  ctx.restore();
}

function _rr(ctx,x,y,w,h,r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
  ctx.arcTo(x+w,y,x+w,y+r,r); ctx.lineTo(x+w,y+h-r);
  ctx.arcTo(x+w,y+h,x+w-r,y+h,r); ctx.lineTo(x+r,y+h);
  ctx.arcTo(x,y+h,x,y+h-r,r); ctx.lineTo(x,y+r);
  ctx.arcTo(x,y,x+r,y,r); ctx.closePath();
}
