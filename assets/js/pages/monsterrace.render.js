// monsterrace.render.js — 의사3D 레이싱 렌더러 + 트랙 생성

// ── 트랙 ─────────────────────────────────────────────────────────────────────
export const SEGS = 300;        // 랩당 세그먼트 수
export const TOTAL_LAPS = 3;

export function buildTrack() {
  const t = [];
  const addStraight = (n, hill = 0) => {
    for (let i = 0; i < n; i++) t.push({ curve: 0, hill });
  };
  const addCurve = (n, c, hill = 0) => {
    for (let i = 0; i < n; i++) t.push({ curve: c, hill });
  };

  addStraight(40);
  addCurve(40, 3);
  addStraight(30, 8);          // 언덕
  addCurve(30, -3, 8);
  addStraight(20, -5);         // 내리막
  addCurve(50, 2);
  addStraight(20);
  addCurve(40, -4);
  addStraight(30);

  while (t.length < SEGS) t.push({ curve: 0, hill: 0 });
  return t.slice(0, SEGS);
}

// ── 렌더러 ───────────────────────────────────────────────────────────────────
const D_NEAR   = 600;    // 가장 가까운 도로 깊이 (추상단위)
const SEG_D    = 300;    // 세그먼트 당 깊이 단위
const DRAW_N   = 120;    // 렌더할 세그먼트 수
const ROAD_W   = 1.2;    // 화면 폭 비율 (근접 시)
const CAM_LEAD = 3;      // 플레이어가 카메라보다 앞선 세그먼트

let _ctx, _W, _H;

export function initRenderer(canvas) {
  _ctx = canvas.getContext('2d');
  _W   = canvas.width;
  _H   = canvas.height;
}

// 깊이(depth) → 화면 Y 좌표
function dToY(d) { return _H / 2 + D_NEAR * (_H / 2) / d; }
// 깊이 → 도로 반폭 (px)
function dToW(d) { return _W * ROAD_W * D_NEAR / (d * 2); }

// 사다리꼴 렌더링 (y1 > y2: 아래→위)
function drawTrap(y1, w1, cx1, y2, w2, cx2, road, grass, rumble, lanes) {
  if (y1 <= y2) return;
  const gY = Math.min(y1, _H);
  // 잔디
  _ctx.fillStyle = grass;
  _ctx.fillRect(0, y2, _W, gY - y2);
  // 럼블 스트립
  _ctx.fillStyle = rumble;
  _ctx.beginPath();
  _ctx.moveTo(cx1 - w1 * 1.1, y1); _ctx.lineTo(cx1 + w1 * 1.1, y1);
  _ctx.lineTo(cx2 + w2 * 1.1, y2); _ctx.lineTo(cx2 - w2 * 1.1, y2);
  _ctx.fill();
  // 도로
  _ctx.fillStyle = road;
  _ctx.beginPath();
  _ctx.moveTo(cx1 - w1, y1); _ctx.lineTo(cx1 + w1, y1);
  _ctx.lineTo(cx2 + w2, y2); _ctx.lineTo(cx2 - w2, y2);
  _ctx.fill();
  // 중앙선
  if (lanes) {
    _ctx.fillStyle = '#fff8';
    _ctx.beginPath();
    _ctx.moveTo(cx1 - 3, y1); _ctx.lineTo(cx1 + 3, y1);
    _ctx.lineTo(cx2 + 2, y2); _ctx.lineTo(cx2 - 2, y2);
    _ctx.fill();
  }
}

