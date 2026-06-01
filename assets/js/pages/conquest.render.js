// conquest.render.js — 렌더링 (카메라·성·안개·유닛·POI·타워)
import {
  worldToScreen, getScale, getVisibleRect, getRevealAnims,
  drawMinimap, WX, WY, FOG_COLS, FOG_ROWS, CELL_W, CELL_H,
  CASTLE_WX, CASTLE_WY,
} from './conquest.world.js';
import { getFrame, MINES, UNIT_DEFS } from './conquest.units.js';
import { POI_DEFS } from './conquest.world.js';
import { ROAD_SEGMENTS } from './conquest.path.js';

let _cv, _ctx, _mapImg;
let _fogCv=null, _fogCtx=null;
let _towerImgs = {};

// ── 건물 타일 (픽셀 분석으로 자동 감지) ─────────────────────────────────
const OBS_GRID = 40;                   // 40×40 분석 격자
let _buildingTiles = null;             // [{wx,wy,cellW,cellH,srcX,...}]
let _obstacleMap  = null;              // Uint8Array — 배치 제한용

// 캐릭터 드로우 스케일 — hitbox 대비 화면 렌더 크기 배율
const DR = 5;
const TOWER_DR = DR * 2/3; // 타워 크기 (이전 1/3에서 ×2배)

export function initRenderer(cv){
  _cv=cv; _ctx=cv.getContext('2d');
  _ctx.imageSmoothingEnabled=true;
  _ctx.imageSmoothingQuality='high';
  _fogCv=null;
}
export async function loadMapAssets(){
  _mapImg=await _ldImg('/assets/images/conquest/map.png');
  _towerImgs.archer_tower=await _ldImg('/assets/images/shops/tower.png');
  _towerImgs.cannon_tower=await _ldImg('/assets/images/shops/tower2.png');
  if(_mapImg) _analyzeBuildings();
}

// 맵 이미지 픽셀 분석 → 어두운 픽셀(건물·숲) = obstacle 타일
function _analyzeBuildings(){
  const oc=document.createElement('canvas');
  oc.width=OBS_GRID; oc.height=OBS_GRID;
  const octx=oc.getContext('2d',{willReadFrequently:true});
  octx.drawImage(_mapImg,0,0,OBS_GRID,OBS_GRID);
  const d=octx.getImageData(0,0,OBS_GRID,OBS_GRID).data;
  const cW=WX/OBS_GRID, cH=WY/OBS_GRID;
  const iW=_mapImg.naturalWidth, iH=_mapImg.naturalHeight;
  _buildingTiles=[];
  _obstacleMap=new Uint8Array(OBS_GRID*OBS_GRID);
  for(let cy=0;cy<OBS_GRID;cy++){
    for(let cx=0;cx<OBS_GRID;cx++){
      const i=(cy*OBS_GRID+cx)*4;
      const lum=d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;
      if(lum<65){
        _obstacleMap[cy*OBS_GRID+cx]=1;
        _buildingTiles.push({
          wx:(cx+.5)*cW, wy:(cy+.5)*cH, cW, cH,
          srcX:cx/OBS_GRID*iW, srcY:cy/OBS_GRID*iH,
          srcW:iW/OBS_GRID,    srcH:iH/OBS_GRID,
        });
      }
    }
  }
}

// 외부에서 배치 가능 여부 확인 (conquest.js에서 import)
export function isMapObstacle(wx,wy){
  if(!_obstacleMap) return false;
  const cx=Math.min(OBS_GRID-1,Math.max(0,Math.floor(wx/WX*OBS_GRID)));
  const cy=Math.min(OBS_GRID-1,Math.max(0,Math.floor(wy/WY*OBS_GRID)));
  return _obstacleMap[cy*OBS_GRID+cx]===1;
}
function _ldImg(src){
  return new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.onerror=()=>r(null);i.src=src;});
}

