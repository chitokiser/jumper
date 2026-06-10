// functions/handlers/shop.js
// 게임 내 상점 시스템 (소유/공격/점령/레벨업/양도)
'use strict';

const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');
const { requireAdmin } = require('../wallet/admin');

const db = admin.firestore();

const VALID_TYPES         = ['weapon_armor', 'potion', 'misc'];
const BASE_HP_PER_LEVEL   = 10000;
const BASE_ATK            = 100;
const ATTACK_COOLDOWN_SEC = 5;

function weaponBonus(weaponId) {
  if (!weaponId) return 0;
  const m = String(weaponId).match(/^weapon_(\d+)$/);
  return m ? Number(m[1]) : 0;
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function isAdmin(uid) {
  return requireAdmin(uid).then(() => true).catch(() => false);
}

// ── 관리자: 상점 생성/수정 ────────────────────────────────────────────────────
const _TYPE_NORMALIZE = { shop_weapon_armor: 'weapon_armor', shop_potion: 'potion', shop_misc: 'misc' };

async function adminSaveShop(uid, data = {}) {
  await requireAdmin(uid);

  const {
    shopId, name, items = [],
    active = true, ownerUid, imageUrl = '',
    level: inputLevel = 1,
  } = data;
  // Normalize user-placed shop types ('shop_potion' → 'potion')
  const type = _TYPE_NORMALIZE[data.type] || data.type;
  let   lat  = data.lat;
  let   lng  = data.lng;

  if (!name || typeof name !== 'string' || !name.trim())
    throw new HttpsError('invalid-argument', 'Shop name is required');
  if (!VALID_TYPES.includes(type))
    throw new HttpsError('invalid-argument', `type must be one of: ${VALID_TYPES.join('|')}`);

  // If editing an existing shop and lat/lng not supplied, read them from Firestore
  if (shopId && (lat == null || lng == null)) {
    const existing = await db.collection('game_shops').doc(shopId).get();
    if (existing.exists) { lat = existing.data().lat; lng = existing.data().lng; }
  }
  if (lat == null || lng == null || typeof lat !== 'number' || typeof lng !== 'number')
    throw new HttpsError('invalid-argument', 'Location coordinates (lat/lng) are required');
  if (!Array.isArray(items))
    throw new HttpsError('invalid-argument', 'items는 배열이어야 합니다');

  for (const item of items) {
    if (!item.itemId || typeof item.itemId !== 'string')
      throw new HttpsError('invalid-argument', '각 아이템에 itemId가 필요합니다');
    if (!item.name || typeof item.name !== 'string')
      throw new HttpsError('invalid-argument', '각 아이템에 name이 필요합니다');
    if (typeof item.price !== 'number' || item.price < 0)
      throw new HttpsError('invalid-argument', '각 아이템에 price(>= 0)가 필요합니다');
    if (item.stock !== undefined && typeof item.stock !== 'number')
      throw new HttpsError('invalid-argument', 'stock은 숫자여야 합니다 (-1: 무제한)');
  }

  const finalOwnerUid = (ownerUid && String(ownerUid).trim()) ? ownerUid.trim() : uid;
  const level = Math.max(1, Math.floor(Number(inputLevel) || 1));
  const maxHp = level * BASE_HP_PER_LEVEL;
  const now   = admin.firestore.FieldValue.serverTimestamp();

  const payload = {
    name: name.trim(),
    type,
    lat, lng,
    items: items.map(it => ({
      itemId: it.itemId,
      name:   it.name,
      price:  it.price,
      stock:  it.stock ?? -1,
    })),
    active,
    imageUrl,
    ownerUid: finalOwnerUid,
    level,
    maxHp,
    updatedAt: now,
  };

  // 5km 반경 내 동일 카테고리 중복 검사 (신규 배치 or 위치 변경 시)
  const nearby = await db.collection('game_shops')
    .where('active', '==', true)
    .where('type', '==', type)
    .get();
  for (const doc of nearby.docs) {
    if (doc.id === shopId) continue; // 자기 자신은 제외
    const s = doc.data();
    if (!s.lat || !s.lng) continue;
    if (haversineM(lat, lng, s.lat, s.lng) <= 5000) {
      throw new HttpsError('already-exists',
        `⛔ A "${type}" shop already exists within 5km: "${s.name}". ` +
        `Only one shop per category is allowed within a 5km radius.`
      );
    }
  }

  let ref;
  if (shopId) {
    ref = db.collection('game_shops').doc(shopId);
    const existing = await ref.get();
    if (!existing.exists) {
      payload.hp        = maxHp;
      payload.createdAt = now;
      await ref.set(payload);
    } else {
      const prev = existing.data();
      // Reset HP when admin changes level
      if ((prev.level ?? 1) !== level) payload.hp = maxHp;
      await ref.update(payload);
    }
  } else {
    payload.hp        = maxHp;
    payload.createdAt = now;
    ref = await db.collection('game_shops').add(payload);
  }

  return { ok: true, shopId: ref.id };
}

// ── 관리자: 상점 삭제 ────────────────────────────────────────────────────────
async function adminDeleteShop(uid, { shopId } = {}) {
  await requireAdmin(uid);
  if (!shopId) throw new HttpsError('invalid-argument', 'shopId가 필요합니다');

  const ref = db.collection('game_shops').doc(shopId);
  if (!(await ref.get()).exists)
    throw new HttpsError('not-found', '상점을 찾을 수 없습니다');

  await ref.delete();
  return { ok: true };
}

// potion_* / revive_* / ticket_mon_* → mentor system (20% owner, 40% SV mentor, 40% system)
// everything else → default 50% owner
function _shopRevenueType(itemId) {
  if (itemId.startsWith('potion_') || itemId.startsWith('revive_')) return 'mentor';
  if (itemId.startsWith('ticket_mon_')) return 'mentor';
  return 'default';
}

// ── 유저: 상점 아이템 구매 ─────────────────────────────────────────────────────
async function buyShopItem(uid, { shopId, itemId, quantity = 1, lat, lng } = {}) {
  if (!shopId) throw new HttpsError('invalid-argument', 'shopId가 필요합니다');
  if (!itemId) throw new HttpsError('invalid-argument', 'itemId가 필요합니다');
  const qty = Math.floor(Number(quantity));
  if (!qty || qty < 1) throw new HttpsError('invalid-argument', 'quantity는 1 이상이어야 합니다');

  const shopSnap = await db.collection('game_shops').doc(shopId).get();
  if (!shopSnap.exists) throw new HttpsError('not-found', '상점을 찾을 수 없습니다');
  const shop = shopSnap.data();
  if (!shop.active) throw new HttpsError('failed-precondition', '현재 이용할 수 없는 상점입니다');

  // 위치: 클라이언트 제공 lat/lng 대신 서버에 저장된 최신 GPS 위치를 사용
  const playerLocSnap = await db.collection('battle_players').doc(uid).get();
  const playerLoc = playerLocSnap.exists ? playerLocSnap.data() : null;
  const storedLat = playerLoc?.lat;
  const storedLng = playerLoc?.lng;
  const locUpdatedAt = playerLoc?.updatedAt?.toMillis?.() ?? null;

  if (storedLat == null || storedLng == null)
    throw new HttpsError('failed-precondition', 'GPS 위치가 확인되지 않습니다. 게임을 시작하고 위치를 활성화하세요.');

  // 위치 데이터 최신성 검증: 10분 초과 시 거부
  if (locUpdatedAt == null || Date.now() - locUpdatedAt > 10 * 60 * 1000)
    throw new HttpsError('failed-precondition', 'GPS 위치 정보가 너무 오래되었습니다. 지도를 열고 위치를 다시 확인하세요.');

  // 1km 거리 제한 (서버 저장 위치 기준)
  if (shop.lat != null && shop.lng != null) {
    const dist = haversineM(storedLat, storedLng, shop.lat, shop.lng);
    if (dist > 1000)
      throw new HttpsError('failed-precondition',
        `상점에서 너무 멀리 있습니다 (${Math.round(dist)}m). 1km 이내에서만 구매할 수 있습니다.`);
  }

  const itemDef = (shop.items || []).find(it => it.itemId === itemId);
  if (!itemDef) throw new HttpsError('not-found', '해당 아이템을 이 상점에서 판매하지 않습니다');
  if (itemDef.stock !== -1 && itemDef.stock < qty)
    throw new HttpsError('failed-precondition', `재고가 부족합니다 (남은 재고: ${itemDef.stock})`);

  const totalCost  = itemDef.price * qty;
  const ownerUid   = shop.ownerUid;
  const sameUser   = !ownerUid || ownerUid === uid;
  const useMentor  = _shopRevenueType(itemId) === 'mentor';
  const ownerShare = Math.round(totalCost * (useMentor ? 0.20 : 0.50));
  const svAmt      = useMentor ? Math.round(totalCost * 0.40) : 0;

  const playerRef = db.collection('battle_players').doc(uid);
  const invRef    = db.collection('treasure_inventory').doc(`${uid}_${itemId}`);
  const shopRef   = db.collection('game_shops').doc(shopId);
  const ownerRef  = sameUser ? null : db.collection('battle_players').doc(ownerUid);
  const now       = admin.firestore.FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const [pSnap, invSnap, ownerSnap] = await Promise.all([
      tx.get(playerRef),
      tx.get(invRef),
      ownerRef ? tx.get(ownerRef) : Promise.resolve(null),
    ]);
    const pData = pSnap.exists ? pSnap.data() : {};
    const currentGold = pData.gold ?? 0;
    if (currentGold < totalCost)
      throw new HttpsError('failed-precondition',
        `골드가 부족합니다 (보유: ${currentGold}, 필요: ${totalCost})`);

    // Mentor system: resolve mentor uid for eligible items
    let mentorUid = null, mentorIsMentor = false, autoAssign = false;
    if (useMentor && svAmt > 0) {
      autoAssign = !pData.mentorUid && ownerUid && ownerUid !== uid;
      mentorUid  = pData.mentorUid ?? (autoAssign ? ownerUid : null);
      if (mentorUid) {
        if (autoAssign) {
          mentorIsMentor = true;
        } else if (mentorUid === ownerUid) {
          mentorIsMentor = (ownerSnap?.data() ?? {}).isMentor ?? false;
        } else if (mentorUid !== uid) {
          mentorIsMentor = (await tx.get(db.collection('battle_players').doc(mentorUid))).data()?.isMentor ?? false;
        }
      }
    }

    // Buyer pays full for mentor items; default items: owner rebate when same user
    const netCost     = (!useMentor && sameUser) ? totalCost - ownerShare : totalCost;
    const playerWrite = { gold: currentGold - netCost, updatedAt: now };
    if (autoAssign) playerWrite.mentorUid = ownerUid;
    if (pSnap.exists) tx.update(playerRef, playerWrite);
    else tx.set(playerRef, { uid, token: 30, hp: 1000, mp: 1000, level: 1, gold: 0, ...playerWrite });

    // Inventory
    const currentCount = invSnap.exists ? (invSnap.data().count ?? 0) : 0;
    tx.set(invRef, { uid, itemId, count: currentCount + qty, updatedAt: now }, { merge: true });

    // Owner share
    if (ownerRef && ownerShare > 0) {
      const ownerGold  = ownerSnap?.exists ? (ownerSnap.data().gold ?? 0) : 0;
      const ownerWrite = { gold: ownerGold + ownerShare, updatedAt: now };
      if (autoAssign) ownerWrite.isMentor = true;
      if (useMentor && mentorUid === ownerUid && mentorIsMentor && svAmt > 0)
        ownerWrite.sv = admin.firestore.FieldValue.increment(svAmt);
      if (ownerSnap?.exists)
        tx.update(ownerRef, ownerWrite);
      else
        tx.set(ownerRef, { uid: ownerUid, token: 30, hp: 1000, mp: 1000, level: 1, ...ownerWrite });
    }

    // Mentor SV when mentor is separate from owner
    if (useMentor && mentorUid && mentorUid !== ownerUid && mentorUid !== uid && mentorIsMentor && svAmt > 0) {
      tx.update(db.collection('battle_players').doc(mentorUid), {
        sv: admin.firestore.FieldValue.increment(svAmt), updatedAt: now,
      });
    }

    // Sales log
    const salesRef = db.collection('shop_sales_logs').doc();
    tx.set(salesRef, {
      shopId, itemId,
      itemName: itemDef.name || itemId,
      qty, totalCost, ownerShare, svAmt,
      buyerUid: uid, ownerUid: ownerUid || null,
      mentorUid: mentorUid || null,
      createdAt: now,
    });

    // Aggregate stats + optional stock update (single write to shopRef)
    const shopUpdate = {
      totalRevenue: admin.firestore.FieldValue.increment(ownerShare),
      totalSales:   admin.firestore.FieldValue.increment(qty),
    };
    if (itemDef.stock !== -1) {
      shopUpdate.items = shop.items.map(it =>
        it.itemId === itemId ? { ...it, stock: it.stock - qty } : it
      );
    }
    tx.update(shopRef, shopUpdate);
  });

  return { ok: true, itemId, quantity: qty, totalCost, ownerShare };
}

