// merchants.dungeon.map.js — 던전 맵 그리드 + A* 경로탐색

export const WORLD_W  = 500;
export const WORLD_H  = 500;
export const GRID_W   = 200;   // 셀 수
export const GRID_H   = 200;
export const CELL     = WORLD_W / GRID_W;  // 2.5 units per cell

let _walkable = null;   // Uint8Array GRID_W × GRID_H  1=floor 0=wall
let _mapImg   = null;

// ── 맵 로드 (PNG 픽셀 → walkable 그리드) ──────────────────────────────────
export async function loadDungeonMap(src) {
  _mapImg = await _loadImg(src);

  const tc = document.createElement('canvas');
  tc.width = GRID_W; tc.height = GRID_H;
  const tx = tc.getContext('2d');
  tx.drawImage(_mapImg, 0, 0, GRID_W, GRID_H);
  const px = tx.getImageData(0, 0, GRID_W, GRID_H).data;

  const raw = new Uint8Array(GRID_W * GRID_H);
  for (let i = 0; i < raw.length; i++) {
    const avg = (px[i*4] + px[i*4+1] + px[i*4+2]) / 3;
    raw[i] = avg > 38 ? 1 : 0;
  }

  // 벽 침투 방지용 1셀 침식 (erosion)
  _walkable = new Uint8Array(GRID_W * GRID_H);
  for (let y = 1; y < GRID_H-1; y++) {
    for (let x = 1; x < GRID_W-1; x++) {
      if (raw[y*GRID_W+x] && raw[(y-1)*GRID_W+x] && raw[(y+1)*GRID_W+x]
          && raw[y*GRID_W+x-1] && raw[y*GRID_W+x+1]) {
        _walkable[y*GRID_W+x] = 1;
      }
    }
  }

  const rooms = _detectRooms();
  return { img: _mapImg, walkable: _walkable, rooms };
}

export function getMapImg()   { return _mapImg; }
export function getWalkable() { return _walkable; }

// ── 방 감지 (Flood Fill → 연결된 플로어 영역) ─────────────────────────────
function _detectRooms() {
  if (!_walkable) return [];
  const vis = new Uint8Array(GRID_W * GRID_H);
  const rooms = [];

  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (!_walkable[y*GRID_W+x] || vis[y*GRID_W+x]) continue;
      const cells = [];
      const q = [[x,y]];
      vis[y*GRID_W+x] = 1;
      while (q.length) {
        const [cx,cy] = q.shift();
        cells.push([cx,cy]);
        for (const [nx,ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]]) {
          if (nx<0||nx>=GRID_W||ny<0||ny>=GRID_H) continue;
          const ni = ny*GRID_W+nx;
          if (!_walkable[ni]||vis[ni]) continue;
          vis[ni]=1; q.push([nx,ny]);
        }
      }
      if (cells.length < 40) continue;  // 최소 방 크기

      const cx = cells.reduce((s,[x])=>s+x,0)/cells.length;
      const cy = cells.reduce((s,[,y])=>s+y,0)/cells.length;
      rooms.push({
        cells,
        cx: cx*CELL + CELL/2,
        cy: cy*CELL + CELL/2,
        size: cells.length,
        spawnPoints: _samplePoints(cells, 12),
      });
    }
  }
  return rooms.sort((a,b)=>b.size-a.size);
}

function _samplePoints(cells, n) {
  const pts=[], step=Math.max(1,Math.floor(cells.length/n));
  for (let i=0; i<cells.length && pts.length<n; i+=step) {
    const [gx,gy]=cells[i];
    pts.push({ x:gx*CELL+CELL/2, y:gy*CELL+CELL/2 });
  }
  return pts;
}

// ── 좌표 변환 ─────────────────────────────────────────────────────────────
export function toCell(wx,wy) {
  return [Math.floor(wx/CELL), Math.floor(wy/CELL)];
}
export function toWorld(cx,cy) {
  return [cx*CELL+CELL/2, cy*CELL+CELL/2];
}

// ── 충돌 쿼리 ─────────────────────────────────────────────────────────────
export function isWalkable(wx,wy) {
  if (!_walkable) return true;
  const [cx,cy]=toCell(wx,wy);
  if (cx<0||cx>=GRID_W||cy<0||cy>=GRID_H) return false;
  return _walkable[cy*GRID_W+cx]===1;
}

