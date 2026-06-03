// relay.race.js — 릴레이 레이스 물리 · AI · 이벤트 시스템

export const LEGS      = 4;
export const LEG_DIST  = 100;   // 한 선수 달리기 거리 (단위)
export const TOTAL_DIST = LEGS * LEG_DIST;
export const NUM_TEAMS = 6;

// 등급별 기본 속도 배율 — 격차 축소로 경기 흥미 유지
const GRADE_SPD = { S: 1.15, A: 1.07, B: 1.00, C: 0.94, D: 0.87 };
// 등급별 배당 배율
export const GRADE_ODDS = { S: 1.5, A: 2.0, B: 4.0, C: 8.0, D: 15.0 };

// ── 랜덤 이벤트 ────────────────────────────────────────────────────────────────
const EVENTS = [
  { id:'slip',   label:'😱 미끄러짐!',     prob:0.008, spd:-0.35, dur:1.5 },
  { id:'baton',  label:'⚠️ 바통 실수!',    prob:0.006, spd:-0.25, dur:2.0 },
  { id:'lace',   label:'👟 신발끈 풀림!',  prob:0.005, spd:-0.20, dur:1.8 },
  { id:'crowd',  label:'📣 관중 응원 버프!',prob:0.007, spd:+0.20, dur:3.0 },
  { id:'comeback',label:'🔥 역전 버프!',   prob:0.004, spd:+0.35, dur:2.5 },
];

// ── 스킬 정의 ─────────────────────────────────────────────────────────────────
export const SKILL_DEFS = {
  trip:    { name:'다리걸기',   emoji:'🦵', cd:18, desc:'앞 선수 -20% 2초',  type:'debuff' },
  apple:   { name:'사과 던지기',emoji:'🍎', cd:20, desc:'앞 선수 혼란 3초',  type:'debuff' },
  boost:   { name:'부스트',     emoji:'💨', cd:15, desc:'속도 +40% 3초',     type:'buff'   },
  sprint:  { name:'질주본능',   emoji:'⚡', cd:25, desc:'스태미나 무시 5초', type:'buff'   },
  iron:    { name:'철인',       emoji:'🛡️', cd:30, desc:'피로 무효 10초',    type:'buff'   },
};

// ── 팀 등급 계산 ──────────────────────────────────────────────────────────────
const GRADE_NUM = { S:5, A:4, B:3, C:2, D:1 };

export function teamGrade(chars, CHARS) {
  const avg = chars.reduce((s,id)=> s + GRADE_NUM[CHARS[id].grade], 0) / chars.length;
  if (avg >= 4.5) return 'S';
  if (avg >= 3.5) return 'A';
  if (avg >= 2.5) return 'B';
  if (avg >= 1.5) return 'C';
  return 'D';
}

// ── 선수 생성 ─────────────────────────────────────────────────────────────────
function makeRunner(charId, CHARS) {
  const c = CHARS[charId];
  return {
    id: charId, name: c.name, grade: c.grade, type: c.type, color: c.color,
    stats: c,
    dist:    0,
    stamina: 100,
    fatigueRate: 0.04 + (1 - c.stamina / 100) * 0.06,
    spd:     0,
    spdMult: 1.0,   // 효과 배율 (스킬/이벤트)
    spdTime: 0,     // 효과 남은 시간
    eventLabel: '',
    eventTs: 0,
    done:    false,
    animFrame: 0,
    animTs:  0,
  };
}

// ── 팀 생성 ──────────────────────────────────────────────────────────────────
export function buildTeam(charIds, CHARS, label, color, isPlayer) {
  return {
    label, color, isPlayer,
    grade:   teamGrade(charIds, CHARS),
    runners: charIds.map(id => makeRunner(id, CHARS)),
    legIdx:  0,       // 현재 주자 인덱스 (0-3)
    totDist: 0,       // 총 이동 거리 (0-400)
    legDist: 0,       // 현재 주자 이동 거리 (0-100)
    batonPass: false, // 바통 전달 중
    batonTimer: 0,
    finishTime: null, // 골인 시각 (ms)
    rank: 0,
    tapBonus: 0,
    tapTime: 0,
    skilledUntil: {},  // 스킬 적용 끝 시각
    skillCd: {},       // 스킬 쿨다운
  };
}

