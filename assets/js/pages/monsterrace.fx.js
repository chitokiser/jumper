// monsterrace.fx.js — 파티클 이펙트 (스파크 / 드리프트 스모크)
const _pts = [];

export function addSparks(trackPos, lane, impact) {
  const n = Math.ceil(impact * 18);
  for (let i = 0; i < n; i++) {
    _pts.push({
      type: 'spark',
      trackPos, lane,
      vx: (Math.random() - 0.5) * impact * 4.5,
      vy: Math.random() * impact * 3 + 0.8,
      life: 1,
      decay: 0.042 + Math.random() * 0.058,
      size: 1.5 + Math.random() * impact * 4,
      hue: impact > 0.5 ? 48 : 30,
      born: performance.now(),
    });
  }
}

export function addSmoke(trackPos, lane) {
  if (_pts.filter(p => p.type === 'smoke').length > 28) return;
  _pts.push({
    type: 'smoke',
    trackPos, lane,
    vx: (Math.random() - 0.5) * 0.4,
    vy: 0.5 + Math.random() * 0.5,
    life: 1,
    decay: 0.016 + Math.random() * 0.014,
    size: 4 + Math.random() * 8,
    born: performance.now(),
  });
}

export function tickParticles() {
  let w = 0;
  for (let i = 0; i < _pts.length; i++) {
    _pts[i].life -= _pts[i].decay;
    if (_pts[i].life > 0) _pts[w++] = _pts[i];
  }
  _pts.length = w;
}

export function drawParticles(ctx, segMap, playerPos, D_NEAR, DRAW_N) {
  if (!_pts.length) return;
  const now = performance.now();
  ctx.save();
  for (const p of _pts) {
    const dist = p.trackPos - playerPos;
    if (dist < -0.5 || dist > DRAW_N - 1) continue;
    const dc = Math.max(0, dist);
    const si = segMap[Math.floor(dc)] || segMap[Math.ceil(dc)] || segMap[0];
    if (!si) continue;
    const sc = D_NEAR / si.depth;
    if (sc < 0.04) continue;
    const t = (now - p.born) / 1000;
    const bx = si.cx + (p.lane + p.vx * t) * si.w2 * 1.35;
    const by = si.y2 - p.vy * t * 52 * sc;
    ctx.globalAlpha = Math.max(0, p.life) * 0.9;
    if (p.type === 'spark') {
      const sz = Math.max(1, p.size * sc);
      ctx.fillStyle = `hsl(${p.hue},100%,${50 + p.life * 35}%)`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 4;
      ctx.fillRect(bx - sz * 0.5, by - sz * 0.5, sz, sz);
    } else {
      const sz = Math.max(1.5, p.size * sc);
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(200,200,200,${p.life * 0.3})`;
      ctx.beginPath(); ctx.arc(bx, by, sz, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}

export function resetParticles() { _pts.length = 0; }
