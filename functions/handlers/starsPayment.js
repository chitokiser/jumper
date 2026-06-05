'use strict';
// starsPayment.js — Telegram Stars 결제 처리 및 상품 지급

const admin = require('firebase-admin');
const db    = admin.firestore();
const { FieldValue } = admin.firestore;

const COMMISSION_RATE = 0.10; // 10%

// ── 상품 지급 ────────────────────────────────────────────────────────────────

async function grantProduct(chargeId) {
  const payRef  = db.collection('stars_payments').doc(chargeId);
  const paySnap = await payRef.get();
  if (!paySnap.exists) throw new Error('Payment not found: ' + chargeId);

  const pay = paySnap.data();
  if (pay.grantStatus === 'done') return { ok: false, reason: 'already_granted' };

  const { uid, productId, productType, starsAmount, referrerUid } = pay;

  const prodSnap = await db.collection('stars_products').doc(productId).get();
  if (!prodSnap.exists) throw new Error('Product not found: ' + productId);
  const product = prodSnap.data();

  let granted = false;
  switch (productType) {
    case 'premium':
      granted = await _grantPremium(uid, product.grantValue || 30);
      break;
    case 'gp':
      await db.collection('battle_players').doc(uid)
        .set({ gold: FieldValue.increment(product.grantValue || 0) }, { merge: true });
      granted = true;
      break;
    case 'key':
      granted = await _grantKey(uid, product.grantValue || 1);
      break;
    case 'random_box':
      granted = await _grantRandomBox(uid);
      break;
    case 'jump_pkg':
      await db.collection('battle_players').doc(uid)
        .set({ jumpTokens: FieldValue.increment(product.grantValue || 0) }, { merge: true });
      granted = true;
      break;
    default:
      throw new Error('Unknown productType: ' + productType);
  }

  if (granted) {
    await payRef.set({
      grantStatus: 'done',
      grantedAt:   FieldValue.serverTimestamp(),
    }, { merge: true });

    await _processAffiliateCommission({ uid, starsAmount, referrerUid, chargeId });
  }

  return { ok: granted };
}

// ── 상품별 지급 로직 ─────────────────────────────────────────────────────────

async function _grantPremium(uid, days) {
  const userRef  = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const today    = _todayUtc7();
  const user     = userSnap.data() || {};

  const expiry = user.coopMemberUntil || '';
  const base   = (expiry && expiry >= today)
    ? new Date(expiry + 'T00:00:00+07:00')
    : new Date();
  base.setDate(base.getDate() + days);
  const newExpiry = base.toISOString().slice(0, 10);

  await userRef.set({
    coopMemberUntil: newExpiry,
    updatedAt:       FieldValue.serverTimestamp(),
  }, { merge: true });

  // 첫 Premium이면 레벨 4 부스트
  if (!user.memberFirstJoin) {
    await userRef.set({ memberFirstJoin: FieldValue.serverTimestamp() }, { merge: true });
    const bpRef  = db.collection('battle_players').doc(uid);
    const bpSnap = await bpRef.get();
    const level  = (bpSnap.data() || {}).level || 1;
    if (level < 4) await bpRef.set({ level: 4 }, { merge: true });
  }
  return true;
}

async function _grantKey(uid, count) {
  await db.collection('battle_players').doc(uid)
    .set({ keys: FieldValue.increment(count) }, { merge: true });
  return true;
}

async function _grantRandomBox(uid) {
  // 랜덤박스: battle_players.randomBoxes 증가
  await db.collection('battle_players').doc(uid)
    .set({ randomBoxes: FieldValue.increment(1) }, { merge: true });
  return true;
}

// ── Affiliate 수수료 기록 ────────────────────────────────────────────────────

async function _processAffiliateCommission({ uid, starsAmount, referrerUid, chargeId }) {
  if (!referrerUid || referrerUid === uid) return;
  const commission = Math.floor(starsAmount * COMMISSION_RATE);
  if (commission < 1) return;

  await db.collection('affiliate_sales').add({
    referrerUid,
    buyerUid:        uid,
    paymentId:       chargeId,
    starsAmount,
    commissionRate:  COMMISSION_RATE,
    commissionStars: commission,
    status:          'pending',
    createdAt:       FieldValue.serverTimestamp(),
  });
}

// ── 관리자 통계 ──────────────────────────────────────────────────────────────

async function getAdminStats() {
  const [paySnaps, saleSnaps] = await Promise.all([
    db.collection('stars_payments').where('grantStatus','==','done').get(),
    db.collection('affiliate_sales').get(),
  ]);

  let totalStars = 0, totalCount = 0;
  const byDay = {}, byMonth = {};

  paySnaps.forEach(s => {
    const d = s.data();
    totalStars += d.starsAmount || 0;
    totalCount++;
    const date = (d.createdAt?.toDate?.() || new Date()).toISOString().slice(0,10);
    const month = date.slice(0,7);
    byDay[date]   = (byDay[date]   || 0) + (d.starsAmount || 0);
    byMonth[month]= (byMonth[month]|| 0) + (d.starsAmount || 0);
  });

  const referrerMap = {};
  saleSnaps.forEach(s => {
    const d = s.data();
    if (!referrerMap[d.referrerUid]) referrerMap[d.referrerUid] = { stars: 0, count: 0 };
    referrerMap[d.referrerUid].stars += d.starsAmount || 0;
    referrerMap[d.referrerUid].count++;
  });

  const topReferrers = Object.entries(referrerMap)
    .sort((a,b) => b[1].stars - a[1].stars)
    .slice(0, 20)
    .map(([uid, v]) => ({ uid, ...v }));

  return { totalStars, totalCount, byDay, byMonth, topReferrers };
}

// ── 상품 시드 데이터 ─────────────────────────────────────────────────────────

const SEED_PRODUCTS = [
  { name:'Premium 30 Days',      description:'Unlock Premium: daily 3,500 GP top-up + exclusive boxes + Lv4 boost', starsPrice:100, productType:'premium',    grantValue:30,    active:true },
  { name:'5,000 GP Package',     description:'5,000 Game Points credited instantly',                                 starsPrice:50,  productType:'gp',         grantValue:5000,  active:true },
  { name:'15,000 GP Package',    description:'15,000 Game Points — best value!',                                    starsPrice:130, productType:'gp',         grantValue:15000, active:true },
  { name:'Treasure Box Key',     description:'One key to open a treasure box',                                      starsPrice:30,  productType:'key',         grantValue:1,     active:true },
  { name:'Random Box',           description:'A mystery box with random rewards',                                   starsPrice:80,  productType:'random_box',  grantValue:1,     active:true },
  { name:'Jump Token Package',   description:'100 JUMP tokens delivered to your wallet',                            starsPrice:200, productType:'jump_pkg',    grantValue:100,   active:true },
];

async function seedProducts() {
  const col = db.collection('stars_products');
  const snap = await col.limit(1).get();
  if (!snap.empty) return { skipped: true };
  const batch = db.batch();
  SEED_PRODUCTS.forEach(p => {
    batch.set(col.doc(), { ...p, createdAt: FieldValue.serverTimestamp() });
  });
  await batch.commit();
  return { seeded: SEED_PRODUCTS.length };
}

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function _todayUtc7() {
  return new Date(Date.now() + 7*3600*1000).toISOString().slice(0,10);
}

module.exports = { grantProduct, getAdminStats, seedProducts };
