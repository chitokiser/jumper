// relay.render.js — 이어달리기 캔버스 렌더링 (트랙 + 스프라이트)
import { LEG_DIST, LEGS } from './relay.race.js';

export const CW = 360, CH = 300;

// 레인 색상
const LANE_COLORS  = ['#c0392b','#e67e22','#f1c40f','#2ecc71','#3498db','#9b59b6'];
const LANE_DARK    = ['#922b21','#b7490f','#b7950b','#1e8449','#1a5276','#6c3483'];
const TEAM_COLORS  = ['#e74c3c','#e67e22','#f1c40f','#27ae60','#2980b9','#8e44ad'];

// 트랙 레이아웃
const LANE_H  = 44;   // 레인 높이
const LABEL_W = 28;   // 왼쪽 팀 라벨 너비
const TRACK_W = CW - LABEL_W;  // 실제 트랙 너비

// 스프라이트 캐시
const _sprCache = {};

function loadSprite(src) {
  if (_sprCache[src]) return _sprCache[src];
  const img = new Image();
  img.src = src;
  _sprCache[src] = img;
  return img;
}

// ── 스프라이트 경로 생성 ──────────────────────────────────────────────────────
export function getSpriteFrames(charId, CHARS) {
  const pad = n => String(n).padStart(3,'0');
  const defs = {
    orc1:    { base:'/assets/images/monsters/orc/',     fn:i=>`ORK_01_WALK_${pad(i)}.png`, n:6 },
    orc2:    { base:'/assets/images/monsters/orc2/',    fn:i=>`ORK_02_WALK_${pad(i)}.png`, n:6 },
    orc3:    { base:'/assets/images/monsters/orc3/',    fn:i=>`ORK_03_WALK_${pad(i)}.png`, n:6 },
    zombie1: { base:'/assets/images/monsters/zombie1/animation/', fn:i=>`Run${i+1}.png`,   n:10 },
    zombie3: { base:'/assets/images/monsters/Zombie3/animation/', fn:i=>`Run${i+1}.png`,   n:10 },
    pirate1: { base:'/assets/images/monsters/pirate/',  fn:i=>`1_entity_000_WALK_${pad(i)}.png`, n:6 },
    pirate2: { base:'/assets/images/monsters/pirate2/', fn:i=>`2_entity_000_WALK_${pad(i)}.png`, n:6 },
    pirate3: { base:'/assets/images/monsters/pirate3/', fn:i=>`3_3-PIRATE_WALK_${pad(i)}.png`,   n:6 },
    troll:   { base:'/assets/images/troll/PNG/Animation/Troll1/', fn:i=>`Run_${pad(i)}.png`, n:10 },
    villager1:{ base:'/assets/images/villager/Zombie_Villager_1/Running/', fn:i=>`${i+1}.png`, n:12 },
    villager2:{ base:'/assets/images/villager/Zombie_Villager_2/Running/', fn:i=>`${i+1}.png`, n:12 },
    villager3:{ base:'/assets/images/villager/Zombie_Villager_3/Running/', fn:i=>`${i+1}.png`, n:12 },
    knight1: { base:'/assets/images/knight/_PNG/1_KNIGHT/', fn:i=>`Knight_01__RUN_${pad(i)}.png`, n:10 },
    knight2: { base:'/assets/images/knight/_PNG/2_KNIGHT/', fn:i=>`Knight_02__RUN_${pad(i)}.png`, n:10 },
    knight3: { base:'/assets/images/knight/_PNG/3_KNIGHT/', fn:i=>`Knight_03__RUN_${pad(i)}.png`, n:10 },
  };
  const d = defs[charId];
  if (!d) return [];
  return Array.from({length: d.n}, (_,i) => loadSprite(d.base + d.fn(i)));
}

export function preloadSprites(charIds, CHARS) {
  charIds.forEach(id => getSpriteFrames(id, CHARS));
}