// ── 상점주인/관리자: 매출 실적 조회 ─────────────────────────────────────────
async function getShopSales(uid, { shopId, limit = 20 } = {}) {
  if (!shopId) throw new HttpsError('invalid-argument', 'shopId가 필요합니다');

  const shopSnap = await db.collection('game_shops').doc(shopId).get();
  if (!shopSnap.exists) throw new HttpsError('not-found', '상점을 찾을 수 없습니다');
  const shop = shopSnap.data();

  const admin_ = await isAdmin(uid);
  if (!admin_ && shop.ownerUid !== uid)
    throw new HttpsError('permission-denied', '상점 소유자 또는 관리자만 조회할 수 있습니다');

  const safeLimit = Math.min(Math.max(1, Number(limit) || 20), 50);
  const snap = await db.collection('shop_sales_logs')
    .where('shopId', '==', shopId)
    .orderBy('createdAt', 'desc')
    .limit(safeLimit)
    .get();

  const sales = snap.docs.map(d => {
    const data = d.data();
    return {
      id:         d.id,
      itemId:     data.itemId,
      itemName:   data.itemName,
      qty:        data.qty,
      totalCost:  data.totalCost,
      ownerShare: data.ownerShare,
      buyerUid:   data.buyerUid,
      createdAt:  data.createdAt?.toDate?.()?.toISOString?.() ?? null,
    };
  });

  return {
    sales,
    totalRevenue:   shop.totalRevenue   ?? 0,
    totalSales:     shop.totalSales     ?? 0,
    seedlingRevenue: shop.seedlingRevenue ?? 0,
    seedlingCount:   shop.seedlingCount  ?? 0,
    boosterRevenue:  shop.boosterRevenue ?? 0,
    boosterCount:    shop.boosterCount   ?? 0,
    shopName:        shop.name,
  };
}

