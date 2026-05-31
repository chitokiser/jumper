// merchants.dungeon.render.js — 던전 렌더러 (플레이어 복합 스프라이트, 타워 이미지, 몬스터 애니)

// ── 공개 이미지 캐시 ──────────────────────────────────────────────────────────
export const IMGS = {
  // 타워
  tower: null, tower2: null,
  // 플레이어 파츠 (monsters/1/)
  p_body:null, p_head:null, p_armL:null, p_armR:null,
  p_legL:null, p_legR:null, p_handL:null, p_handR:null,
  p_bow1:null, p_bow2:null, p_quiver:null, p_arrow:null,
  // 몬스터 스프라이트 프레임
  m: {},   // { spKey: { walk:[], atk:[], hurt:[], die:[] } }
};

let _ctx = null, _W = 0, _H = 0;

export function initDungeonRenderer(canvas) {
  _ctx = canvas.getContext('2d');
  _W = canvas.width;
  _H = canvas.height;
}

export function resizeDungeonRenderer(canvas) {
  _ctx = canvas.getContext('2d');
  _W = canvas.width;
  _H = canvas.height;
}

// ── 스프라이트 로딩 ───────────────────────────────────────────────────────────
const S3 = n => String(n).padStart(3, '0');
const FS = (dir, pfx, anim, n) =>
  Array.from({ length: n }, (_, i) => `/assets/images/monsters/${dir}/${pfx}${anim}_${S3(i)}.png`);
const FN = (dir, pfx, n) =>
  Array.from({ length: n }, (_, i) => `/assets/images/monsters/${dir}/${pfx}${i + 1}.png`);

export const MSPRITE_DEFS = {
  orc1:    { walk: FS('orc','ORK_01_','WALK',6),    atk: FS('orc','ORK_01_','ATTAK',6),   hurt: FS('orc','ORK_01_','HURT',6),   die: FS('orc','ORK_01_','DIE',6) },
  orc2:    { walk: FS('orc2','ORK_02_','WALK',6),   atk: FS('orc2','ORK_02_','ATTAK',6),  hurt: FS('orc2','ORK_02_','HURT',6),  die: FS('orc2','ORK_02_','DIE',6) },
  orc3:    { walk: FS('orc3','ORK_03_','WALK',6),   atk: FS('orc3','ORK_03_','ATTAK',6),  hurt: FS('orc3','ORK_03_','HURT',6),  die: FS('orc3','ORK_03_','DIE',6) },
  pirate1: { walk: FS('pirate','1_entity_000_','WALK',6), atk: FS('pirate','1_entity_000_','ATTACK',6), hurt: FS('pirate','1_entity_000_','HURT',6), die: FS('pirate','1_entity_000_','DIE',6) },
  pirate2: { walk: FS('pirate2','2_entity_000_','WALK',6), atk: FS('pirate2','2_entity_000_','ATTACK',6), hurt: FS('pirate2','2_entity_000_','HURT',6), die: FS('pirate2','2_entity_000_','DIE',6) },
  pirate3: { walk: FS('pirate3','3_3-PIRATE_','WALK',6), atk: FS('pirate3','3_3-PIRATE_','ATTACK',6), hurt: FS('pirate3','3_3-PIRATE_','HURT',6), die: FS('pirate3','3_3-PIRATE_','DIE',6) },
  zombie:  { walk: FN('zombie1/animation','Run',8),  atk: FN('zombie1/animation','Attack',6), hurt: FN('zombie1/animation','Hurt',5), die: FN('zombie1/animation','Dead',8) },
  dragon:  {
    walk: Array.from({ length: 6 }, (_, i) => `/assets/images/monsters/dragon/fly${S3(i)}.png`),
    atk:  Array.from({ length: 6 }, (_, i) => `/assets/images/monsters/dragon/attak${S3(i)}.png`),
    hurt: Array.from({ length: 6 }, (_, i) => `/assets/images/monsters/dragon/idle${S3(i)}.png`),
    die:  Array.from({ length: 6 }, (_, i) => `/assets/images/monsters/dragon/attak${S3(i)}.png`),
  },
};