// ── 속도 계산 ─────────────────────────────────────────────────────────────────
function runnerSpeed(runner, team, tapBonus, now) {
  const { stats, stamina, spdMult } = runner;
  const gradeMult = GRADE_SPD[stats.grade];
  const baseSpd   = 4.5 + stats.speed * 0.065;  // ~5.2 (D) ~ 10.5 (S) units/sec
  const stFactor  = 0.65 + (stamina / 100) * 0.45;  // 0.65 .. 1.10
  const rand      = 0.90 + Math.random() * 0.20;     // ±10% — 더 큰 랜덤성으로 역전 가능

  // 바통 전달 감속
  if (team.batonPass) return 0;

  // AI 성향 보정 — AI 전체적으로 더 빠르게 (플레이어가 탭해야 이길 수 있도록)
  let aiFactor = 1.0;
  if (!team.isPlayer) {
    aiFactor = 1.08; // AI 기본 8% 부스트
    if (runner.type === 'aggressive') aiFactor = 1.12;
    if (runner.type === 'defensive' && team.totDist > TOTAL_DIST * 0.6) aiFactor = 1.15; // 후반 역전
    // 뒤처진 AI 추격 부스트
    const sorted = [team]; // 단순화
    if (team.rank > 3) aiFactor *= 1.05;
  }

  return baseSpd * gradeMult * stFactor * rand * spdMult * aiFactor * (1 + tapBonus * 0.45);
}

// ── 레이스 틱 ─────────────────────────────────────────────────────────────────
export function tickRace(teams, dt, now, CHARS) {
  const finishedCount = teams.filter(t => t.finishTime !== null).length;

  teams.forEach(team => {
    if (team.finishTime !== null) return;

    // 바통 전달 처리
    if (team.batonPass) {
      team.batonTimer -= dt;
      if (team.batonTimer <= 0) {
        team.batonPass = false;
        team.legIdx++;
        if (team.legIdx >= LEGS) {
          team.finishTime = now;
          team.rank = finishedCount + 1;
          return;
        }
        team.runners[team.legIdx].dist = 0;
        team.runners[team.legIdx].stamina = 100;
      }
      return;
    }

    const runner = team.runners[team.legIdx];
    if (!runner || runner.done) return;

    // 스킬 효과 만료
    if (runner.spdTime > 0) {
      runner.spdTime -= dt;
      if (runner.spdTime <= 0) { runner.spdMult = 1.0; runner.spdTime = 0; }
    }

    // 탭 보너스 점진적 감소 (연타 안 하면 빠르게 줄어듦)
    if (team.tapBonus > 0) {
      team.tapBonus = Math.max(0, team.tapBonus - dt * 0.55);
    }

    // 스태미나 감소 (철인 스킬이면 무시)
    const ironActive = (team.skilledUntil.iron || 0) > now;
    const sprintActive = (team.skilledUntil.sprint || 0) > now;
    if (!ironActive) {
      runner.stamina = Math.max(0, runner.stamina - runner.fatigueRate * (sprintActive ? 2.5 : 1) * dt * 60);
    }

    // 속도 계산
    const spd = runnerSpeed(runner, team, team.tapBonus, now);
    runner.spd = spd;

    // 랜덤 이벤트 (AI 팀만 또는 전체)
    EVENTS.forEach(ev => {
      if (Math.random() < ev.prob * dt) {
        runner.spdMult = 1 + ev.spd;
        runner.spdTime = ev.dur;
        runner.eventLabel = ev.label;
        runner.eventTs = now;
      }
    });

    // 이동
    const move = spd * dt;
    runner.dist += move;
    team.legDist = runner.dist;
    team.totDist = team.legIdx * LEG_DIST + runner.dist;

    // 애니메이션 프레임
    runner.animTs += dt * 1000;
    const frameDur = Math.max(60, 200 - spd * 12);
    if (runner.animTs >= frameDur) {
      runner.animTs = 0;
      const frameCount = CHARS[runner.id]?.frameCount || 6;
      runner.animFrame = (runner.animFrame + 1) % frameCount;
    }

    // 구간 완주 → 바통 전달
    if (runner.dist >= LEG_DIST) {
      runner.dist = LEG_DIST;
      runner.done = true;
      if (team.legIdx < LEGS - 1) {
        team.batonPass  = true;
        team.batonTimer = 0.3 + Math.random() * 0.9; // 0.3~1.2초
        team.legDist = 0;
        if (team.onBaton) team.onBaton();
      } else {
        team.finishTime = now;
        team.rank = finishedCount + 1;
        if (team.onFinish) team.onFinish(team.rank);
      }
    }
  });

  // AI 스킬 자동 사용 (단순화)
  teams.filter(t => !t.isPlayer && t.finishTime === null).forEach(team => {
    const runner = team.runners[team.legIdx];
    if (!runner) return;
    if (runner.stamina < 30 && !team.skilledUntil.sprint && Math.random() < 0.005 * dt * 60) {
      team.skilledUntil.sprint = now + 5000;
    }
    if (runner.stamina < 20 && !team.skilledUntil.iron && Math.random() < 0.004 * dt * 60) {
      team.skilledUntil.iron = now + 10000;
    }
  });
}

