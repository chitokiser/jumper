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
      granted = { granted: true };
      break;
    case 'key':
      granted = await _grantKey(uid, product.grantValue || 1);
      break;
    case 'random_box': {
      const dailyLimit = product.dailyLimit || 3;
      const withinLimit = await _checkDailyLimit(uid, 'random_box', dailyLimit);
      if (!withinLimit) {
        await payRef.set({ grantStatus: 'limit_exceeded' }, { merge: true });
        return { ok: false, reason: 'daily_limit_exceeded' };
      }
      granted = await _grantRandomBox(uid);
      break;
    }
    case 'jump_pkg':
      await db.collection('battle_players').doc(uid)
        .set({ jumpTokens: FieldValue.increment(product.grantValue || 0) }, { merge: true });
      granted = { granted: true };
      break;
    default:
      throw new Error('Unknown productType: ' + productType);
  }

  const grantResult = typeof granted === 'object' ? granted : { granted };
  if (grantResult.granted) {
    await payRef.set({
      grantStatus: 'done',
      grantedAt:   FieldValue.serverTimestamp(),
      ...(grantResult.gp !== undefined ? { grantedGp: grantResult.gp } : {}),
    }, { merge: true });

    await _processAffiliateCommission({ uid, starsAmount, referrerUid, chargeId });
  }

  return { ok: !!grantResult.granted, gp: grantResult.gp };
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
  return { granted: true };
}

async function _grantKey(uid, count) {
  await db.collection('battle_players').doc(uid)
    .set({ keys: FieldValue.increment(count) }, { merge: true });
  return { granted: true };
}

// ── 랜덤박스 확률 테이블 ─────────────────────────────────────────────────────
//  GP 범위       확률 (누적)
//  1~10          50%
//  11~50         25%  → 75%
//  51~100        15%  → 90%
//  101~500        7%  → 97%
//  501~1,000      2%  → 99%
//  1,001~5,000   0.9% → 99.9%
//  5,001~10,000  0.1% → 100%

function _randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function _rollRandomBox() {
  const r = Math.random() * 100;
  if (r < 50)   return _randInt(1,    10);
  if (r < 75)   return _randInt(11,   50);
  if (r < 90)   return _randInt(51,  100);
  if (r < 97)   return _randInt(101,  500);
  if (r < 99)   return _randInt(501, 1000);
  if (r < 99.9) return _randInt(1001, 5000);
  return          _randInt(5001, 10000);
}

async function _grantRandomBox(uid) {
  const gp = _rollRandomBox();
  await db.collection('battle_players').doc(uid)
    .set({ gold: FieldValue.increment(gp) }, { merge: true });
  // 결과 기록 (유저가 확인할 수 있도록)
  await db.collection('random_box_results').add({
    uid, gp,
    openedAt: FieldValue.serverTimestamp(),
  });
  return { granted: true, gp };
}

// ── 일일 구매 제한 ────────────────────────────────────────────────────────────