export async function loadAllDungeonSprites() {
  const ld = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });

  // 타워 이미지
  IMGS.tower  = await ld('/assets/images/shops/tower.png');
  IMGS.tower2 = await ld('/assets/images/shops/tower2.png');

  // 플레이어 파츠
  const pp = '/assets/images/monsters/1/';
  [IMGS.p_body, IMGS.p_head, IMGS.p_armL, IMGS.p_armR,
   IMGS.p_legL, IMGS.p_legR, IMGS.p_handL, IMGS.p_handR,
   IMGS.p_bow1, IMGS.p_bow2, IMGS.p_quiver, IMGS.p_arrow] = await Promise.all([
    ld(pp+'1_body.png'), ld(pp+'1_head.png'), ld(pp+'1_arm left.png'), ld(pp+'1_arm right.png'),
    ld(pp+'1_leg left.png'), ld(pp+'1_leg right.png'), ld(pp+'1_hand left.png'), ld(pp+'1_hand right.png'),
    ld(pp+'1_bow1.png'), ld(pp+'1_bow2.png'), ld(pp+'1_quiver.png'), ld(pp+'arrow.png'),
  ]);

  // 몬스터 스프라이트
  await Promise.all(Object.entries(MSPRITE_DEFS).map(async ([key, def]) => {
    IMGS.m[key] = { walk: [], atk: [], hurt: [], die: [] };
    for (const anim of ['walk','atk','hurt','die']) {
      IMGS.m[key][anim] = await Promise.all(def[anim].map(ld));
    }
  }));
}

// ── 플레이어 복합 스프라이트 렌더 ────────────────────────────────────────────
function _part(img, ox, oy, angle, sc) {
  if (!img?.naturalWidth) return;
  _ctx.save();
  _ctx.translate(ox, oy);
  if (angle) _ctx.rotate(angle);
  const w = img.naturalWidth  * sc * 0.45;
  const h = img.naturalHeight * sc * 0.45;
  _ctx.drawImage(img, -w / 2, -h / 2, w, h);
  _ctx.restore();
}

export function drawPlayerSprite(x, y, state, ts, facingRight = true, windActive = false) {
  const t  = ts * 0.001;
  const sc = 0.9;

  let bodyY = 0, bodyR = 0;
  let armLA = 0, armRA = 0, legLA = 0, legRA = 0;

  switch (state) {
    case 'idle':
      bodyY   = Math.sin(t * 2) * 1.5;
      armLA   = Math.sin(t * 1.8) * 0.05;
      armRA   = -armLA;
      break;
    case 'walk':
      bodyY   = Math.abs(Math.sin(t * 8)) * (-3.5);
      armLA   = Math.sin(t * 8) * 0.35;
      armRA   = -armLA;
      legLA   = Math.sin(t * 8) * 0.38;
      legRA   = -legLA;
      break;
    case 'atk': {
      const p = Math.min(1, (ts % 500) / 400);
      armLA   = -0.55 + Math.sin(p * Math.PI) * 0.3;
      armRA   =  0.65 - Math.sin(p * Math.PI) * 0.3;
      bodyY   = Math.sin(p * Math.PI) * -2;
      break;
    }
    case 'hurt':
      bodyR   = Math.sin(t * 28) * 0.15;
      break;
    case 'death':
      bodyR   = Math.min(Math.PI / 2.2, (ts % 3000) * 0.001 * (Math.PI / 2));
      bodyY   = Math.min(20, (ts % 3000) * 0.01);
      break;
  }

  _ctx.save();
  _ctx.translate(x, y);
  if (!facingRight) _ctx.scale(-1, 1);

  _ctx.save(); _ctx.rotate(bodyR); _ctx.translate(0, bodyY);

  _part(IMGS.p_quiver,  12,  -8,  0.1,  sc * 0.7);
  _part(IMGS.p_legR,     4,  18, legRA, sc * 0.75);
  _part(IMGS.p_armR,    10,  -4, armRA, sc * 0.78);
  _part(IMGS.p_body,     0,   0,  0,    sc);
  _part(IMGS.p_bow1,    12,  -6, armRA * 0.6, sc * 0.85);
  _part(IMGS.p_legL,    -4,  18, legLA, sc * 0.75);
  _part(IMGS.p_armL,    -10, -4, armLA, sc * 0.78);
  _part(IMGS.p_head,     0, -26,  bodyR * 0.3, sc * 0.88);
  _part(IMGS.p_handR,   16,  -4, armRA, sc * 0.55);
  _part(IMGS.p_handL,  -14,  -4, armLA, sc * 0.55);

  _ctx.restore();

  // 바람 아우라
  if (windActive) {
    _ctx.save();
    _ctx.globalAlpha = 0.35 + Math.sin(ts * 0.008) * 0.15;
    _ctx.strokeStyle = '#a78bfa'; _ctx.lineWidth = 2.5;
    _ctx.beginPath(); _ctx.arc(0, -12, 26, 0, Math.PI * 2); _ctx.stroke();
    _ctx.restore();
  }

  _ctx.restore();
}

