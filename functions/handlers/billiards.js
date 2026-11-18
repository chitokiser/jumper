'use strict';
// billiards.js — 베스트당구장 GP 게임 (1인 플레이) 서버 처리
//   3쿠션 · 사구(4구) · 리브레(3구) · 9볼 · 8볼 · 스누커 · 15볼 클리어(리빌)
//
// 공통 (서버 정의 — 클라이언트는 샷 판정 결과만 보냄, 점수·기회는 서버가 계산)
//   참가비: 50 / 100 / 200 GP → 보상 배율 ×1 / ×2 / ×4
//   기회: 5번으로 시작, 0이 되면 판 종료
//   GP 지급: (점수 ÷ GP_SCORE_UNIT) × 배율, 판 종료 시 1회
//   주간 랭킹: 판 최종 점수(배율 무관)를 서버가 직접 접수 → 일요일 자동 정산 (weeklyRanking.js)
//
// 한 번 시작한 판은 끝나거나(기회 0·클리어·퇴출) 정산하기 전까지 다른 게임으로 바꿀 수 없음 (startGame 거부)
//
// 3쿠션 (threecushion) — 성공 +1 기회(최대 10) / 실패 -1
//   3쿠션 300 · 쿠션 하나 더할 때마다 +100 · 빈쿠션(쿠션 먼저) 600부터
// 사구 (sagu) — 빨간 공 2개를 모두 맞히면 80점, 기회 유지 / 실패·파울 -1 · 점수 3,000 달성 시 완주 종료
// 리브레 (libre) — 두 공을 모두 맞히면 50점, 기회 유지 / 실패 -1 · 점수 2,500 달성 시 완주 종료
// 9볼 (nineball) — 1~8번 60점씩 · 9번 합법 포켓 600 + 남은 기회 ×100 → 클리어
// 8볼 (eightball) — 내 그룹 공 60점씩 · 8번 합법 포켓 700 + 남은 기회 ×100 → 클리어
//   8번 공을 일찍/파울로 넣어 엔진이 패배 처리하면 판 종료(보너스 없음)
// 스누커 (snooker) — 엔진 점수(빨강 1 … 검정 7) × 20점 · 테이블 클리어 700 + 남은 기회 ×100
// 15볼 클리어 (reveal) — 파울 없음, 넣은 공 하나당 40점 · 15개 모두 넣으면 400 + 남은 기회 ×100
// 포켓 게임 공통: 넣으면 기회 유지, 못 넣으면 -1, 파울 -1 · 연속 파울 3번이면 퇴출 (9볼 3파울 룰 준용)
//
// 부정 방지: 샷 번호 연속성, 샷 간 최소 간격, 판당 최대 샷 수, 판 최대 시간, 하루 GP 한도,
//            포켓볼은 같은 공 번호를 한 판에 두 번 점수로 인정하지 않음.
// 물리 계산은 브라우저에서 돌기 때문에 완전한 검증은 불가 — 위 제한으로 조작 폭을 줄인다.
//
// 컬렉션 (서버 전용, firestore.rules 에 규칙 없음 = 클라이언트 접근 불가)
//   billiards_sessions/{uid}   진행 중/마지막 판 상태

const admin = require('firebase-admin');
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const TIERS = { 50: 1, 100: 2, 200: 4 };  // 참가비 → 보상 배율
const MODES = {
  threecushion: { label: '3쿠션',        kind: 'carom3' },
  sagu:         { label: '사구(4구)',     kind: 'simple', points: 80, cap: 3000 },
  libre:        { label: '리브레(3구)',   kind: 'simple', points: 50, cap: 2500 },
  nineball:     { label: '9볼',          kind: 'pool' },
  eightball:    { label: '8볼',          kind: 'pool' },
  snooker:      { label: '스누커',        kind: 'snooker', unit: 20, clear: 700, maxEngine: 147 },
  reveal:       { label: '15볼 클리어',   kind: 'reveal', ball: 40, clear: 400, balls: 15 },
};
const FOUL_OUT_KINDS = new Set(['pool', 'snooker']);
const START_CHANCES = 5;
const MAX_CHANCES = 10;                    // 3쿠션 기회 상한
const FOUL_OUT = 3;                        // 포켓볼 연속 파울 퇴출
const MAX_SHOTS = 300;                     // 판당 최대 샷
const MIN_SHOT_GAP_MS = 1500;              // 샷 사이 최소 간격 (공이 멈추는 시간)
const SESSION_MAX_MS = 3 * 60 * 60 * 1000; // 3시간 지나면 현재 점수로 종료
const GP_SCORE_UNIT = 10;                  // 10점당 1 GP (×배율)
const MAX_GP_PER_GAME = 3000;              // 판당 GP 상한 (×배율 전) — 수이카와 동일
const DAILY_MAX_EARN = 100000;             // 하루 당구 GP 최대 획득
const MAX_CUSHIONS = 12;

