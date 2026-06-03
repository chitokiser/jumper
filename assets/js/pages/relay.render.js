// relay.render.js — 이어달리기 렌더링 (원형 트랙 · 원근감 · 스프라이트)
import { LEG_DIST, LEGS } from './relay.race.js';

export const CW = 360, CH = 320;
const CX = CW / 2, CY = CH * 0.46;

// ── 파티클 풀 ─────────────────────────────────────────────────────────────────
const _particles = [];

function addDust(x, y, scale = 1) {
  for (let i = 0; i < 3; i++) {
    _particles.push({
      x: x + (Math.random() - 0.5) * 10 * scale,
      y: y + (Math.random() - 0.5) * 4 * scale,
      vx: (Math.random() - 0.6) * 1.2,
      vy: -(Math.random() * 0.8 + 0.2),
      life: 1, decay: 0.04 + Math.random() * 0.03,
      r: (1.5 + Math.random() * 2.5) * scale,
      color: `rgba(${180+Math.random()*40|0},${140+Math.random()*30|0},${100+Math.random()*20|0},`
    });
  }
}

function updateParticles() {
  for (let i = _particles.length - 1; i >= 0; i--) {
    const p = _particles[i];
    p.x += p.vx; p.y += p.vy; p.life -= p.decay;
    if (p.life <= 0) _particles.splice(i, 1);
  }
}

function drawParticles(ctx) {
  _particles.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
    ctx.fillStyle = p.color + (p.life * 0.45) + ')';
    ctx.fill();
  });
}

// ── 스프라이트 캐시 & 로딩 ────────────────────────────────────────────────────
const _cache = {};

function img(src) {
  if (!_cache[src]) { const i = new Image(); i.src = src; _cache[src] = i; }
  return _cache[src];
}

// 스페이스 인코딩 헬퍼
const enc = s => s.replace(/ /g, '%20');
const pad = (n, w = 3) => String(n).padStart(w, '0');

const SPRITE_DEFS = {
  orc1:     { dir:'/assets/images/monsters/orc/',     fn:i=>`ORK_01_WALK_${pad(i)}.png`,           n:6  },
  orc2:     { dir:'/assets/images/monsters/orc2/',    fn:i=>`ORK_02_WALK_${pad(i)}.png`,           n:6  },
  orc3:     { dir:'/assets/images/monsters/orc3/',    fn:i=>`ORK_03_WALK_${pad(i)}.png`,           n:6  },
  zombie1:  { dir:'/assets/images/monsters/zombie1/animation/', fn:i=>`Run${i+1}.png`,             n:10 },
  zombie3:  { dir:'/assets/images/monsters/Zombie3/animation/', fn:i=>`Run${i+1}.png`,             n:10 },
  pirate1:  { dir:'/assets/images/monsters/pirate/',  fn:i=>`1_entity_000_WALK_${pad(i)}.png`,     n:6  },
  pirate2:  { dir:'/assets/images/monsters/pirate2/', fn:i=>`2_entity_000_WALK_${pad(i)}.png`,     n:6  },
  pirate3:  { dir:'/assets/images/monsters/pirate3/', fn:i=>`3_3-PIRATE_WALK_${pad(i)}.png`,       n:6  },
  troll:    { dir:enc('/assets/images/troll/PNG/Animation/Troll1/'), fn:i=>`Run_${pad(i)}.png`,    n:10 },
  // Villager — 정확한 경로: PNG/PNG Sequences/Running/
  villager1:{ dir:enc('/assets/images/villager/Zombie_Villager_1/PNG/PNG Sequences/Running/'), fn:i=>`0_Zombie_Villager_Running_${pad(i)}.png`, n:12 },
  villager2:{ dir:enc('/assets/images/villager/Zombie_Villager_2/PNG/PNG Sequences/Running/'), fn:i=>`0_Zombie_Villager_Running_${pad(i)}.png`, n:12 },
  villager3:{ dir:enc('/assets/images/villager/Zombie_Villager_3/PNG/PNG Sequences/Running/'), fn:i=>`0_Zombie_Villager_Running_${pad(i)}.png`, n:12 },
  knight1:  { dir:enc('/assets/images/knight/_PNG/1_KNIGHT/'), fn:i=>`Knight_01__RUN_${pad(i)}.png`, n:10 },
  knight2:  { dir:enc('/assets/images/knight/_PNG/2_KNIGHT/'), fn:i=>`Knight_02__RUN_${pad(i)}.png`, n:10 },
  knight3:  { dir:enc('/assets/images/knight/_PNG/3_KNIGHT/'), fn:i=>`Knight_03__RUN_${pad(i)}.png`, n:10 },
};