export function renderScene(track, racers, playerPos, sprites, items) {
  if (!_ctx) return;
  const W = _W, H = _H;

  // 하늘
  const sky = _ctx.createLinearGradient(0, 0, 0, H / 2);
  sky.addColorStop(0, '#0a0a1a');
  sky.addColorStop(1, '#1a3a6a');
  _ctx.fillStyle = sky;
  _ctx.fillRect(0, 0, W, H);

  // 지평선 언덕 느낌
  _ctx.fillStyle = '#2d5a1a';
  _ctx.fillRect(0, H * 0.47, W, H * 0.06);

  const startSeg = Math.floor(playerPos) + CAM_LEAD;
  let curveX = 0;
  let hillY  = 0;

  // ── 세그먼트 그리기 (뒤→앞, painter's algorithm) ───────────────────────────
  const segsToRender = [];
  for (let i = DRAW_N; i >= 0; i--) {
    const idx = (startSeg + i) % SEGS;
    const seg = track[idx];
    const depth  = D_NEAR + i * SEG_D;
    const depth2 = D_NEAR + (i + 1) * SEG_D;

    const y1 = Math.min(H, dToY(depth2) - hillY);
    const y2 = Math.min(H, dToY(depth) - hillY);
    hillY += seg.hill * 0.4;

    const w1 = dToW(depth2);
    const w2 = dToW(depth);
    curveX += seg.curve * (D_NEAR / depth) * 0.8;
    const cx = W / 2 + curveX;

    const alt  = (Math.floor(playerPos) + i) % 2 === 0;
    const road   = alt ? '#5a5a5a' : '#484848';
    const grass  = alt ? '#2d7a0a' : '#256607';
    const rumble = alt ? '#cc1111' : '#eeeeee';

    if (y1 > H / 2) {
      segsToRender.push({ i, y1, w1, cx, y2: Math.max(H / 2, y2), w2, road, grass, rumble, depth, idx });
    }
  }

  // 뒤에서 앞으로 그리기
  for (const s of segsToRender) {
    drawTrap(s.y1, s.w1, s.cx, s.y2, s.w2, s.cx, s.road, s.grass, s.rumble, s.i % 20 < 10);
  }

  // ── 아이템박스 렌더 ────────────────────────────────────────────────────────
  for (const item of items) {
    const dist = item.trackPos - playerPos;
    if (dist < 0 || dist > DRAW_N) continue;
    const seg = segsToRender.find(s => s.i === Math.floor(dist));
    if (!seg) continue;
    const scale = D_NEAR / seg.depth;
    const sw = 36 * scale;
    const sx = seg.cx + item.lane * seg.w1 - sw / 2;
    if (sprites.box && sw > 4) {
      _ctx.drawImage(sprites.box, sx, seg.y1 - sw, sw, sw);
    }
  }

  // ── 레이서 스프라이트 ──────────────────────────────────────────────────────
  const toRender = racers
    .filter(r => {
      const d = r.pos - playerPos;
      return d > 0.5 && d < DRAW_N;
    })
    .sort((a, b) => (b.pos - playerPos) - (a.pos - playerPos));

  for (const r of toRender) {
    const dist = r.pos - playerPos;
    const seg  = segsToRender.find(s => s.i === Math.floor(dist));
    if (!seg) continue;
    const scale = D_NEAR / seg.depth;
    const sh = 80 * scale;
    const sw = sh * 0.8;
    const sx = seg.cx + r.lane * seg.w1 * 1.5 - sw / 2;
    const sy = seg.y1 - sh;
    if (sw < 2) continue;
    const img = sprites[r.id];
    if (img) {
      _ctx.drawImage(img, sx, sy, sw, sh);
    } else {
      _ctx.fillStyle = r.color;
      _ctx.fillRect(sx, sy, sw, sh);
    }
    // HP bar (미니)
    if (sh > 12) {
      _ctx.fillStyle = '#00000088';
      _ctx.fillRect(sx, sy - 6, sw, 4);
      _ctx.fillStyle = '#22cc44';
      _ctx.fillRect(sx, sy - 6, sw * (r.hp / r.maxHp), 4);
    }
  }

  // ── 플레이어 (화면 하단 중앙) ─────────────────────────────────────────────
  if (sprites.player) {
    const pw = 70, ph = 90;
    _ctx.drawImage(sprites.player, W / 2 - pw / 2, H - ph - 20, pw, ph);
  }

  // ── 함정 표시 ─────────────────────────────────────────────────────────────
  for (const r of racers) {
    for (const trap of (r.traps || [])) {
      const dist = trap.pos - playerPos;
      if (dist < 0 || dist > DRAW_N) continue;
      const seg = segsToRender.find(s => s.i === Math.floor(dist));
      if (!seg) continue;
      const scale = D_NEAR / seg.depth;
      const sz = 24 * scale;
      if (sz < 2) continue;
      const sx = seg.cx + trap.lane * seg.w1 * 1.5 - sz / 2;
      _ctx.font = `${Math.max(8, sz)}px serif`;
      _ctx.fillText(trap.emoji, sx, seg.y1 - 4);
    }
  }
}
