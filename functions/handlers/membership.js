'use strict';
const expH = require('./exp');
const admin = require('firebase-admin');
const db    = admin.firestore();

const MEMBERSHIP_DAYS   = 30;
const REFERRAL_GP       = 500;
const LEVEL_BONUS       = 4;

// ── 일일 GP 충전 설정 ──────────────────────────────────────────────────────────
const DAILY_GP_TOPUP    = 3500;   // 매일 지급 GP
const TOPUP_THRESHOLD   = 1000;   // GP 이 값 이하일 때만 충전 가능

// UTC+7 기준 오늘 날짜 문자열 (YYYY-MM-DD)
function todayUtc7() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function isPremiumActive(coopMemberUntil) {
  return !!(coopMemberUntil && coopMemberUntil >= todayUtc7());
}

// ── 일일 GP 충전 (정회원 전용) ──────────────────────────────────────────────────
// 조건: ① 정회원 ② GP ≤ 1000 ③ 오늘 미수령
async function claimDailyGpTopup(uid) {
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) throw new Error('User not found');

  const coopUntil = (userSnap.data() || {}).coopMemberUntil;
  if (!isPremiumActive(coopUntil)) throw new Error('Premium membership required');

  const today    = todayUtc7();
  const topupKey = `dailyTopup_${today}`;
  const ref      = db.collection('battle_players').doc(uid);

  return db.runTransaction(async t => {
    const snap = await t.get(ref);
    const data = snap.exists ? snap.data() : {};

    if (data[topupKey]) throw new Error('Already claimed today');

    const currentGP = data.gold || 0;
    if (currentGP > TOPUP_THRESHOLD) {
      throw new Error(`GP must be ${TOPUP_THRESHOLD} or below to claim (current: ${currentGP.toLocaleString()} GP)`);
    }

    t.set(ref, {
      gold:       admin.firestore.FieldValue.increment(DAILY_GP_TOPUP),
      [topupKey]: true,
    }, { merge: true });

    return {
      gp:      DAILY_GP_TOPUP,
      newGold: currentGP + DAILY_GP_TOPUP,
    };
  });
}

// ── 정회원 상태 조회 ──────────────────────────────────────────────────────────
async function getMembershipStatus(uid) {
  const [userSnap, playerSnap] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('battle_players').doc(uid).get(),
  ]);

  const user   = userSnap.data()   || {};
  const player = playerSnap.data() || {};
  const today  = todayUtc7();
  const expiry = user.coopMemberUntil || '';
  const isPremium = isPremiumActive(expiry);

  let daysLeft = 0;
  if (isPremium && expiry) {
    const ms = new Date(expiry + 'T00:00:00+07:00') - new Date(Date.now() + 7 * 3600 * 1000);
    daysLeft  = Math.max(0, Math.ceil(ms / 86400000));
  }

  const topupKey         = `dailyTopup_${today}`;
  const topupClaimedToday = !!(player[topupKey]);
  const currentGP        = player.gold || 0;
  const topupEligible    = isPremium && !topupClaimedToday && currentGP <= TOPUP_THRESHOLD;

  const cfgSnap    = await db.collection('membership_config').doc('pricing').get();
  const starsPrice = (cfgSnap.data() || {}).starsPrice || 500;

  return {
    isPremium,
    expiresAt:          expiry  || null,
    daysLeft,
    currentGP,
    dailyTopupAmount:   DAILY_GP_TOPUP,
    topupThreshold:     TOPUP_THRESHOLD,
    topupClaimedToday,
    topupEligible,
    memberFirstJoin:    !!(user.memberFirstJoin),
    starsPrice,
  };
}

// ── 관리자: 통계 조회 ──────────────────────────────────────────────────────────
async function adminGetMembershipStats() {
  const today         = todayUtc7();
  const weekLater     = new Date(Date.now() + 7 * 3600 * 1000 + 7 * 86400000)
    .toISOString().slice(0, 10);

  const [activeSnap, expiringSnap, allPaySnap, monthPaySnap, refSnap, cfgSnap] = await Promise.all([
    db.collection('users').where('coopMemberUntil', '>=', today).get(),
    db.collection('users').where('coopMemberUntil', '>=', today)
      .where('coopMemberUntil', '<=', weekLater).get(),
    db.collection('membership_payments').get(),
    db.collection('membership_payments').where('createdMonth', '==', today.slice(0, 7)).get(),
    db.collection('membership_referrals').where('status', '==', 'rewarded').get(),
    db.collection('membership_config').doc('pricing').get(),
  ]);

  const totalStars      = allPaySnap.docs.reduce((s, d) => s + (d.data().starsAmount || 0), 0);
  const totalStarsMonth = monthPaySnap.docs.reduce((s, d) => s + (d.data().starsAmount || 0), 0);

  const expiringMembers = expiringSnap.docs.map(d => ({
    uid:       d.id,
    name:      d.data().displayName || d.data().name || d.id,
    email:     d.data().email || '',
    expiresAt: d.data().coopMemberUntil,
  }));

  return {
    activeCount:      activeSnap.size,
    expiringCount:    expiringSnap.size,
    totalPayments:    allPaySnap.size,
    monthPayments:    monthPaySnap.size,
    totalStars,
    totalStarsMonth,
    referralRewards:  refSnap.size,
    totalReferralGp:  refSnap.size * REFERRAL_GP,
    starsPrice:       (cfgSnap.data() || {}).starsPrice || 500,
    expiringMembers,
  };
}

// ── 관리자: 가격 설정 ──────────────────────────────────────────────────────────
async function adminSetMembershipPrice(starsPrice) {
  const p = Number(starsPrice);
  if (!Number.isFinite(p) || p < 1 || !Number.isInteger(p))
    throw new Error('Stars 가격은 1 이상 정수여야 합니다');

  await db.collection('membership_config').doc('pricing').set(
    { starsPrice: p, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
  return { starsPrice: p };
}

// ── 초대 보상 처리 ─────────────────────────────────────────────────────────────
async function processReferralReward(referrerUid, newUserUid) {
  if (!referrerUid || !newUserUid) throw new Error('파라미터 누락');
  if (referrerUid === newUserUid)  throw new Error('자기 초대 불가');

  const dupSnap = await db.collection('membership_referrals')
    .where('newUserUid', '==', newUserUid)
    .limit(1).get();
  if (!dupSnap.empty) throw new Error('이미 처리된 초대');

  const referrerSnap = await db.collection('users').doc(referrerUid).get();
  if (!referrerSnap.exists) throw new Error('초대자 없음');
  if (!isPremiumActive((referrerSnap.data() || {}).coopMemberUntil))
    throw new Error('초대자가 정회원이 아닙니다');

  await db.collection('battle_players').doc(referrerUid).set(
    { gold: admin.firestore.FieldValue.increment(REFERRAL_GP) },
    { merge: true }
  );

  await db.collection('membership_referrals').add({
    referrerUid,
    newUserUid,
    gpRewarded:  REFERRAL_GP,
    status:      'rewarded',
    createdAt:   admin.firestore.FieldValue.serverTimestamp(),
  });

  // EXP 부여: 추천인에게 1,000 EXP
  try { await expH.grantExp(referrerUid, 1000, 'referral'); } catch (_) {}

  return { gpRewarded: REFERRAL_GP };
}

module.exports = {
  claimDailyGpTopup,
  getMembershipStatus,
  adminSetMembershipPrice,
  adminGetMembershipStats,
  processReferralReward,
  isPremiumActive,
  todayUtc7,
  DAILY_GP_TOPUP,
  TOPUP_THRESHOLD,
};
