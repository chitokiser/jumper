// relay.render.js — 이어달리기 렌더링 v2 (대형 트랙·원근·불꽃·바통)
import { LEG_DIST, LEGS } from './relay.race.js';

export const CW = 360, CH = 380;
const CX = CW / 2, CY = CH * 0.44;

// ── 파티클 풀 ─────────────────────────────────────────────────────────────────
const _dust  = [];
const _sparks = [];     // 바통 전달 스파크
const _fireworks = [];  // 골인 축포

export function launchFireworks(x, y) {
  for (let i = 0; i < 80; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd   = 3 + Math.random() * 8;
    _fireworks.push({
      x: x ?? CX, y: y ?? CY - 60,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd - 4,
      life: 1, decay: 0.012 + Math.random() * 0.018,
      r:   2.5 + Math.random() * 3,
      hue: Math.random() * 360,
      trail: [],
    });
  }
}

export function launchBatonSpark(x, y) {
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 2 + Math.random() * 4;
    _sparks.push({ x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s-1, life:1, decay:0.07 });
  }
}

function addDust(x, y, sc) {
  if (Math.random() > 0.2) return;
  _dust.push({ x:x+(Math.random()-.5)*8*sc, y:y+(Math.random()-.5)*4*sc,
    vx:(Math.random()-.65)*1.1, vy:-(Math.random()*.7+.1),
    life:1, decay:0.038+Math.random()*.03, r:(1.5+Math.random()*2)*sc });
}

function tickParticles(dt) {
  [_dust, _sparks, _fireworks].forEach(pool => {
    for (let i = pool.length - 1; i >= 0; i--) {
      const p = pool[i];
      p.x  += p.vx * dt * 60;
      p.y  += p.vy * dt * 60;
      if (pool === _fireworks) p.vy += 0.12 * dt * 60; // 중력
      p.life -= p.decay * dt * 60;
      if (p.life <= 0) pool.splice(i, 1);
    }
  });
}

function drawParticles(ctx) {
  _dust.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(180,145,100,${p.life * 0.4})`;
    ctx.fill();
  });
  _sparks.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r ?? 2.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,220,80,${p.life})`;
    ctx.fill();
  });
  _fireworks.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * Math.max(0.1, p.life), 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${p.hue},100%,70%,${p.life * 0.9})`;
    ctx.fill();
    // 꼬리
    if (p.trail) {
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 5) p.trail.shift();
      p.trail.forEach((t, ti) => {
        ctx.beginPath();
        ctx.arc(t.x, t.y, p.r * 0.4 * (ti / p.trail.length), 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue},100%,80%,${p.life * (ti/p.trail.length) * 0.5})`;
        ctx.fill();
      });
    }
  });
}

// ── 스프라이트 ────────────────────────────────────────────────────────────────
const _cache = {};
const enc = s => s.replace(/ /g, '%20');
const pad = (n, w = 3) => String(n).padStart(w, '0');

const SPRITE_DEFS = {
  orc1:     { dir:'/assets/images/monsters/orc/',     fn:i=>`ORK_01_WALK_${pad(i)}.png`,                       n:6  },
  orc2:     { dir:'/assets/images/monsters/orc2/',    fn:i=>`ORK_02_WALK_${pad(i)}.png`,                       n:6  },
  orc3:     { dir:'/assets/images/monsters/orc3/',    fn:i=>`ORK_03_WALK_${pad(i)}.png`,                       n:6  },
  zombie1:  { dir:'/assets/images/monsters/zombie1/animation/', fn:i=>`Run${i+1}.png`,                         n:10 },
  zombie3:  { dir:'/assets/images/monsters/Zombie3/animation/', fn:i=>`Run${i+1}.png`,                         n:10 },
  pirate1:  { dir:'/assets/images/monsters/pirate/',  fn:i=>`1_entity_000_WALK_${pad(i)}.png`,                 n:6  },
  pirate2:  { dir:'/assets/images/monsters/pirate2/', fn:i=>`2_entity_000_WALK_${pad(i)}.png`,                 n:6  },
  pirate3:  { dir:'/assets/images/monsters/pirate3/', fn:i=>`3_3-PIRATE_WALK_${pad(i)}.png`,                   n:6  },
  troll:    { dir:enc('/assets/images/troll/PNG/Animation/Troll1/'), fn:i=>`Run_${pad(i)}.png`,               n:10 },
  villager1:{ dir:enc('/assets/images/villager/Zombie_Villager_1/PNG/PNG Sequences/Running/'),
              fn:i=>`0_Zombie_Villager_Running_${pad(i)}.png`, n:12 },
  villager2:{ dir:enc('/assets/images/villager/Zombie_Villager_2/PNG/PNG Sequences/Running/'),
              fn:i=>`0_Zombie_Villager_Running_${pad(i)}.png`, n:12 },
  villager3:{ dir:enc('/assets/images/villager/Zombie_Villager_3/PNG/PNG Sequences/Running/'),
              fn:i=>`0_Zombie_Villager_Running_${pad(i)}.png`, n:12 },
  knight1:  { dir:enc('/assets/images/knight/_PNG/1_KNIGHT/'), fn:i=>`Knight_01__RUN_${pad(i)}.png`, n:10 },
  knight2:  { dir:enc('/assets/images/knight/_PNG/2_KNIGHT/'), fn:i=>`Knight_02__RUN_${pad(i)}.png`, n:10 },
  knight3:  { dir:enc('/assets/images/knight/_PNG/3_KNIGHT/'), fn:i=>`Knight_03__RUN_${pad(i)}.png`, n:10 },
};