// 원형 충돌 고려 이동 (슬라이딩)
export function tryMove(x, y, dx, dy, r=2.2) {
  const ok = (wx,wy) => isWalkable(wx,wy)
    && isWalkable(wx-r,wy) && isWalkable(wx+r,wy)
    && isWalkable(wx,wy-r) && isWalkable(wx,wy+r);
  const nx=x+dx, ny=y+dy;
  if (ok(nx,ny))   return {x:nx,y:ny};
  if (ok(x+dx,y))  return {x:x+dx,y};
  if (ok(x,y+dy))  return {x,y:y+dy};
  return {x,y};
}

// ── A* 경로탐색 ────────────────────────────────────────────────────────────
const _DIRS4 = [[-1,0],[1,0],[0,-1],[0,1]];

export function findPath(sx, sy, gx, gy) {
  if (!_walkable) return [{x:gx,y:gy}];
  const [x0,y0]=toCell(sx,sy), [x1,y1]=toCell(gx,gy);
  if (x0===x1&&y0===y1) return [{x:gx,y:gy}];
  if (!_inB(x0,y0)||!_inB(x1,y1)) return null;
  if (!_walkable[y1*GRID_W+x1]) return null;

  const N = GRID_W*GRID_H;
  const gCost = new Float32Array(N).fill(Infinity);
  const prev  = new Int32Array(N).fill(-1);
  const open  = [];
  const si    = y0*GRID_W+x0;
  gCost[si]=0;
  _push(open,{i:si, f:_h(x0,y0,x1,y1)});

  const goalI = y1*GRID_W+x1;
  while (open.length) {
    const cur=_pop(open);
    if (cur.i===goalI) return _buildPath(prev,goalI,gx,gy);
    const cx=cur.i%GRID_W, cy=Math.floor(cur.i/GRID_W);
    for (const [dx,dy] of _DIRS4) {
      const nx=cx+dx,ny=cy+dy;
      if (!_inB(nx,ny)) continue;
      const ni=ny*GRID_W+nx;
      if (!_walkable[ni]) continue;
      const ng=gCost[cur.i]+1;
      if (ng<gCost[ni]) {
        gCost[ni]=ng; prev[ni]=cur.i;
        _push(open,{i:ni, f:ng+_h(nx,ny,x1,y1)});
      }
    }
  }
  return null;
}

function _buildPath(prev, endI, gx, gy) {
  const cells=[]; let ci=endI;
  while (ci>=0&&cells.length<600){cells.unshift(ci);ci=prev[ci];}
  const pts=[];
  for (let i=0;i<cells.length;i++) {
    if (i>0&&i<cells.length-1) {
      // 직선 단순화
      const ax=cells[i]%GRID_W-cells[i-1]%GRID_W;
      const bx=cells[i+1]%GRID_W-cells[i]%GRID_W;
      const ay=Math.floor(cells[i]/GRID_W)-Math.floor(cells[i-1]/GRID_W);
      const by=Math.floor(cells[i+1]/GRID_W)-Math.floor(cells[i]/GRID_W);
      if (ax===bx&&ay===by) continue;
    }
    const cx=cells[i]%GRID_W, cy=Math.floor(cells[i]/GRID_W);
    pts.push({x:cx*CELL+CELL/2, y:cy*CELL+CELL/2});
  }
  pts.push({x:gx,y:gy});
  return pts;
}

function _h(x,y,gx,gy){ return Math.abs(x-gx)+Math.abs(y-gy); }
function _inB(x,y){ return x>=0&&x<GRID_W&&y>=0&&y<GRID_H; }

// Binary min-heap
function _push(h,v){ h.push(v);let i=h.length-1;while(i>0){const p=(i-1)>>1;if(h[p].f<=h[i].f)break;[h[i],h[p]]=[h[p],h[i]];i=p;}}
function _pop(h){ const t=h[0],l=h.pop();if(h.length){h[0]=l;let i=0;for(;;){let m=i,l2=2*i+1,r=2*i+2;if(l2<h.length&&h[l2].f<h[m].f)m=l2;if(r<h.length&&h[r].f<h[m].f)m=r;if(m===i)break;[h[i],h[m]]=[h[m],h[i]];i=m;}}return t;}

function _loadImg(src) {
  return new Promise((res,rej)=>{
    const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src;
  });
}
