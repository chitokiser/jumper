'use strict';

const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');
const { requireAdmin } = require('../wallet/admin');
const { logger } = require('firebase-functions');

const db = admin.firestore();

const DEFAULT_INSTALL_COST = 100000;
const DEFAULT_MINER_COST   = 10000;
const MAX_MINERS            = 100;
const MINE_RADIUS_M         = 5000;
const GOLD_PER_MINER_MIN    = 0.1;

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcEfficiency(distM) {
  return 1 + Math.max(0, (5000 - distM) / 5000);
}

async function getConfig() {
  const snap = await db.collection('game_config').doc('gold_mine').get();
  const d = snap.exists ? snap.data() : {};
  return {
    installCost: d.installCost ?? DEFAULT_INSTALL_COST,
    minerCost:   d.minerCost   ?? DEFAULT_MINER_COST,
  };
}

// ── 금광 설치 ──────────────────────────────────────────────────────────────────
async function createGoldMine(uid, { storeId, lat, lng }) {
  if (!storeId) throw new HttpsError('invalid-argument', 'storeId is required');
  if (lat == null || lng == null) throw new HttpsError('invalid-argument', 'lat and lng are required');

  const [shopSnap, playerSnap, cfg] = await Promise.all([
    db.collection('game_shops').doc(storeId).get(),
    db.collection('battle_players').doc(uid).get(),
    getConfig(),
  ]);

  if (!shopSnap.exists) throw new HttpsError('not-found', 'Shop not found');
  const shop = shopSnap.data();
  if (shop.ownerUid !== uid) throw new HttpsError('permission-denied', 'You do not own this shop');
  if (shop.lat != null && shop.lng != null) {
    const distToShop = haversineM(lat, lng, shop.lat, shop.lng);
    if (distToShop > MINE_RADIUS_M) {
      throw new HttpsError('failed-precondition',
        `Gold mine must be within 5km of your shop (${Math.round(distToShop / 100) / 10}km away)`);
    }
  }

  const playerGold = playerSnap.exists ? (playerSnap.data().gold ?? 0) : 0;
  if (playerGold < cfg.installCost) {
    throw new HttpsError('failed-precondition',
      `Not enough GP. Need ${cfg.installCost.toLocaleString()}, have ${playerGold.toLocaleString()}`);
  }

  const totalGold = Math.floor(10000 + Math.random() * (10000000 - 10000));
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();

  batch.update(db.collection('battle_players').doc(uid), {
    gold: admin.firestore.FieldValue.increment(-cfg.installCost),
    updatedAt: now,
  });

  const mineRef = db.collection('gold_mines').doc();
  batch.set(mineRef, {
    owner_id: uid,
    store_id: storeId,
    store_lat: shop.lat,
    store_lng: shop.lng,
    lat,
    lng,
    miners_count:     0,
    total_gold:       totalGold,
    remain_gold:      totalGold,
    status:           'active',
    deposit_revealed: false,
    created_at:       now,
    last_processed_at: now,
  });

  await batch.commit();
  return { ok: true, mineId: mineRef.id, installCost: cfg.installCost };
}

// ── 광부 배치 ──────────────────────────────────────────────────────────────────
async function addMiners(uid, { mineId, count }) {
  if (!mineId) throw new HttpsError('invalid-argument', 'mineId is required');
  const n = Math.floor(Number(count));
  if (!n || n < 1) throw new HttpsError('invalid-argument', 'count must be >= 1');

  const [mineSnap, playerSnap, cfg] = await Promise.all([
    db.collection('gold_mines').doc(mineId).get(),
    db.collection('battle_players').doc(uid).get(),
    getConfig(),
  ]);

  if (!mineSnap.exists) throw new HttpsError('not-found', 'Gold mine not found');
  const mine = mineSnap.data();
  if (mine.owner_id !== uid) throw new HttpsError('permission-denied', 'You do not own this mine');
  if (mine.status !== 'active') throw new HttpsError('failed-precondition', 'Mine is depleted');

  const current   = mine.miners_count ?? 0;
  const available = MAX_MINERS - current;
  if (available <= 0) throw new HttpsError('failed-precondition', `Mine is at max capacity (${MAX_MINERS})`);

  const adding    = Math.min(n, available);
  const totalCost = adding * cfg.minerCost;

  const playerGold = playerSnap.exists ? (playerSnap.data().gold ?? 0) : 0;
  if (playerGold < totalCost) {
    throw new HttpsError('failed-precondition',
      `Not enough GP. Need ${totalCost.toLocaleString()}, have ${playerGold.toLocaleString()}`);
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();

  batch.update(db.collection('battle_players').doc(uid), {
    gold: admin.firestore.FieldValue.increment(-totalCost),
    updatedAt: now,
  });

  const mineUpdate = {
    miners_count: current + adding,
    updatedAt: now,
  };
  if (!mine.deposit_revealed) mineUpdate.deposit_revealed = true;
  batch.update(db.collection('gold_mines').doc(mineId), mineUpdate);

  await batch.commit();
  return {
    ok: true,
    added: adding,
    miners_count: current + adding,
    totalCost,
    deposit: mine.total_gold,
  };
}

// ── 내 금광 목록 ───────────────────────────────────────────────────────────────
async function getMyMines(uid) {
  const [snap, cfg] = await Promise.all([
    db.collection('gold_mines')
      .where('owner_id', '==', uid)
      .orderBy('created_at', 'desc')
      .get(),
    getConfig(),
  ]);
  const mines = snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      owner_id:  data.owner_id,
      store_id:  data.store_id,
      lat:       data.lat,
      lng:       data.lng,
      store_lat: data.store_lat,
      store_lng: data.store_lng,
      miners_count:     data.miners_count ?? 0,
      total_gold:       data.deposit_revealed ? data.total_gold : null,
      remain_gold:      data.deposit_revealed ? data.remain_gold : null,
      status:           data.status,
      deposit_revealed: data.deposit_revealed ?? false,
      created_at: data.created_at?.toDate?.()?.toISOString?.() ?? null,
      last_processed_at: data.last_processed_at?.toDate?.()?.toISOString?.() ?? null,
    };
  });
  return { mines, config: cfg };
}