// ── 플레이어 탭 ───────────────────────────────────────────────────────────────
export function playerTap(team) {
  const runner = team.runners[team.legIdx];
  if (!runner || runner.done || team.batonPass) return;
  // 탭마다 +0.12, 최대 1.0 — 계속 눌러야 MAX 유지
  team.tapBonus = Math.min(1.0, (team.tapBonus || 0) + 0.12);
  team.tapTime  = 0.8; // 0.8초 후 감소 시작 (짧게 해서 연타 필요)
  runner.stamina = Math.max(0, runner.stamina - 1.5);
}

// ── 스킬 사용 ─────────────────────────────────────────────────────────────────
export function useSkill(skillId, playerTeam, allTeams, now) {
  const cd = SKILL_DEFS[skillId]?.cd || 15;
  if ((playerTeam.skillCd[skillId] || 0) > now) return false;

  playerTeam.skillCd[skillId] = now + cd * 1000;
  const runner = playerTeam.runners[playerTeam.legIdx];

  switch (skillId) {
    case 'boost':
      runner.spdMult = 1.4; runner.spdTime = 3;
      break;
    case 'sprint':
      playerTeam.skilledUntil.sprint = now + 5000;
      break;
    case 'iron':
      playerTeam.skilledUntil.iron = now + 10000;
      break;
    case 'trip': {
      // 앞 팀 선수 감속
      const leader = allTeams
        .filter(t => t !== playerTeam && t.finishTime === null)
        .sort((a,b) => b.totDist - a.totDist)[0];
      if (leader) {
        const lr = leader.runners[leader.legIdx];
        if (lr) { lr.spdMult = 0.8; lr.spdTime = 2; lr.eventLabel = '🦵 다리걸기!'; lr.eventTs = now; }
      }
      break;
    }
    case 'apple': {
      const leader = allTeams
        .filter(t => t !== playerTeam && t.finishTime === null)
        .sort((a,b) => b.totDist - a.totDist)[0];
      if (leader) {
        const lr = leader.runners[leader.legIdx];
        if (lr) { lr.spdMult = 0.75; lr.spdTime = 3; lr.eventLabel = '🍎 사과 맞음!'; lr.eventTs = now; }
      }
      break;
    }
  }
  return true;
}

// ── 팀 등급으로 배당 계산 ──────────────────────────────────────────────────────
export function calcPayout(teamGrade_, entryFee, rank) {
  const odds = GRADE_ODDS[teamGrade_] || 2.0;
  const posMulti = rank === 1 ? 1.0 : rank === 2 ? 0.5 : rank <= 3 ? 0.25 : 0;
  return Math.floor(entryFee * odds * posMulti);
}
