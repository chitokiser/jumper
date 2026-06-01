// conquest.render.js — 렌더링 (카메라·성·안개·유닛·POI)
import {
  worldToScreen, getScale, getVisibleRect, getRevealAnims,
  drawMinimap, WX, WY, FOG_COLS, FOG_ROWS, CELL_W, CELL_H,
  CASTLE_WX, CASTLE_WY,
} from './conquest.world.js';
import { getFrame, MINES } from './conquest.units.js';
import { POI_DEFS } from './conquest.world.js';

let _cv, _ctx, _mapImg;

export function initRenderer(cv){ _cv=cv; _ctx=cv.getContext('2d'); }
export async function loadMapAssets(){
  _mapImg=await _ldImg('/assets/images/conquest/map.png');
}
function _ldImg(src){
  return new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.onerror=()=>r(null);i.src=src;});
}

// ── 메인 렌더 ─────────────────────────────────────────────────────────────
export function renderScene({defenders,monsters,castleHp,maxCastleHp,fogGrid,pois,prepCountdown,wave,phase},sprites){
  if(!_ctx)return;
  const W=_cv.width,H=_cv.height;
  _ctx.clearRect(0,0,W,H);

  _drawMap(W,H);
  _drawMines();
  _drawPOIs(pois);
  _drawCastleHP(castleHp,maxCastleHp);
  _drawFog(fogGrid);
  _drawRevealAnims();

  // 유닛 (y축 정렬)
  const vis=getVisibleRect();
  const buf=150;
  [...defenders,...monsters]
    .filter(u=>u.x>vis.l-buf&&u.x<vis.r+buf&&u.y>vis.t-buf&&u.y<vis.b+buf)
    .sort((a,b)=>a.y-b.y)
    .forEach(u=>_drawUnit(u,sprites));

  // 카운트다운 텍스트
  if(phase==='game'&&!wave&&prepCountdown>0){
    const[cx,cy]=worldToScreen(CASTLE_WX,CASTLE_WY-130);
    _ctx.save();
    _ctx.font=`bold ${Math.round(36*Math.min(getScale(),1))}px sans-serif`;
    _ctx.textAlign='center'; _ctx.fillStyle='#fbbf24';
    _ctx.shadowColor='#000'; _ctx.shadowBlur=8;
    _ctx.fillText(`웨이브 시작까지 ${Math.ceil(prepCountdown/1000)}s`,cx,cy);
    _ctx.restore();
  }

  drawMinimap(_ctx,fogGrid,pois||[],defenders,W,H);
}

// ── 맵 배경 ──────────────────────────────────────────────────────────────
function _drawMap(W,H){
  _ctx.fillStyle='#111a08'; _ctx.fillRect(0,0,W,H);
  if(!_mapImg){_ctx.fillStyle='#1a2e10';_ctx.fillRect(0,0,W,H);return;}
  const vis=getVisibleRect();
  const s=getScale();
  const[sx,sy]=worldToScreen(0,0);
  _ctx.drawImage(_mapImg,sx,sy,WX*s,WY*s);
}

// ── 광산 아이콘 ───────────────────────────────────────────────────────────
function _drawMines(){
  const s=getScale();
  MINES.forEach(({x,y})=>{
    const[sx,sy]=worldToScreen(x,y);
    if(!_inView(sx,sy,20*s)) return;
    const r=10*s;
    _ctx.fillStyle='#4a3010';
    _ctx.beginPath(); _ctx.arc(sx,sy,r,0,Math.PI*2); _ctx.fill();
    _ctx.strokeStyle='#8a6030'; _ctx.lineWidth=1.5; _ctx.stroke();
    _ctx.strokeStyle='#fbbf24'; _ctx.lineWidth=1;
    _ctx.beginPath(); _ctx.moveTo(sx-5*s,sy); _ctx.lineTo(sx+5*s,sy); _ctx.stroke();
    _ctx.beginPath(); _ctx.moveTo(sx,sy-5*s); _ctx.lineTo(sx,sy+5*s); _ctx.stroke();
  });
}

// ── POI 렌더링 ────────────────────────────────────────────────────────────
function _drawPOIs(pois){
  if(!pois) return;
  const s=getScale(), ts=performance.now();
  for(const p of pois){
    if(!p.discovered) continue;
    const[sx,sy]=worldToScreen(p.x,p.y);
    if(!_inView(sx,sy,22*s)) continue;
    const r=10*s, def=POI_DEFS[p.type];
    _ctx.fillStyle=def?.color||'#888';
    _ctx.beginPath(); _ctx.arc(sx,sy,r,0,Math.PI*2); _ctx.fill();
    _ctx.strokeStyle='rgba(255,255,255,.5)'; _ctx.lineWidth=1; _ctx.stroke();
    if(s>0.3){
      _ctx.fillStyle='#fff'; _ctx.font=`bold ${Math.round(9*s)}px sans-serif`;
      _ctx.textAlign='center';
      _ctx.fillText(def?.name||p.type,sx,sy+r+10*s);
    }
  }
}

