// conquest.fx.js — 전투 연출 (투사체 · 데미지 숫자 · 파티클 · 화면 흔들림 · 낮밤 분위기)
// 게임 규칙은 건드리지 않고 화면 효과만 담당한다. 피해 적용은 투사체가 닿는 순간 impact 핸들러로 넘긴다.
import { worldToScreen, getScale, getVisibleRect, CASTLE_WX, CASTLE_WY } from './conquest.world.js';

const MAX_TEXTS = 60, MAX_PARTS = 350, MAX_PROJ = 80;
const WALL_FX = {
  north: { x:5000, y:3800, ax:'h' }, south: { x:5000, y:6200, ax:'h' },
  west:  { x:3800, y:5000, ax:'v' }, east:  { x:6200, y:5000, ax:'v' },
};
export const WALL_POINT = { north:[5000,3800], south:[5000,6200], west:[3800,5000], east:[6200,5000] };
const TORCHES = [[3800,3800],[6200,3800],[3800,6200],[6200,6200],[5000,3800],[5000,6200],[3800,5000],[6200,5000]];

let _proj = [], _texts = [], _parts = [], _shake = 0, _banner = null, _impact = null, _t = 0;

export function setImpactHandler(fn) { _impact = fn; }
export function resetFx() { _proj = []; _texts = []; _parts = []; _shake = 0; _banner = null; }
export function addShake(p) { _shake = Math.min(16, Math.max(_shake, p)); }
export function shakeOffset() {
  if (_shake < 0.3) return [0, 0];
  return [(Math.random() - 0.5) * _shake * 2, (Math.random() - 0.5) * _shake * 2];
}
export function showBanner(text, color = '#fbbf24') { _banner = { text, color, t: 0, dur: 1700 }; }

function inView(x, y, pad = 250) {
  const v = getVisibleRect();
  return x > v.l - pad && x < v.r + pad && y > v.t - pad && y < v.b + pad;
}
const rnd = (a, b) => a + Math.random() * (b - a);

function part(p) { if (_parts.length < MAX_PARTS) _parts.push(Object.assign({ vx:0, vy:0, g:0, size:6, life:400, max:400, kind:'dust', color:'#fff' }, p, { max: p.life })); }

export function addDamage(x, y, amount, crit = false, ally = false) {
  if (_texts.length >= MAX_TEXTS || !inView(x, y, 100)) return;
  _texts.push({ x: x + rnd(-18, 18), y, amount, crit, ally, life: crit ? 1000 : 750, max: crit ? 1000 : 750 });
}
export function addSpark(x, y, color = '#fde68a', n = 4) {
  if (!inView(x, y)) return;
  for (let i = 0; i < n; i++) part({ kind:'spark', x, y, vx: rnd(-320, 320), vy: rnd(-380, -40), g: 700, size: rnd(3, 6), life: rnd(160, 320), color });
}
export function addPuff(x, y, n = 6, kind = 'dust') {
  if (!inView(x, y)) return;
  for (let i = 0; i < n; i++) part({ kind, x: x + rnd(-30, 30), y: y + rnd(-20, 10), vx: rnd(-90, 90), vy: rnd(-140, -30), size: rnd(14, 30), life: rnd(450, 900), color: kind === 'smoke' ? '#3a3a3a' : '#a89a7a' });
}
export function addCoin(x, y, value = 1) {
  if (!inView(x, y)) return;
  part({ kind:'coin', x, y: y - 20, vx: rnd(-60, 60), vy: -320, g: 900, size: 22, life: 700 });
  if (value >= 2 && _texts.length < MAX_TEXTS) _texts.push({ x, y: y - 60, amount: '+' + value, coin: true, life: 800, max: 800 });
}
export function addBurst(x, y, kind = 'fire') {
  if (!inView(x, y, 400)) return;
  for (let i = 0; i < 10; i++) part({ kind:'flame', x: x + rnd(-40, 40), y: y + rnd(-20, 20), vx: rnd(-80, 80), vy: rnd(-200, -60), size: rnd(18, 36), life: rnd(400, 800) });
  addPuff(x, y, 5, 'smoke');
}