// ── 메인 렌더 ────────────────────────────────────────────────────────────────
export function renderDungeonFrame(st) {
  if (!_ctx) return;
  const { monsters, towers, player, drops, floats, projs, effects, cam,
          windActive, ts, floorDef, boss } = st;
  const cx = _W / 2 - cam.x, cy = _H / 2 - cam.y;
  const now = Date.now();

  // 배경
  _ctx.fillStyle = floorDef?.theme || '#080814';
  _ctx.fillRect(0, 0, _W, _H);

  // 그리드
  _ctx.strokeStyle = 'rgba(255,255,255,0.035)'; _ctx.lineWidth = 1;
  const gs = 80;
  const gx0 = Math.floor((cam.x - _W / 2) / gs) * gs;
  const gy0 = Math.floor((cam.y - _H / 2) / gs) * gs;
  for (let gx = gx0; gx < cam.x + _W / 2 + gs; gx += gs) { const sx = gx + cx; _ctx.beginPath(); _ctx.moveTo(sx, 0); _ctx.lineTo(sx, _H); _ctx.stroke(); }
  for (let gy = gy0; gy < cam.y + _H / 2 + gs; gy += gs) { const sy = gy + cy; _ctx.beginPath(); _ctx.moveTo(0, sy); _ctx.lineTo(_W, sy); _ctx.stroke(); }

  // 경계
  _ctx.save(); _ctx.strokeStyle = 'rgba(255,60,30,.45)'; _ctx.lineWidth = 3; _ctx.setLineDash([12, 8]);
  _ctx.beginPath(); _ctx.arc(cx, cy, st.worldR || 950, 0, Math.PI * 2); _ctx.stroke();
  _ctx.setLineDash([]); _ctx.restore();

  // 파괴된 타워 잔해
  for (const t of towers) {
    if (t.alive) continue;
    const sx = t.x + cx, sy = t.y + cy;
    if (sx < -60 || sx > _W + 60 || sy < -60 || sy > _H + 60) continue;
    _ctx.save(); _ctx.globalAlpha = 0.35; _ctx.fillStyle = '#374151';
    _ctx.beginPath(); _ctx.arc(sx, sy, 18, 0, Math.PI * 2); _ctx.fill();
    _ctx.font = '16px sans-serif'; _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
    _ctx.globalAlpha = 0.5; _ctx.fillText('🪨', sx, sy + 1); _ctx.restore();
  }

  // 이펙트
  _drawEffects(effects, cx, cy, now);

  // 드롭
  _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
  for (const d of drops) {
    const sx = d.x + cx, sy = d.y + cy;
    _ctx.save(); _ctx.font = '15px sans-serif';
    if (d.skillId) { const sk = st.skills?.find?.(s => s.id === d.skillId); _ctx.shadowColor = sk?.color || '#e879f9'; _ctx.shadowBlur = 12; _ctx.fillText(sk?.emoji || '✨', sx, sy); }
    else if (d.potion)   { _ctx.shadowColor = '#f87171'; _ctx.shadowBlur = 10; _ctx.fillText('🧪', sx, sy); }
    else if (d.mpPotion) { _ctx.shadowColor = '#60a5fa'; _ctx.shadowBlur = 10; _ctx.fillText('💙', sx, sy); }
    else { _ctx.fillText('💰', sx, sy); }
    _ctx.restore();
  }

  // 살아있는 타워
  for (const t of towers) {
    if (!t.alive) continue;
    const sx = t.x + cx, sy = t.y + cy;
    if (sx < -90 || sx > _W + 90 || sy < -90 || sy > _H + 90) continue;
    _drawTower(t, sx, sy);
  }

  // 몬스터
  for (const m of monsters) {
    if (m.state === 'gone') continue;
    const sx = m.x + cx, sy = m.y + cy;
    if (sx < -100 || sx > _W + 100 || sy < -100 || sy > _H + 100) continue;
    _drawMonster(m, sx, sy, st.freezeSet, st.burnMap, now);
  }

  // 발사체
  for (const proj of projs) {
    const sx = proj.x + cx, sy = proj.y + cy;
    _ctx.save();
    if (proj.isPiercing) {
      // 관통 화살 — 긴 선
      const len = 16, nx = proj.vx / (Math.hypot(proj.vx, proj.vy) || 1), ny = proj.vy / (Math.hypot(proj.vx, proj.vy) || 1);
      _ctx.strokeStyle = proj.color; _ctx.lineWidth = 2.5; _ctx.shadowColor = proj.color; _ctx.shadowBlur = 8;
      _ctx.beginPath(); _ctx.moveTo(sx - nx * len, sy - ny * len); _ctx.lineTo(sx + nx * 4, sy + ny * 4); _ctx.stroke();
    } else {
      _ctx.fillStyle = proj.color; _ctx.shadowColor = proj.color; _ctx.shadowBlur = proj.isAoe ? 14 : 8;
      _ctx.beginPath(); _ctx.arc(sx, sy, proj.r, 0, Math.PI * 2); _ctx.fill();
    }
    _ctx.restore();
  }

  // 플레이어
  const px = player.x + cx, py = player.y + cy;
  const pState = player.animState || 'idle';
  drawPlayerSprite(px, py, pState, ts, player.facing > 0, windActive);
  // HP 링
  _ctx.save();
  _ctx.strokeStyle = '#3b82f6'; _ctx.lineWidth = 2.5;
  _ctx.beginPath(); _ctx.arc(px, py - 12, 22, 0, Math.PI * 2); _ctx.stroke();
  _ctx.restore();

  // 이동 인디케이터
  if (player.moving) {
    _ctx.save(); _ctx.strokeStyle = 'rgba(99,102,241,.5)'; _ctx.lineWidth = 1; _ctx.setLineDash([5, 4]);
    _ctx.beginPath(); _ctx.moveTo(px, py); _ctx.lineTo(player.tx + cx, player.ty + cy); _ctx.stroke();
    _ctx.setLineDash([]); _ctx.fillStyle = 'rgba(99,102,241,.8)';
    _ctx.beginPath(); _ctx.arc(player.tx + cx, player.ty + cy, 4, 0, Math.PI * 2); _ctx.fill(); _ctx.restore();
  }

  // 플로팅 텍스트
  for (const f of floats) {
    _ctx.save(); _ctx.globalAlpha = Math.min(1, f.life * 1.3);
    _ctx.fillStyle = f.color; _ctx.font = 'bold 13px sans-serif';
    _ctx.textAlign = 'center'; _ctx.textBaseline = 'alphabetic';
    _ctx.fillText(f.text, f.wx + cx, f.wy + cy); _ctx.restore();
  }

  // 보스 HP 바 (캔버스 상단)
  if (boss) {
    const bw = Math.min(280, _W - 40), bx = (_W - bw) / 2;
    _ctx.fillStyle = 'rgba(0,0,0,.75)'; _ctx.fillRect(bx - 4, 4, bw + 8, 18);
    const r = Math.max(0, boss.hp / boss.maxHp);
    const c = r > 0.5 ? '#ef4444' : r > 0.25 ? '#f97316' : '#dc2626';
    _ctx.fillStyle = c; _ctx.fillRect(bx, 7, bw * r, 12);
    _ctx.font = 'bold 10px sans-serif'; _ctx.textAlign = 'center'; _ctx.fillStyle = '#fff';
    _ctx.fillText(`🐉 ${boss.def.label} HP ${Math.ceil(boss.hp)} / ${boss.def.maxHp}`, _W / 2, 17);
  }
}