// ── 유저: 상점 공격 ──────────────────────────────────────────────────────────
async function attackShop(uid, { shopId } = {}) {
  if (!shopId) throw new HttpsError('invalid-argument', 'shopId가 필요합니다');

  const shopRef   = db.collection('game_shops').doc(shopId);
  const playerRef = db.collection('battle_players').doc(uid);
  const coolRef   = db.collection('shop_attack_cooldowns').doc(`${uid}_${shopId}`);
  const now       = admin.firestore.FieldValue.serverTimestamp();

  const [shopSnap, playerSnap, coolSnap] = await Promise.all([
    shopRef.get(), playerRef.get(), coolRef.get(),
  ]);

  if (!shopSnap.exists) throw new HttpsError('not-found', '상점을 찾을 수 없습니다');
  const shop = shopSnap.data();
  if (!shop.active) throw new HttpsError('failed-precondition', '비활성화된 상점입니다');
  if (shop.ownerUid === uid)
    throw new HttpsError('failed-precondition', '자신의 상점은 공격할 수 없습니다');

  // Cooldown check
  if (coolSnap.exists) {
    const lastSec = coolSnap.data().lastAt?.seconds ?? 0;
    const elapsed = Date.now() / 1000 - lastSec;
    if (elapsed < ATTACK_COOLDOWN_SEC)
      throw new HttpsError('failed-precondition',
        `공격 쿨다운 중 (${Math.ceil(ATTACK_COOLDOWN_SEC - elapsed)}초 남음)`);
  }

  const player = playerSnap.exists ? playerSnap.data() : {};
  const atk    = BASE_ATK + weaponBonus(player.equippedWeapon || 'weapon_50');

  const currentHp = shop.hp ?? shop.maxHp ?? BASE_HP_PER_LEVEL;
  const newHp     = Math.max(0, currentHp - atk);
  const conquered = newHp === 0;

  const batch = db.batch();

  batch.update(shopRef, {
    hp:        conquered ? shop.maxHp : newHp, // reset HP on conquest
    ownerUid:  conquered ? uid : shop.ownerUid,
    updatedAt: now,
  });

  batch.set(coolRef, { uid, shopId, lastAt: now });

  batch.set(db.collection('shop_attack_logs').doc(), {
    shopId,
    attackerUid:  uid,
    prevOwnerUid: shop.ownerUid,
    atk,
    prevHp:   currentHp,
    newHp:    conquered ? shop.maxHp : newHp,
    conquered,
    createdAt: now,
  });

  await batch.commit();

  return {
    ok: true, atk,
    prevHp: currentHp,
    newHp: conquered ? shop.maxHp : newHp,
    conquered,
    shopName: shop.name,
  };
}