// 투사체 등록: kind = arrow | cannon | fire
export function addShot(ev) {
  if (_proj.length >= MAX_PROJ) return;
  const d = Math.hypot(ev.tx - ev.sx, ev.ty - ev.sy);
  const dur = ev.dur || (ev.kind === 'cannon' ? 480 : 140 + d * 0.8);
  _proj.push(Object.assign({}, ev, { t: 0, dur }));
  if (ev.kind === 'cannon') { addSpark(ev.sx, ev.sy, '#fdba74', 6); addPuff(ev.sx, ev.sy, 5, 'smoke'); }
  else if (ev.kind === 'arrow') addSpark(ev.sx, ev.sy, '#fde68a', 2);
}

function land(p) {
  if (p.att && _impact) _impact(p);
  if (p.kind === 'arrow') { addSpark(p.tx, p.ty - 20, '#ffffff', 3); }
  else if (p.kind === 'cannon') {
    part({ kind:'ring', x: p.tx, y: p.ty, size: 95, life: 380 });
    addBurst(p.tx, p.ty); addSpark(p.tx, p.ty, '#fdba74', 8); addShake(3.5);
  } else if (p.kind === 'fire') { addBurst(p.tx, p.ty); addShake(1.6); }
}

export function updateFx(dt, st = {}) {
  _t += dt;
  _shake *= Math.max(0, 1 - dt / 170);
  if (_banner) { _banner.t += dt; if (_banner.t >= _banner.dur) _banner = null; }

  for (const p of _proj) {
    p.t += dt;
    if (p.kind === 'arrow' && p.tgt && !p.tgt.dying) { p.tx = p.tgt.x; p.ty = p.tgt.y; }
    if ((p.kind === 'cannon' || p.kind === 'fire') && Math.random() < 0.6) {
      const u = Math.min(1, p.t / p.dur);
      part({ kind:'smoke', x: p.sx + (p.tx - p.sx) * u, y: p.sy + (p.ty - p.sy) * u - Math.sin(Math.PI * u) * (p.kind === 'cannon' ? 160 : 60), size: 10, life: 350, vy: -20, color: p.kind === 'fire' ? '#f97316' : '#444' });
    }
    if (p.t >= p.dur) { p.done = true; land(p); }
  }
  _proj = _proj.filter(p => !p.done);

  for (const q of _parts) {
    q.life -= dt;
    q.x += q.vx * dt / 1000; q.y += q.vy * dt / 1000; q.vy += q.g * dt / 1000;
  }
  _parts = _parts.filter(q => q.life > 0);
  for (const tx of _texts) { tx.life -= dt; tx.y -= 110 * dt / 1000; }
  _texts = _texts.filter(tx => tx.life > 0);

  // 상한 성벽 불꽃 / 성 연기
  if (st.walls) {
    for (const [k, w] of Object.entries(st.walls)) {
      const pos = WALL_FX[k]; if (!pos || !inView(pos.x, pos.y, 500)) continue;
      const pct = w.hp / w.maxHp;
      const rate = w.breached ? 16 : pct < 0.4 ? 7 : 0;
      if (rate && Math.random() < rate * dt / 1000) {
        const ox = pos.ax === 'h' ? rnd(-320, 320) : rnd(-25, 25), oy = pos.ax === 'h' ? rnd(-25, 25) : rnd(-320, 320);
        part({ kind:'flame', x: pos.x + ox, y: pos.y + oy, vx: rnd(-20, 20), vy: rnd(-110, -50), size: rnd(18, 34), life: rnd(450, 800) });
        if (Math.random() < 0.5) part({ kind:'smoke', x: pos.x + ox, y: pos.y + oy - 30, vx: rnd(-25, 25), vy: rnd(-90, -40), size: rnd(18, 32), life: rnd(900, 1500), color: '#2a2a2a' });
      }
    }
  }
  if (st.castleRatio !== undefined && st.castleRatio < 0.5 && inView(CASTLE_WX, CASTLE_WY, 600)) {
    const rate = st.castleRatio < 0.25 ? 12 : 6;
    if (Math.random() < rate * dt / 1000) {
      part({ kind:'smoke', x: CASTLE_WX + rnd(-90, 90), y: CASTLE_WY + rnd(-60, 20), vx: rnd(-20, 20), vy: rnd(-90, -45), size: rnd(22, 40), life: rnd(1000, 1600), color: '#262626' });
      if (st.castleRatio < 0.25 && Math.random() < 0.6) part({ kind:'flame', x: CASTLE_WX + rnd(-90, 90), y: CASTLE_WY + rnd(-40, 20), vy: rnd(-120, -60), size: rnd(20, 36), life: rnd(450, 800) });
    }
  }
}