// ── 내부 드로우 헬퍼 ─────────────────────────────────────────────────────────
function _drawTower(t, sx, sy) {
  const imgKey = t.kind === 'archer' ? 'tower' : 'tower2';
  const img = IMGS[imgKey];
  const th = t.sz || 44;
  _ctx.save();
  // 사정거리
  _ctx.globalAlpha = 0.06; _ctx.fillStyle = t.color;
  _ctx.beginPath(); _ctx.arc(sx, sy, t.range, 0, Math.PI * 2); _ctx.fill();
  _ctx.globalAlpha = 0.35; _ctx.strokeStyle = t.color; _ctx.lineWidth = 1; _ctx.setLineDash([5, 5]);
  _ctx.beginPath(); _ctx.arc(sx, sy, t.range, 0, Math.PI * 2); _ctx.stroke();
  _ctx.setLineDash([]); _ctx.globalAlpha = 1;
  if (img?.naturalWidth) {
    const tw = th * img.naturalWidth / img.naturalHeight;
    _ctx.drawImage(img, sx - tw / 2, sy - th, tw, th);
  } else {
    _ctx.fillStyle = t.kind === 'archer' ? '#78716c' : '#7f1d1d';
    _ctx.strokeStyle = t.color; _ctx.lineWidth = 1.5;
    _ctx.beginPath(); _ctx.arc(sx, sy, t.sz / 2, 0, Math.PI * 2); _ctx.fill(); _ctx.stroke();
    _ctx.font = `${t.sz / 2 + 2}px sans-serif`; _ctx.textAlign = 'center'; _ctx.textBaseline = 'middle';
    _ctx.fillText(t.kind === 'archer' ? '🏹' : '💣', sx, sy + 1);
  }
  const bw = 44, bh = 5, hpR = t.hp / t.maxHp;
  _ctx.fillStyle = '#111'; _ctx.fillRect(sx - bw / 2, sy - th - 8, bw, bh);
  _ctx.fillStyle = hpR > 0.5 ? '#22c55e' : hpR > 0.25 ? '#f59e0b' : '#ef4444';
  _ctx.fillRect(sx - bw / 2, sy - th - 8, bw * hpR, bh);
  _ctx.restore();
}