// ── 메인 렌더 ────────────────────────────────────────────────────────────────
export function renderRace(ctx, teams, allChars, now) {
  ctx.clearRect(0, 0, CW, CH);

  // 배경
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, CW, CH);

  // 레인 렌더
  teams.forEach((team, ti) => {
    const y = ti * LANE_H;
    const isFinished = team.finishTime !== null;

    // 레인 배경
    ctx.fillStyle = ti % 2 === 0 ? '#16213e' : '#0f3460';
    ctx.fillRect(0, y, CW, LANE_H);

    // 트랙 표면
    ctx.fillStyle = LANE_DARK[ti % LANE_COLORS.length];
    ctx.fillRect(LABEL_W, y + 6, TRACK_W, LANE_H - 12);

    // 레인 선
    ctx.fillStyle = LANE_COLORS[ti % LANE_COLORS.length];
    ctx.fillRect(LABEL_W, y + 4, TRACK_W, 2);
    ctx.fillRect(LABEL_W, y + LANE_H - 6, TRACK_W, 2);

    // 팀 라벨
    ctx.fillStyle = TEAM_COLORS[ti % TEAM_COLORS.length];
    ctx.fillRect(0, y, LABEL_W, LANE_H);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(team.label, LABEL_W/2, y + LANE_H/2 - 4);
    ctx.font = '8px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.fillText(team.grade, LABEL_W/2, y + LANE_H/2 + 5);

    // 골인 표시
    if (isFinished) {
      ctx.fillStyle = 'rgba(255,215,0,.25)';
      ctx.fillRect(LABEL_W, y, TRACK_W, LANE_H);
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`🏆 ${team.rank}위`, LABEL_W + TRACK_W/2, y + LANE_H/2 + 4);
      return;
    }

    // 바통 전달 중
    if (team.batonPass) {
      ctx.fillStyle = 'rgba(255,255,100,.15)';
      ctx.fillRect(LABEL_W, y, TRACK_W, LANE_H);
    }

    // 러너 위치 계산
    const runner = team.runners[team.legIdx];
    if (!runner) return;
    const progress = runner.dist / LEG_DIST;
    const runnerX  = LABEL_W + progress * (TRACK_W - 38) + 4;
    const runnerY  = y + LANE_H / 2;

    // 스프라이트 그리기
    const frames = getSpriteFrames(runner.id, allChars);
    const sprH = LANE_H - 10, sprW = sprH;
    const frame = frames[runner.animFrame % Math.max(1, frames.length)];
    if (frame?.complete && frame.naturalWidth > 0) {
      ctx.drawImage(frame, runnerX, runnerY - sprH/2, sprW, sprH);
    } else {
      // 폴백: 색상 원
      ctx.fillStyle = team.color || TEAM_COLORS[ti];
      ctx.beginPath();
      ctx.arc(runnerX + sprW/2, runnerY, sprH/2 - 2, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(runner.name.slice(0,4), runnerX + sprW/2, runnerY + 3);
    }

    // 이벤트 텍스트 (플로팅)
    if (runner.eventLabel && now - runner.eventTs < 1800) {
      const alpha = 1 - (now - runner.eventTs) / 1800;
      const floatY = runnerY - sprH/2 - (now - runner.eventTs) * 0.018;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(runner.eventLabel, runnerX + sprW + 2, floatY);
      ctx.globalAlpha = 1;
    }

    // 스태미나 바
    const stW = 28;
    ctx.fillStyle = '#333';
    ctx.fillRect(runnerX, runnerY + sprH/2 - 3, stW, 4);
    const stColor = runner.stamina > 60 ? '#22c55e' : runner.stamina > 30 ? '#fbbf24' : '#ef4444';
    ctx.fillStyle = stColor;
    ctx.fillRect(runnerX, runnerY + sprH/2 - 3, stW * (runner.stamina/100), 4);

    // 구간 진행 점선
    ctx.setLineDash([4,4]);
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(LABEL_W, y + LANE_H/2);
    ctx.lineTo(LABEL_W + TRACK_W, y + LANE_H/2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 플레이어 팀 하이라이트
    if (team.isPlayer) {
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, y + 1, CW - 2, LANE_H - 2);
      ctx.lineWidth = 1;
    }
  });

  // 골인선
  ctx.strokeStyle = 'rgba(255,255,255,.4)';
  ctx.setLineDash([6,3]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(CW - 6, 0);
  ctx.lineTo(CW - 6, CH);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
}

// ── 구간 / 다음 주자 미리보기 패널 ───────────────────────────────────────────
export function renderNextRunner(ctx, team, CHARS, now) {
  if (!team || team.legIdx >= LEGS - 1) return;
  const next = team.runners[team.legIdx + 1];
  if (!next) return;

  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillRect(CW - 72, 2, 70, 36);
  ctx.fillStyle = '#fbbf24';
  ctx.font = 'bold 8px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('NEXT →', CW - 5, 13);
  ctx.fillStyle = '#fff';
  ctx.font = '9px sans-serif';
  ctx.fillText(next.name, CW - 5, 26);
  const gradeColor = {S:'#ffd700',A:'#c0c0c0',B:'#cd7f32',C:'#aaa',D:'#888'}[next.grade]||'#fff';
  ctx.fillStyle = gradeColor;
  ctx.fillText(`[${next.grade}]`, CW - 5, 36);
}

// ── 스피드 시각화 (선두 화살표) ───────────────────────────────────────────────
export function renderLeaderArrow(ctx, teams, now) {
  const active = teams.filter(t=>t.finishTime===null);
  if (!active.length) return;
  const leader = [...active].sort((a,b)=>b.totDist-a.totDist)[0];
  const li = teams.indexOf(leader);
  const y = li * LANE_H + LANE_H/2;
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('👑', LABEL_W + 2, y + 4);
}
