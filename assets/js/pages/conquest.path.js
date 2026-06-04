// conquest.path.js — 맵 이미지 기반 하드코딩 경로 (AI 생성 금지)
// 이미지 분석: 성벽 3800-6200, 직선 4방향 도로, 각 모서리 스폰

export const CX = 5000, CY = 5000;

// ── 맵 기반 성문 위치 (이미지 상 성벽 외곽 출입문) ───────────────────────
export const GATE_NORTH = {x:5000, y:3800};
export const GATE_SOUTH = {x:5000, y:6200};
export const GATE_WEST  = {x:3800, y:5000};
export const GATE_EAST  = {x:6200, y:5000};

// ── 맵 이미지 위의 실제 도로 좌표 (디자이너 지정 경로) ───────────────────
// 규칙: AI가 이 경로를 수정하거나 새로 만들지 않는다
// 규칙: 몬스터는 반드시 이 순서대로만 이동한다
// 마지막 waypoint = 성벽에 바짝 붙은 위치 (거의 접촉)
// 규칙: 이 좌표 외 어떤 경로도 AI가 생성하지 않는다
export const ROADS = {
  north: [
    {x:5000, y:500},
    {x:5000, y:1500},
    {x:5000, y:2700},
    {x:5000, y:3802},  // 북문 성벽(y=3800) 바로 앞
  ],
  south: [
    {x:5000, y:9500},
    {x:5000, y:8500},
    {x:5000, y:7300},
    {x:5000, y:6198},  // 남문 성벽(y=6200) 바로 앞
  ],
  west: [
    {x:500,  y:5000},
    {x:1500, y:5000},
    {x:2700, y:5000},
    {x:3802, y:5000},  // 서문 성벽(x=3800) 바로 앞
  ],
  east: [
    {x:9500, y:5000},
    {x:8500, y:5000},
    {x:7300, y:5000},
    {x:6198, y:5000},  // 동문 성벽(x=6200) 바로 앞
  ],
};

// 스폰 포인트 (각 도로의 첫 번째 좌표)
const SPAWNS = [
  {x:5000, y:500,  road:'north'},
  {x:5000, y:9500, road:'south'},
  {x:500,  y:5000, road:'west'},
  {x:9500, y:5000, road:'east'},
];

// ── 도로 세그먼트 (렌더·스냅용) ──────────────────────────────────────────
export const ROAD_SEGMENTS = [];
for (const pts of Object.values(ROADS)) {
  for (let i=0;i<pts.length-1;i++) ROAD_SEGMENTS.push([pts[i],pts[i+1]]);
}

// ── 몬스터 경로 반환: 스폰 위치 기준으로 가장 가까운 도로 선택 ────────────
export function getMonsterPath(spawnX, spawnY) {
  let nearest=SPAWNS[0], minD=Infinity;
  for (const s of SPAWNS) {
    const d=Math.hypot(s.x-spawnX,s.y-spawnY);
    if(d<minD){minD=d;nearest=s;}
  }
  return [...ROADS[nearest.road]];
}

// ── 스폰 위치 생성 (side: 'rand'|'all'|'north'|'south'|'west'|'east') ─────
const ROAD_KEYS=['north','south','west','east'];
let _roundIdx=0;
export function getSpawnPos(side) {
  let road;
  if(side==='rand')      road=ROAD_KEYS[Math.floor(Math.random()*4)];
  else if(side==='all'){ road=ROAD_KEYS[_roundIdx%4]; _roundIdx++; }
  else                   road=side;
  const base=SPAWNS.find(s=>s.road===road)||SPAWNS[0];
  const sc=20; // 도로 위에서 약간 분산 (도로 폭 이내)
  return {
    x: base.x + (Math.random()-.5)*sc*2,
    y: base.y + (Math.random()-.5)*sc*2,
  };
}

// ── 드래곤 대각선 스폰 (2시·4시·7시·11시 방향) ─────────────────────────────
// 시계 방향 대각선 코너에서 날아옴 (flying 유닛 전용 — 도로 불필요)
const DRAGON_SPAWNS = [
  {x:8500, y:1200},  // 2시 (NE)
  {x:8500, y:8800},  // 4시 (SE)
  {x:1500, y:8800},  // 7시 (SW)
  {x:1200, y:1200},  // 11시 (NW)
];
let _dragonIdx = 0;
export function getDragonSpawnPos() {
  // 랜덤 선택 (같은 방향 연속 출현 방지: 마지막과 다른 위치 선택)
  let idx;
  do { idx = Math.floor(Math.random() * 4); } while (idx === _dragonIdx && Math.random() < 0.7);
  _dragonIdx = idx;
  const base = DRAGON_SPAWNS[idx];
  const sc = 120;
  return { x: base.x + (Math.random() - 0.5) * sc, y: base.y + (Math.random() - 0.5) * sc };
}

// ── 가장 가까운 도로 위 점 (수비대 이동 명령 스냅용) ─────────────────────
export function snapToRoad(wx, wy) {
  let best={x:wx,y:wy}, minD=Infinity;
  for (const [a,b] of ROAD_SEGMENTS) {
    const pt=_closestOnSeg(wx,wy,a,b);
    const d=Math.hypot(pt.x-wx,pt.y-wy);
    if(d<minD){minD=d;best=pt;}
  }
  return best;
}

function _closestOnSeg(px,py,a,b){
  const dx=b.x-a.x, dy=b.y-a.y, len2=dx*dx+dy*dy;
  if(!len2) return a;
  const t=Math.max(0,Math.min(1,((px-a.x)*dx+(py-a.y)*dy)/len2));
  return{x:a.x+t*dx, y:a.y+t*dy};
}

export function isOnRoad(wx, wy, threshold=200) {
  for (const [a,b] of ROAD_SEGMENTS) {
    const pt=_closestOnSeg(wx,wy,a,b);
    if(Math.hypot(pt.x-wx,pt.y-wy)<=threshold) return true;
  }
  return false;
}