function _drawMonster(m, sx, sy, freezeSet, burnMap, now) {
  const sz = m.def.sz || 52;
  const sp = IMGS.m[m.base.sp];
  const isFrz = freezeSet?.has(m.id);
  const isBrn = burnMap?.has(m.id);
  const animKey = m.state === 'die' ? 'die' : m.state === 'hurt' ? 'hurt' : m.state === 'atk' ? 'atk' : 'walk';
  const frames = sp?.[animKey] || [];
  const fi = Math.min(m.frame || 0, frames.length - 1);
  const img = frames[fi];

  _ctx.save();
  if (isFrz) _ctx.filter = 'hue-rotate(180deg)brightness(1.3)saturate(0.5)';
  else if (isBrn) _ctx.filter = 'hue-rotate(-30deg)saturate(2.5)';

  _ctx.translate(sx, sy);
  if ((m.facing || 1) < 0) _ctx.scale(-1, 1);

  if (img?.complete && img.naturalWidth) { _ctx.drawImage(img, -sz / 2, -sz, sz, sz); }
  else { _ctx.fillStyle = '#f87171'; _ctx.beginPath(); _ctx.arc(0, -sz / 2, sz / 2, 0, Math.PI * 2); _ctx.fill(); }
  _ctx.filter = 'none';

  if (isFrz)  { _ctx.globalAlpha = 0.35; _ctx.fillStyle = '#38bdf8'; _ctx.beginPath(); _ctx.arc(0, -sz / 2, sz / 2, 0, Math.PI * 2); _ctx.fill(); _ctx.globalAlpha = 1; }
  if (isBrn)  { _ctx.globalAlpha = 0.25; _ctx.fillStyle = '#f97316'; _ctx.beginPath(); _ctx.arc(0, -sz / 2, sz / 2, 0, Math.PI * 2); _ctx.fill(); _ctx.globalAlpha = 1; }
  if (m.isKnockback) { _ctx.globalAlpha = 0.3; _ctx.fillStyle = '#a78bfa'; _ctx.beginPath(); _ctx.arc(0, -sz / 2, sz / 2, 0, Math.PI * 2); _ctx.fill(); _ctx.globalAlpha = 1; }

  // 드래곤 보스 화염 브레스 경고
  if (m.bossPhase === 'breath' && m.breathAngle != null) {
    _ctx.globalAlpha = 0.25 + Math.sin(now * 0.02) * 0.1;
    _ctx.fillStyle = '#f97316';
    _ctx.beginPath(); _ctx.moveTo(0, -sz / 2);
    _ctx.arc(0, -sz / 2, 180, m.breathAngle - 0.5, m.breathAngle + 0.5);
    _ctx.closePath(); _ctx.fill(); _ctx.globalAlpha = 1;
  }

  _ctx.restore();

  // HP바
  if (m.state !== 'die') {
    const bw = sz * 0.85, bh = 4, hpR = Math.max(0, m.hp / m.def.maxHp);
    _ctx.fillStyle = '#111'; _ctx.fillRect(sx - bw / 2, sy - sz - 8, bw, bh);
    _ctx.fillStyle = hpR > 0.5 ? '#4ade80' : hpR > 0.25 ? '#fbbf24' : '#ef4444';
    _ctx.fillRect(sx - bw / 2, sy - sz - 8, bw * hpR, bh);
    if (sz > 60) { _ctx.font = `bold ${Math.round(9 * sz / 55)}px sans-serif`; _ctx.textAlign = 'center'; _ctx.fillStyle = '#fff'; _ctx.fillText(m.def.label, sx, sy - sz - 12); }
  }
}