// ── 상점주인/관리자: 이메일로 양도 ───────────────────────────────────────────
async function transferShop(uid, { shopId, toEmail } = {}) {
  if (!shopId)  throw new HttpsError('invalid-argument', 'shopId가 필요합니다');
  if (!toEmail) throw new HttpsError('invalid-argument', '수신자 이메일이 필요합니다');

  const shopSnap = await db.collection('game_shops').doc(shopId).get();
  if (!shopSnap.exists) throw new HttpsError('not-found', '상점을 찾을 수 없습니다');
  const shop = shopSnap.data();

  const admin_ = await isAdmin(uid);
  if (!admin_ && shop.ownerUid !== uid)
    throw new HttpsError('permission-denied', '상점 소유자만 양도할 수 있습니다');

  const usersSnap = await db.collection('users')
    .where('email', '==', toEmail.trim().toLowerCase())
    .limit(1).get();
  if (usersSnap.empty)
    throw new HttpsError('not-found', `이메일 ${toEmail}에 해당하는 유저를 찾을 수 없습니다`);

  const toUid = usersSnap.docs[0].id;
  if (toUid === uid)
    throw new HttpsError('invalid-argument', '자신에게는 양도할 수 없습니다');

  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.update(db.collection('game_shops').doc(shopId), { ownerUid: toUid, updatedAt: now });
  batch.set(db.collection('shop_transfer_logs').doc(), {
    shopId, fromUid: uid, toUid, toEmail, createdAt: now,
  });
  await batch.commit();

  return { ok: true, toUid, toEmail };
}