function imgAt(src) {
  if (!_cache[src]) { const i = new Image(); i.src = src; _cache[src] = i; }
  return _cache[src];
}

export function getFrames(charId) {
  const d = SPRITE_DEFS[charId];
  return d ? Array.from({ length: d.n }, (_, i) => imgAt(d.dir + d.fn(i))) : [];
}

export function preloadAll() {
  Object.keys(SPRITE_DEFS).forEach(getFrames);
  imgAt('/assets/images/jump/logo2.png'); // 로고 프리로드
}

const _logoImg = imgAt('/assets/images/jump/logo2.png');

// ── 트랙 좌표 ─────────────────────────────────────────────────────────────────
function laneR(lane) {
  return { rx: 108 + lane * 10.5, ry: 58 + lane * 6 };
}

export function trackPos(progress, lane) {
  const { rx, ry } = laneR(lane);
  const angle = progress * Math.PI * 2 - Math.PI / 2;
  const x = CX + rx * Math.cos(angle);
  const y = CY + ry * Math.sin(angle);
  const perspScale = 0.52 + ((Math.sin(angle) + 1) / 2) * 0.50;
  return { x, y, perspScale, angle };
}

// ── 트랙 배경 드로잉 ──────────────────────────────────────────────────────────
let _trackCache = null;

