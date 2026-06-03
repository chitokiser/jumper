'use strict';
// gameReward.js — 게임 GP 보상/참가비 서버사이드 처리 (클라이언트 신뢰 불가)
const admin = require('firebase-admin');
const db    = admin.firestore();
const { todayUtc7 } = require('./membership');

// ── 게임 타입별 최대 단일 보상 한도 ─────────────────────────────────────────
const GAME_MAX_REWARD = {
  memory:   700,
  bow:      2000,
  race:     500,
  relay:    3000,   // D등급 우승 15× 시 최대 (200GP × 15 = 3000)
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
  bow:     10000,
  relay:   15000,
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
 * 게임 참가비 차감 — GP 차감 (원자 트랜잭션)
 * 무료 입장 혜택 제거됨 — 정회원은 daily GP 충전으로 대체
 */
async function payGameEntry(uid, gameKey) {
  if (!uid || typeof gameKey !== 'string') throw new Error('파라미터 오류');

  const allowedKeys = ['memoryEntry', 'bowEntry', 'raceEntry', 'dungeonEntry', 'conquestEntry'];
  if (!allowedKeys.includes(gameKey)) throw new Error(`알 수 없는 게임 키: ${gameKey}`);

  const ref = db.collection('battle_players').doc(uid);

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
  // ms 숫자로 저장 — 클라이언트에서 Timestamp 변환 없이 직접 비교 가능
  const existingResetMs = entry.resetAt?.toMillis?.() ?? (typeof entry.resetAt === 'number' ? entry.resetAt : 0);
  const newResetAt = count === 0 ? now : (existingResetMs || now);

  t.set(ref, {
    gold:                   admin.firestore.FieldValue.increment(-fee),
    [gameKey]: { count: newCount, resetAt: newResetAt },
  }, { merge: true });

  return { fee, isFree: false, newCount };
}

module.exports = { claimGameReward, payGameEntry };