// ── 상점주인/관리자: 레벨업 ──────────────────────────────────────────────────
async function levelUpShop(uid, { shopId } = {}) {
  if (!shopId) throw new HttpsError('invalid-argument', 'shopId가 필요합니다');

  const shopRef   = db.collection('game_shops').doc(shopId);
  const playerRef = db.collection('battle_players').doc(uid);

  const [shopSnap, playerSnap] = await Promise.all([shopRef.get(), playerRef.get()]);
  if (!shopSnap.exists) throw new HttpsError('not-found', '상점을 찾을 수 없습니다');

  const shop    = shopSnap.data();
  const admin_  = await isAdmin(uid);
  if (!admin_ && shop.ownerUid !== uid)
    throw new HttpsError('permission-denied', '상점 소유자만 레벨업할 수 있습니다');

  const currentLevel = shop.level ?? 1;
  const cost         = currentLevel * currentLevel * 10000;
  const gold         = playerSnap.exists ? (playerSnap.data().gold ?? 0) : 0;

  if (!admin_ && gold < cost)
    throw new HttpsError('failed-precondition',
      `골드 부족 (보유: ${gold.toLocaleString()}, 필요: ${cost.toLocaleString()})`);

  const newLevel = currentLevel + 1;
  const newMaxHp = newLevel * BASE_HP_PER_LEVEL;
  const now      = admin.firestore.FieldValue.serverTimestamp();

  const batch = db.batch();
  batch.update(shopRef, { level: newLevel, maxHp: newMaxHp, hp: newMaxHp, updatedAt: now });
  if (!admin_ && playerSnap.exists)
    batch.update(playerRef, { gold: gold - cost, updatedAt: now });

  await batch.commit();
  return { ok: true, newLevel, newMaxHp, cost };
}