function buildTrackCache(w, h) {
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const ctx = off.getContext('2d');

  // 배경 하늘
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.28);
  sky.addColorStop(0, '#08112a'); sky.addColorStop(1, '#1a2e50');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h * 0.3);

  // 배경 바닥
  const gnd = ctx.createLinearGradient(0, h * 0.28, 0, h);
  gnd.addColorStop(0, '#1a3020'); gnd.addColorStop(1, '#0d1a10');
  ctx.fillStyle = gnd; ctx.fillRect(0, h * 0.27, w, h * 0.73);

  // 관중석 (점선 배경)
  for (let i = 0; i < 260; i++) {
    const px = Math.random() * w, py = Math.random() * h * 0.22;
    ctx.fillStyle = `rgba(${100+Math.random()*100|0},${80+Math.random()*80|0},${60+Math.random()*60|0},0.4)`;
    ctx.beginPath(); ctx.arc(px, py, 1.5 + Math.random(), 0, Math.PI * 2); ctx.fill();
  }

  // 잔디 (내부)
  const cx = w/2, cy = h * 0.44;
  const ir = laneR(-0.6);
  ctx.beginPath(); ctx.ellipse(cx, cy, ir.rx, ir.ry, 0, 0, Math.PI * 2);
  const grassG = ctx.createRadialGradient(cx, cy - 10, 10, cx, cy, ir.rx);
  grassG.addColorStop(0, '#2d7a2d'); grassG.addColorStop(0.7, '#236523'); grassG.addColorStop(1, '#1a5a1a');
  ctx.fillStyle = grassG; ctx.fill();
  // 잔디 줄무늬
  ctx.save(); ctx.clip();
  for (let x = cx - ir.rx; x < cx + ir.rx; x += 13) {
    ctx.fillStyle = x % 26 < 13 ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.04)';
    ctx.fillRect(x, cy - ir.ry, 13, ir.ry * 2);
  }
  ctx.restore();

  // 트랙 레인 (바깥→안 순서)
  const COLORS = ['#6b1c00','#7a2000','#8a2500','#9a2a00','#aa2f00','#bb3400'];
  for (let lane = 5; lane >= 0; lane--) {
    const lo = laneR(lane + 0.5), li = laneR(lane - 0.5);
    ctx.beginPath();
    ctx.ellipse(cx, cy, lo.rx, lo.ry, 0, 0, Math.PI * 2);
    ctx.ellipse(cx, cy, li.rx, li.ry, 0, 0, Math.PI * 2, true);
    const tg = ctx.createRadialGradient(cx, cy, li.rx, cx, cy, lo.rx);
    tg.addColorStop(0, COLORS[lane]); tg.addColorStop(1, COLORS[Math.min(5,lane+1)]);
    ctx.fillStyle = tg; ctx.fill('evenodd');
    // 레인 구분선
    ctx.beginPath(); ctx.ellipse(cx, cy, li.rx, li.ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,220,150,0.5)'; ctx.lineWidth = lane === 0 ? 1.8 : 1;
    ctx.stroke();
  }

  // 바깥 테두리
  const or = laneR(5.6);
  ctx.beginPath(); ctx.ellipse(cx, cy, or.rx, or.ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2; ctx.stroke();

  // 스타트/피니시 라인 (두꺼운 흰 줄)
  const ft = trackPos(0, -0.6), fb = trackPos(0, 5.6);
  ctx.beginPath(); ctx.moveTo(ft.x, ft.y); ctx.lineTo(fb.x, fb.y);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();

  // 중간 교환 라인 (반바퀴 위치, 점선)
  const ht = trackPos(0.5, -0.4), hb = trackPos(0.5, 5.4);
  ctx.beginPath(); ctx.moveTo(ht.x, ht.y); ctx.lineTo(hb.x, hb.y);
  ctx.setLineDash([6,4]); ctx.strokeStyle = 'rgba(255,230,100,.6)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.setLineDash([]);

  // FINISH 텍스트
  ctx.fillStyle = '#ffffffbb';
  ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('FINISH / START', cx, cy - or.ry - 7);
  // 교환 텍스트
  ctx.fillStyle = 'rgba(255,230,100,.6)';
  ctx.font = '8px sans-serif';
  ctx.fillText('EXCHANGE', cx, cy + or.ry + 13);

  // 레인 번호
  for (let l = 0; l < 6; l++) {
    const { rx, ry } = laneR(l);
    ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.font = '7px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(l + 1, cx + rx * 0.98 + 10, cy + 3);
  }

  return off;
}

