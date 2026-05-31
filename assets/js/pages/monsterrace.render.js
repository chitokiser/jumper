// monsterrace.render.js — 의사3D 렌더러 + 트랙 + 스프라이트 애니메이션

// ── 트랙 ─────────────────────────────────────────────────────────────────────
export const SEGS       = 300;
export const TOTAL_LAPS = 3;

export function buildTrack() {
  const t = [];
  const str  = (n, hill = 0) => { for (let i=0;i<n;i++) t.push({curve:0,hill}); };
  const cur  = (n, c, hill=0) => { for (let i=0;i<n;i++) t.push({curve:c,hill}); };

  str(40);          cur(40,3);     str(20,10);   // 우커브 → 언덕
  cur(30,-3,8);     str(15,-4);    cur(50,2);    // 내리막 → 좌커브
  str(25);          cur(35,-4);    str(20);      // 직선 → 우커브 → 직선
  cur(25,2,6);      str(10,-6);                  // 언덕 커브 → 내리막

  while (t.length < SEGS) t.push({curve:0,hill:0});
  return t.slice(0, SEGS);
}

// ── 스프라이트 정의 ────────────────────────────────────────────────────────────
const SPRITE_DEFS = {
  orc3:    { frames: Array.from({length:6}, (_,i)=>`/assets/images/monsters/orc3/ORK_03_WALK_${String(i).padStart(3,'0')}.png`) },
  pirate3: { frames: Array.from({length:6}, (_,i)=>`/assets/images/monsters/pirate3/3_3-PIRATE_WALK_${String(i).padStart(3,'0')}.png`) },
  zombie1: { frames: Array.from({length:8}, (_,i)=>`/assets/images/monsters/zombie1/animation/Run${i+1}.png`) },
  zombie3: { frames: Array.from({length:8}, (_,i)=>`/assets/images/monsters/Zombie3/animation/Run${i+1}.png`) },
  dragon:  { frames: Array.from({length:6}, (_,i)=>`/assets/images/monsters/dragon/fly${String(i).padStart(3,'0')}.png`) },
  player:  { frames: Array.from({length:8}, (_,i)=>`/assets/images/hero/${i+1}.png`) },
  box:     { frames: ['/assets/images/item/box.png'] },
};

const _loaded = {};   // { key: HTMLImageElement[] }

export async function loadAllSprites() {
  const load = src => new Promise(res => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });

  await Promise.all(
    Object.entries(SPRITE_DEFS).map(async ([key, def]) => {
      _loaded[key] = await Promise.all(def.frames.map(load));
    })
  );
}

// 현재 애니메이션 프레임 반환 (fps: 초당 프레임 수)
export function getFrame(key, fps, ts) {
  const frames = _loaded[key];
  if (!frames || !frames.length) return null;
  const valid  = frames.filter(Boolean);
  if (!valid.length) return null;
  const idx = Math.floor(ts * fps / 1000) % valid.length;
  return valid[idx];
}

// ── 렌더러 내부 상태 ─────────────────────────────────────────────────────────
const DRAW_N  = 100;
const D_NEAR  = 500;
const SEG_D   = 320;
const ROAD_W  = 1.15;

let _ctx, _W, _H;
let _shake = 0;   // 화면 흔들림 (픽셀)

export function initRenderer(canvas) {
  _ctx = canvas.getContext('2d');
  _W   = canvas.width;
  _H   = canvas.height;
}

export function triggerShake(strength = 6) { _shake = strength; }

function dToY(d) { return _H / 2 + D_NEAR * (_H / 2) / d; }
function dToW(d) { return _W * ROAD_W * D_NEAR / (d * 2); }

