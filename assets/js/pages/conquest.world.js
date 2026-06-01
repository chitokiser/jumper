// conquest.world.js — 10km×10km 월드 · 카메라 · 안개 · POI · 미니맵

// ── 월드 상수 ─────────────────────────────────────────────────────────────
export const WX = 10000, WY = 10000;
export const CASTLE_WX = 5000, CASTLE_WY = 5000;
export const FOG_COLS = 300, FOG_ROWS = 300;
export const CELL_W = WX / FOG_COLS;   // 33 world-unit
export const CELL_H = WY / FOG_ROWS;
const INIT_REVEAL_R = 1500; // 성벽 전체(반경 1200) + 외곽 여유

// ── POI 정의 ──────────────────────────────────────────────────────────────
export const POI_DEFS = {
  mine:     { name:'폐광',       color:'#8B4513', gp:100 },
  temple:   { name:'고대 신전',  color:'#9B59B6', gp:500 },
  dragon:   { name:'드래곤 둥지',color:'#E74C3C', gp:1000 },
  treasure: { name:'보물상자',   color:'#F39C12', gp:200 },
  monster:  { name:'몬스터 소굴',color:'#27AE60', gp:80 },
  ruins:    { name:'고대 폐허',  color:'#7F8C8D', gp:150 },
};

// ── 카메라 상태 ───────────────────────────────────────────────────────────
let _camX=CASTLE_WX, _camY=CASTLE_WY;
let _viewW=1200;  // 성 전체(2400유닛)의 절반 — 성벽+도로 일부 표시
let _cW=360, _cH=640, _scale=1;

export function initCamera(cv){
  _cW=cv.width; _cH=cv.height; _viewW=1200; _recalc();
}
export function resizeCamera(w,h){ _cW=w; _cH=h; _recalc(); }
function _recalc(){ _scale=_cW/_viewW; }

export function getScale(){ return _scale; }
export function getCam(){ return {x:_camX,y:_camY,vw:_viewW}; }

export function worldToScreen(wx,wy){
  return [(wx-_camX)*_scale+_cW/2, (wy-_camY)*_scale+_cH/2];
}
export function screenToWorld(sx,sy){
  return [(sx-_cW/2)/_scale+_camX, (sy-_cH/2)/_scale+_camY];
}
export function panBy(dxPx,dyPx){
  const hv=(_cH/_cW)*_viewW/2;
  _camX=clamp(_camX-dxPx/_scale,_viewW/2,WX-_viewW/2);
  _camY=clamp(_camY-dyPx/_scale,hv,WY-hv);
}
export function moveCamTo(wx,wy){ _camX=clamp(wx,0,WX); _camY=clamp(wy,0,WY); }
export function zoomBy(f){
  _viewW=clamp(_viewW/f,400,8000); _recalc();
}
export function getVisibleRect(){
  const hw=_viewW/2, hh=(_cH/_cW)*_viewW/2;
  return{l:_camX-hw,r:_camX+hw,t:_camY-hh,b:_camY+hh};
}
function clamp(v,lo,hi){ return v<lo?lo:v>hi?hi:v; }

// ── 안개 그리드 ───────────────────────────────────────────────────────────
export function makeFogGrid(){
  const g=new Uint8Array(FOG_COLS*FOG_ROWS).fill(1);
  _doReveal(g,CASTLE_WX,CASTLE_WY,INIT_REVEAL_R);
  return g;
}
function _idx(c,r){ return r*FOG_COLS+c; }
function _wToC(wx,wy){
  return[clamp(Math.floor(wx/CELL_W),0,FOG_COLS-1),
         clamp(Math.floor(wy/CELL_H),0,FOG_ROWS-1)];
}
function _doReveal(g,wx,wy,r){
  const cMin=Math.max(0,Math.floor((wx-r)/CELL_W));
  const cMax=Math.min(FOG_COLS-1,Math.ceil((wx+r)/CELL_W));
  const rMin=Math.max(0,Math.floor((wy-r)/CELL_H));
  const rMax=Math.min(FOG_ROWS-1,Math.ceil((wy+r)/CELL_H));
  for(let row=rMin;row<=rMax;row++){
    for(let col=cMin;col<=cMax;col++){
      const cx=(col+.5)*CELL_W, cy=(row+.5)*CELL_H;
      if(Math.hypot(cx-wx,cy-wy)<=r){ g[_idx(col,row)]=0; _mmDirty=true; }
    }
  }
}

export function revealFog(g,wx,wy,radius,pois=[]){
  _doReveal(g,wx,wy,radius);
  const disc=[];
  for(const p of pois){
    if(p.discovered) continue;
    if(Math.hypot(p.x-wx,p.y-wy)>radius+CELL_W*2) continue;
    const[c,r]=_wToC(p.x,p.y);
    if(g[_idx(c,r)]===0){ p.discovered=true; disc.push(p); }
  }
  return disc;
}
export function isFogRevealed(g,wx,wy){
  const[c,r]=_wToC(wx,wy); return g[_idx(c,r)]===0;
}

