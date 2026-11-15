'use strict';
// weeklyRanking.js — 수박게임(suika)·2048 주간 랭킹 접수 및 정산
//
// 주간 기준: 베트남 시간(UTC+7, 서머타임 없음) 일요일 00:00 ~ 다음 일요일 00:00
// 정산: 매주 일요일 00:00(베트남) 스케줄 함수가 직전 주 TOP10 을 확정하고 GP 자동 지급
// 상금: 1위 50,000,000 GP → 10위 5,000,000 GP (5,000,000 GP 단위 감소)
//
// 컬렉션 (모두 서버 전용 쓰기)
//   weekly_game_sessions/{uid}_{gameType}            참가비 낸 판 1개 = 점수 접수 1회권
//   weekly_rankings/{gameType}_{weekId}              주간 보드 메타
//   weekly_rankings/{gameType}_{weekId}/entries/{uid} 주간 최고점
//   weekly_settlements/{gameType}_{weekId}           정산 결과 (존재 = 정산 완료, 멱등성 키)
//   weekly_ranking_payouts/{gameType}_{weekId}_{rank} 지급 로그

const admin = require('firebase-admin');
const db    = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS       = 24 * 60 * 60 * 1000;
const WEEK_MS      = 7 * DAY_MS;

const WEEKLY_GAMES = {
  suika:    { entryKey: 'suikaEntry',    label: '수박게임', maxScore: 90000  }, // GAME_MAX_REWARD 3000 × 30점
  game2048: { entryKey: 'game2048Entry', label: '2048',    maxScore: 200000 }, // GAME_MAX_REWARD 20000 × 10점
};

const TOP_N          = 10;
const PRIZE_STEP_GP  = 5_000_000;
const SESSION_MIN_MS = 10 * 1000;          // 10초 미만 판은 접수 안 함
const SESSION_MAX_MS = 3 * 60 * 60 * 1000; // 3시간 넘은 참가권은 만료

/** 순위별 상금 (1위 5천만 ~ 10위 5백만) */
function prizeForRank(rank) {
  if (!Number.isInteger(rank) || rank < 1 || rank > TOP_N) return 0;
  return (TOP_N + 1 - rank) * PRIZE_STEP_GP;
}

/** ms → 해당 주(베트남 일요일 00:00 시작) 정보 */
function weekInfo(ms = Date.now()) {
  const vn       = ms + VN_OFFSET_MS;
  const dayStart = Math.floor(vn / DAY_MS) * DAY_MS;
  const dow      = new Date(dayStart).getUTCDay(); // 0 = 일요일
  const startVn  = dayStart - dow * DAY_MS;
  const weekId   = new Date(startVn).toISOString().slice(0, 10);
  const startsAt = startVn - VN_OFFSET_MS;
  return { weekId, startsAt, endsAt: startsAt + WEEK_MS };
}

/** weekId(YYYY-MM-DD, 일요일) 유효성 + 시작 시각(UTC ms) */
function weekStartFromId(weekId) {
  if (typeof weekId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(weekId)) return null;
  const startVn = Date.parse(`${weekId}T00:00:00Z`);
  if (!Number.isFinite(startVn) || new Date(startVn).getUTCDay() !== 0) return null;
  return startVn - VN_OFFSET_MS;
}

function boardId(gameType, weekId) { return `${gameType}_${weekId}`; }

function maskEmail(email) {
  const [user, domain] = String(email).split('@');
  if (!domain) return String(email).slice(0, 12);
  return `${user.slice(0, 3)}***@${domain}`;
}

/** 랭킹 표시용 프로필 — 구글(Firebase Auth) 이름·사진 우선, 이메일은 마스킹 */
async function profileFor(uid) {
  let authUser = null, b = {}, d = {};
  try { authUser = await admin.auth().getUser(uid); } catch (_) {}
  try {
    const [bp, u] = await Promise.all([
      db.collection('battle_players').doc(uid).get(),
      db.collection('users').doc(uid).get(),
    ]);
    b = bp.data() || {}; d = u.data() || {};
  } catch (_) {}
  const photoURL = authUser?.photoURL || b.photoURL || d.photoURL || null;
  const name = authUser?.displayName || b.displayName || d.name || d.displayName || d.nickname
    || (d.username ? `@${d.username}` : null);
  const email = authUser?.email || d.email;
  const displayName = name ? String(name).slice(0, 20)
    : email ? maskEmail(email) : `Player-${uid.slice(0, 5)}`;
  return { displayName, photoURL };
}

/**
 * payGameEntry 트랜잭션 안에서 호출 — 참가비 낸 판마다 점수 접수권 1장 발급
 * (클라이언트가 쓸 수 없는 서버 전용 컬렉션)
 */
function issueSessionInTx(t, uid, gameKey) {
  const gameType = Object.keys(WEEKLY_GAMES).find(k => WEEKLY_GAMES[k].entryKey === gameKey);
  if (!gameType) return;
  t.set(db.collection('weekly_game_sessions').doc(`${uid}_${gameType}`), {
    uid, gameType, startedAt: Date.now(), used: false,
  });
}

/**
 * 주간 점수 접수 — 참가비 낸 판 1개당 1회. 주간 최고점만 보관.
 */