function trap(y1,w1,cx1, y2,w2,cx2, road,grass,rumble,showLane) {
  if (y1 <= y2) return;
  // 잔디
  _ctx.fillStyle = grass;
  _ctx.fillRect(0, y2, _W, Math.min(y1, _H) - y2);
  // 럼블
  _ctx.fillStyle = rumble;
  _ctx.beginPath();
  _ctx.moveTo(cx1-w1*1.12,y1); _ctx.lineTo(cx1+w1*1.12,y1);
  _ctx.lineTo(cx2+w2*1.12,y2); _ctx.lineTo(cx2-w2*1.12,y2);
  _ctx.fill();
  // 도로
  _ctx.fillStyle = road;
  _ctx.beginPath();
  _ctx.moveTo(cx1-w1,y1); _ctx.lineTo(cx1+w1,y1);
  _ctx.lineTo(cx2+w2,y2); _ctx.lineTo(cx2-w2,y2);
  _ctx.fill();
  // 중앙 점선
  if (showLane) {
    _ctx.fillStyle = '#ffffffaa';
    _ctx.beginPath();
    _ctx.moveTo(cx1-2,y1); _ctx.lineTo(cx1+2,y1);
    _ctx.lineTo(cx2+2,y2); _ctx.lineTo(cx2-2,y2);
    _ctx.fill();
  }
}

