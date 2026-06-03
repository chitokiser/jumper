'use strict';
// gameReward.js — 게임 GP 보상/참가비 서버사이드 처리 (클라이언트 신뢰 불가)
const admin = require('firebase-admin');
const db    = admin.firestore();
const { isPremiumActive, todayUtc7, FREE_ENTRY_MAX, FREE_ENTRY_GAMES } = require('./membership');

// ── 게임 타입별 최대 단일 보상 한도 ─────────────────────────────────────────
const GAME_MAX_REWARD = {
  memory:   700,
  bow:      300,
  race:     500,
  dungeon:  300,
  conquest: 300,
};

// ── 참가비 (서버 정의 — 클라이언트 전달값 무시) ──────────────────────────────
const GAME_BASE_FEE = 100;
const GAME_FEE_STEP = 50;
const RESET_MS      = 24 * 60 * 60 * 1000;

// ── 하루 최대 총 GP 획득 한도 ────────────────────────────────────────────────
const DAILY_MAX_EARN = {
  memory:  5000,
  bow:     3000,
  default: 10000,
};

/**
 * 게임 보상 지급 — 서버사이드 amount 상한 검증 후 Admin SDK로 gold 업데이트
 */
async function claimGameReward(uid, gameType, amount) {
  if (!uid || typeof gameType !== 'string') throw new Error('파라미터 오류');

  const maxReward = GAME_MAX_REWARD[gameType];
  if (!maxReward) throw new Error(`알 수 없는 게임 타입: ${gameType}`);

  const gp = Math.floor(Number(amount));
  if (!Number.isFinite(gp) || gp <= 0) throw new Error('보상 금액이 올바르지 않습니다');
  if (gp > maxReward) throw new Error(`최대 보상 한도 초과 (한도 ${maxReward} GP)`);

  const dailyMax = DAILY_MAX_EARN[gameType] || DAILY_MAX_EARN.default;
  const todayKey = `gameEarn_${gameType}_${new Date().toISOString().slice(0, 10)}`;
  const ref      = db.collection('battle_players').doc(uid);

  return db.runTransaction(async t => {
    const snap = await t.get(ref);
    const data = snap.data() || {};
    const earnedToday = data[todayKey] || 0;
    if (earnedToday + gp > dailyMax) {
      throw new Error(`오늘 ${gameType} 게임 보상 한도 도달 (최대 ${dailyMax.toLocaleString()} GP/일)`);
    }
    t.set(ref, {
      gold:       admin.firestore.FieldValue.increment(gp),
      [todayKey]: admin.firestore.FieldValue.increment(gp),
    }, { merge: true });
    return { gp };
  });
}

/**
 * 게임 참가비 차감
 * - 정회원 + 대상 게임 + 오늘 무료 횟수 남아있으면 → 무료 입장
 * - 그 외 → GP 차감 (원자 트랜잭션)
 */
async function payGameEntry(uid, gameKey) {
  if (!uid || typeof gameKey !== 'string') throw new Error('파라미터 오류');

  const allowedKeys = ['memoryEntry', 'bowEntry', 'raceEntry', 'dungeonEntry', 'conquestEntry'];
  if (!allowedKeys.includes(gameKey)) throw new Error(`알 수 없는 게임 키: ${gameKey}`);

  const ref   = db.collection('battle_players').doc(uid);
  const today = todayUtc7();

  // ── 정회원 무료 입장 확인 (트랜잭션 밖에서 users read) ──────────────────
  if (FREE_ENTRY_GAMES.has(gameKey)) {
    const userSnap = await db.collection('users').doc(uid).get();
    const coopUntil = (userSnap.data() || {}).coopMemberUntil;

    if (isPremiumActive(coopUntil)) {
      const freeKey = `freeEntry_${today}`;

      return db.runTransaction(async t => {
        const snap = await t.get(ref);
        if (!snap.exists) throw new Error('플레이어 데이터 없음');
        const data     = snap.data();
        const freeUsed = data[freeKey] || 0;

        if (freeUsed < FREE_ENTRY_MAX) {
          // 무료 입장 — GP 차감 없이 카운터만 증가
          t.set(ref, { [freeKey]: admin.firestore.FieldValue.increment(1) }, { merge: true });
          return {
            fee:      0,
            isFree:   true,
            freeUsed: freeUsed + 1,
            freeLeft: FREE_ENTRY_MAX - freeUsed - 1,
            newCount: (data[gameKey]?.count) || 0,
          };
        }
        // 무료 소진 → 유료로 fallthrough
        return _chargeEntry(t, data, ref, gameKey);
      });
    }
  }

  // ── 일반 유료 입장 ──────────────────────────────────────────────────────
  return db.runTransaction(async t => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new Error('플레이어 데이터 없음');
    return _chargeEntry(t, snap.data(), ref, gameKey);
  });
}

/** 트랜잭션 내부: GP 차감 + 참가 카운터 갱신 */
function _chargeEntry(t, data, ref, gameKey) {
  const gold   = data.gold || 0;
  const entry  = data[gameKey] || {};
  const now    = Date.now();
  const resetAt = entry.resetAt?.toMillis?.() ?? 0;
  const count  = (resetAt && now - resetAt < RESET_MS) ? (entry.count || 0) : 0;
  const fee    = GAME_BASE_FEE + count * GAME_FEE_STEP;

  if (gold < fee)
    throw new Error(`GP 부족 — 필요: ${fee.toLocaleString()} GP, 보유: ${gold.toLocaleString()} GP`);

  const newCount   = count + 1;
  const newResetAt = count === 0
    ? admin.firestore.Timestamp.now()
    : (entry.resetAt || admin.firestore.Timestamp.now());

  t.update(ref, {
    gold:                   admin.firestore.FieldValue.increment(-fee),
    [`${gameKey}.count`]:   newCount,
    [`${gameKey}.resetAt`]: newResetAt,
  });

  return { fee, isFree: false, newCount };
}

module.exports = { claimGameReward, payGameEntry };