export function getFrames(charId) {
  const d = SPRITE_DEFS[charId];
  if (!d) return [];
  return Array.from({ length: d.n }, (_, i) => img(d.dir + d.fn(i)));
}

export function preloadAll() {
  Object.keys(SPRITE_DEFS).forEach(id => getFrames(id));
}

// ── 트랙 좌표 ─────────────────────────────────────────────────────────────────
// lane 0 = 안쪽, lane 5 = 바깥쪽
function laneRadii(lane) {
  return { rx: 88 + lane * 9.5, ry: 48 + lane * 5.5 };
}

// progress 0~1 → 화면 (x, y, perspScale)
export function trackPos(progress, lane) {
  const { rx, ry } = laneRadii(lane);
  const angle = progress * Math.PI * 2 - Math.PI / 2;  // 위쪽 12시에서 시작
  const x = CX + rx * Math.cos(angle);
  const y = CY + ry * Math.sin(angle);
  // 원근: 아래(가까운쪽) ≈ 1.0, 위(먼쪽) ≈ 0.55
  const perspScale = 0.55 + ((Math.sin(angle) + 1) / 2) * 0.45;
  return { x, y, perspScale };
}

// ── 트랙 드로잉 ───────────────────────────────────────────────────────────────
export function drawTrack(ctx) {
  // ① 하늘 배경
  const sky = ctx.createLinearGradient(0, 0, 0, CH * 0.3);
  sky.addColorStop(0, '#0a1628');
  sky.addColorStop(1, '#1a2840');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, CW, CH * 0.35);

  // 배경 (경기장 바닥)
  ctx.fillStyle = '#1a2e1a';
  ctx.fillRect(0, CH * 0.3, CW, CH * 0.7);

  // ② 잔디 (안쪽 타원)
  const inner = laneRadii(-0.5);
  ctx.beginPath();
  ctx.ellipse(CX, CY, inner.rx, inner.ry, 0, 0, Math.PI * 2);
  const grassGrad = ctx.createRadialGradient(CX, CY - 8, 10, CX, CY, inner.rx);
  grassGrad.addColorStop(0, '#2d6a2d');
  grassGrad.addColorStop(0.6, '#256325');
  grassGrad.addColorStop(1, '#1e5a1e');
  ctx.fillStyle = grassGrad;
  ctx.fill();

  // 잔디 줄무늬
  ctx.save();
  ctx.clip();
  for (let x = CX - inner.rx; x < CX + inner.rx; x += 14) {
    ctx.fillStyle = x % 28 < 14 ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.03)';
    ctx.fillRect(x, CY - inner.ry, 14, inner.ry * 2);
  }
  ctx.restore();

  // ③ 트랙 레이어 (6개 레인, 안→밖 순서로 그려서 바깥이 위에 오도록)
  const LANE_COLORS = ['#8B2500','#9B3000','#AB3500','#BB3A00','#CB3F00','#D94400'];
  const LANE_LINES  = ['#e8a060','#e8a060','#eaa062','#eaa062','#ecaa65','#ecaa65'];

  for (let lane = 5; lane >= 0; lane--) {
    const lo = laneRadii(lane + 0.5);
    const li = laneRadii(lane - 0.5);

    // 레인 채우기 (도넛 형태)
    ctx.beginPath();
    ctx.ellipse(CX, CY, lo.rx, lo.ry, 0, 0, Math.PI * 2);
    ctx.ellipse(CX, CY, li.rx, li.ry, 0, 0, Math.PI * 2, true);
    ctx.fillStyle = LANE_COLORS[lane];
    ctx.fill('evenodd');

    // 레인 구분선 (안쪽 테두리)
    ctx.beginPath();
    ctx.ellipse(CX, CY, li.rx, li.ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = LANE_LINES[lane];
    ctx.lineWidth = lane === 0 ? 1.5 : 1;
    ctx.stroke();
  }

  // 바깥 테두리
  const outer = laneRadii(5.5);
  ctx.beginPath();
  ctx.ellipse(CX, CY, outer.rx, outer.ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = '#fff8';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // ④ 스타트/피니시 라인 (12시 방향)
  const p0 = trackPos(0, -0.5), p5 = trackPos(0, 5.5);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p5.x, p5.y);
  ctx.strokeStyle = '#ffffffcc';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // FINISH 텍스트
  ctx.fillStyle = '#ffffffaa';
  ctx.font = 'bold 8px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('FINISH', CX, CY - outer.ry - 6);

  // ⑤ 레인 번호 (바깥쪽에 작게)
  for (let l = 0; l < 6; l++) {
    const { rx, ry } = laneRadii(l);
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.font = '7px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(l + 1, CX + rx + 9, CY + ry * 0.15 + 2);
  }
}

