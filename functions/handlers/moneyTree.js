// functions/handlers/moneyTree.js
// 돈나무(Money Tree) 수동형 수익 시스템
'use strict';

const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');
const { requireAdmin } = require('../wallet/admin');

const db = admin.firestore();
const CONFIG_REF = db.doc('system_config/money_tree');

const DEFAULTS = {
  seedlingPriceGp: 10000,
  seedlingPriceStars: 80,
  lotteryMin: 1, lotteryMax: 1000,
  growthRate: 50, maxTreeValue: 500000,
  harvestTicketThreshold: 10,
  boosterPriceGp: 1000, boosterMin: 1, boosterMax: 10,
  trollDropRate: 0.10, harvestTaxRate: 0.10,
  shopOwnerCommissionSeedling: 0.30,
  shopOwnerCommissionBooster: 0.50,
  globalPlantCounter: 0,
};

function haversineM(lat1, lng1, lat2, lng2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getConfig() {
  const snap = await CONFIG_REF.get();
  return { ...DEFAULTS, ...(snap.exists ? snap.data() : {}) };
}

function calcTreeValue(globalCounter, baseCounter, growthRate, maxValue, boostTotal) {
  const effective = growthRate + (boostTotal || 0);
  return Math.min(Math.max(0, (globalCounter - baseCounter) * effective), maxValue);
}

function treeImageNum(value) {
  if (value >= 500000) return 11;
  if (value >= 320000) return 10;
  if (value >= 160000) return 9;
  if (value >= 120000) return 8;
  if (value >= 80000)  return 7;
  if (value >= 40000)  return 6;
  if (value >= 20000)  return 5;
  if (value >= 10000)  return 4;
  if (value >= 5000)   return 3;
  if (value >= 500)    return 2;
  return 1;
}

async function _validateGps(uid) {
  const snap = await db.collection('battle_players').doc(uid).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Player data not found.');
  const d = snap.data();
  if (d.lat == null || d.lng == null)
    throw new HttpsError('failed-precondition', 'Your location is not set. Please wait a moment and try again.');
  const age = Date.now() - (d.updatedAt?.toMillis?.() ?? 0);
  if (age > 10 * 60 * 1000)
    throw new HttpsError('failed-precondition', 'Location data is too old. Please move to refresh your position.');
  return d;
}

async function _log(type, data) {
  await db.collection('money_tree_logs').add({
    type, ...data,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ── 설정 조회 ──────────────────────────────────────────────────────────────────
async function getMoneyTreeConfig() {
  return await getConfig();
}

// ── 관리자 설정 변경 ──────────────────────────────────────────────────────────
async function adminSetMoneyTreeConfig(uid, data) {
  await requireAdmin(uid);
  const allowed = [
    'seedlingPriceGp', 'seedlingPriceStars', 'lotteryMin', 'lotteryMax',
    'growthRate', 'maxTreeValue', 'harvestTicketThreshold',
    'boosterPriceGp', 'boosterMin', 'boosterMax',
    'trollDropRate', 'harvestTaxRate',
    'shopOwnerCommissionSeedling', 'shopOwnerCommissionBooster',
  ];
  const update = {};
  for (const k of allowed) {
    if (data[k] !== undefined) update[k] = Number(data[k]);
  }
  if (!Object.keys(update).length) throw new HttpsError('invalid-argument', '변경할 설정값 없음');
  await CONFIG_REF.set(update, { merge: true });
  return { ok: true };
}

// ── 묘목 구매 (물약상점) ──────────────────────────────────────────────────────
async function buySeedling(uid, { shopId, qty = 1 }) {
  if (!shopId) throw new HttpsError('invalid-argument', 'shopId is required.');
  const n = Math.max(1, Math.floor(qty));
  const cfg = await getConfig();
  const totalCost = cfg.seedlingPriceGp * n;

  const [shopSnap, player] = await Promise.all([
    db.collection('game_shops').doc(shopId).get(),
    _validateGps(uid),
  ]);
  if (!shopSnap.exists) throw new HttpsError('not-found', 'Shop not found.');
  const shop = shopSnap.data();
  const shopType = shop.type?.replace(/^shop_/, '') ?? shop.type;
  if (shopType !== 'potion') throw new HttpsError('failed-precondition', 'Seedlings can only be purchased at a Potion Shop.');
  const dist = haversineM(player.lat, player.lng, shop.lat, shop.lng);
  if (dist > 5000) throw new HttpsError('failed-precondition', `You are too far from the shop (${Math.round(dist)}m). Move within 5 km.`);

  const ownerUid = shop.ownerUid;
  const ownerShare = Math.floor(totalCost * cfg.shopOwnerCommissionSeedling);

  await db.runTransaction(async (tx) => {
    const pRef = db.collection('battle_players').doc(uid);
    const pSnap = await tx.get(pRef);
    const gold = pSnap.data()?.gold ?? 0;
    if (gold < totalCost) throw new HttpsError('failed-precondition', `Not enough GP (have ${gold}, need ${totalCost}).`);
    const now = admin.firestore.FieldValue.serverTimestamp();
    tx.update(pRef, { gold: gold - totalCost, seedlings: admin.firestore.FieldValue.increment(n), updatedAt: now });
    if (ownerUid && ownerUid !== uid) {
      tx.update(db.collection('battle_players').doc(ownerUid), {
        gold: admin.firestore.FieldValue.increment(ownerShare), updatedAt: now,
      });
    }
    tx.set(db.collection('game_shops').doc(shopId), {
      seedlingRevenue: admin.firestore.FieldValue.increment(ownerShare),
      seedlingCount:   admin.firestore.FieldValue.increment(n),
    }, { merge: true });
  });

  await _log('buy_seedling', { uid, shopId, qty: n, totalCost, ownerShare, ownerUid });
  return { ok: true, qty: n, cost: totalCost };
}

// ── 영양제 구매 (물약상점) ────────────────────────────────────────────────────
async function buyTreeBooster(uid, { shopId, qty = 1 }) {
  if (!shopId) throw new HttpsError('invalid-argument', 'shopId is required.');
  const n = Math.max(1, Math.floor(qty));
  const cfg = await getConfig();
  const totalCost = cfg.boosterPriceGp * n;

  const [shopSnap, player] = await Promise.all([
    db.collection('game_shops').doc(shopId).get(),
    _validateGps(uid),
  ]);
  if (!shopSnap.exists) throw new HttpsError('not-found', 'Shop not found.');
  const shop = shopSnap.data();
  const shopType = shop.type?.replace(/^shop_/, '') ?? shop.type;
  if (shopType !== 'potion') throw new HttpsError('failed-precondition', 'Boosters can only be purchased at a Potion Shop.');
  const dist = haversineM(player.lat, player.lng, shop.lat, shop.lng);
  if (dist > 5000) throw new HttpsError('failed-precondition', `You are too far from the shop (${Math.round(dist)}m). Move within 5 km.`);

  const ownerUid = shop.ownerUid;
  const ownerShare = Math.floor(totalCost * cfg.shopOwnerCommissionBooster);

  await db.runTransaction(async (tx) => {
    const pRef = db.collection('battle_players').doc(uid);
    const pSnap = await tx.get(pRef);
    const gold = pSnap.data()?.gold ?? 0;
    if (gold < totalCost) throw new HttpsError('failed-precondition', `Not enough GP (have ${gold}, need ${totalCost}).`);
    const now = admin.firestore.FieldValue.serverTimestamp();
    tx.update(pRef, { gold: gold - totalCost, treeBoosters: admin.firestore.FieldValue.increment(n), updatedAt: now });
    if (ownerUid && ownerUid !== uid) {
      tx.update(db.collection('battle_players').doc(ownerUid), {
        gold: admin.firestore.FieldValue.increment(ownerShare), updatedAt: now,
      });
    }
    tx.set(db.collection('game_shops').doc(shopId), {
      boosterRevenue: admin.firestore.FieldValue.increment(ownerShare),
      boosterCount:   admin.firestore.FieldValue.increment(n),
    }, { merge: true });
  });

  await _log('buy_booster', { uid, shopId, qty: n, totalCost, ownerShare, ownerUid });
  return { ok: true, qty: n, cost: totalCost };
}

// ── 묘목 식재 ────────────────────────────────────────────────────────────────
async function plantSeedling(uid, { shopId }) {
  if (!shopId) throw new HttpsError('invalid-argument', 'shopId is required.');

  const [shopSnap, player, cfg] = await Promise.all([
    db.collection('game_shops').doc(shopId).get(),
    _validateGps(uid),
    getConfig(),
  ]);
  if (!shopSnap.exists) throw new HttpsError('not-found', 'Shop not found.');
  const shop = shopSnap.data();
  const dist = haversineM(player.lat, player.lng, shop.lat, shop.lng);
  if (dist > 5000) throw new HttpsError('failed-precondition', `You must be within 5 km of the shop to plant (${Math.round(dist)}m away).`);
  if ((player.seedlings ?? 0) < 1) throw new HttpsError('failed-precondition', 'You have no seedlings.');

  // 10m 이내 나무 존재 여부 확인
  const near = await db.collection('money_trees')
    .where('lat', '>=', player.lat - 0.0002)
    .where('lat', '<=', player.lat + 0.0002)
    .get();
  for (const d of near.docs) {
    const t = d.data();
    if (haversineM(player.lat, player.lng, t.lat, t.lng) < 10)
      throw new HttpsError('failed-precondition', 'There is already a tree within 10 m of this location.');
  }

  // 복권 번호 생성
  const lotteryR = Math.floor(Math.random() * (cfg.lotteryMax - cfg.lotteryMin + 1)) + cfg.lotteryMin;
  const lotteryRef = db.collection('lottery_index').doc(String(lotteryR));
  const lotterySnap = await lotteryRef.get();
  const existingLotteryUid = lotterySnap.exists ? lotterySnap.data().uid : null;
  const lotteryWinnerUid = (existingLotteryUid && existingLotteryUid !== uid) ? existingLotteryUid : null;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const result = await db.runTransaction(async (tx) => {
    const pRef = db.collection('battle_players').doc(uid);
    const cfgSnap = await tx.get(CONFIG_REF);
    const pSnap = await tx.get(pRef);
    const pData = pSnap.data() ?? {};

    if ((pData.seedlings ?? 0) < 1) throw new HttpsError('failed-precondition', 'You have no seedlings.');

    const cfgData = { ...DEFAULTS, ...(cfgSnap.exists ? cfgSnap.data() : {}) };
    const newCounter = (cfgData.globalPlantCounter ?? 0) + 1;
    const treeId = `tree_${newCounter}`;
    const newTotalPlants = (pData.totalPlantsCount ?? 0) + 1;
    const ticketBonus = newTotalPlants % cfg.harvestTicketThreshold === 0 ? 1 : 0;
    const assignedLottery = lotteryWinnerUid ? null : lotteryR;

    tx.update(pRef, {
      seedlings: admin.firestore.FieldValue.increment(-1),
      totalPlantsCount: admin.firestore.FieldValue.increment(1),
      harvestTickets: admin.firestore.FieldValue.increment(ticketBonus),
      updatedAt: now,
    });
    tx.set(CONFIG_REF, { globalPlantCounter: newCounter }, { merge: true });
    tx.set(db.collection('money_trees').doc(treeId), {
      treeId, ownerUid: uid, plantedAt: now,
      baseCounter: newCounter - 1,
      lat: player.lat, lng: player.lng,
      shopId, boostTotal: 0,
      lotteryNumber: assignedLottery,
    });

    if (lotteryWinnerUid) {
      tx.update(db.collection('battle_players').doc(lotteryWinnerUid), {
        harvestTickets: admin.firestore.FieldValue.increment(1), updatedAt: now,
      });
      tx.delete(lotteryRef);
    } else {
      tx.set(lotteryRef, { uid, createdAt: now });
    }

    return { treeId, ticketBonus, assignedLottery };
  });

  await _log('plant_seedling', {
    uid, shopId, treeId: result.treeId, lat: player.lat, lng: player.lng,
    lotteryR, lotteryWinnerUid, ticketBonus: result.ticketBonus,
  });
  return {
    ok: true, treeId: result.treeId,
    lotteryNumber: result.assignedLottery,
    ticketGranted: result.ticketBonus > 0,
    lotteryTriggeredWin: !!lotteryWinnerUid,
  };
}

// ── 영양제 사용 (슬롯머신) ────────────────────────────────────────────────────
async function useTreeBooster(uid, { treeId }) {
  if (!treeId) throw new HttpsError('invalid-argument', 'treeId is required.');
  const cfg = await getConfig();

  const [treeSnap, player] = await Promise.all([
    db.collection('money_trees').doc(treeId).get(),
    _validateGps(uid),
  ]);
  if (!treeSnap.exists) throw new HttpsError('not-found', 'Tree not found.');
  const tree = treeSnap.data();
  if (tree.ownerUid !== uid) throw new HttpsError('permission-denied', 'You can only use boosters on your own trees.');
  const dist = haversineM(player.lat, player.lng, tree.lat, tree.lng);
  if (dist > 50) throw new HttpsError('failed-precondition', `You must be within 50 m of the tree to use a booster (${Math.round(dist)}m away).`);

  const boostResult = Math.floor(Math.random() * (cfg.boosterMax - cfg.boosterMin + 1)) + cfg.boosterMin;
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const pRef = db.collection('battle_players').doc(uid);
    const pSnap = await tx.get(pRef);
    if ((pSnap.data()?.treeBoosters ?? 0) < 1)
      throw new HttpsError('failed-precondition', 'You have no boosters.');
    tx.update(pRef, { treeBoosters: admin.firestore.FieldValue.increment(-1), updatedAt: now });
    tx.update(db.collection('money_trees').doc(treeId), {
      boostTotal: admin.firestore.FieldValue.increment(boostResult), updatedAt: now,
    });
  });

  await _log('use_booster', { uid, treeId, boostResult });
  return { ok: true, boostResult };
}

// ── 나무 수확 ────────────────────────────────────────────────────────────────
async function harvestTree(uid, { treeId }) {
  if (!treeId) throw new HttpsError('invalid-argument', 'treeId is required.');

  const [treeSnap, player, cfgSnap] = await Promise.all([
    db.collection('money_trees').doc(treeId).get(),
    _validateGps(uid),
    CONFIG_REF.get(),
  ]);
  if (!treeSnap.exists) throw new HttpsError('not-found', 'Tree not found.');
  const tree = treeSnap.data();
  if (tree.ownerUid !== uid) throw new HttpsError('permission-denied', 'You can only harvest your own trees.');
  const cfg  = { ...DEFAULTS, ...(cfgSnap.exists ? cfgSnap.data() : {}) };

  const dist = haversineM(player.lat, player.lng, tree.lat, tree.lng);
  if (dist > 50) throw new HttpsError('failed-precondition', `You must be within 50 m of the tree to harvest (${Math.round(dist)}m away).`);
  if ((player.harvestTickets ?? 0) < 1) throw new HttpsError('failed-precondition', 'You have no harvest tickets.');

  const treeValue = calcTreeValue(cfg.globalPlantCounter, tree.baseCounter, cfg.growthRate, cfg.maxTreeValue, tree.boostTotal);
  if (treeValue <= 0) throw new HttpsError('failed-precondition', 'This tree has no value yet. Wait for other players to plant nearby.');

  const tax            = Math.floor(treeValue * cfg.harvestTaxRate);
  const harvesterGp    = treeValue - tax;
  const shopSnap       = await db.collection('game_shops').doc(tree.shopId).get();
  const shopOwnerUid   = shopSnap.exists ? shopSnap.data().ownerUid : null;
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const pRef = db.collection('battle_players').doc(uid);
    const pSnap = await tx.get(pRef);
    if ((pSnap.data()?.harvestTickets ?? 0) < 1)
      throw new HttpsError('failed-precondition', '수확권이 없습니다');
    tx.update(pRef, {
      gold: admin.firestore.FieldValue.increment(harvesterGp),
      harvestTickets: admin.firestore.FieldValue.increment(-1),
      updatedAt: now,
    });
    if (shopOwnerUid && tax > 0) {
      tx.update(db.collection('battle_players').doc(shopOwnerUid), {
        gold: admin.firestore.FieldValue.increment(tax), updatedAt: now,
      });
    }
    tx.delete(db.collection('money_trees').doc(treeId));
    if (tree.lotteryNumber != null) {
      tx.delete(db.collection('lottery_index').doc(String(tree.lotteryNumber)));
    }
  });

  await _log('harvest', { uid, treeId, treeValue, harvesterGp, tax, shopOwnerUid, shopId: tree.shopId });
  return { ok: true, amount: harvesterGp, tax, treeValue };
}