async function _checkDailyLimit(uid, productType, limitPerDay) {
  const today  = _todayUtc7();
  const ref    = db.collection('stars_daily_purchases').doc(`${uid}_${today}`);
  const snap   = await ref.get();
  const count  = (snap.data() || {})[productType] || 0;
  if (count >= limitPerDay) return false;
  await ref.set(
    { [productType]: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
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
  { name:'Premium Membership (30 Days)', description:'⭐ Upgrade to Premium: daily 3,500 GP top-up + exclusive treasure boxes + Level 4 boost. Valid 30 days.', starsPrice:800, productType:'premium', grantValue:30, active:true },
  { name:'5,000 GP Package',     description:'5,000 Game Points credited instantly',                                 starsPrice:50,  productType:'gp',         grantValue:5000,  active:true },
  { name:'15,000 GP Package',    description:'15,000 Game Points — best value!',                                    starsPrice:130, productType:'gp',         grantValue:15000, active:true },
  // rate: 100 Stars = 17,000 GP  /  1,000 Stars = 170,000 GP  /  10,000 Stars = 1,700,000 GP
  { name:'💰 17,000 GP',         description:'17,000 Game Points — 100 Stars',                                        starsPrice:100,  productType:'gp',        grantValue:17000,   active:true },
  { name:'💰 170,000 GP',        description:'170,000 Game Points — 1,000 Stars',                                     starsPrice:1000, productType:'gp',        grantValue:170000,  active:true },
  { name:'💰 1,700,000 GP',      description:'1,700,000 Game Points — 10,000 Stars',                                  starsPrice:10000,productType:'gp',        grantValue:1700000, active:true },
  { name:'Treasure Box Key',     description:'One key to open a treasure box',                                      starsPrice:30,  productType:'key',         grantValue:1,     active:true },
  { name:'Random Box',           description:'A mystery box with random rewards',                                   starsPrice:80,  productType:'random_box',  grantValue:1,     active:true },
  { name:'Jump Token Package',   description:'100 JUMP tokens delivered to your wallet',                            starsPrice:200, productType:'jump_pkg',    grantValue:100,   active:true },
];

async function seedProducts() {
  const col = db.collection('stars_products');
  const snap = await col.get();
  const byName  = new Map(snap.docs.map(d => [d.data().name, d.ref]));
  const byKey   = new Map(snap.docs.map(d => [`${d.data().starsPrice}_${d.data().productType}`, d.ref]));
  const batch = db.batch();
  let added = 0, updated = 0;
  SEED_PRODUCTS.forEach(p => {
    const key = `${p.starsPrice}_${p.productType}`;
    if (byName.has(p.name)) {
      batch.set(byName.get(p.name), { ...p, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      updated++;
    } else if (byKey.has(key)) {
      batch.set(byKey.get(key), { ...p, updatedAt: FieldValue.serverTimestamp() });
      updated++;
    } else {
      batch.set(col.doc(), { ...p, createdAt: FieldValue.serverTimestamp() });
      added++;
    }
  });
  if (added + updated > 0) await batch.commit();
  return { seeded: added, updated, skipped: SEED_PRODUCTS.length - added - updated };
}

async function upsertProduct(data) {
  const col = db.collection('stars_products');
  // name 기준 덮어쓰기 (동일 productType 복수 허용)
  const existing = await col.where('name','==',data.name).limit(1).get();
  if (!existing.empty) {
    await existing.docs[0].ref.set({ ...data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { updated: true, id: existing.docs[0].id };
  }
  const ref = await col.add({ ...data, createdAt: FieldValue.serverTimestamp() });
  return { created: true, id: ref.id };
}

// ── Affiliate 커미션 GP 환급 ──────────────────────────────────────────────────

async function redeemAffiliateCommission(uid) {
  const pendingSnaps = await db.collection('affiliate_sales')
    .where('referrerUid', '==', uid)
    .where('status', '==', 'pending')
    .get();

  if (pendingSnaps.empty) return { ok: false, reason: 'no_pending_commission' };

  let totalStars = 0;
  pendingSnaps.forEach(s => { totalStars += (s.data().commissionStars || 0); });

  if (totalStars < 1) return { ok: false, reason: 'commission_too_small' };

  const gpAmount = totalStars * 100; // 1⭐ = 100 GP
  const batch = db.batch();
  pendingSnaps.forEach(s => {
    batch.update(s.ref, { status: 'paid', paidAt: FieldValue.serverTimestamp() });
  });

  await Promise.all([
    batch.commit(),
    db.collection('battle_players').doc(uid)
      .set({ gold: FieldValue.increment(gpAmount) }, { merge: true }),
  ]);

  return { ok: true, starsRedeemed: totalStars, gpGranted: gpAmount };
}

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function _todayUtc7() {
  return new Date(Date.now() + 7*3600*1000).toISOString().slice(0,10);
}

module.exports = { grantProduct, getAdminStats, seedProducts, upsertProduct, redeemAffiliateCommission };