const POOL = {
  ballPoints: 60,
  nineClear: 600,
  eightClear: 700,
  chanceBonus: 100,
};

/** 3쿠션 샷 점수 */
function caromPoints({ success, cushions, bank }) {
  if (!success) return 0;
  return (bank ? 600 : 300) + Math.max(0, cushions - 3) * 100;
}

const isSolid = n => n >= 1 && n <= 7;
const isStripe = n => n >= 9 && n <= 15;

/**
 * 포켓볼 샷 판정 (순수 함수 — 테스트 가능)
 * @returns {{ points, chanceDelta, success, cleared, newPotted, group, endNow }}
 */
function poolShot(mode, s, { foul, pots, group, cleared, engineEnd }) {
  const already = new Set(s.potted || []);
  const fresh = [...new Set(pots)].filter(n => !already.has(n));
  let grp = s.group || 0;
  if (!grp && (group === 1 || group === 2)) grp = group;

  if (foul) {
    // 파울: 넣은 공은 기록만(같은 공 재점수 방지) — 9볼의 9번은 엔진이 다시 올려두므로 기록 안 함
    const keep = fresh.filter(n => !(mode === 'nineball' && n === 9) && !(mode === 'eightball' && n === 8));
    return { points: 0, chanceDelta: -1, success: false, cleared: false, newPotted: keep, group: grp, endNow: !!engineEnd };
  }

  let points = 0;
  let mine = 0;
  if (mode === 'nineball') {
    for (const n of fresh) if (n >= 1 && n <= 8) { points += POOL.ballPoints; mine++; }
    const nine = fresh.includes(9) && cleared;
    if (nine) mine++;
    return {
      points, chanceDelta: mine > 0 ? 0 : -1, success: mine > 0, cleared: nine,
      newPotted: fresh.filter(n => n !== 9 || nine), group: grp, endNow: nine || !!engineEnd,
    };
  }
  // eightball
  for (const n of fresh) {
    if (n === 8) continue;
    const ok = grp === 0 || (grp === 1 && isSolid(n)) || (grp === 2 && isStripe(n));
    if (ok) { points += POOL.ballPoints; mine++; }
  }
  const eight = fresh.includes(8) && cleared;
  if (eight) mine++;
  return {
    points, chanceDelta: mine > 0 ? 0 : -1, success: mine > 0, cleared: eight,
    newPotted: fresh.filter(n => n !== 8 || eight), group: grp, endNow: eight || !!engineEnd,
  };
}