function _drawEffects(effects, cx, cy, now) {
  for (const ef of effects) {
    const age = (now - ef.startAt) / ef.dur, alpha = Math.max(0, 1 - age);
    const esx = ef.x + cx, esy = ef.y + cy;
    if (ef.type === 'fire' || ef.type === 'ice') {
      _ctx.save(); _ctx.globalAlpha = alpha * 0.32; _ctx.fillStyle = ef.color;
      _ctx.beginPath(); _ctx.arc(esx, esy, ef.r * (0.5 + age * 0.5), 0, Math.PI * 2); _ctx.fill();
      _ctx.globalAlpha = alpha * 0.75; _ctx.strokeStyle = ef.color; _ctx.lineWidth = 2.5;
      _ctx.beginPath(); _ctx.arc(esx, esy, ef.r, 0, Math.PI * 2); _ctx.stroke(); _ctx.restore();
    } else if (ef.type === 'bolt') {
      _ctx.save(); _ctx.strokeStyle = ef.color; _ctx.lineWidth = 2.5; _ctx.globalAlpha = alpha; _ctx.shadowColor = ef.color; _ctx.shadowBlur = 10;
      for (const seg of ef.targets || []) { _ctx.beginPath(); _ctx.moveTo(seg.from.x + cx, seg.from.y + cy); _ctx.lineTo(seg.to.x + cx, seg.to.y + cy); _ctx.stroke(); }
      _ctx.restore();
    } else if (ef.type === 'meteor_warn') {
      const pulse = Math.sin(age * Math.PI * 6) * 0.3 + 0.7;
      _ctx.save(); _ctx.globalAlpha = 0.45 * pulse; _ctx.strokeStyle = '#fb923c'; _ctx.lineWidth = 2; _ctx.setLineDash([7, 5]);
      _ctx.beginPath(); _ctx.arc(esx, esy, ef.r, 0, Math.PI * 2); _ctx.stroke(); _ctx.setLineDash([]); _ctx.restore();
    } else if (ef.type === 'meteor_hit') {
      _ctx.save(); _ctx.globalAlpha = alpha * 0.55; _ctx.fillStyle = '#ef4444';
      _ctx.beginPath(); _ctx.arc(esx, esy, ef.r * (1 + age * 0.5), 0, Math.PI * 2); _ctx.fill(); _ctx.restore();
    } else if (ef.type === 'wind') {
      const spin = now * 0.004 % (Math.PI * 2);
      _ctx.save(); _ctx.globalAlpha = alpha * 0.22; _ctx.fillStyle = '#a78bfa';
      _ctx.beginPath(); _ctx.arc(esx, esy, ef.r, 0, Math.PI * 2); _ctx.fill();
      _ctx.globalAlpha = alpha * 0.65; _ctx.strokeStyle = '#a78bfa'; _ctx.lineWidth = 2;
      for (let wi = 0; wi < 6; wi++) { _ctx.beginPath(); _ctx.arc(esx + Math.cos(spin + (wi / 6) * Math.PI * 2) * ef.r * 0.6, esy + Math.sin(spin + (wi / 6) * Math.PI * 2) * ef.r * 0.6, 5, 0, Math.PI * 2); _ctx.stroke(); }
      _ctx.restore();
    } else if (ef.type === 'explosion') {
      const r = ef.r * (0.6 + age * 0.8);
      _ctx.save(); _ctx.globalAlpha = alpha * 0.7;
      const g = _ctx.createRadialGradient(esx, esy, 0, esx, esy, r);
      g.addColorStop(0, 'rgba(255,220,50,.9)'); g.addColorStop(0.4, 'rgba(255,90,0,.6)'); g.addColorStop(1, 'transparent');
      _ctx.fillStyle = g; _ctx.beginPath(); _ctx.arc(esx, esy, r, 0, Math.PI * 2); _ctx.fill(); _ctx.restore();
    } else if (ef.type === 'knockback_ring') {
      _ctx.save(); _ctx.globalAlpha = alpha * 0.6; _ctx.strokeStyle = '#a78bfa'; _ctx.lineWidth = 2;
      _ctx.beginPath(); _ctx.arc(esx, esy, ef.r * (0.3 + age * 0.7), 0, Math.PI * 2); _ctx.stroke(); _ctx.restore();
    }
  }
}