// ── 주변 금광 목록 (지도용) ────────────────────────────────────────────────────
async function getNearbyMines(uid, { lat, lng, radiusKm = 20 }) {
  const snap = await db.collection('gold_mines').where('status', '==', 'active').get();
  const radiusM = radiusKm * 1000;
  const mines = [];
  for (const d of snap.docs) {
    const data = d.data();
    if (data.lat == null || data.lng == null) continue;
    const dist = haversineM(lat, lng, data.lat, data.lng);
    if (dist > radiusM) continue;
    const isOwner = data.owner_id === uid;
    const shopDistM = (data.store_lat != null && data.store_lng != null)
      ? Math.round(haversineM(data.lat, data.lng, data.store_lat, data.store_lng))
      : null;
    mines.push({
      id:          d.id,
      owner_id:    data.owner_id,
      store_id:    data.store_id,
      lat:         data.lat,
      lng:         data.lng,
      miners_count:     data.miners_count ?? 0,
      status:           data.status,
      deposit_revealed: data.deposit_revealed ?? false,
      total_gold:  (isOwner || data.deposit_revealed) ? data.total_gold  : null,
      remain_gold: (isOwner || data.deposit_revealed) ? data.remain_gold : null,
      isOwner,
      distM:     Math.round(dist),
      shopDistM,
    });
  }
  return { mines };
}

// ── 관리자: 전체 금광 조회 ─────────────────────────────────────────────────────
async function adminGetMines(uid) {
  await requireAdmin(uid);
  const snap = await db.collection('gold_mines').orderBy('created_at', 'desc').limit(200).get();
  return { mines: snap.docs.map(d => ({ id: d.id, ...d.data() })) };
}

// ── 관리자: 설정 변경 ──────────────────────────────────────────────────────────
async function adminSetGoldMineConfig(uid, { installCost, minerCost }) {
  await requireAdmin(uid);
  const update = {};
  if (installCost != null) update.installCost = Math.max(0, Math.floor(Number(installCost)));
  if (minerCost   != null) update.minerCost   = Math.max(0, Math.floor(Number(minerCost)));
  if (!Object.keys(update).length) throw new HttpsError('invalid-argument', 'Nothing to update');
  await db.collection('game_config').doc('gold_mine').set(update, { merge: true });
  return { ok: true, ...update };
}

// ── 스케줄: 1분마다 채굴 처리 ─────────────────────────────────────────────────
async function processGoldMines() {
  const snap = await db.collection('gold_mines').where('status', '==', 'active').get();
  if (snap.empty) return { processed: 0 };

  const BATCH_LIMIT = 400;
  let batch    = db.batch();
  let opCount  = 0;
  let processed = 0;
  const now = admin.firestore.FieldValue.serverTimestamp();

  async function flush() {
    if (opCount === 0) return;
    await batch.commit();
    batch   = db.batch();
    opCount = 0;
  }

  for (const doc of snap.docs) {
    const data = doc.data();
    const miners = data.miners_count ?? 0;
    if (miners <= 0) continue;

    const distM      = haversineM(data.lat, data.lng, data.store_lat, data.store_lng);
    const efficiency = calcEfficiency(distM);
    const produced   = miners * GOLD_PER_MINER_MIN * efficiency;
    const remain     = data.remain_gold ?? 0;
    const mined      = Math.min(produced, remain);
    if (mined <= 0) continue;

    const newRemain = remain - mined;
    const depleted  = newRemain <= 0;

    const mineUpdate = {
      remain_gold:       depleted ? 0 : newRemain,
      status:            depleted ? 'depleted' : 'active',
      last_processed_at: now,
    };
    if (depleted) mineUpdate.miners_count = 0;
    batch.update(doc.ref, mineUpdate);
    opCount++;

    const ownerRef = db.collection('battle_players').doc(data.owner_id);
    batch.set(ownerRef, {
      gold:      admin.firestore.FieldValue.increment(Math.floor(mined)),
      updatedAt: now,
    }, { merge: true });
    opCount++;

    processed++;
    if (opCount >= BATCH_LIMIT) await flush();
  }

  await flush();
  logger.info('[processGoldMines] done', { processed });
  return { processed };
}

module.exports = {
  createGoldMine,
  addMiners,
  getMyMines,
  getNearbyMines,
  adminGetMines,
  adminSetGoldMineConfig,
  processGoldMines,
};