function vnDate(ms = Date.now()) {
  return new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function publicState(s) {
  return {
    active: !!s && !s.ended,
    mode: s?.mode || 'threecushion',
    fee: s?.fee ?? 0,
    mult: s?.mult ?? 1,
    chances: s?.chances ?? 0,
    score: s?.score ?? 0,
    shots: s?.shots ?? 0,
    successes: s?.successes ?? 0,
    potted: s?.potted || [],
    cleared: !!s?.cleared,
    fouls: s?.fouls ?? 0,
    ended: !!s?.ended,
    gpAwarded: s?.gpAwarded ?? 0,
  };
}

/** 판 시작 — 참가비 차감 + 새 판 생성 (진행 중이던 판은 현재 점수로 먼저 정산) */
async function startGame(uid, { fee, mode } = {}) {
  const f = Number(fee);
  const mult = TIERS[f];
  if (!mult) throw new Error('참가비는 50, 100, 200 GP 중에서 고르세요');
  const m = MODES[mode] ? mode : 'threecushion';

  // 진행 중인 판이 있으면 새 판(다른 게임 포함) 시작 불가 — 시간 초과된 판만 자동 정산
  const prevSnap = await db.collection('billiards_sessions').doc(uid).get();
  const prev = prevSnap.data();
  if (prev && !prev.ended) {
    if (Date.now() - (prev.startedAt || 0) > SESSION_MAX_MS) {
      await endGame(uid, { reason: 'expired' }).catch(() => {});
    } else {
      throw new Error(`진행 중인 ${MODES[prev.mode]?.label || '3쿠션'} 게임이 있어요. 끝까지 치거나 정산한 뒤 새 게임을 시작하세요.`);
    }
  }

  const playerRef = db.collection('battle_players').doc(uid);
  const sessRef = db.collection('billiards_sessions').doc(uid);
  const now = Date.now();

  const state = await db.runTransaction(async t => {
    const snap = await t.get(playerRef);
    if (!snap.exists) throw new Error('플레이어 데이터 없음');
    const gold = snap.data().gold || 0;
    if (gold < f) throw new Error(`GP 부족 — 필요: ${f.toLocaleString()} GP, 보유: ${gold.toLocaleString()} GP`);
    t.set(playerRef, { gold: FieldValue.increment(-f) }, { merge: true });
    const s = {
      uid, mode: m, fee: f, mult, chances: START_CHANCES, score: 0, shots: 0, successes: 0,
      potted: [], group: 0, cleared: false, fouls: 0, engineTotal: 0,
      startedAt: now, lastShotAt: now, ended: false, gpAwarded: 0, log: [],
    };
    t.set(sessRef, s);
    return s;
  });
  return publicState(state);
}

function parseShot(mode, d) {
  const kind = MODES[mode].kind;
  const foul = typeof d.foul === 'string' && d.foul ? d.foul.slice(0, 60) : null;
  if (kind === 'carom3') {
    const c = Math.floor(Number(d.cushions));
    if (!Number.isFinite(c) || c < 0 || c > MAX_CUSHIONS) return null;
    return { success: d.success === true && c >= 3, cushions: c, bank: d.bank === true };
  }
  if (kind === 'simple') return { success: d.success === true && !foul, foul };
  if (kind === 'snooker') {
    const gain = Math.floor(Number(d.gain) || 0);
    if (gain < 0 || gain > 20) return null;
    return { foul, gain: foul ? 0 : gain, cleared: d.cleared === true, engineEnd: d.engineEnd === true };
  }
  const pots = Array.isArray(d.pots) ? d.pots.map(Number) : [];
  if (pots.length > 15 || pots.some(n => !Number.isInteger(n) || n < 1 || n > 15)) return null;
  if (mode === 'nineball' && pots.some(n => n > 9)) return null;
  if (kind === 'reveal') return { pots, scratch: d.scratch === true };
  return {
    foul,
    pots,
    group: Number(d.group) || 0,
    cleared: d.cleared === true,
    engineEnd: d.engineEnd === true,
  };
}

/** 사구·리브레·스누커·15볼 샷 판정 (순수 함수) */
function otherShot(mode, s, shot) {
  const M = MODES[mode];
  if (M.kind === 'simple') {
    return { points: shot.success ? M.points : 0, chanceDelta: shot.success ? 0 : -1, success: shot.success, extra: {} };
  }
  if (M.kind === 'snooker') {
    const used = s.engineTotal || 0;
    const gain = Math.max(0, Math.min(shot.gain, M.maxEngine - used));
    const success = !shot.foul && gain > 0;
    const cleared = success && !!shot.cleared;
    return {
      points: gain * M.unit, chanceDelta: success ? 0 : -1, success, cleared,
      clearBonus: cleared ? M.clear : 0, endNow: cleared || !!shot.engineEnd,
      extra: { engineTotal: used + gain },
    };
  }
  // reveal
  const already = new Set(s.potted || []);
  const fresh = [...new Set(shot.pots)].filter(n => !already.has(n));
  const potted = [...(s.potted || []), ...fresh];
  const success = fresh.length > 0;
  const cleared = potted.length >= M.balls;
  return {
    points: fresh.length * M.ball, chanceDelta: success ? 0 : -1, success, cleared,
    clearBonus: cleared ? M.clear : 0, endNow: cleared, extra: { potted },
  };
}

/** 샷 결과 접수 — 서버가 점수·기회 계산. 기회 0 / 클리어면 바로 정산 */
async function reportShot(uid, data = {}) {
  const sessRef = db.collection('billiards_sessions').doc(uid);
  const now = Date.now();
  if (!Number.isInteger(Number(data.seq))) throw new Error('샷 데이터가 올바르지 않습니다');

  const result = await db.runTransaction(async t => {
    const snap = await t.get(sessRef);
    const s = snap.data();
    if (!s || s.ended) throw new Error('진행 중인 게임이 없습니다');
    const mode = s.mode || 'threecushion';
    if (data.rule && data.rule !== mode) throw new Error(`이 판은 ${MODES[mode].label} 게임이에요 (중간에 게임을 바꿀 수 없음)`);
    const shot = parseShot(mode, data);
    if (!shot) throw new Error('샷 데이터가 올바르지 않습니다');
    if (now - s.startedAt > SESSION_MAX_MS) return { s, shot, expired: true };
    if (Number(data.seq) !== s.shots + 1) throw new Error('샷 순서가 맞지 않습니다');
    if (now - (s.lastShotAt || 0) < MIN_SHOT_GAP_MS) throw new Error('샷 간격이 너무 짧습니다');
    if (s.shots >= MAX_SHOTS) return { s, shot, expired: true };

    const M = MODES[mode];
    let pts, delta, success, extra = {}, endNow = false, judged = shot, cleared = false;
    if (M.kind === 'carom3') {
      pts = caromPoints(shot); success = shot.success;
      delta = success ? (s.chances < MAX_CHANCES ? 1 : 0) : -1;
    } else if (M.kind === 'pool') {
      const r = poolShot(mode, s, shot);
      pts = r.points; success = r.success; delta = r.chanceDelta; endNow = r.endNow; cleared = r.cleared;
      if (r.cleared) pts += POOL[mode === 'nineball' ? 'nineClear' : 'eightClear'] + Math.max(0, s.chances + delta) * POOL.chanceBonus;
      extra = { potted: [...(s.potted || []), ...r.newPotted], group: r.group };
    } else {
      const r = otherShot(mode, s, shot);
      pts = r.points; success = r.success; delta = r.chanceDelta; endNow = !!r.endNow; cleared = !!r.cleared;
      if (cleared) pts += r.clearBonus + Math.max(0, s.chances + delta) * POOL.chanceBonus;
      extra = r.extra;
    }
    let fouls = 0, foulOut = false;
    if (FOUL_OUT_KINDS.has(M.kind)) {
      fouls = shot.foul ? (s.fouls || 0) + 1 : 0;
      foulOut = fouls >= FOUL_OUT;
      if (foulOut) endNow = true;
    } else if (shot.foul) fouls = (s.fouls || 0) + 1;
    // 쉬운 캐롬(사구·리브레)은 점수 상한 — 도달하면 완주로 종료
    let capped = false;
    if (M.cap && s.score + pts >= M.cap) { pts = Math.max(0, M.cap - s.score); capped = true; endNow = true; }
    extra = { ...extra, cleared: cleared || capped, fouls, foulOut };
    judged = { ...shot, success, cleared: cleared || capped, capped, points: pts };
    const next = {
      shots: s.shots + 1,
      successes: s.successes + (success ? 1 : 0),
      score: s.score + pts,
      chances: s.chances + delta,
      lastShotAt: now,
      ...extra,
      log: FieldValue.arrayUnion(`${s.shots + 1}:${success ? 1 : 0}:${pts}:${JSON.stringify(shot).slice(0, 120)}`),
    };
    t.update(sessRef, next);
    return { s: { ...s, ...next }, pts, shot: judged, endNow };
  });

  if (result.expired || result.endNow || result.s.chances <= 0) {
    const reason = result.expired ? 'expired' : result.shot?.capped ? 'cap' : result.s.cleared ? 'cleared'
      : result.s.foulOut ? 'three-fouls' : result.endNow ? 'engine-end' : 'chances';
    const fin = await endGame(uid, { reason });
    return { ...fin, points: result.pts || 0, shot: result.shot };
  }
  return { ...publicState(result.s), points: result.pts, shot: result.shot };
}

/** 판 종료 — GP 지급 + 주간 랭킹 접수 (판당 1회, 멱등) */
async function endGame(uid, { reason = 'quit' } = {}) {
  const sessRef = db.collection('billiards_sessions').doc(uid);
  const playerRef = db.collection('battle_players').doc(uid);
  const dayKey = `gameEarn_billiards_${vnDate()}`;

  const fin = await db.runTransaction(async t => {
    const [snap, pSnap] = await Promise.all([t.get(sessRef), t.get(playerRef)]);
    const s = snap.data();
    if (!s || s.ended) return { s, already: true };
    const earnedToday = (pSnap.data() || {})[dayKey] || 0;
    let gp = Math.min(Math.floor(s.score / GP_SCORE_UNIT), MAX_GP_PER_GAME) * s.mult;
    gp = Math.max(0, Math.min(gp, DAILY_MAX_EARN - earnedToday));
    if (gp > 0) {
      t.set(playerRef, { gold: FieldValue.increment(gp), [dayKey]: FieldValue.increment(gp) }, { merge: true });
    }
    const done = { ended: true, endedAt: Date.now(), endReason: reason, gpAwarded: gp };
    t.update(sessRef, done);
    return { s: { ...s, ...done } };
  });

  if (!fin.s) return publicState(null);
  let weekly = null;
  if (!fin.already && fin.s.score > 0) {
    try {
      weekly = await require('./weeklyRanking').recordServerScore(uid, 'billiards', fin.s.score);
    } catch (e) {
      weekly = { accepted: false, error: e.message };
    }
  }
  return { ...publicState(fin.s), endReason: fin.s.endReason, weekly };
}

/** 현재 판 상태 (새로고침 후 이어하기 표시용) */
async function getState(uid) {
  const snap = await db.collection('billiards_sessions').doc(uid).get();
  return publicState(snap.data());
}

module.exports = {
  startGame, reportShot, endGame, getState,
  caromPoints, poolShot, otherShot, parseShot, TIERS, MODES, POOL, GP_SCORE_UNIT, START_CHANCES, MAX_CHANCES, FOUL_OUT,
};
