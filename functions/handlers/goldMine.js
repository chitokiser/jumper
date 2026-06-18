'use strict';
// v2
const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');
const { requireAdmin } = require('../wallet/admin');
const { logger } = require('firebase-functions');

const db = admin.firestore();

const DEFAULT_INSTALL_COST  = 100000;
const DEFAULT_MINER_COST    = 10000;
const MAX_MINERS             = 100;
const MAX_MINES_PER_PLAYER   = 10;
const MINE_TAX_RATE          = 0.10;
const MINE_RADIUS_M          = 5000;
const GOLD_PER_MINER_MIN     = 0.01;
const CLAIM_INTERVAL_MS      = 24 * 60 * 60 * 1000;

// Deposit size distribution — biased toward small deposits to reduce profitability
// 5%:10만~50만 | 50%:50만~100만 | 20%:100만~200만 | 10%:200만~400만 | 7%:400만~600만 | 5%:600만~800만 | 3%:800만~1000만
function _rollDeposit() {
  const r = Math.random() * 100;
  if (r < 5)  return Math.floor(100000  + Math.random() * 400000);
  if (r < 55) return Math.floor(500000  + Math.random() * 500000);
  if (r < 75) return Math.floor(1000000 + Math.random() * 1000000);
  if (r < 85) return Math.floor(2000000 + Math.random() * 2000000);
  if (r < 92) return Math.floor(4000000 + Math.random() * 2000000);
  if (r < 97) return Math.floor(6000000 + Math.random() * 2000000);
  return Math.floor(8000000 + Math.random() * 2000000);
}

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
// 포션상점 근처에만 설치 가능, 플레이어당 최대 10개
async function createGoldMine(uid, { storeId }) {
  if (!storeId) throw new HttpsError('invalid-argument', 'storeId is required');

  const [shopSnap, playerSnap, cfg] = await Promise.all([
    db.collection('game_shops').doc(storeId).get(),
    db.collection('battle_players').doc(uid).get(),
    getConfig(),
  ]);

  if (!shopSnap.exists) throw new HttpsError('not-found', 'Shop not found');
  const shop = shopSnap.data();

  // 포션상점 전용
  const shopType = shop.type?.replace(/^shop_/, '') ?? '';
  if (shopType !== 'potion') {
    throw new HttpsError('failed-precondition', 'Gold mines can only be installed near a Potion Shop');
  }

  // 플레이어당 최대 10개
  const myMinesSnap = await db.collection('gold_mines')
    .where('owner_id', '==', uid)
    .where('status', '==', 'active')
    .get();
  if (myMinesSnap.size >= MAX_MINES_PER_PLAYER) {
    throw new HttpsError('failed-precondition',
      `You already have ${MAX_MINES_PER_PLAYER} active gold mines (maximum allowed)`);
  }

  const playerGold = playerSnap.exists ? (playerSnap.data().gold ?? 0) : 0;
  if (playerGold < cfg.installCost) {
    throw new HttpsError('failed-precondition',
      `Not enough GP. Need ${cfg.installCost.toLocaleString()}, have ${playerGold.toLocaleString()}`);
  }

  const storeLat    = typeof shop.lat === 'number' ? shop.lat : null;
  const storeLng    = typeof shop.lng === 'number' ? shop.lng : null;
  const shopOwnerId = shop.ownerUid ?? null;

  const totalGold = _rollDeposit();
  const nowTs = admin.firestore.Timestamp.fromMillis(Date.now());
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();

  batch.update(db.collection('battle_players').doc(uid), {
    gold: admin.firestore.FieldValue.increment(-cfg.installCost),
    updatedAt: now,
  });

  const mineRef = db.collection('gold_mines').doc();
  batch.set(mineRef, {
    owner_id:      uid,
    store_id:      storeId,
    shop_owner_id: shopOwnerId,
    store_lat:     storeLat,
    store_lng:     storeLng,
    lat:           storeLat,
    lng:           storeLng,
    miners_count:     0,
    total_gold:       totalGold,
    remain_gold:      totalGold,
    pending_gold:     0,
    status:           'active',
    deposit_revealed: false,
    created_at:       now,
    last_processed_at: now,
    last_claimed_at:  nowTs,
  });

  await batch.commit();
  return {
    ok: true,
    mineId:      mineRef.id,
    installCost: cfg.installCost,
    lat:         storeLat,
    lng:         storeLng,
    taxRate:     MINE_TAX_RATE,
  };
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
      pending_gold:     data.pending_gold ?? 0,
      last_claimed_at:  data.last_claimed_at?.toMillis?.() ?? 0,
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
      store_lat:   data.store_lat ?? data.lat,
      store_lng:   data.store_lng ?? data.lng,
      miners_count:     data.miners_count ?? 0,
      status:           data.status,
      deposit_revealed: data.deposit_revealed ?? false,
      total_gold:  (isOwner || data.deposit_revealed) ? data.total_gold  : null,
      remain_gold: (isOwner || data.deposit_revealed) ? data.remain_gold : null,
      pending_gold:    isOwner ? (data.pending_gold ?? 0) : null,
      last_claimed_at: isOwner ? (data.last_claimed_at?.toMillis?.() ?? 0) : null,
      isOwner,
      distM:     Math.round(dist),
      shopDistM,
    });
  }
  return { mines };
}

