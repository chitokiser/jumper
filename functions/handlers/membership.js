'use strict';
const admin = require('firebase-admin');
const db    = admin.firestore();

const MEMBERSHIP_DAYS   = 30;
const FREE_ENTRY_MAX    = 3;
const REFERRAL_GP       = 500;
const LEVEL_BONUS       = 4;
const FREE_ENTRY_GAMES  = new Set(['bowEntry', 'memoryEntry', 'raceEntry', 'conquestEntry']);

// UTC+7 기준 오늘 날짜 문자열 (YYYY-MM-DD)
function todayUtc7() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function isPremiumActive(coopMemberUntil) {
  return !!(coopMemberUntil && coopMemberUntil >= todayUtc7());
}

// ── 정회원 무료 입장 자격 확인 ─────────────────────────────────────────────────
// gameReward.payGameEntry 에서 호출 (트랜잭션 내부에서 직접 쓰므로 여기선 read-only)
async function checkFreeEntry(uid, gameKey) {
  if (!FREE_ENTRY_GAMES.has(gameKey)) return { eligible: false };

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return { eligible: false };

  const coopUntil = (userSnap.data() || {}).coopMemberUntil;
  if (!isPremiumActive(coopUntil)) return { eligible: false };

  const freeKey  = `freeEntry_${todayUtc7()}`;
  const playerSnap = await db.collection('battle_players').doc(uid).get();
  const freeUsed = (playerSnap.data() || {})[freeKey] || 0;

  return {
    eligible:  freeUsed < FREE_ENTRY_MAX,
    freeUsed,
    freeLeft:  Math.max(0, FREE_ENTRY_MAX - freeUsed),
    freeKey,
  };
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

  const freeKey      = `freeEntry_${today}`;
  const freeUsedToday = player[freeKey] || 0;

  // 설정에서 가격 조회
  const cfgSnap  = await db.collection('membership_config').doc('pricing').get();
  const starsPrice = (cfgSnap.data() || {}).starsPrice || 500;

  return {
    isPremium,
    expiresAt:      expiry  || null,
    daysLeft,
    freeUsedToday,
    freeMaxDaily:   FREE_ENTRY_MAX,
    freeLeft:       isPremium ? Math.max(0, FREE_ENTRY_MAX - freeUsedToday) : 0,
    memberFirstJoin: !!(user.memberFirstJoin),
    starsPrice,
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

// ── 관리자: 통계 조회 ──────────────────────────────────────────────────────────
async function adminGetMembershipStats() {
  const today         = todayUtc7();
  const firstOfMonth  = today.slice(0, 7) + '-01';
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

// ── 초대 보상 처리 (bot.py 에서 호출) ─────────────────────────────────────────
// referrerUid: 초대한 정회원 UID, newUserUid: 신규 가입 유저 UID
async function processReferralReward(referrerUid, newUserUid) {
  if (!referrerUid || !newUserUid) throw new Error('파라미터 누락');
  if (referrerUid === newUserUid)  throw new Error('자기 초대 불가');

  // 중복 확인
  const dupSnap = await db.collection('membership_referrals')
    .where('newUserUid', '==', newUserUid)
    .limit(1).get();
  if (!dupSnap.empty) throw new Error('이미 처리된 초대');

  // 초대자 정회원 확인
  const referrerSnap = await db.collection('users').doc(referrerUid).get();
  if (!referrerSnap.exists) throw new Error('초대자 없음');
  if (!isPremiumActive((referrerSnap.data() || {}).coopMemberUntil))
    throw new Error('초대자가 정회원이 아닙니다');

  // 500 GP 지급
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

  return { gpRewarded: REFERRAL_GP };
}

module.exports = {
  checkFreeEntry,
  getMembershipStatus,
  adminSetMembershipPrice,
  adminGetMembershipStats,
  processReferralReward,
  isPremiumActive,
  todayUtc7,
  FREE_ENTRY_MAX,
  FREE_ENTRY_GAMES,
};