// ── POI 생성 ──────────────────────────────────────────────────────────────
export function generatePOIs(){
  const pois=[],cfg=[
    {type:'mine',    n:18,minR:600, reward:100},
    {type:'temple',  n:5, minR:2500,reward:500},
    {type:'dragon',  n:3, minR:3800,reward:1000},
    {type:'treasure',n:22,minR:400, reward:200},
    {type:'monster', n:12,minR:800, reward:80},
    {type:'ruins',   n:8, minR:1200,reward:150},
  ];
  for(const c of cfg){
    let placed=0,tries=0;
    while(placed<c.n&&tries<3000){
      tries++;
      const a=Math.random()*Math.PI*2;
      const d=c.minR+Math.random()*(4600-Math.min(c.minR,4600));
      const x=CASTLE_WX+Math.cos(a)*d, y=CASTLE_WY+Math.sin(a)*d;
      if(x<200||x>WX-200||y<200||y>WY-200) continue;
      if(pois.some(q=>Math.hypot(q.x-x,q.y-y)<380)) continue;
      pois.push({id:pois.length,type:c.type,x,y,reward:c.reward,discovered:false});
      placed++;
    }
  }
  return pois;
}

// ── 안개 해제 애니메이션 ──────────────────────────────────────────────────
const _anims=[];
export function addRevealAnim(wx,wy,maxR){
  _anims.push({wx,wy,maxR,t:0,dur:1200});
}
export function updateRevealAnims(dt){
  for(let i=_anims.length-1;i>=0;i--){ _anims[i].t+=dt; if(_anims[i].t>_anims[i].dur) _anims.splice(i,1); }
}
export function getRevealAnims(){ return _anims; }

// ── 미니맵 ───────────────────────────────────────────────────────────────
const MM=150;
let _mmOff=null,_mmCtx=null,_mmDirty=true;

function _initMM(){
  if(_mmOff) return;
  _mmOff=document.createElement('canvas'); _mmOff.width=MM; _mmOff.height=MM;
  _mmCtx=_mmOff.getContext('2d');
}
function _redrawMM(fogGrid,pois){
  _mmCtx.fillStyle='#050a03'; _mmCtx.fillRect(0,0,MM,MM);
  const idata=_mmCtx.createImageData(MM,MM);
  const sw=MM/FOG_COLS, sh=MM/FOG_ROWS;
  for(let r=0;r<FOG_ROWS;r++){
    for(let c=0;c<FOG_COLS;c++){
      if(fogGrid[_idx(c,r)]!==0) continue;
      const px=Math.floor(c*sw),py=Math.floor(r*sh);
      const pw=Math.max(1,Math.ceil(sw)),ph=Math.max(1,Math.ceil(sh));
      for(let dy=0;dy<ph&&py+dy<MM;dy++){
        for(let dx=0;dx<pw&&px+dx<MM;dx++){
          const i=((py+dy)*MM+(px+dx))*4;
          idata.data[i]=25;idata.data[i+1]=55;idata.data[i+2]=15;idata.data[i+3]=255;
        }
      }
    }
  }
  _mmCtx.putImageData(idata,0,0);
  pois.forEach(p=>{
    if(!p.discovered) return;
    _mmCtx.fillStyle=POI_DEFS[p.type]?.color||'#fff';
    _mmCtx.fillRect(p.x/WX*MM-1.5,p.y/WY*MM-1.5,3,3);
  });
  _mmCtx.fillStyle='#fbbf24';
  _mmCtx.fillRect(CASTLE_WX/WX*MM-3,CASTLE_WY/WY*MM-3,6,6);
  _mmDirty=false;
}

export function drawMinimap(ctx,fogGrid,pois,scouts,cw,ch){
  _initMM();
  if(_mmDirty) _redrawMM(fogGrid,pois);
  const x=cw-MM-6,y=6;
  ctx.fillStyle='rgba(0,0,0,.8)'; ctx.fillRect(x-2,y-2,MM+4,MM+4);
  ctx.drawImage(_mmOff,x,y);
  // 뷰포트 표시
  const v=getVisibleRect();
  const vx=v.l/WX*MM+x,vy=v.t/WY*MM+y;
  const vw=(v.r-v.l)/WX*MM,vh=(v.b-v.t)/WY*MM;
  ctx.strokeStyle='rgba(255,255,255,.7)'; ctx.lineWidth=1;
  ctx.strokeRect(vx,vy,Math.max(2,vw),Math.max(2,vh));
  // 정찰대
  scouts?.forEach(s=>{
    if(s.type!=='scout') return;
    ctx.fillStyle='#34d399';
    ctx.beginPath(); ctx.arc(s.x/WX*MM+x,s.y/WY*MM+y,2,0,Math.PI*2); ctx.fill();
  });
  ctx.fillStyle='rgba(255,255,255,.4)'; ctx.font='8px sans-serif';
  ctx.textAlign='left'; ctx.fillText('미니맵',x+2,y+MM-2);
}

export function minimapHit(sx,sy,cw,ch){
  const x=cw-MM-6,y=6;
  if(sx<x||sx>x+MM||sy<y||sy>y+MM) return null;
  return{wx:(sx-x)/MM*WX, wy:(sy-y)/MM*WY};
}