// ── 메인 렌더 ─────────────────────────────────────────────────────────────
export function renderScene({defenders,monsters,castleHp,maxCastleHp,walls,fogGrid,pois,prepCountdown,wave,phase},sprites){
  if(!_ctx)return;
  const W=_cv.width,H=_cv.height;
  _ctx.clearRect(0,0,W,H);

  _drawMap(W,H);
  _drawRoads();
  _drawMines();
  _drawPOIs(pois);
  _drawCastleHP(castleHp,maxCastleHp);
  if(walls) _drawWalls(walls);
  _drawFog(fogGrid);
  _drawRevealAnims();

  // 몬스터 이동 경로 안개 걷힘 — render단에서 처리 (world coords만 사용)
  // (실제 revealFog 호출은 conquest.js _update에서 처리됨)

  // ── 유닛 + 건물 타일 Y축 정렬 통합 렌더 ──────────────────────────────
  const vis=getVisibleRect();
  const buf=200;

  const visUnits=[...defenders,...monsters]
    .filter(u=>u.x>vis.l-buf&&u.x<vis.r+buf&&u.y>vis.t-buf&&u.y<vis.b+buf);

  // 건물 타일: sortY = 타일 앞쪽 경계 (유닛이 이 Y보다 아래 있으면 타일 앞에 보임)
  const visTiles=(_buildingTiles||[]).filter(t=>
    t.wx>vis.l-t.cW&&t.wx<vis.r+t.cW&&t.wy>vis.t-t.cH&&t.wy<vis.b+t.cH
  );

  const renderList=[
    ...visUnits.map(u=>({isUnit:true,  obj:u, sortY:u.y})),
    ...visTiles.map(t=>({isUnit:false, obj:t, sortY:t.wy+t.cH*0.35})),
  ].sort((a,b)=>a.sortY-b.sortY);

  for(const item of renderList){
    if(item.isUnit) _drawUnit(item.obj,sprites);
    else _drawBuildingTile(item.obj);
  }

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
  const s=getScale();
  const[sx,sy]=worldToScreen(0,0);
  _ctx.imageSmoothingEnabled=true;
  _ctx.imageSmoothingQuality='high';
  _ctx.drawImage(_mapImg,sx,sy,WX*s,WY*s);
}