// ── 채굴 수익 수령 ─────────────────────────────────────────────────────────────
async function claimGoldMine(uid, { mineId }) {
  if (!mineId) throw new HttpsError('invalid-argument', 'mineId is required');
  const mineRef = db.collection('gold_mines').doc(mineId);
  return await db.runTransaction(async tx => {
    const snap = await tx.get(mineRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Mine not found');
    const mine = snap.data();
    if (mine.owner_id !== uid) throw new HttpsError('permission-denied', 'Not your mine');
    const lastMs = mine.last_claimed_at?.toMillis?.() ?? 0;
    const nowMs  = Date.now();
    if ((nowMs - lastMs) < CLAIM_INTERVAL_MS) {
      const hoursLeft = Math.ceil((lastMs + CLAIM_INTERVAL_MS - nowMs) / 3600000);
      throw new HttpsError('failed-precondition', `Next claim available in ${hoursLeft}h`);
    }
    const pending = Math.floor(mine.pending_gold ?? 0);
    if (pending <= 0) throw new HttpsError('failed-precondition', 'No gold accumulated yet');
    const playerRef = db.collection('battle_players').doc(uid);
    tx.update(mineRef, {
      pending_gold:    0,
      last_claimed_at: admin.firestore.Timestamp.fromMillis(nowMs),
    });
    tx.update(playerRef, {
      gold:      admin.firestore.FieldValue.increment(pending),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { claimed: pending };
  });
}

// ── 소유권 양도 ────────────────────────────────────────────────────────────────
async function transferGoldMine(uid, { mineId, toUid }) {
  if (!mineId) throw new HttpsError('invalid-argument', 'mineId is required');
  if (!toUid)  throw new HttpsError('invalid-argument', 'toUid is required');
  if (toUid === uid) throw new HttpsError('invalid-argument', 'Cannot transfer to yourself');

  const [mineSnap, targetSnap] = await Promise.all([
    db.collection('gold_mines').doc(mineId).get(),
    db.collection('battle_players').doc(toUid).get(),
  ]);

  if (!mineSnap.exists) throw new HttpsError('not-found', 'Mine not found');
  const mine = mineSnap.data();
  if (mine.owner_id !== uid) throw new HttpsError('permission-denied', 'You do not own this mine');
  if (!targetSnap.exists) throw new HttpsError('not-found', 'Recipient player not found');

  const targetData = targetSnap.data();
  const displayName = targetData.displayName ?? targetData.nickname ?? toUid;

  await db.collection('gold_mines').doc(mineId).update({
    owner_id:  toUid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true, newOwner: toUid, displayName };
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
// 채굴량의 10%는 상점 주인에게 즉시 입금, 90%는 mine owner의 pending_gold
async function processGoldMines() {
  const snap = await db.collection('gold_mines').where('status', '==', 'active').get();
  if (snap.empty) return { processed: 0 };

  const BATCH_LIMIT = 400;
  let batch    = db.batch();
  let opCount  = 0;
  let processed = 0;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const taxAccum = {}; // shopOwnerId → accumulated tax GP

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
    const produced   = miners * GOLD_PER_MINER_MIN * 5 * efficiency;
    const remain     = data.remain_gold ?? 0;
    const mined      = Math.min(produced, remain);
    if (mined <= 0) continue;

    const newRemain  = remain - mined;
    const depleted   = newRemain <= 0;
    const totalMined = Math.floor(mined);
    const taxAmount  = Math.floor(totalMined * MINE_TAX_RATE);
    const ownerNet   = totalMined - taxAmount;

    const mineUpdate = {
      remain_gold:       depleted ? 0 : newRemain,
      status:            depleted ? 'depleted' : 'active',
      last_processed_at: now,
      pending_gold:      admin.firestore.FieldValue.increment(ownerNet),
      total_earned:      admin.firestore.FieldValue.increment(totalMined),
    };
    if (depleted) mineUpdate.miners_count = 0;
    batch.update(doc.ref, mineUpdate);
    opCount++;

    // 세금 적립 (mine owner와 다른 경우만)
    const shopOwnerId = data.shop_owner_id;
    if (shopOwnerId && shopOwnerId !== data.owner_id && taxAmount > 0) {
      taxAccum[shopOwnerId] = (taxAccum[shopOwnerId] ?? 0) + taxAmount;
    }

    processed++;
    if (opCount >= BATCH_LIMIT) await flush();
  }

  await flush();

  // 상점 주인에게 세금 일괄 입금
  const taxOwners = Object.keys(taxAccum);
  if (taxOwners.length > 0) {
    const taxBatch = db.batch();
    for (const ownerId of taxOwners) {
      taxBatch.update(db.collection('battle_players').doc(ownerId), {
        gold:      admin.firestore.FieldValue.increment(taxAccum[ownerId]),
        updatedAt: now,
      });
    }
    await taxBatch.commit();
  }

  logger.info('[processGoldMines] done', { processed, taxOwners: taxOwners.length });
  return { processed };
}

module.exports = {
  createGoldMine,
  addMiners,
  claimGoldMine,
  transferGoldMine,
  getMyMines,
  getNearbyMines,
  adminGetMines,
  adminSetGoldMineConfig,
  processGoldMines,
};
