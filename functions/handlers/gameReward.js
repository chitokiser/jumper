'use strict';
// gameReward.js — 게임 GP 보상/참가비 서버사이드 처리 (클라이언트 신뢰 불가)
const admin = require('firebase-admin');
const db    = admin.firestore();
const { todayUtc7 } = require('./membership');

// ── 게임 타입별 최대 단일 보상 한도 ─────────────────────────────────────────
const GAME_MAX_REWARD = {
  memory:   1200,  // 최대 가능 점수: 매칭360 + 콤보240 + 클리어300 + 시간보너스200 = 1100
  bow:      2000,
  race:     500,
  relay:    3000,
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

/**
 * 관리자: 유저 GP 내역 조회
 * battle_players 필드에서 게임획득/충전/보너스 이력 재구성
 * + membership_payments 에서 TON 결제 내역 포함
 */
async function adminGetUserGpHistory(uid) {
  if (!uid) throw new Error('uid 누락');

  const GAME_LABELS = {
    memory: '기억력 게임', bow: '활쏘기', race: '몬스터레이스',
    relay: '이어달리기', dungeon: '던전', conquest: '몬스터수성',
  };

  const [bpSnap, paySnap] = await Promise.all([
    db.collection('battle_players').doc(uid).get(),
    db.collection('membership_payments').where('uid', '==', uid)
      .orderBy('createdAt', 'desc').limit(50).get(),
  ]);

  const bp      = bpSnap.exists ? (bpSnap.data() || {}) : {};
  const history = [];

  // ── 1. battle_players 필드 파싱 ──────────────────────────────────────────
  for (const [key, val] of Object.entries(bp)) {
    // gameEarn_{type}_{YYYY-MM-DD}
    const earnMatch = key.match(/^gameEarn_([a-z]+)_(\d{4}-\d{2}-\d{2})$/);
    if (earnMatch && val > 0) {
      history.push({
        date:  earnMatch[2],
        type:  'game',
        label: GAME_LABELS[earnMatch[1]] || earnMatch[1],
        gp:    val,
      });
      continue;
    }
    // dailyTopup_{YYYY-MM-DD}
    const topupMatch = key.match(/^dailyTopup_(\d{4}-\d{2}-\d{2})$/);
    if (topupMatch && val === true) {
      history.push({
        date:  topupMatch[1],
        type:  'topup',
        label: '정회원 일일 충전',
        gp:    3500,
      });
      continue;
    }
  }

  // ── 2. 신규 가입 보너스 ───────────────────────────────────────────────────
  if (bp.joinBonusAt) {
    const ts = bp.joinBonusAt.toMillis ? bp.joinBonusAt.toMillis() : Number(bp.joinBonusAt);
    history.push({
      date:  new Date(ts).toISOString().slice(0, 10),
      type:  'bonus',
      label: '신규 가입 보너스',
      gp:    1000,
    });
  }

  // ── 3. TON 정회원 결제 내역 ───────────────────────────────────────────────
  for (const d of paySnap.docs) {
    const p  = d.data();
    const ts = p.createdAt?.toMillis?.() ?? Date.now();
    history.push({
      date:    new Date(ts).toISOString().slice(0, 10),
      type:    'membership',
      label:   p.isFirstMembership ? '정회원 가입 (TON)' : '정회원 연장 (TON)',
      gp:      0,   // GP 변동 없음 — 정보용
      tonAmount: p.tonAmount ?? null,
      expiresAt: p.expiresAt ?? null,
    });
  }

  // ── 날짜 내림차순 정렬 ────────────────────────────────────────────────────
  history.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));

  // ── GP 합계 계산 ──────────────────────────────────────────────────────────
  const totalEarned = history.reduce((s, r) => s + (r.gp || 0), 0);

  return {
    uid,
    currentGold: bp.gold || 0,
    totalEarned,
    history,
  };
}

module.exports = { claimGameReward, payGameEntry, adminGetUserGpHistory };