// ── 주변 나무 조회 (지도용) ──────────────────────────────────────────────────
async function getNearbyTrees(uid, { lat, lng, radiusKm = 5 }) {
  const delta = radiusKm / 111;
  const [treeSnap, cfgSnap] = await Promise.all([
    db.collection('money_trees')
      .where('lat', '>=', lat - delta)
      .where('lat', '<=', lat + delta)
      .limit(100)
      .get(),
    CONFIG_REF.get(),
  ]);
  const cfg = { ...DEFAULTS, ...(cfgSnap.exists ? cfgSnap.data() : {}) };
  const trees = treeSnap.docs
    .map(d => {
      const t = d.data();
      if (haversineM(lat, lng, t.lat, t.lng) > radiusKm * 1000) return null;
      const value = calcTreeValue(cfg.globalPlantCounter, t.baseCounter, cfg.growthRate, cfg.maxTreeValue, t.boostTotal);
      return {
        treeId: t.treeId, ownerUid: t.ownerUid,
        lat: t.lat, lng: t.lng, shopId: t.shopId,
        value, imageNum: treeImageNum(value),
        isOwn: t.ownerUid === uid,
      };
    })
    .filter(Boolean);
  return { trees };
}

// ── 내 나무 목록 ──────────────────────────────────────────────────────────────
async function getMyTrees(uid) {
  const [treeSnap, cfgSnap] = await Promise.all([
    db.collection('money_trees').where('ownerUid', '==', uid).limit(50).get(),
    CONFIG_REF.get(),
  ]);
  const cfg = { ...DEFAULTS, ...(cfgSnap.exists ? cfgSnap.data() : {}) };
  const trees = treeSnap.docs.map(d => {
    const t = d.data();
    const value = calcTreeValue(cfg.globalPlantCounter, t.baseCounter, cfg.growthRate, cfg.maxTreeValue, t.boostTotal);
    return {
      treeId: t.treeId, lat: t.lat, lng: t.lng, shopId: t.shopId,
      boostTotal: t.boostTotal, lotteryNumber: t.lotteryNumber,
      value, imageNum: treeImageNum(value),
      plantedAt: t.plantedAt,
    };
  });
  return { trees };
}