// ── 상점주인/관리자: 이름·이미지 수정 ─────────────────────────────────────────
async function updateShopAppearance(uid, { shopId, name, imageUrl } = {}) {
  if (!shopId) throw new HttpsError('invalid-argument', 'shopId가 필요합니다');

  const shopSnap = await db.collection('game_shops').doc(shopId).get();
  if (!shopSnap.exists) throw new HttpsError('not-found', '상점을 찾을 수 없습니다');
  const shop = shopSnap.data();

  const admin_ = await isAdmin(uid);
  if (!admin_ && shop.ownerUid !== uid)
    throw new HttpsError('permission-denied', '상점 소유자만 수정할 수 있습니다');

  const update = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (name && typeof name === 'string' && name.trim()) update.name = name.trim();
  if (imageUrl !== undefined) update.imageUrl = imageUrl;

  if (Object.keys(update).length === 1)
    throw new HttpsError('invalid-argument', '변경할 항목이 없습니다');

  await db.collection('game_shops').doc(shopId).update(update);
  return { ok: true };
}

// ── 스타터 팩 정의 ─────────────────────────────────────────────────────────────
const STARTER_PACK = {
  equippedWeapon: 'weapon_50',
  equippedArmor:  'armo_10',
  token:          30,
  gold:           0,
  hp:             1000,
  mp:             1000,
  level:          1,
};
const STARTER_INV = [
  { itemId: 'weapon_50',     count: 1  },
  { itemId: 'armo_10',       count: 1  },
  { itemId: 'revive_ticket', count: 30 },
  { itemId: 'potion_red',    count: 30 },
];

async function _applyStarterToPlayer(uid, existingSnap) {
  const now   = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  const playerRef = db.collection('battle_players').doc(uid);

  if (!existingSnap || !existingSnap.exists) {
    batch.set(playerRef, { uid, ...STARTER_PACK, updatedAt: now });
  } else {
    const d = existingSnap.data();
    const update = {};
    if ((d.token ?? 0) < STARTER_PACK.token) update.token = STARTER_PACK.token;
    if (!d.equippedWeapon || d.equippedWeapon === 'weapon_100')
      update.equippedWeapon = STARTER_PACK.equippedWeapon;
    if (!d.equippedArmor) update.equippedArmor = STARTER_PACK.equippedArmor;
    if (Object.keys(update).length) { update.updatedAt = now; batch.update(playerRef, update); }
  }

  for (const { itemId, count } of STARTER_INV) {
    const invRef  = db.collection('treasure_inventory').doc(`${uid}_${itemId}`);
    const invSnap = await invRef.get();
    const current = invSnap.exists ? (invSnap.data().count ?? 0) : 0;
    if (current < count)
      batch.set(invRef, { uid, itemId, count, updatedAt: now }, { merge: true });
  }

  await batch.commit();
}

async function initBattlePlayer(uid) {
  const playerRef = db.collection('battle_players').doc(uid);
  const snap = await playerRef.get();
  if (snap.exists) return { ok: true, created: false };
  await _applyStarterToPlayer(uid, snap);
  return { ok: true, created: true };
}

async function adminInitAllPlayers(uid) {
  await requireAdmin(uid);
  const usersSnap = await db.collection('users').get();
  const uids = usersSnap.docs.map(d => d.id);
  const CHUNK = 20;
  let processed = 0;

  for (let i = 0; i < uids.length; i += CHUNK) {
    await Promise.all(uids.slice(i, i + CHUNK).map(async (u) => {
      const snap = await db.collection('battle_players').doc(u).get();
      await _applyStarterToPlayer(u, snap);
    }));
    processed += Math.min(CHUNK, uids.length - i);
  }

  return { ok: true, processed };
}