export function renderScene(track, racers, player, items, ts) {
  if (!_ctx) return;
  const W = _W, H = _H;

  // 화면 흔들림
  const sx = _shake > 0 ? (Math.random()-0.5)*_shake*2 : 0;
  const sy = _shake > 0 ? (Math.random()-0.5)*_shake : 0;
  _shake = Math.max(0, _shake - 0.8);
  _ctx.save();
  _ctx.translate(sx, sy);

  // 하늘
  const sky = _ctx.createLinearGradient(0,0,0,H*0.5);
  sky.addColorStop(0,'#08081a');
  sky.addColorStop(1,'#1a3a6a');
  _ctx.fillStyle = sky;
  _ctx.fillRect(0,0,W,H*0.5);

  // 원경 산
  _ctx.fillStyle='#1a3a14';
  _ctx.beginPath();
  _ctx.moveTo(0,H*0.48);
  for(let x=0;x<W;x+=W/8) {
    _ctx.lineTo(x, H*0.42 + Math.sin(x*0.02)*H*0.04);
  }
  _ctx.lineTo(W,H*0.48); _ctx.fill();

  // 도로 세그먼트
  const playerSeg = Math.floor(player.pos);
  const segMap = {};     // i → segment info (for sprite lookup)
  let curX = 0, hillY = 0;

  const drawList = [];
  for (let i = DRAW_N; i >= 0; i--) {
    const idx  = ((playerSeg + i) % SEGS + SEGS) % SEGS;
    const seg  = track[idx];
    const d1   = D_NEAR + i * SEG_D;
    const d2   = D_NEAR + (i+1) * SEG_D;

    curX += seg.curve * (D_NEAR / d1) * 1.0;
    hillY += seg.hill * (D_NEAR / d1) * 0.5;

    const y1 = Math.min(H, dToY(d2) - hillY);
    const y2 = Math.min(H, dToY(d1) - hillY);
    if (y2 < H / 2) continue;

    const w1  = dToW(d2);
    const w2  = dToW(d1);
    const cx  = W / 2 + curX;
    const alt = (playerSeg + i) % 2 === 0;

    drawList.push({
      i, y1: Math.max(H/2, y1), w1, cx,
      y2: Math.max(H/2, y2), w2,
      road:   alt ? '#5a5a5a':'#484848',
      grass:  alt ? '#2d7a0a':'#226006',
      rumble: alt ? '#cc1111':'#eeeeee',
      lane:   i % 22 < 11,
      depth: d1,
    });
    segMap[i] = drawList[drawList.length-1];
  }

  // 도로 페인터 알고리즘 (뒤→앞)
  for (const s of drawList) {
    trap(s.y2, s.w2, s.cx, s.y1, s.w1, s.cx, s.road, s.grass, s.rumble, s.lane);
  }

  // ── 아이템 박스 ─────────────────────────────────────────────────────────────
  const boxFrame = _loaded.box?.[0];
  for (const item of items) {
    if (!item.active) continue;
    const dist = item.trackPos - player.pos;
    if (dist < 0.5 || dist > DRAW_N - 1) continue;
    const si = segMap[Math.floor(dist)] || segMap[Math.ceil(dist)];
    if (!si) continue;
    const sc  = D_NEAR / si.depth;
    const sz  = 40 * sc;
    if (sz < 3) continue;
    const bx  = si.cx + item.lane * si.w2 * 1.4;
    // 상하 유동 애니메이션
    const bob = Math.sin(ts * 0.003 + item.id) * 3 * sc;
    if (boxFrame) {
      _ctx.drawImage(boxFrame, bx - sz/2, si.y2 - sz + bob, sz, sz);
    } else {
      _ctx.fillStyle='#f59e0b';
      _ctx.fillRect(bx-sz/2, si.y2-sz+bob, sz, sz);
    }
  }

  // ── AI 레이서 스프라이트 (앞에 있는 레이서만) ─────────────────────────────
  const ahead = racers
    .filter(r => { const d = r.pos - player.pos; return d > 0.3 && d < DRAW_N && !r.finished; })
    .sort((a,b) => (b.pos - player.pos) - (a.pos - player.pos));

  for (const r of ahead) {
    const dist = r.pos - player.pos;
    const si   = segMap[Math.floor(dist)] || segMap[Math.ceil(dist)];
    if (!si) continue;
    const sc   = D_NEAR / si.depth;
    const sh   = 90 * sc;
    const sw   = sh * 0.75;
    if (sw < 2) continue;

    const spd   = r.speed / r.maxSpeed;
    const fps   = 4 + spd * 10;
    const frame = getFrame(r.imgKey, fps, ts);

    const bx = si.cx + r.lane * si.w2 * 1.4;
    const by = si.y2 - sh;

    // 넘어짐 이펙트
    if (r.fallUntil > Date.now()) {
      _ctx.save();
      _ctx.translate(bx, by + sh/2);
      _ctx.rotate(Math.PI/2);
      if (frame) _ctx.drawImage(frame, -sw/2, -sh/2, sw, sh);
      else { _ctx.fillStyle = r.color; _ctx.fillRect(-sw/2,-sh/2,sw,sh); }
      _ctx.restore();
    } else {
      if (frame) _ctx.drawImage(frame, bx-sw/2, by, sw, sh);
      else { _ctx.fillStyle = r.color; _ctx.fillRect(bx-sw/2, by, sw, sh); }
    }

    // HP 바
    if (sh > 14) {
      _ctx.fillStyle='#00000088';
      _ctx.fillRect(bx-sw/2, by-7, sw, 4);
      _ctx.fillStyle = r.hp/r.maxHp > 0.5 ? '#22c55e' : '#ef4444';
      _ctx.fillRect(bx-sw/2, by-7, sw*(r.hp/r.maxHp), 4);
    }

    // 이름 레이블
    if (sh > 30) {
      _ctx.font = `bold ${Math.max(8, 9*sc)}px sans-serif`;
      _ctx.fillStyle = '#fff';
      _ctx.textAlign = 'center';
      _ctx.fillText(r.name, bx, by - 10);
    }
  }

  // ── 플레이어 스케이트보드 (3인칭 후방 시점) ────────────────────────────────
  drawPlayerBoard(_ctx, W, H, player, ts);

  // ── 트랩 이모지 ────────────────────────────────────────────────────────────
  _ctx.textAlign = 'center';
  for (const r of [...racers, player]) {
    for (const trap of (r.traps||[])) {
      if (!trap.active) continue;
      const dist = trap.pos - player.pos;
      if (dist < 0.3 || dist > DRAW_N - 1) continue;
      const si = segMap[Math.floor(dist)] || segMap[Math.ceil(dist)];
      if (!si) continue;
      const sc = D_NEAR / si.depth;
      const sz = Math.max(8, 22 * sc);
      const bx = si.cx + trap.lane * si.w2 * 1.4;
      _ctx.font = `${sz}px serif`;
      _ctx.fillText(trap.emoji, bx, si.y2 - 4);
    }
  }

  // ── 속도감 오버레이 (빠를수록 비네팅) ──────────────────────────────────────
  const spd = player.speed / player.maxSpeed;
  if (spd > 0.7) {
    _ctx.save();
    _ctx.globalAlpha = (spd - 0.7) * 1.2;
    const vg = _ctx.createRadialGradient(W/2,H/2,20,W/2,H/2,W*0.75);
    vg.addColorStop(0,'transparent');
    vg.addColorStop(1,'#000000cc');
    _ctx.fillStyle = vg;
    _ctx.fillRect(0,0,W,H);
    _ctx.restore();
  }

  _ctx.restore(); // shake 해제
}