// ── 러너 드로잉 ───────────────────────────────────────────────────────────────
function drawRunner(ctx, team, runner, x, y, sc, isPlayer, now, isBaton) {
  const sz = Math.max(24, Math.round(44 * sc));
  const frames = getFrames(runner.id);
  const fi = runner.animFrame % Math.max(1, frames.length);
  const fr = frames[fi];

  // 속도선 (탭 부스트 시)
  if (team.tapBonus > 0.3 && sc > 0.7) {
    ctx.save(); ctx.globalAlpha = team.tapBonus * 0.5;
    for (let i = 1; i <= 3; i++) {
      ctx.strokeStyle = `rgba(255,220,50,${0.4 - i*0.1})`;
      ctx.lineWidth = (4 - i) * sc;
      ctx.beginPath();
      ctx.moveTo(x - i * 8 * sc, y - sz * 0.4 + i * 1);
      ctx.lineTo(x - i * 8 * sc - 14 * sc, y - sz * 0.4 + i * 1);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 바통 전달 중 글로우
  if (isBaton) {
    ctx.save();
    const glow = ctx.createRadialGradient(x, y - sz*0.3, 0, x, y - sz*0.3, sz * 0.7);
    glow.addColorStop(0, 'rgba(255,220,50,.6)'); glow.addColorStop(1, 'rgba(255,220,50,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y - sz*0.3, sz * 0.7, 0, Math.PI * 2);
    ctx.fill(); ctx.restore();
  }

  // 그림자
  ctx.beginPath(); ctx.ellipse(x, y + sz * 0.44, sz * 0.28, sz * 0.1, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fill();

  // 스프라이트 or 폴백
  if (fr?.complete && fr.naturalWidth > 0) {
    ctx.drawImage(fr, x - sz * 0.55, y - sz * 0.95, sz * 1.1, sz * 1.0);
  } else {
    const gr = ctx.createRadialGradient(x, y - sz*0.4, 2, x, y - sz*0.4, sz*0.45);
    gr.addColorStop(0, '#fff'); gr.addColorStop(1, team.color || '#888');
    ctx.beginPath(); ctx.arc(x, y - sz*0.4, sz*0.45, 0, Math.PI*2);
    ctx.fillStyle = gr; ctx.fill();
    ctx.fillStyle = '#000'; ctx.font = `bold ${Math.round(9*sc)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(runner.name.slice(0,4), x, y - sz*0.33);
  }

  // 플레이어 팀 링
  if (isPlayer) {
    const pulse = 0.8 + Math.sin(Date.now() / 200) * 0.15;
    ctx.strokeStyle = `rgba(255,215,0,${pulse})`;
    ctx.lineWidth = 2 * sc;
    ctx.beginPath(); ctx.arc(x, y - sz*0.4, sz * 0.55 * pulse, 0, Math.PI*2); ctx.stroke();
  }

  // 등급 뱃지
  if (sc > 0.68) {
    const gc = {S:'#ffd700',A:'#c0c0c0',B:'#cd7f32',C:'#aada50',D:'#aaa'}[runner.grade]||'#fff';
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.beginPath(); ctx.roundRect(x-12*sc, y-sz*1.02, 24*sc, 12*sc, 3); ctx.fill();
    ctx.fillStyle = gc; ctx.font = `bold ${Math.round(7.5*sc)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`[${runner.grade}] ${runner.name.slice(0,5)}`, x, y - sz * 0.95);
  }

  // 스태미나 바
  const bW = Math.round(30*sc), bH = Math.round(4*sc);
  const bX = x - bW/2, bY = y - sz*1.1;
  ctx.fillStyle = '#222'; ctx.fillRect(bX, bY, bW, bH);
  const sc2 = runner.stamina > 60 ? '#22c55e' : runner.stamina > 30 ? '#fbbf24' : '#ef4444';
  ctx.fillStyle = sc2; ctx.fillRect(bX, bY, bW*(runner.stamina/100), bH);

  // 이벤트 텍스트
  if (runner.eventLabel && now - runner.eventTs < 2200) {
    const a = 1 - (now - runner.eventTs) / 2200;
    const fy = y - sz * 1.05 - (now - runner.eventTs) * 0.022;
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(10*sc)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.fillText(runner.eventLabel, x, fy);
    ctx.restore();
  }
}

// ── 카운트다운 오버레이 ──────────────────────────────────────────────────────
export function renderCountdown(ctx, num, now) {
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillRect(0, 0, CW, CH);

  const pulse = 1 + Math.sin((now % 300) / 300 * Math.PI) * 0.12;
  const text  = num > 0 ? String(num) : 'GO!';
  const color = num > 0 ? '#fbbf24' : '#22c55e';
  const size  = num > 0 ? 100 * pulse : 80 * pulse;

  ctx.save();
  ctx.translate(CX, CY);
  ctx.font = `900 ${size|0}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 그림자 효과
  ctx.shadowColor = color; ctx.shadowBlur = 40;
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.shadowBlur = 0; ctx.restore();

  ctx.fillStyle = 'rgba(255,255,255,.6)';
  ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('READY…', CX, CY + 70);
}

// ── 메인 렌더 ────────────────────────────────────────────────────────────────
export function renderRace(ctx, teams, now, dt) {
  // 트랙 배경 (캐시)
  if (!_trackCache) _trackCache = buildTrackCache(CW, CH);
  ctx.drawImage(_trackCache, 0, 0);

  // 잔디 중앙 JumpDAO 로고
  if (_logoImg?.complete && _logoImg.naturalWidth > 0) {
    const lw = 72;
    const lh = lw * (_logoImg.naturalHeight / _logoImg.naturalWidth);
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.drawImage(_logoImg, CX - lw / 2, CY - lh / 2, lw, lh);
    ctx.restore();
  }

  tickParticles(dt || 0.016);

  // 러너 수집 & Y 정렬
  const drawList = [];
  teams.forEach((team, ti) => {
    if (team.finishTime !== null) return;
    const runner = team.runners[team.legIdx];
    if (!runner) return;
    const totalProg = (team.legIdx * LEG_DIST + runner.dist) / (LEGS * LEG_DIST);
    const pos = trackPos(totalProg % 1, ti);
    if (Math.random() < 0.12) addDust(pos.x, pos.y, pos.perspScale);
    drawList.push({ team, runner, pos, isPlayer: team.isPlayer, ti });
  });

  drawParticles(ctx);

  // 원근 정렬 (Y 오름차순 = 먼 곳 먼저)
  drawList.sort((a, b) => a.pos.y - b.pos.y).forEach(({ team, runner, pos, isPlayer }) => {
    drawRunner(ctx, team, runner, pos.x, pos.y, pos.perspScale, isPlayer, now, team.batonPass);
  });

  // 골인 팀 뱃지
  const finished = teams.filter(t => t.finishTime !== null).sort((a,b)=>a.rank-b.rank);
  finished.forEach((team, i) => {
    const medals = ['🥇','🥈','🥉','4위','5위','6위'];
    ctx.fillStyle = team.isPlayer ? 'rgba(255,215,0,.22)' : 'rgba(0,0,0,.5)';
    ctx.beginPath(); ctx.roundRect(4, 4 + i * 22, 80, 19, 4); ctx.fill();
    ctx.fillStyle = team.isPlayer ? '#ffd700' : '#ccc';
    ctx.font = `bold 10px sans-serif`; ctx.textAlign = 'left';
    ctx.fillText(`${medals[i]} ${team.label}[${team.grade}]`, 8, 18 + i * 22);
  });
}

// ── 다음 주자 미리보기 ────────────────────────────────────────────────────────
export function renderNextUp(ctx, team, now) {
  if (!team || team.legIdx >= LEGS - 1) return;
  const next = team.runners[team.legIdx + 1];
  if (!next) return;

  ctx.fillStyle = 'rgba(10,10,30,.78)';
  ctx.beginPath(); ctx.roundRect(CW - 90, 2, 88, 50, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(255,191,36,.5)'; ctx.lineWidth = 1; ctx.stroke();

  ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'right';
  ctx.fillText('NEXT ▶', CW - 5, 14);

  const frames = getFrames(next.id);
  const fr = frames[Math.floor(now / 90) % Math.max(1, frames.length)];
  if (fr?.complete && fr.naturalWidth > 0) ctx.drawImage(fr, CW - 87, 16, 26, 28);

  ctx.fillStyle = '#fff'; ctx.font = '8px sans-serif';
  ctx.fillText(next.name, CW - 5, 30);
  const gc = {S:'#ffd700',A:'#c0c0c0',B:'#cd7f32',C:'#8aaa4a',D:'#aaa'}[next.grade]||'#fff';
  ctx.fillStyle = gc; ctx.fillText(`[${next.grade}]`, CW - 5, 42);
}

// ── 리더 크라운 ──────────────────────────────────────────────────────────────
export function renderLeaderCrown(ctx, teams) {
  const active = teams.filter(t => t.finishTime === null);
  if (!active.length) return;
  const leader = [...active].sort((a, b) => b.totDist - a.totDist)[0];
  const li = teams.indexOf(leader);
  const runner = leader.runners[leader.legIdx];
  if (!runner) return;
  const tp = (leader.legIdx * LEG_DIST + runner.dist) / (LEGS * LEG_DIST);
  const pos = trackPos(tp % 1, li);
  const sz  = Math.round(44 * pos.perspScale);
  ctx.font = `${Math.round(14 * pos.perspScale)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('👑', pos.x, pos.y - sz * 1.12);
}

// ── 바통 전달 이펙트 ─────────────────────────────────────────────────────────
export function renderBatonPass(ctx, teams, now) {
  teams.forEach((team, ti) => {
    if (!team.batonPass) return;
    const progress = ((team.legIdx + 1) * LEG_DIST) / (LEGS * LEG_DIST) % 1;
    const pos = trackPos(progress, ti);
    const pulse = 0.7 + Math.sin(now / 60) * 0.3;

    ctx.save();
    ctx.globalAlpha = pulse;
    // 글로우 링
    const gr = ctx.createRadialGradient(pos.x, pos.y, 4, pos.x, pos.y, 28 * pos.perspScale);
    gr.addColorStop(0, 'rgba(255,220,50,.9)'); gr.addColorStop(1, 'rgba(255,220,50,0)');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(pos.x, pos.y, 28 * pos.perspScale, 0, Math.PI * 2);
    ctx.fill();
    // 텍스트
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.round(11 * pos.perspScale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('🏃BATON!', pos.x, pos.y - 22 * pos.perspScale);
    ctx.restore();
  });
}