// ── 인벤토리 조회 ────────────────────────────────────────────────────────────
async function getMyInventory(uid) {
  const [pSnap, lotterySnap] = await Promise.all([
    db.collection('battle_players').doc(uid).get(),
    db.collection('lottery_index').where('uid', '==', uid).get(),
  ]);
  const d = pSnap.exists ? pSnap.data() : {};
  return {
    seedlings:        d.seedlings        ?? 0,
    harvestTickets:   d.harvestTickets   ?? 0,
    treeBoosters:     d.treeBoosters     ?? 0,
    totalPlantsCount: d.totalPlantsCount ?? 0,
    lotteryNumbers:   lotterySnap.docs.map(x => Number(x.id)),
  };
}

// ── 몬스터 드롭 (게임서버 내부 호출) ─────────────────────────────────────────
async function grantSeedlingDrop(uid, { monsterType }) {
  const dropTypes = ['troll', 'dragon'];
  if (!dropTypes.includes(monsterType)) return { dropped: false };
  const cfg = await getConfig();
  if (Math.random() >= cfg.trollDropRate) return { dropped: false };
  await db.collection('battle_players').doc(uid).update({
    seedlings: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await _log('drop_seedling', { uid, monsterType });
  return { dropped: true };
}

// ── 관리자 통계 ───────────────────────────────────────────────────────────────
async function adminGetMoneyTreeStats(uid) {
  await requireAdmin(uid);
  const [cfgSnap, treesCount, logsSnap] = await Promise.all([
    CONFIG_REF.get(),
    db.collection('money_trees').count().get(),
    db.collection('money_tree_logs').orderBy('createdAt', 'desc').limit(30).get(),
  ]);
  const cfg = { ...DEFAULTS, ...(cfgSnap.exists ? cfgSnap.data() : {}) };
  return {
    config: cfg,
    totalTrees: treesCount.data().count,
    recentLogs: logsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
  };
}

module.exports = {
  getMoneyTreeConfig,
  adminSetMoneyTreeConfig,
  buySeedling,
  buyTreeBooster,
  plantSeedling,
  useTreeBooster,
  harvestTree,
  getNearbyTrees,
  getMyTrees,
  getMyInventory,
  grantSeedlingDrop,
  adminGetMoneyTreeStats,
};