// ── 성 HP 바만 표시 (맵에 이미 성이 그려져 있음) ─────────────────────────
function _drawCastleHP(hp,maxHp){
  const s=getScale();
  const[hx,hy]=worldToScreen(CASTLE_WX,CASTLE_WY-110);
  const bw=Math.max(60,90*s), bh=Math.max(5,7*s);
  const pct=Math.max(0,hp/maxHp);
  _ctx.fillStyle='rgba(0,0,0,.65)'; _ctx.fillRect(hx-bw/2-1,hy-1,bw+2,bh+2);
  _ctx.fillStyle=pct>.5?'#22c55e':pct>.25?'#f59e0b':'#ef4444';
  _ctx.fillRect(hx-bw/2,hy,bw*pct,bh);
  _ctx.fillStyle='rgba(255,255,255,.75)';
  _ctx.font=`bold ${Math.max(9,Math.round(9*s))}px sans-serif`;
  _ctx.textAlign='center';
  _ctx.fillText(`🏰 ${Math.ceil(hp)}`,hx,hy+bh+Math.max(9,10*s));
}

// ── 안개 ─────────────────────────────────────────────────────────────────
function _drawFog(fogGrid){
  if(!fogGrid) return;
  const vis=getVisibleRect(), s=getScale();
  const cMin=Math.max(0,Math.floor(vis.l/CELL_W));
  const cMax=Math.min(FOG_COLS-1,Math.ceil(vis.r/CELL_W));
  const rMin=Math.max(0,Math.floor(vis.t/CELL_H));
  const rMax=Math.min(FOG_ROWS-1,Math.ceil(vis.b/CELL_H));
  const anims=getRevealAnims();
  const sw=CELL_W*s+1,sh=CELL_H*s+1;
  for(let r=rMin;r<=rMax;r++){
    for(let c=cMin;c<=cMax;c++){
      if(fogGrid[r*FOG_COLS+c]===0) continue;
      const cx=(c+.5)*CELL_W,cy=(r+.5)*CELL_H;
      let alpha=0.9;
      for(const a of anims){
        const p=Math.min(1,a.t/a.dur);
        if(Math.hypot(cx-a.wx,cy-a.wy)<a.maxR*p) alpha=Math.min(alpha,alpha*(1-p));
      }
      if(alpha<0.04) continue;
      const[sx,sy]=worldToScreen(c*CELL_W,r*CELL_H);
      _ctx.fillStyle=`rgba(0,0,0,${alpha})`;
      _ctx.fillRect(sx,sy,sw,sh);
    }
  }
}

// ── 안개 해제 원형 이펙트 ────────────────────────────────────────────────
function _drawRevealAnims(){
  const s=getScale();
  for(const a of getRevealAnims()){
    const p=Math.min(1,a.t/a.dur);
    const[sx,sy]=worldToScreen(a.wx,a.wy);
    const r=a.maxR*p*s;
    _ctx.save();
    _ctx.strokeStyle=`rgba(255,220,80,${(1-p)*.7})`;
    _ctx.lineWidth=3*s;
    _ctx.beginPath(); _ctx.arc(sx,sy,r,0,Math.PI*2); _ctx.stroke();
    _ctx.restore();
  }
}

// ── 유닛 ─────────────────────────────────────────────────────────────────
function _drawUnit(u,sprites){
  const[sx,sy]=worldToScreen(u.x,u.y);
  const s=getScale(),sz=u.size*s;
  const img=getFrame(u,sprites);
  if(u.selected){
    _ctx.strokeStyle='#22c55e'; _ctx.lineWidth=2;
    _ctx.beginPath(); _ctx.ellipse(sx,sy,sz*.42,sz*.13,0,0,Math.PI*2); _ctx.stroke();
  }
  _ctx.save();
  if(u.hitFlash>0&&Math.floor(u.hitFlash/45)%2===0) _ctx.globalAlpha=.4;
  if(img){
    if(u.flipH){ _ctx.scale(-1,1); _ctx.drawImage(img,-sx-sz/2,sy-sz,sz,sz); }
    else _ctx.drawImage(img,sx-sz/2,sy-sz,sz,sz);
  } else {
    _ctx.fillStyle=u.team==='ally'?'#60a5fa':'#ef4444';
    _ctx.beginPath(); _ctx.arc(sx,sy-sz/2,sz/2,0,Math.PI*2); _ctx.fill();
  }
  _ctx.restore();
  if(!u.dying){
    const bw=sz*.85,bh=3*s,bx=sx-bw/2,by=sy-sz-4*s,pct=Math.max(0,u.hp/u.maxHp);
    _ctx.fillStyle='rgba(0,0,0,.6)'; _ctx.fillRect(bx-1,by-1,bw+2,bh+2);
    _ctx.fillStyle=u.team==='ally'?'#22c55e':'#ef4444';
    _ctx.fillRect(bx,by,bw*pct,bh);
  }
}

function _inView(sx,sy,pad){
  return sx>-pad&&sx<_cv.width+pad&&sy>-pad&&sy<_cv.height+pad;
}
