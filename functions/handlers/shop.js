// functions/handlers/shop.js
// 게임 내 상점 시스템 (무기/방어구, 약물, 잡템)
'use strict';

const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');
const { requireAdmin } = require('../wallet/admin');

const db = admin.firestore();

const VALID_TYPES = ['weapon_armor', 'potion', 'misc'];

// ── 관리자: 상점 저장 (생성/수정) ─────────────────────────────────────────────
async function adminSaveShop(uid, data = {}) {
  await requireAdmin(uid);

  const { shopId, name, type, lat, lng, items = [], active = true } = data;

  if (!name || typeof name !== 'string' || !name.trim())
    throw new HttpsError('invalid-argument', '상점 이름이 필요합니다');
  if (!VALID_TYPES.includes(type))
    throw new HttpsError('invalid-argument', `type은 ${VALID_TYPES.join('|')} 중 하나여야 합니다`);
  if (lat == null || lng == null || typeof lat !== 'number' || typeof lng !== 'number')
    throw new HttpsError('invalid-argument', '위치 좌표(lat/lng)가 필요합니다');
  if (!Array.isArray(items))
    throw new HttpsError('invalid-argument', 'items는 배열이어야 합니다');

  // 아이템 배열 유효성 검사
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

  const payload = {
    name: name.trim(),
    type,
    lat,
    lng,
    items: items.map(it => ({
      itemId: it.itemId,
      name: it.name,
      price: it.price,
      stock: it.stock ?? -1,
    })),
    active,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  let ref;
  if (shopId) {
    ref = db.collection('game_shops').doc(shopId);
    await ref.update(payload);
  } else {
    payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    ref = await db.collection('game_shops').add(payload);
  }

  return { ok: true, shopId: ref.id };
}

// ── 관리자: 상점 삭제 ──────────────────────────────────────────────────────────
async function adminDeleteShop(uid, { shopId } = {}) {
  await requireAdmin(uid);
  if (!shopId) throw new HttpsError('invalid-argument', 'shopId가 필요합니다');

  const ref = db.collection('game_shops').doc(shopId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', '상점을 찾을 수 없습니다');

  await ref.delete();
  return { ok: true };
}

// ── 유저: 상점 아이템 구매 ─────────────────────────────────────────────────────
async function buyShopItem(uid, { shopId, itemId, quantity = 1 } = {}) {
  if (!shopId) throw new HttpsError('invalid-argument', 'shopId가 필요합니다');
  if (!itemId) throw new HttpsError('invalid-argument', 'itemId가 필요합니다');
  const qty = Math.floor(Number(quantity));
  if (!qty || qty < 1) throw new HttpsError('invalid-argument', 'quantity는 1 이상이어야 합니다');

  const shopSnap = await db.collection('game_shops').doc(shopId).get();
  if (!shopSnap.exists) throw new HttpsError('not-found', '상점을 찾을 수 없습니다');
  const shop = shopSnap.data();
  if (!shop.active) throw new HttpsError('failed-precondition', '현재 이용할 수 없는 상점입니다');

  const itemDef = (shop.items || []).find(it => it.itemId === itemId);
  if (!itemDef) throw new HttpsError('not-found', '해당 아이템을 이 상점에서 판매하지 않습니다');

  // 재고 확인 (-1 = 무제한)
  if (itemDef.stock !== -1 && itemDef.stock < qty)
    throw new HttpsError('failed-precondition', `재고가 부족합니다 (남은 재고: ${itemDef.stock})`);

  const totalCost = itemDef.price * qty;
  const playerRef = db.collection('battle_players').doc(uid);
  const invRef    = db.collection('treasure_inventory').doc(`${uid}_${itemId}`);

  await db.runTransaction(async (tx) => {
    const [pSnap, invSnap] = await Promise.all([tx.get(playerRef), tx.get(invRef)]);

    if (!pSnap.exists) throw new HttpsError('not-found', '플레이어 정보를 찾을 수 없습니다');
    const currentGold = pSnap.data().gold ?? 0;
    if (currentGold < totalCost)
      throw new HttpsError('failed-precondition',
        `골드가 부족합니다 (보유: ${currentGold}, 필요: ${totalCost})`);

    tx.update(playerRef, {
      gold: currentGold - totalCost,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const currentCount = invSnap.exists ? (invSnap.data().count ?? 0) : 0;
    tx.set(invRef, {
      uid, itemId,
      count: currentCount + qty,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // 유한 재고 차감
    if (itemDef.stock !== -1) {
      const shopRef = db.collection('game_shops').doc(shopId);
      const newItems = shop.items.map(it =>
        it.itemId === itemId ? { ...it, stock: it.stock - qty } : it
      );
      tx.update(shopRef, { items: newItems });
    }
  });

  return { ok: true, itemId, quantity: qty, totalCost };
}

module.exports = { adminSaveShop, adminDeleteShop, buyShopItem };