export function drawFx(ctx, W, H) {
  const s = getScale();
  ctx.save();
  ctx.textAlign = 'center';

  // 파티클
  for (const q of _parts) {
    const [sx, sy] = worldToScreen(q.x, q.y);
    if (sx < -60 || sx > W + 60 || sy < -60 || sy > H + 60) continue;
    const a = Math.max(0, q.life / q.max), r = q.size * s;
    if (q.kind === 'spark') {
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a; ctx.fillStyle = q.color;
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(1, r), 0, Math.PI * 2); ctx.fill();
    } else if (q.kind === 'flame') {
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.8;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * (0.6 + a * 0.6));
      g.addColorStop(0, 'rgba(255,230,120,0.9)'); g.addColorStop(0.5, 'rgba(255,110,20,0.55)'); g.addColorStop(1, 'rgba(180,30,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r * (0.6 + a * 0.6), 0, Math.PI * 2); ctx.fill();
    } else if (q.kind === 'ring') {
      const u = 1 - a; ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = a * 0.8;
      ctx.strokeStyle = '#fdba74'; ctx.lineWidth = Math.max(2, 5 * s * a);
      ctx.beginPath(); ctx.arc(sx, sy, q.size * s * (0.3 + u * 0.9), 0, Math.PI * 2); ctx.stroke();
    } else if (q.kind === 'coin') {
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = Math.min(1, a * 1.6);
      ctx.font = `${Math.max(12, q.size * s * 1.6)}px sans-serif`; ctx.fillText('🪙', sx, sy);
    } else {   // dust / smoke
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = a * (q.kind === 'smoke' ? 0.45 : 0.35);
      ctx.fillStyle = q.color; ctx.beginPath(); ctx.arc(sx, sy, r * (1.4 - a * 0.4), 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalCompositeOperation = 'source-over';

  // 투사체
  for (const p of _proj) {
    const u = Math.min(1, p.t / p.dur);
    const arc = (p.kind === 'cannon' ? 160 : p.kind === 'fire' ? 60 : 45);
    const pt = k => { const x = p.sx + (p.tx - p.sx) * k, y = p.sy + (p.ty - p.sy) * k; return worldToScreen(x, y - Math.sin(Math.PI * k) * arc); };
    const [px, py] = pt(u);
    if (px < -40 || px > W + 40 || py < -40 || py > H + 40) continue;
    ctx.globalAlpha = 1;
    if (p.kind === 'arrow') {
      const [qx, qy] = pt(Math.max(0, u - 0.08));
      ctx.strokeStyle = '#d6b27a'; ctx.lineWidth = Math.max(1.5, 2.2 * s * 2);
      ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(px, py); ctx.stroke();
      ctx.fillStyle = '#e5e7eb'; ctx.beginPath(); ctx.arc(px, py, Math.max(1.5, 2 * s * 2), 0, Math.PI * 2); ctx.fill();
    } else if (p.kind === 'cannon') {
      const [gx, gy] = worldToScreen(p.sx + (p.tx - p.sx) * u, p.sy + (p.ty - p.sy) * u);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(gx, gy, 9 * s * 2, 4 * s * 2, 0, 0, Math.PI * 2); ctx.fill();
      const r = Math.max(3.5, 7 * s * 2);
      ctx.fillStyle = '#1f2937'; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(px - r * .3, py - r * .3, r * .35, 0, Math.PI * 2); ctx.fill();
    } else {   // fire
      ctx.globalCompositeOperation = 'lighter';
      const r = Math.max(8, 16 * s * 2);
      const g = ctx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'rgba(255,240,150,1)'); g.addColorStop(0.45, 'rgba(255,120,20,.8)'); g.addColorStop(1, 'rgba(200,40,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // 데미지 숫자 / 코인 획득 숫자
  for (const t of _texts) {
    const [sx, sy] = worldToScreen(t.x, t.y);
    if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) continue;
    const a = Math.max(0, t.life / t.max);
    const pop = t.crit ? 1 + Math.max(0, (1 - a) < 0.15 ? (0.15 - (1 - a)) * 4 : 0) : 1;
    const size = t.coin ? 13 : t.crit ? 22 : t.ally ? 11 : 13;
    ctx.globalAlpha = Math.min(1, a * 1.8);
    ctx.font = `900 ${Math.round(size * pop)}px sans-serif`;
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)';
    ctx.fillStyle = t.coin ? '#fde047' : t.crit ? '#fbbf24' : t.ally ? '#fca5a5' : '#ffffff';
    const label = t.crit ? t.amount + '!' : String(t.amount);
    ctx.strokeText(label, sx, sy); ctx.fillText(label, sx, sy);
  }

  // 배너 (연속 처치 등)
  if (_banner) {
    const u = _banner.t / _banner.dur;
    const sc = u < 0.12 ? 0.5 + u / 0.12 * 0.6 : u < 0.2 ? 1.1 - (u - 0.12) / 0.08 * 0.1 : 1;
    ctx.globalAlpha = u > 0.8 ? (1 - u) / 0.2 : 1;
    ctx.save(); ctx.translate(W / 2, H * 0.22); ctx.scale(sc, sc);
    ctx.font = '900 22px sans-serif'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.8)';
    ctx.fillStyle = _banner.color; ctx.strokeText(_banner.text, 0, 0); ctx.fillText(_banner.text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

// 낮밤 분위기(웨이브가 진행될수록 석양 → 밤) + 횃불 + 성 체력 경고
export function drawAtmosphere(ctx, W, H, { wave = 0, castleRatio = 1 } = {}) {
  const s = getScale();
  const n = wave <= 2 ? 0 : wave <= 4 ? (wave - 2) / 3 * 0.5 : wave <= 7 ? 0.5 + (wave - 4) / 4 * 0.3 : 0.9;
  if (n > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${Math.round(255 - 195 * n)},${Math.round(215 - 145 * n)},${Math.round(190 - 50 * n)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    TORCHES.forEach(([wx, wy], i) => {
      const [sx, sy] = worldToScreen(wx, wy);
      if (sx < -150 || sx > W + 150 || sy < -150 || sy > H + 150) return;
      const r = (230 + Math.sin(_t * 0.011 + i * 1.7) * 28) * s;
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
      g.addColorStop(0, `rgba(255,170,60,${0.5 * n})`); g.addColorStop(1, 'rgba(255,120,20,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.restore();
  }
  if (castleRatio < 0.5) {   // 성 균열
    const [cx, cy] = worldToScreen(CASTLE_WX, CASTLE_WY);
    ctx.save();
    ctx.strokeStyle = `rgba(20,10,5,${Math.min(0.8, (0.5 - castleRatio) * 1.8)})`;
    ctx.lineWidth = Math.max(1.5, 3 * s * 2); ctx.lineCap = 'round';
    for (let k = 0; k < 6; k++) {
      let a = k * 1.05 + 0.4, x = cx, y = cy - 30 * s;
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let j = 0; j < 5; j++) {
        a += Math.sin(k * 7.3 + j * 3.1) * 0.7;
        x += Math.cos(a) * 28 * s * 2; y += Math.sin(a) * 22 * s * 2;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  if (castleRatio < 0.3) {   // 위험 비네팅
    const pulse = 0.5 + 0.5 * Math.sin(_t * 0.006);
    ctx.save();
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(220,0,0,0)'); g.addColorStop(1, `rgba(220,0,0,${0.12 + 0.2 * pulse})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}