// ── 상점 주인: HP 수리 (100 HP당 100 골드) ───────────────────────────────────
const REPAIR_COST_PER_HP = 1; // 1 골드 / 1 HP

async function repairShop(uid, { shopId, amount } = {}) {
  if (!shopId) throw new HttpsError('invalid-argument', 'shopId가 필요합니다');

  const shopRef   = db.collection('game_shops').doc(shopId);
  const playerRef = db.collection('battle_players').doc(uid);

  const [shopSnap, playerSnap] = await Promise.all([shopRef.get(), playerRef.get()]);

  if (!shopSnap.exists) throw new HttpsError('not-found', '상점을 찾을 수 없습니다');
  const shop = shopSnap.data();
  if (shop.ownerUid !== uid) throw new HttpsError('permission-denied', '상점 주인만 수리할 수 있습니다');

  const maxHp    = shop.maxHp ?? BASE_HP_PER_LEVEL;
  const currentHp = shop.hp   ?? maxHp;
  const missing  = maxHp - currentHp;

  if (missing <= 0) throw new HttpsError('failed-precondition', 'HP가 이미 최대입니다');

  // amount 미지정 시 전체 수리
  const repairHp = amount ? Math.min(Math.max(1, Math.floor(Number(amount))), missing) : missing;
  const cost     = repairHp * REPAIR_COST_PER_HP;

  const gold = playerSnap.exists ? (playerSnap.data().gold ?? 0) : 0;
  if (gold < cost) throw new HttpsError('failed-precondition', `골드가 부족합니다 (필요: ${cost}, 보유: ${gold})`);

  const batch = db.batch();
  batch.update(shopRef,   { hp: currentHp + repairHp, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  batch.update(playerRef, { gold: admin.firestore.FieldValue.increment(-cost) });
  await batch.commit();

  return { ok: true, repairHp, cost, newHp: currentHp + repairHp, maxHp };
}

// ── 워프 입장료: 상점 방문 시 10GP 상점 주인에게 지불 ─────────────────────────
const WARP_ENTRANCE_FEE = 10;

async function payWarpEntrance(uid, { shopId } = {}) {
  if (!shopId) throw new HttpsError('invalid-argument', 'shopId is required');

  const shopRef   = db.collection('game_shops').doc(shopId);
  const playerRef = db.collection('battle_players').doc(uid);

  const [shopSnap, playerSnap] = await Promise.all([shopRef.get(), playerRef.get()]);
  if (!shopSnap.exists) throw new HttpsError('not-found', 'Shop not found');

  const shop    = shopSnap.data();
  const ownerUid = shop.ownerUid;

  // 자신의 상점은 입장료 없음
  if (ownerUid === uid) return { ok: true, fee: 0, skipped: true };

  const playerGold = playerSnap.exists ? (playerSnap.data().gold ?? 0) : 0;
  if (playerGold < WARP_ENTRANCE_FEE)
    throw new HttpsError('failed-precondition',
      `Not enough GP. Entrance fee: ${WARP_ENTRANCE_FEE} GP`);

  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();

  // 플레이어 GP 차감
  batch.set(playerRef, { gold: admin.firestore.FieldValue.increment(-WARP_ENTRANCE_FEE) }, { merge: true });

  // 상점 주인 GP 지급 (주인이 있을 때만)
  if (ownerUid) {
    const ownerRef = db.collection('battle_players').doc(ownerUid);
    batch.set(ownerRef, { gold: admin.firestore.FieldValue.increment(WARP_ENTRANCE_FEE) }, { merge: true });
  }

  // 매출 기록
  const saleRef = db.collection('shop_sales').doc();
  batch.set(saleRef, {
    shopId,
    shopName:    shop.name || '',
    ownerUid:    ownerUid || null,
    buyerUid:    uid,
    itemId:      'warp_entrance',
    itemName:    'Warp Entrance Fee',
    qty:         1,
    totalCost:   WARP_ENTRANCE_FEE,
    ownerShare:  ownerUid ? WARP_ENTRANCE_FEE : 0,
    createdAt:   now,
  });

  // 상점 totalRevenue 카운터 (매출순 정렬용)
  batch.set(shopRef, {
    totalRevenue:  admin.firestore.FieldValue.increment(WARP_ENTRANCE_FEE),
    totalVisits:   admin.firestore.FieldValue.increment(1),
    updatedAt:     now,
  }, { merge: true });

  await batch.commit();
  return { ok: true, fee: WARP_ENTRANCE_FEE };
}

// ── 상점 소유자: 이름 변경 + 판매 아이템 등록/수정 ───────────────────────────
async function ownerSaveShopItems(uid, { shopId, name, items = [], sellsMt } = {}) {
  if (!shopId) throw new HttpsError('invalid-argument', 'shopId가 필요합니다');
  if (!Array.isArray(items)) throw new HttpsError('invalid-argument', 'items는 배열이어야 합니다');

  const ref  = db.collection('game_shops').doc(shopId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', '상점을 찾을 수 없습니다');

  const shop = snap.data();
  const isOwner = shop.ownerUid === uid;
  const adminOk = await isAdmin(uid);
  if (!isOwner && !adminOk)
    throw new HttpsError('permission-denied', '이 상점의 소유자만 수정할 수 있습니다');

  // 이름 유효성 검사
  const newName = name ? String(name).trim() : null;
  if (newName !== null && newName.length === 0)
    throw new HttpsError('invalid-argument', '상점 이름은 비워둘 수 없습니다');

  // 아이템 유효성 검사
  for (const item of items) {
    if (!item.itemId || typeof item.itemId !== 'string')
      throw new HttpsError('invalid-argument', '각 아이템에 itemId가 필요합니다');
    if (!item.name || typeof item.name !== 'string')
      throw new HttpsError('invalid-argument', '각 아이템에 name이 필요합니다');
    if (typeof item.price !== 'number' || item.price < 0)
      throw new HttpsError('invalid-argument', 'price는 0 이상의 숫자여야 합니다');
  }

  // 아이템이 상점 카테고리에 맞는 타입인지 검사 (관리자 제외)
  // → 잡템상점(300K)으로 개설 후 약물상점(600K) 아이템 등록 방지
  if (!adminOk) {
    const ALLOWED_PREFIXES = {
      potion:       ['potion_', 'revive_'],
      shop_potion:  ['potion_', 'revive_'],
      weapon_armor: ['weapon_', 'armor_', 'helm_', 'sword_', 'bow_', 'shield_',
                     'armo_', 'legs_', 'glov_', 'boot_'],
      shop_weapon_armor: ['weapon_', 'armor_', 'helm_', 'sword_', 'bow_', 'shield_',
                          'armo_', 'legs_', 'glov_', 'boot_'],
      misc:         null, // 제한 없음
      shop_misc:    null,
    };
    const allowed = ALLOWED_PREFIXES[shop.type];
    if (allowed !== null && allowed !== undefined) {
      for (const item of items) {
        const ok = allowed.some(p => item.itemId.startsWith(p));
        if (!ok)
          throw new HttpsError('invalid-argument',
            `아이템 "${item.itemId}"은 "${shop.type}" 상점에 등록할 수 없습니다. ` +
            `상점 카테고리에 맞는 아이템만 등록 가능합니다.`
          );
      }
    }
  }

  const cleanItems = items.map(it => ({
    itemId: String(it.itemId).trim(),
    name:   String(it.name).trim(),
    price:  Math.round(Number(it.price)),
    stock:  typeof it.stock === 'number' ? Math.floor(it.stock) : -1,
  }));

  // type·lat·lng·ownerUid·active는 절대 변경 불가 — 명시적 허용 필드만 update
  const update = {
    items:     cleanItems,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (newName) update.name = newName;
  if (sellsMt !== undefined) update.sellsMt = !!sellsMt;

  await ref.update(update);

  return { ok: true, count: cleanItems.length };
}

module.exports = {
  adminSaveShop,
  adminDeleteShop,
  buyShopItem,
  getShopSales,
  attackShop,
  repairShop,
  transferShop,
  levelUpShop,
  updateShopAppearance,
  initBattlePlayer,
  adminInitAllPlayers,
  ownerSaveShopItems,
  payWarpEntrance,
};