// ── 러너 드로잉 ───────────────────────────────────────────────────────────────
function drawRunner(ctx, team, runner, x, y, sc, isPlayer, now) {
  const size = Math.round(36 * sc);
  const frames = getFrames(runner.id);
  const fi = runner.animFrame % Math.max(1, frames.length);

  // 그림자
  ctx.beginPath();
  ctx.ellipse(x, y + size * 0.5, size * 0.32, size * 0.12, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fill();

  // 스프라이트 or 폴백
  const frame = frames[fi];
  if (frame?.complete && frame.naturalWidth > 0) {
    ctx.drawImage(frame, x - size / 2, y - size * 0.85, size, size);
  } else {
    // 폴백 캐릭터 원
    const gr = ctx.createRadialGradient(x, y - size * 0.35, 2, x, y - size * 0.35, size * 0.4);
    gr.addColorStop(0, '#fff');
    gr.addColorStop(1, team.color || '#888');
    ctx.beginPath();
    ctx.arc(x, y - size * 0.35, size * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = gr;
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = `bold ${Math.round(8 * sc)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(runner.name.slice(0, 3), x, y - size * 0.28);
  }

  // 등급 배지
  const gradeColor = { S:'#ffd700', A:'#c0c0c0', B:'#cd7f32', C:'#8aaa4a', D:'#aaa' }[runner.grade] || '#fff';
  if (sc > 0.75) {
    ctx.fillStyle = gradeColor;
    ctx.font = `bold ${Math.round(7 * sc)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`[${runner.grade}]`, x, y - size * 0.9);
  }

  // 팀 라벨 (플레이어 팀 강조)
  if (isPlayer) {
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 1.5 * sc;
    ctx.beginPath();
    ctx.arc(x, y - size * 0.35, size * 0.46, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 스태미나 바
  const bW = Math.round(26 * sc), bH = Math.round(4 * sc);
  const bX = x - bW / 2, bY = y - size * 0.95;
  ctx.fillStyle = '#333';
  ctx.fillRect(bX, bY, bW, bH);
  const stColor = runner.stamina > 60 ? '#22c55e' : runner.stamina > 30 ? '#fbbf24' : '#ef4444';
  ctx.fillStyle = stColor;
  ctx.fillRect(bX, bY, bW * (runner.stamina / 100), bH);

  // 속도 이펙트 (부스트 중 / 탭 시)
  if (runner.spdMult > 1.1) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    for (let i = 1; i <= 3; i++) {
      ctx.drawImage(frame?.complete ? frame : new Image(),
        x - size / 2 - i * 5 * sc, y - size * 0.85 + i * 1.5, size * (1 - i * 0.08), size * (1 - i * 0.08));
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // 이벤트 텍스트 플로팅
  if (runner.eventLabel && now - runner.eventTs < 2000) {
    const alpha = 1 - (now - runner.eventTs) / 2000;
    const fy = y - size * 0.9 - (now - runner.eventTs) * 0.025;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(9 * sc)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(runner.eventLabel, x, fy);
    ctx.globalAlpha = 1;
  }
}

// ── 메인 렌더 ────────────────────────────────────────────────────────────────
export function renderRace(ctx, teams, now) {
  ctx.clearRect(0, 0, CW, CH);

  // 트랙 배경
  drawTrack(ctx);
  updateParticles();

  // 러너를 Y 좌표 기준으로 정렬 (원근법: 작은 Y = 먼쪽 = 먼저 그림)
  const runners = [];
  teams.forEach((team, ti) => {
    if (team.finishTime !== null) return;
    const runner = team.runners[team.legIdx];
    if (!runner) return;
    const legProg = runner.dist / LEG_DIST;
    const totalProg = (team.legIdx * LEG_DIST + runner.dist) / (LEGS * LEG_DIST);
    const pos = trackPos(totalProg % 1, ti);   // 레인 = 팀 인덱스
    runners.push({ team, runner, pos, isPlayer: team.isPlayer, ti });

    // 먼지 파티클
    if (runner.spd > 3 && Math.random() < 0.15) {
      addDust(pos.x, pos.y, pos.perspScale);
    }
  });

  // 파티클 먼저
  drawParticles(ctx);

  // Y 오름차순 정렬 후 그리기 (멀리 있는 것 먼저)
  runners.sort((a, b) => a.pos.y - b.pos.y).forEach(({ team, runner, pos, isPlayer }) => {
    drawRunner(ctx, team, runner, pos.x, pos.y, pos.perspScale, isPlayer, now);
  });

  // 골인 팀 표시
  teams.filter(t => t.finishTime !== null).forEach((team, i) => {
    const medals = ['🥇','🥈','🥉'];
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(4, 4 + i * 20, 72, 17);
    ctx.fillStyle = team.isPlayer ? '#ffd700' : '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${medals[i]||team.rank+'위'} ${team.label}`, 8, 16 + i * 20);
  });
}

// ── 다음 주자 미리보기 ────────────────────────────────────────────────────────
export function renderNextUp(ctx, team, now) {
  if (!team || team.legIdx >= LEGS - 1) return;
  const next = team.runners[team.legIdx + 1];
  if (!next) return;

  ctx.fillStyle = 'rgba(10,10,30,.75)';
  ctx.beginPath();
  ctx.roundRect(CW - 82, 2, 80, 42, 6);
  ctx.fill();
  ctx.strokeStyle = '#fbbf2466';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = '#fbbf24';
  ctx.font = 'bold 8px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('NEXT ▶', CW - 5, 13);

  const frames = getFrames(next.id);
  const fr = frames[Math.floor(now / 100) % Math.max(1, frames.length)];
  if (fr?.complete && fr.naturalWidth > 0) {
    ctx.drawImage(fr, CW - 80, 14, 24, 24);
  }

  ctx.fillStyle = '#fff';
  ctx.font = '8px sans-serif';
  ctx.fillText(next.name, CW - 5, 27);
  const gc = { S:'#ffd700', A:'#c0c0c0', B:'#cd7f32', C:'#8aaa4a', D:'#aaa' }[next.grade];
  ctx.fillStyle = gc || '#fff';
  ctx.fillText(`[${next.grade}]`, CW - 5, 39);
}

// ── 리더 크라운 ───────────────────────────────────────────────────────────────
export function renderLeaderCrown(ctx, teams) {
  const active = teams.filter(t => t.finishTime === null);
  if (!active.length) return;
  const leader = [...active].sort((a, b) => b.totDist - a.totDist)[0];
  const li = teams.indexOf(leader);
  const runner = leader.runners[leader.legIdx];
  if (!runner) return;
  const totalProg = (leader.legIdx * LEG_DIST + runner.dist) / (LEGS * LEG_DIST);
  const pos = trackPos(totalProg % 1, li);
  const sz = Math.round(36 * pos.perspScale);

  ctx.font = `${Math.round(12 * pos.perspScale)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('👑', pos.x, pos.y - sz * 1.05);
}

// ── 바통 전달 이펙트 ──────────────────────────────────────────────────────────
export function renderBatonPass(ctx, teams, now) {
  teams.forEach((team, ti) => {
    if (!team.batonPass) return;
    const pos = trackPos((team.legIdx * LEG_DIST + LEG_DIST) / (LEGS * LEG_DIST) % 1, ti);
    const alpha = 0.5 + Math.sin(now / 80) * 0.4;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffd700';
    ctx.font = `bold ${Math.round(14 * pos.perspScale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('🏃💨', pos.x, pos.y - 24 * pos.perspScale);
    ctx.globalAlpha = 1;
  });
}