// ── 스케이트보드 + 라이더 (하단 중앙 고정 시점) ────────────────────────────────
function drawPlayerBoard(ctx, W, H, player, ts) {
  const spd   = player.speed / player.maxSpeed;
  const steer = player.lane * 0.18;         // 조향에 따른 기울기
  const boost = (player.effects?.boost || 0) > Date.now();
  const fallen= player.fallUntil > Date.now();

  const cx = W / 2;
  const cy = H - 28;

  ctx.save();
  ctx.translate(cx, cy);
  if (fallen) ctx.rotate(Math.PI / 2 + Math.sin(ts*0.01)*0.3);
  else        ctx.rotate(steer * 0.25);

  // ── 속도 트레일 ──
  if (spd > 0.3 && !fallen) {
    ctx.save();
    ctx.globalAlpha = spd * 0.6;
    const trailColors = boost ? ['#60a5fa','#93c5fd','#bfdbfe'] : ['#ffffff44','#ffffff22','#ffffff11'];
    trailColors.forEach((c, i) => {
      ctx.strokeStyle = c;
      ctx.lineWidth = 2 - i * 0.5;
      ctx.beginPath();
      [-18, -6, 6, 18].forEach(ox => {
        ctx.moveTo(ox, 8);
        ctx.lineTo(ox + (Math.random()-0.5)*4, 8 + 14 + i*6 + spd*12);
      });
      ctx.stroke();
    });
    ctx.restore();
  }

  // ── 바퀴 (뒷면 2개) ──
  ctx.fillStyle = '#111';
  [[-20, 6], [20, 6]].forEach(([ox, oy]) => {
    ctx.beginPath();
    ctx.ellipse(ox, oy, 6, 4, 0, 0, Math.PI*2);
    ctx.fill();
    // 바퀴 테두리
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // ── 보드 데크 ──
  ctx.fillStyle = boost ? '#1d4ed8' : '#7c2d12';
  ctx.beginPath();
  ctx.roundRect(-28, -4, 56, 10, 4);
  ctx.fill();

  // 그립 테이프 패턴
  ctx.fillStyle = boost ? '#3b82f6' : '#431407';
  ctx.beginPath();
  ctx.roundRect(-24, -3, 48, 8, 3);
  ctx.fill();

  // 로고 줄무늬
  ctx.fillStyle = '#ffffff33';
  ctx.fillRect(-8, -2, 16, 2);

  // ── 라이더 실루엣 (캐릭터 뒷모습) ──
  if (!fallen) {
    // 다리
    ctx.fillStyle = '#1e3a5f';
    ctx.beginPath();
    ctx.roundRect(-10, -22, 8, 18, 3);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(2, -22, 8, 18, 3);
    ctx.fill();

    // 몸통
    ctx.fillStyle = '#2563eb';
    ctx.beginPath();
    ctx.roundRect(-14, -42, 28, 22, 5);
    ctx.fill();

    // 팔 (조향에 따라 움직임)
    ctx.fillStyle = '#2563eb';
    ctx.beginPath();
    ctx.roundRect(-22, -40, 9, 16, 3);
    ctx.save();
    ctx.translate(0, 0);
    ctx.rotate(steer * 0.4);
    ctx.roundRect(13, -40, 9, 16, 3);
    ctx.restore();
    ctx.fill();

    // 헬멧
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.arc(0, -46, 12, 0, Math.PI*2);
    ctx.fill();
    // 헬멧 챙
    ctx.fillStyle = '#b91c1c';
    ctx.beginPath();
    ctx.ellipse(0, -35, 14, 4, 0, 0, Math.PI);
    ctx.fill();
    // 고글
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.roundRect(-8, -50, 16, 7, 3);
    ctx.fill();
  }

  ctx.restore();
}