async function submitWeeklyScore(uid, { gameType, score } = {}) {
  const game = WEEKLY_GAMES[gameType];
  if (!uid || !game) throw new Error('알 수 없는 게임입니다');
  const s = Math.floor(Number(score));
  if (!Number.isFinite(s) || s <= 0) return { accepted: false, reason: 'zero' };
  if (s > game.maxScore) throw new Error(`점수 한도 초과 (최대 ${game.maxScore.toLocaleString()}점)`);

  const now   = Date.now();
  const week  = weekInfo(now);
  const bId   = boardId(gameType, week.weekId);
  const sessRef  = db.collection('weekly_game_sessions').doc(`${uid}_${gameType}`);
  const boardRef = db.collection('weekly_rankings').doc(bId);
  const entryRef = boardRef.collection('entries').doc(uid);
  const profile  = await profileFor(uid);

  return db.runTransaction(async t => {
    const [sessSnap, entrySnap] = await Promise.all([t.get(sessRef), t.get(entryRef)]);
    const sess = sessSnap.data();
    if (!sess || sess.used) throw new Error('참가비를 낸 판의 점수만 랭킹에 등록됩니다');
    const elapsed = now - (sess.startedAt || 0);
    if (elapsed < SESSION_MIN_MS) throw new Error('너무 짧은 판은 랭킹에 등록되지 않습니다');
    if (elapsed > SESSION_MAX_MS) {
      t.update(sessRef, { used: true, usedAt: now, expired: true });
      return { accepted: false, reason: 'expired' };
    }
    t.update(sessRef, { used: true, usedAt: now, score: s, weekId: week.weekId });

    const prev = entrySnap.exists ? (entrySnap.data().bestScore || 0) : 0;
    t.set(boardRef, {
      gameType, weekId: week.weekId, startsAt: week.startsAt, endsAt: week.endsAt,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (s <= prev) {
      t.set(entryRef, { ...profile, plays: FieldValue.increment(1) }, { merge: true });
      return { accepted: true, improved: false, bestScore: prev, weekId: week.weekId };
    }
    t.set(entryRef, {
      uid, ...profile, bestScore: s, achievedAt: now,
      plays: FieldValue.increment(1),
    }, { merge: true });
    return { accepted: true, improved: true, bestScore: s, weekId: week.weekId };
  });
}

/** 주간 TOP N 조회 (동점은 먼저 달성한 사람이 상위) */
async function _topEntries(gameType, weekId, tx) {
  const q = db.collection('weekly_rankings').doc(boardId(gameType, weekId))
    .collection('entries').orderBy('bestScore', 'desc').limit(50);
  const snap = tx ? await tx.get(q) : await q.get();
  return snap.docs
    .map(d => ({ uid: d.id, ...d.data() }))
    .filter(e => (e.bestScore || 0) > 0)
    .sort((a, b) => (b.bestScore - a.bestScore) || ((a.achievedAt || 0) - (b.achievedAt || 0)))
    .slice(0, TOP_N);
}

/**
 * 한 게임의 한 주 정산 — 멱등 (weekly_settlements 문서가 있으면 아무것도 안 함)
 */
async function settleWeek(gameType, weekId, { triggeredBy = 'schedule' } = {}) {
  const game = WEEKLY_GAMES[gameType];
  if (!game) throw new Error('알 수 없는 게임입니다');
  const startsAt = weekStartFromId(weekId);
  if (startsAt === null) throw new Error('weekId 형식 오류 (일요일 YYYY-MM-DD)');
  const endsAt = startsAt + WEEK_MS;
  if (Date.now() < endsAt) throw new Error('아직 끝나지 않은 주입니다');

  const settleId  = boardId(gameType, weekId);
  const settleRef = db.collection('weekly_settlements').doc(settleId);

  return db.runTransaction(async t => {
    const settleSnap = await t.get(settleRef);
    if (settleSnap.exists) return { settled: false, alreadySettled: true, settleId };

    const top = await _topEntries(gameType, weekId, t);
    const winners = top.map((e, i) => ({
      rank: i + 1,
      uid: e.uid,
      displayName: e.displayName || null,
      photoURL: e.photoURL || null,
      bestScore: e.bestScore,
      prizeGp: prizeForRank(i + 1),
    }));

    for (const w of winners) {
      t.set(db.collection('battle_players').doc(w.uid), {
        gold: FieldValue.increment(w.prizeGp),
      }, { merge: true });
      t.set(db.collection('weekly_ranking_payouts').doc(`${settleId}_${w.rank}`), {
        settleId, gameType, weekId, ...w,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    t.set(settleRef, {
      gameType, gameLabel: game.label, weekId, startsAt, endsAt,
      winners,
      totalPrizeGp: winners.reduce((s, w) => s + w.prizeGp, 0),
      triggeredBy,
      settledAt: FieldValue.serverTimestamp(),
    });
    return { settled: true, settleId, winners };
  });
}

/** 스케줄러용 — 방금 끝난 주를 두 게임 모두 정산 */
async function settleLastWeekAll() {
  // 현재 주 시작 직전 = 방금 끝난 주 (재시도가 늦게 돌아도 같은 주를 가리킴)
  const lastWeek = weekInfo(weekInfo().startsAt - 1).weekId;
  const results = {};
  for (const gameType of Object.keys(WEEKLY_GAMES)) {
    try {
      results[gameType] = await settleWeek(gameType, lastWeek);
    } catch (e) {
      results[gameType] = { error: e.message };
    }
  }
  return { weekId: lastWeek, results };
}

module.exports = {
  WEEKLY_GAMES, prizeForRank, weekInfo, weekStartFromId,
  issueSessionInTx, submitWeeklyScore, settleWeek, settleLastWeekAll,
};