// ── 도로 선 렌더링 (맵 이미지 위에 오버레이, 반투명) ────────────────────
function _drawRoads(){
  const s=getScale();
  // 맵 이미지에 이미 도로가 그려져 있으므로 가이드 라인만 가볍게 표시
  const roadW=Math.max(2,120*s); // 실제 도로 폭(약 200유닛)에 근사
  _ctx.save();
  _ctx.strokeStyle='rgba(220,190,100,0.18)';
  _ctx.lineWidth=roadW;
  _ctx.lineCap='round';
  _ctx.lineJoin='round';
  for(const[a,b]of ROAD_SEGMENTS){
    const[ax,ay]=worldToScreen(a.x,a.y);
    const[bx,by]=worldToScreen(b.x,b.y);
    _ctx.beginPath();_ctx.moveTo(ax,ay);_ctx.lineTo(bx,by);_ctx.stroke();
  }
  _ctx.restore();
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
  const s=getScale();
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

// ── 성 HP 바 ─────────────────────────────────────────────────────────────
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

// ── 성벽 HP 바 (고급스러운 디자인) ──────────────────────────────────────
const WALL_POS = {
  north:{wx:5000,wy:3800,axis:'h'},
  south:{wx:5000,wy:6200,axis:'h'},
  west: {wx:3800,wy:5000,axis:'v'},
  east: {wx:6200,wy:5000,axis:'v'},
};
const WALL_LABEL = {north:'북벽',south:'남벽',west:'서벽',east:'동벽'};

function _drawWalls(walls){
  const s=getScale(), ts=performance.now();
  for(const[key,w]of Object.entries(walls)){
    const pos=WALL_POS[key];
    const[sx,sy]=worldToScreen(pos.wx,pos.wy);
    if(!_inView(sx,sy,120)) continue;
    const pct=w.hp/w.maxHp;

    if(w.breached){
      // 함락: 깜빡이는 불꽃 오버레이
      const flicker=Math.sin(ts*0.015)*0.3+0.7;
      _ctx.save();
      _ctx.globalAlpha=flicker*0.85;
      _ctx.fillStyle='#ef4444';
      _ctx.font=`bold ${Math.max(12,14*s)}px sans-serif`;
      _ctx.textAlign='center';
      _ctx.shadowColor='#ff0000'; _ctx.shadowBlur=12*s;
      _ctx.fillText('🔥 함락',sx,sy-(pos.axis==='h'?28:0)*s);
      _ctx.restore();
      continue;
    }

    // 바 크기 및 위치
    const bw=Math.max(60,100*s), bh=Math.max(6,8*s);
    const bx=sx-bw/2;
    const by=pos.axis==='h' ? sy-(30+bh)*s : sy-bh/2;

    // 배경 (반투명 다크)
    _ctx.save();
    _ctx.fillStyle='rgba(0,0,0,0.7)';
    _roundRect(bx-2,by-2,bw+4,bh+4,3);
    _ctx.fill();

    // 피해 구간 (회색)
    _ctx.fillStyle='rgba(80,30,30,0.8)';
    _roundRect(bx,by,bw,bh,2);
    _ctx.fill();

    // HP 구간 (그라디언트)
    const grad=_ctx.createLinearGradient(bx,by,bx+bw*pct,by);
    if(pct>0.6){grad.addColorStop(0,'#22c55e');grad.addColorStop(1,'#16a34a');}
    else if(pct>0.3){grad.addColorStop(0,'#f59e0b');grad.addColorStop(1,'#d97706');}
    else{grad.addColorStop(0,'#ef4444');grad.addColorStop(1,'#dc2626');}
    _ctx.fillStyle=grad;
    _roundRect(bx,by,bw*pct,bh,2);
    _ctx.fill();

    // 광택 하이라이트
    _ctx.fillStyle='rgba(255,255,255,0.15)';
    _ctx.fillRect(bx,by,bw*pct,bh/2);

    // 테두리
    _ctx.strokeStyle='rgba(255,255,255,0.2)'; _ctx.lineWidth=1;
    _roundRect(bx-2,by-2,bw+4,bh+4,3);
    _ctx.stroke();

    // 라벨
    _ctx.fillStyle='rgba(255,255,255,0.9)';
    _ctx.font=`bold ${Math.max(8,9*s)}px sans-serif`;
    _ctx.textAlign='center';
    _ctx.fillText(`${WALL_LABEL[key]} ${Math.ceil(w.hp)}`,sx,by-3*s);
    _ctx.restore();
  }
}

// 둥근 사각형 헬퍼
function _roundRect(x,y,w,h,r){
  if(w<=0)return;
  _ctx.beginPath();
  _ctx.moveTo(x+r,y);
  _ctx.lineTo(x+w-r,y); _ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  _ctx.lineTo(x+w,y+h-r); _ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  _ctx.lineTo(x+r,y+h); _ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  _ctx.lineTo(x,y+r); _ctx.quadraticCurveTo(x,y,x+r,y);
  _ctx.closePath();
}

// ── 안개 (destination-out 원형 + 대형 blur → 자욱한 안개) ───────────────
function _drawFog(fogGrid){
  if(!fogGrid) return;
  const W=_cv.width, H=_cv.height;
  const vis=getVisibleRect(), s=getScale();

  if(!_fogCv||_fogCv.width!==W||_fogCv.height!==H){
    _fogCv=document.createElement('canvas');
    _fogCv.width=W; _fogCv.height=H;
    _fogCtx=_fogCv.getContext('2d');
  }
  const fc=_fogCtx;
  fc.clearRect(0,0,W,H);

  // 1. 짙은 안개색으로 전체 채우기
  fc.fillStyle='rgba(5,9,3,1)';
  fc.fillRect(0,0,W,H);

  // 2. 안개 표면 wisp (드리프트) — 소용돌이 패턴
  _paintFogWisps(fc, W, H);

  // 3. 가시 영역을 원형으로 잘라냄 (destination-out)
  fc.save();
  fc.globalCompositeOperation='destination-out';
  fc.fillStyle='rgba(0,0,0,1)';

  const cMin=Math.max(0,Math.floor(vis.l/CELL_W)-2);
  const cMax=Math.min(FOG_COLS-1,Math.ceil(vis.r/CELL_W)+2);
  const rMin=Math.max(0,Math.floor(vis.t/CELL_H)-2);
  const rMax=Math.min(FOG_ROWS-1,Math.ceil(vis.b/CELL_H)+2);
  const anims=getRevealAnims();
  const cellPx=CELL_W*s;
  const circR=Math.max(cellPx, 3);  // 픽셀 이하 셀도 최소 3px

  for(let r=rMin;r<=rMax;r++){
    for(let c=cMin;c<=cMax;c++){
      if(fogGrid[r*FOG_COLS+c]!==0) continue;  // 안개 있음 → 건너뜀
      const wx=(c+.5)*CELL_W, wy=(r+.5)*CELL_H;
      const[px,py]=worldToScreen(wx,wy);
      let alpha=1;
      for(const a of anims){
        const p=Math.min(1,a.t/a.dur);
        if(Math.hypot(wx-a.wx,wy-a.wy)<a.maxR*p) alpha=Math.max(alpha,p);
      }
      fc.globalAlpha=alpha;
      fc.beginPath();
      fc.arc(px,py,circR,0,Math.PI*2);
      fc.fill();
    }
  }
  fc.globalAlpha=1;
  fc.restore();

  // 4. 큰 blur → 경계가 자욱하게 번짐
  const blurPx=Math.max(40, Math.round(cellPx*3));
  _ctx.save();
  _ctx.filter=`blur(${blurPx}px)`;
  _ctx.drawImage(_fogCv,0,0);
  _ctx.restore();
}

// wisp 설정 (모듈 레벨 — 매 프레임 재생성 없이 재사용)
const _WISPS=[
  {ph:0,     sp:0.00022,rx:0.32,ry:0.22},
  {ph:1.047, sp:0.00017,rx:0.28,ry:0.18},
  {ph:2.094, sp:0.00030,rx:0.24,ry:0.28},
  {ph:3.141, sp:0.00019,rx:0.35,ry:0.16},
  {ph:4.189, sp:0.00026,rx:0.20,ry:0.30},
  {ph:5.236, sp:0.00015,rx:0.30,ry:0.24},
];

// 안개 캔버스 위에 천천히 흐르는 반투명 wisp 패턴 그리기
function _paintFogWisps(fc, W, H){
  const t=performance.now();
  for(const w of _WISPS){
    const cx=W*(0.5+0.48*Math.sin(t*w.sp+w.ph));
    const cy=H*(0.5+0.48*Math.cos(t*w.sp*0.65+w.ph));
    const r=Math.min(W,H)*(w.rx+w.ry*0.5);
    const g=fc.createRadialGradient(cx,cy,0,cx,cy,r);
    g.addColorStop(0,'rgba(18,32,10,0.45)');   // 안개 속 연한 초록빛 코어
    g.addColorStop(0.45,'rgba(10,18,6,0.22)');
    g.addColorStop(1,'rgba(0,0,0,0)');
    fc.fillStyle=g;
    fc.beginPath();
    fc.arc(cx,cy,r,0,Math.PI*2);
    fc.fill();
  }
}

// ── 안개 해제 이펙트 ──────────────────────────────────────────────────────
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

// ── 유닛 (DR=5 적용: 스프라이트·타워 모두 5배 크기로 렌더) ──────────────
function _drawUnit(u,sprites){
  const[sx,sy]=worldToScreen(u.x,u.y);
  const s=getScale();
  const sz=u.size*s;                          // hitbox 기준 크기
  const dsz=sz*(u.isTower?TOWER_DR:DR);       // 타워 1/3, 유닛 5배

  // 선택 링 — 스프라이트 크기에 맞춤
  if(u.selected){
    _ctx.strokeStyle=u.team==='ally'?'#22c55e':'#ff4444';
    _ctx.lineWidth=3;
    _ctx.beginPath(); _ctx.ellipse(sx,sy,dsz*.46,dsz*.15,0,0,Math.PI*2); _ctx.stroke();
    // 이동 목표 위치 표시
    if(u.cmdX!==null){
      const[tx,ty]=worldToScreen(u.cmdX,u.cmdY);
      _ctx.save();
      _ctx.strokeStyle='rgba(34,197,94,.7)'; _ctx.lineWidth=2;
      _ctx.setLineDash([4,3]);
      _ctx.beginPath(); _ctx.moveTo(sx,sy); _ctx.lineTo(tx,ty); _ctx.stroke();
      _ctx.setLineDash([]);
      _ctx.fillStyle='#22c55e';
      _ctx.beginPath(); _ctx.arc(tx,ty,5,0,Math.PI*2); _ctx.fill();
      _ctx.restore();
    }
    // 순찰 반경 표시
    if(u.patrolMode&&u.patrolHome){
      const r={villager:100,scout:100,miner:80,hero:200}[u.type]||100;
      const[hx,hy]=worldToScreen(u.patrolHome.x,u.patrolHome.y);
      _ctx.save();
      _ctx.strokeStyle='rgba(251,146,60,.5)'; _ctx.lineWidth=2;
      _ctx.setLineDash([6,4]);
      _ctx.beginPath(); _ctx.arc(hx,hy,r*s,0,Math.PI*2); _ctx.stroke();
      _ctx.fillStyle='rgba(251,146,60,.7)';
      _ctx.beginPath(); _ctx.arc(hx,hy,4,0,Math.PI*2); _ctx.fill();
      _ctx.restore();
    }
  }

  // 비행 유닛 그림자 (지면 높이에 타원)
  if(u.flying){
    _ctx.save();
    _ctx.fillStyle='rgba(0,0,0,0.25)';
    _ctx.beginPath(); _ctx.ellipse(sx,sy,dsz*.35,dsz*.1,0,0,Math.PI*2); _ctx.fill();
    _ctx.restore();
  }

  _ctx.save();
  if(u.hitFlash>0&&Math.floor(u.hitFlash/45)%2===0) _ctx.globalAlpha=.4;
  // 비행 유닛은 약간 위로 띄워서 렌더
  const flyOffset = u.flying ? -dsz*0.25 : 0;

  if(u.isTower){
    _drawTower(u,sx,sy,dsz,s);
  } else {
    const img=getFrame(u,sprites);
    const drawImg=img||(u.team==='monster'?getFrame({...u,spriteKey:'troll'},sprites):null);
    if(drawImg){
      const ry=sy+flyOffset; // 비행 유닛은 flyOffset만큼 위로
      if(u.flipH){ _ctx.scale(-1,1); _ctx.drawImage(drawImg,-sx-dsz/2,ry-dsz,dsz,dsz); }
      else _ctx.drawImage(drawImg,sx-dsz/2,ry-dsz,dsz,dsz);
    } else {
      _ctx.fillStyle=u.team==='ally'?'#60a5fa':'#ef4444';
      _ctx.beginPath(); _ctx.arc(sx,sy-dsz/2,dsz/2,0,Math.PI*2); _ctx.fill();
    }
  }
  _ctx.restore();

  // HP 바 (5배 크기 위에 표시)
  if(!u.dying){
    const topY = sy - dsz - 4*s;
    const bw=dsz*.85, bh=Math.max(4,4*s), bx=sx-bw/2;
    const pct=Math.max(0,u.hp/u.maxHp);
    _ctx.fillStyle='rgba(0,0,0,.6)'; _ctx.fillRect(bx-1,topY-1,bw+2,bh+2);
    _ctx.fillStyle=u.team==='ally'?'#22c55e':'#ef4444';
    _ctx.fillRect(bx,topY,bw*pct,bh);
  }
}

// ── 타워 이미지 렌더링 (tower.png / tower2.png) ───────────────────────────
function _drawTower(u,sx,sy,dsz,s){
  const img=_towerImgs[u.type];
  if(img&&img.complete&&img.naturalWidth>0){
    _ctx.drawImage(img,sx-dsz/2,sy-dsz,dsz,dsz);
  } else {
    // 이미지 로드 전 fallback
    _ctx.fillStyle=u.type==='archer_tower'?'#a0522d':'#555';
    _ctx.fillRect(sx-dsz*0.25,sy-dsz*0.8,dsz*0.5,dsz*0.8);
  }
  // 선택 시 사거리 표시
  if(u.selected){
    const isArcher=u.type==='archer_tower';
    _ctx.save();
    _ctx.strokeStyle=isArcher?'rgba(255,220,80,0.4)':'rgba(255,80,80,0.4)';
    _ctx.lineWidth=2;
    _ctx.setLineDash([6*s,4*s]);
    // 사정거리 원 중심 = 월드 기준점(sy) — 실제 distance 계산과 일치
    _ctx.beginPath();_ctx.arc(sx,sy,u.range*s,0,Math.PI*2);_ctx.stroke();
    _ctx.restore();
  }
}

// ── 건물 타일 재드로우 (유닛 위에 겹쳐 깊이 생성) ─────────────────────
function _drawBuildingTile(t){
  if(!_mapImg) return;
  const s=getScale();
  const[sx,sy]=worldToScreen(t.wx-t.cW/2, t.wy-t.cH/2);
  const dw=t.cW*s+1, dh=t.cH*s+1;
  _ctx.drawImage(_mapImg, t.srcX, t.srcY, t.srcW, t.srcH, sx, sy, dw, dh);
}

function _inView(sx,sy,pad){
  return sx>-pad&&sx<_cv.width+pad&&sy>-pad&&sy<_cv.height+pad;
}
