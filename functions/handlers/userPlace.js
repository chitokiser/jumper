// functions/handlers/userPlace.js
// 유저가 GP로 보물박스 / 몬스터 / 아쳐타워를 지도 위에 배치
'use strict';

const admin = require('firebase-admin');
const db    = admin.firestore();

function haversineM(lat1, lng1, lat2, lng2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat/2)**2
    + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── 카탈로그 ─────────────────────────────────────────────────────────────────
const CATALOG = {
  box_lv1: {
    price: 5000, type: 'box', label: '보물박스 Lv1',
    hp: 200, itemPool: [
      { itemId: '0', weight: 10 },
      { itemId: '1', weight: 10 },
      { itemId: '2', weight: 10 },
    ],
  },
  box_lv2: {
    price: 10000, type: 'box', label: '보물박스 Lv2',
    hp: 300, itemPool: [
      { itemId: '3', weight: 10 },
      { itemId: '4', weight: 10 },
      { itemId: '5', weight: 10 },
      { itemId: '6', weight: 10 },
    ],
  },
  box_lv3: {
    price: 15000, type: 'box', label: '보물박스 Lv3',
    hp: 500, itemPool: [
      { itemId: '7',  weight: 10 },
      { itemId: '8',  weight: 10 },
      { itemId: '9',  weight: 10 },
      { itemId: '10', weight: 10 },
    ],
  },
  mon_cabi: {
    price: 5000, type: 'monster', label: 'cabi',
    image: '23.png', maxHp: 500, atk: 20, detectRadius: 30,
  },
  mon_eyes: {
    price: 10000, type: 'monster', label: 'Monster eyes',
    image: '22.png', maxHp: 800, atk: 80, detectRadius: 30,
  },
  mon_orc1: {
    price: 15000, type: 'monster', label: 'Orc',
    monsterType: 'orc', maxHp: 1200, atk: 60, detectRadius: 35,
  },
  mon_orc2: {
    price: 20000, type: 'monster', label: 'Orc2',
    monsterType: 'orc2', maxHp: 1800, atk: 80, detectRadius: 40,
  },
  mon_orc3: {
    price: 25000, type: 'monster', label: 'Orc3',
    monsterType: 'orc3', maxHp: 2500, atk: 100, detectRadius: 45,
  },
  mon_pirate: {
    price: 30000, type: 'monster', label: 'Pirate',
    monsterType: 'pirate', maxHp: 3000, atk: 120, detectRadius: 40,
  },
  mon_pirate2: {
    price: 35000, type: 'monster', label: 'Pirate 2',
    monsterType: 'pirate2', maxHp: 3500, atk: 140, detectRadius: 40,
  },
  mon_pirate3: {
    price: 40000, type: 'monster', label: 'Pirate 3',
    monsterType: 'pirate3', maxHp: 4000, atk: 160, detectRadius: 45,
  },
  mon_zombie1: {
    price: 45000, type: 'monster', label: 'Zombie',
    monsterType: 'zombie1', maxHp: 4500, atk: 180, detectRadius: 40,
  },
  mon_zombie3: {
    price: 50000, type: 'monster', label: 'Zombie 3',
    monsterType: 'zombie3', maxHp: 5000, atk: 200, detectRadius: 45,
  },
  mon_zvil1: {
    price: 55000, type: 'monster', label: 'Zombie Villager 1',
    monsterType: 'zombie_villager1', maxHp: 5500, atk: 220, detectRadius: 30,
  },
  mon_zvil2: {
    price: 60000, type: 'monster', label: 'Zombie Villager 2',
    monsterType: 'zombie_villager2', maxHp: 6000, atk: 240, detectRadius: 30,
  },
  mon_zvil3: {
    price: 65000, type: 'monster', label: 'Zombie Villager 3',
    monsterType: 'zombie_villager3', maxHp: 6500, atk: 260, detectRadius: 30,
  },
  mon_troll: {
    price: 70000, type: 'monster', label: 'Troll',
    monsterType: 'troll', maxHp: 7000, atk: 280, detectRadius: 30,
  },
  mon_knight1: {
    price: 75000, type: 'monster', label: 'Knight 1',
    monsterType: 'knight1', maxHp: 7500, atk: 300, detectRadius: 30,
  },
  mon_knight2: {
    price: 80000, type: 'monster', label: 'Knight 2',
    monsterType: 'knight2', maxHp: 8000, atk: 320, detectRadius: 30,
  },
  mon_knight3: {
    price: 85000, type: 'monster', label: 'Knight 3',
    monsterType: 'knight3', maxHp: 8500, atk: 340, detectRadius: 30,
  },
  mon_dragon: {
    price: 200000, type: 'monster', label: 'Dragon',
    monsterType: 'dragon', maxHp: 20000, atk: 500, detectRadius: 30,
  },
  archer_tower: {
    price:  20000, type: 'tower', label: '아쳐타워',
    towerType: 'archer', atk: 50,  radius: 40, hp:  500, image: '/assets/images/shops/tower.png',
  },
  cannon_tower: {
    price: 100000, type: 'tower', label: '대포타워',
    towerType: 'cannon', atk: 120, radius: 35, hp: 1000, image: '/assets/images/shops/tower2.png',
  },
  shop_potion: {
    price: 600000, type: 'shop', label: '약물상점',
    shopType: 'shop_potion', image: '/assets/images/shops/shop2.png',
  },
  shop_weapon: {
    price: 400000, type: 'shop', label: '무기상점',
    shopType: 'shop_weapon_armor', image: '/assets/images/shops/arms.png',
  },
  shop_armor: {
    price: 400000, type: 'shop', label: '방어구 상점',
    shopType: 'shop_weapon_armor', image: '/assets/images/shops/arms.png',
  },
};

// ── 가격 조회 (Firestore 우선, 없으면 CATALOG 기본값) ─────────────────────────
const PRICES_DOC = () => db.collection('config').doc('userPlacePrices');

async function _getEffectivePrice(itemKey) {
  try {
    const snap = await PRICES_DOC().get();
    if (snap.exists && snap.data()[itemKey] != null) return Number(snap.data()[itemKey]);
  } catch (_) {}
  return CATALOG[itemKey]?.price ?? 0;
}

async function getUserPlacePrices() {
  const snap = await PRICES_DOC().get();
  const overrides = snap.exists ? snap.data() : {};
  const result = {};
  for (const [key, def] of Object.entries(CATALOG)) {
    result[key] = {
      label: def.label,
      price: overrides[key] != null ? Number(overrides[key]) : def.price,
      defaultPrice: def.price,
    };
  }
  return { prices: result };
}

async function adminSetUserPlacePrices(data) {
  const updates = {};
  for (const [key, val] of Object.entries(data)) {
    if (CATALOG[key] && Number.isFinite(Number(val)) && Number(val) >= 0) {
      updates[key] = Number(val);
    }
  }
  updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  await PRICES_DOC().set(updates, { merge: true });
  return { ok: true, updated: Object.keys(updates).length - 1 };
}

// ── 1. 오브젝트 배치 ──────────────────────────────────────────────────────────
async function placeUserObject(uid, { itemKey, lat, lng }) {
  const def = CATALOG[itemKey];
  if (!def)           throw new Error('유효하지 않은 아이템 키');
  if (!lat || !lng)   throw new Error('좌표가 필요합니다');
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('유효하지 않은 좌표');

  // Firestore 우선 가격 조회
  const price = await _getEffectivePrice(itemKey);

  // ── 상점 5km 중복 검사 — GP 차감 전에 실행 (GP 손실 방지 + 즉시 피드백)
  if (def.type === 'shop') {
    const TYPE_ALIASES = {
      shop_potion:       ['shop_potion', 'potion'],
      shop_weapon_armor: ['shop_weapon_armor', 'weapon_armor'],
      shop_misc:         ['shop_misc', 'misc'],
    };
    const aliasTypes = TYPE_ALIASES[def.shopType] || [def.shopType];
    const allShopsSnap = await db.collection('game_shops')
      .where('active', '==', true)
      .get();
    for (const shopDoc of allShopsSnap.docs) {
      const s = shopDoc.data();
      if (!s.lat || !s.lng) continue;
      if (!aliasTypes.includes(s.type)) continue;
      const distM = haversineM(Number(lat), Number(lng), Number(s.lat), Number(s.lng));
      if (distM <= 5000) {
        throw new Error(
          `⛔ A "${s.type}" shop already exists within 5km: "${s.name || shopDoc.id}" (${Math.round(distM)}m away). ` +
          `Only one shop per category is allowed within a 5km radius.`
        );
      }
    }
  }

  const bpRef     = db.collection('battle_players').doc(uid);
  const userRef   = db.collection('users').doc(uid);
  const userSnap  = await userRef.get();
  const ownerName = userSnap.data()?.name || '플레이어';

  // GP 차감 + 배치 번호 증가 (트랜잭션 — reads 먼저, writes 나중)
  let placeNo = 1;
  await db.runTransaction(async t => {
    // ① 모든 read 먼저
    const [bp, uSnap] = await Promise.all([t.get(bpRef), t.get(userRef)]);

    const gold = bp.exists ? (bp.data().gold ?? 0) : 0;
    if (gold < price) {
      throw new Error(`Not enough GP. Required: ${price.toLocaleString()} GP, Available: ${gold.toLocaleString()} GP`);
    }
    placeNo = (uSnap.data()?.placeCount ?? 0) + 1;

    // ② 모든 write 나중
    t.set(bpRef,   { gold: admin.firestore.FieldValue.increment(-price) }, { merge: true });
    t.set(userRef, { placeCount: placeNo }, { merge: true });
  });

  const base = {
    ownerUid: uid, ownerName,
    lat: Number(lat), lng: Number(lng),
    active: true, userPlaced: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  let docId = null;

  const nim = `${ownerName}님의`;

  if (def.type === 'box') {
    const ref = await db.collection('treasure_boxes').add({
      ...base,
      name:     `${nim} 보물${placeNo}`,
      hiddenBox: false,
      hp:        def.hp,
      itemPool:  def.itemPool,
    });
    docId = ref.id;
  } else if (def.type === 'monster') {
    const ref = await db.collection('battle_monsters').add({
      ...base,
      name:          `${nim} ${def.label}${placeNo}`,
      image:         def.image ?? null,
      monsterType:   def.monsterType ?? null,
      maxHp:         def.maxHp,
      hp:            def.maxHp,
      atk:           def.atk,
      detectRadius:  def.detectRadius,
      respawnMinutes: 0,
    });
    docId = ref.id;
  } else if (def.type === 'tower') {
    const ref = await db.collection('battle_towers').add({
      ...base,
      name:   `${nim} ${def.label}${placeNo}`,
      type:   def.towerType,
      atk:    def.atk,
      radius: def.radius,
      hp:     def.hp,
      image:  def.image,
    });
    docId = ref.id;
  } else if (def.type === 'shop') {
    // 5km 체크는 트랜잭션 전에 이미 완료됨
    // shop_potion → potion 등 정규화 (moneyTree CF 타입 체크와 일치)
    const normalizedShopType = def.shopType.replace(/^shop_/, '');
    const ref = await db.collection('game_shops').add({
      ...base,
      name:    `${nim} ${def.label}${placeNo}`,
      type:    normalizedShopType,
      image:   def.image ?? null,
      items:   [],
      sellsMt: normalizedShopType === 'potion',
    });
    docId = ref.id;
  }

  return { ok: true, docId, itemKey, label: def.label, price };
}

// ── 2. 내가 배치한 오브젝트 목록 ─────────────────────────────────────────────
async function getMyPlacedObjects(uid) {
  const [boxes, monsters, towers, shops] = await Promise.all([
    db.collection('treasure_boxes')
      .where('ownerUid', '==', uid).where('active', '==', true).limit(20).get(),
    db.collection('battle_monsters')
      .where('ownerUid', '==', uid).where('active', '==', true).limit(20).get(),
    db.collection('battle_towers')
      .where('ownerUid', '==', uid).where('active', '==', true).limit(20).get(),
    db.collection('game_shops')
      .where('ownerUid', '==', uid).where('active', '==', true).limit(20).get(),
  ]);
  return {
    boxes:    boxes.docs.map(d => ({ id: d.id, ...d.data() })),
    monsters: monsters.docs.map(d => ({ id: d.id, ...d.data() })),
    towers:   towers.docs.map(d => ({ id: d.id, ...d.data() })),
    shops:    shops.docs.map(d => ({ id: d.id, ...d.data() })),
  };
}

// ── 3. 배치권 사용 ────────────────────────────────────────────────────────────
async function useTicket(uid, { itemId, lat, lng }) {
  if (!itemId || !String(itemId).startsWith('ticket_')) throw new Error('Invalid ticket item');
  const catalogKey = String(itemId).replace(/^ticket_/, '');
  const def = CATALOG[catalogKey];
  if (!def) throw new Error('Unknown ticket type: ' + catalogKey);
  if (!lat || !lng) throw new Error('Coordinates required');
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('Invalid coordinates');

  // 상점 배치권은 5km 중복 검사 동일 적용
  if (def.type === 'shop') {
    const TYPE_ALIASES = {
      shop_potion:       ['shop_potion', 'potion'],
      shop_weapon_armor: ['shop_weapon_armor', 'weapon_armor'],
    };
    const aliasTypes = TYPE_ALIASES[def.shopType] || [def.shopType];
    const allShopsSnap = await db.collection('game_shops').where('active', '==', true).get();
    for (const shopDoc of allShopsSnap.docs) {
      const s = shopDoc.data();
      if (!s.lat || !s.lng) continue;
      if (!aliasTypes.includes(s.type)) continue;
      const distM = haversineM(Number(lat), Number(lng), Number(s.lat), Number(s.lng));
      if (distM <= 5000) {
        throw new Error(
          `⛔ A "${s.type}" shop already exists within 5km: "${s.name || shopDoc.id}" (${Math.round(distM)}m away). ` +
          `Only one shop per category is allowed within a 5km radius.`
        );
      }
    }
  }

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const ownerName = userSnap.data()?.name || 'Player';

  // treasure_inventory에서 티켓 확인
  const invSnap = await db.collection('treasure_inventory')
    .where('uid', '==', uid)
    .where('itemId', '==', itemId)
    .limit(1)
    .get();
  if (invSnap.empty) throw new Error('No placement ticket available: ' + itemId);
  const invDocRef = invSnap.docs[0].ref;

  let placeNo = 1;
  await db.runTransaction(async t => {
    const [invDoc, uSnap] = await Promise.all([t.get(invDocRef), t.get(userRef)]);
    if (!invDoc.exists || (invDoc.data().count ?? 0) <= 0) throw new Error('Ticket not available');
    placeNo = (uSnap.data()?.placeCount ?? 0) + 1;
    t.update(invDocRef, { count: admin.firestore.FieldValue.increment(-1) });
    t.set(userRef, { placeCount: placeNo }, { merge: true });
  });

  const base = {
    ownerUid: uid, ownerName,
    lat: Number(lat), lng: Number(lng),
    active: true, userPlaced: true, placedByTicket: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const nim = `${ownerName}님의`;
  let docId = null;

  if (def.type === 'box') {
    const ref = await db.collection('treasure_boxes').add({
      ...base, name: `${nim} 보물${placeNo}`,
      hiddenBox: false, hp: def.hp, itemPool: def.itemPool,
    });
    docId = ref.id;
  } else if (def.type === 'monster') {
    const ref = await db.collection('battle_monsters').add({
      ...base, name: `${nim} ${def.label}${placeNo}`,
      image: def.image ?? null, monsterType: def.monsterType ?? null,
      maxHp: def.maxHp, hp: def.maxHp, atk: def.atk,
      detectRadius: def.detectRadius, respawnMinutes: 0,
    });
    docId = ref.id;
  } else if (def.type === 'tower') {
    const ref = await db.collection('battle_towers').add({
      ...base, name: `${nim} ${def.label}${placeNo}`,
      type: def.towerType, atk: def.atk, radius: def.radius,
      hp: def.hp, image: def.image,
    });
    docId = ref.id;
  } else if (def.type === 'shop') {
    const normalizedShopType = def.shopType.replace(/^shop_/, '');
    const ref = await db.collection('game_shops').add({
      ...base, name: `${nim} ${def.label}${placeNo}`,
      type: normalizedShopType, image: def.image ?? null,
      items: [], sellsMt: normalizedShopType === 'potion',
    });
    docId = ref.id;
  }

  return { ok: true, docId, catalogKey, label: def.label };
}

// ── 4. 내 배치권 목록 ─────────────────────────────────────────────────────────
async function getMyPlacementTickets(uid) {
  const snap = await db.collection('treasure_inventory')
    .where('uid', '==', uid)
    .get();
  const tickets = snap.docs
    .filter(d => d.data().itemId?.startsWith('ticket_') && (d.data().count ?? 0) > 0)
    .map(d => {
      const { itemId, count } = d.data();
      const catalogKey = itemId.replace(/^ticket_/, '');
      const def = CATALOG[catalogKey];
      return {
        itemId, count,
        catalogKey,
        label: def?.label ?? catalogKey,
        type: def?.type ?? null,
        emoji: def?.type === 'monster' ? '👾'
          : def?.type === 'box'     ? '🎁'
          : def?.type === 'tower'   ? '🏹'
          : def?.type === 'shop'    ? '🧪'
          : '🎟️',
      };
    })
    .filter(t => t.type !== null);
  return { tickets };
}

// ── 유저 지도 마커 (얼굴 이미지 + 링크) ─────────────────────────────────────

const MARKER_GP_PRICE   = 10000;
const MARKER_OWNER_SHARE = 5000; // 50 %
const MARKER_DAYS        = 30;   // expiry

async function _findNearestShop(lat, lng, radiusM = 500) {
  const snap = await db.collection('game_shops').where('active', '==', true).get();
  let best = null, bestDist = Infinity;
  for (const doc of snap.docs) {
    const s = doc.data();
    if (!s.lat || !s.lng || !s.ownerUid) continue;
    const d = haversineM(lat, lng, s.lat, s.lng);
    if (d <= radiusM && d < bestDist) { best = doc; bestDist = d; }
  }
  return best;
}

async function placeUserMarker(uid, { imageUrl, linkUrl, lat, lng }) {
  if (!imageUrl || !linkUrl)         throw new Error('Image URL and link URL are required');
  if (lat == null || lng == null)    throw new Error('Coordinates are required');
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('Invalid coordinates');
  try { new URL(imageUrl); new URL(linkUrl); } catch { throw new Error('Invalid URL format'); }

  const bpRef   = db.collection('battle_players').doc(uid);
  const userRef = db.collection('users').doc(uid);

  // Find nearest shop before transaction (read-only, safe outside tx)
  const shopDoc   = await _findNearestShop(Number(lat), Number(lng), 500);
  const shopId    = shopDoc ? shopDoc.id : null;
  const shopData  = shopDoc ? shopDoc.data() : null;
  const shopOwnerUid = shopData?.ownerUid ?? null;

  await db.runTransaction(async t => {
    const bp   = await t.get(bpRef);
    const gold = bp.exists ? (bp.data().gold ?? 0) : 0;
    if (gold < MARKER_GP_PRICE) {
      throw new Error(`Not enough GP. Need ${MARKER_GP_PRICE.toLocaleString()}, have ${gold.toLocaleString()}.`);
    }
    // Deduct full cost from buyer
    t.set(bpRef, { gold: admin.firestore.FieldValue.increment(-MARKER_GP_PRICE) }, { merge: true });
    // Credit 50 % to shop owner (if found and different from buyer)
    if (shopOwnerUid && shopOwnerUid !== uid) {
      const ownerBpRef = db.collection('battle_players').doc(shopOwnerUid);
      t.set(ownerBpRef, { gold: admin.firestore.FieldValue.increment(MARKER_OWNER_SHARE) }, { merge: true });
    }
  });

  const userSnap    = await userRef.get();
  const userData    = userSnap.data() || {};
  const displayName = userData.name || userData.displayName || 'Player';

  const now       = admin.firestore.FieldValue.serverTimestamp();
  const expiresAt = new Date(Date.now() + MARKER_DAYS * 24 * 60 * 60 * 1000);

  const markerRef = await db.collection('user_markers').add({
    uid,
    displayName,
    imageUrl,
    linkUrl,
    lat:           Number(lat),
    lng:           Number(lng),
    active:        true,
    shopId:        shopId ?? null,
    shopOwnerUid:  shopOwnerUid ?? null,
    ownerShare:    shopOwnerUid ? MARKER_OWNER_SHARE : 0,
    expiresAt,
    createdAt:     now,
  });

  // Log to shop_sales_logs for revenue tracking
  if (shopId && shopOwnerUid) {
    await db.collection('shop_sales_logs').add({
      shopId,
      ownerUid:    shopOwnerUid,
      buyerUid:    uid,
      itemId:      'user_marker',
      itemName:    '📍 Map Marker',
      qty:         1,
      grossGp:     MARKER_GP_PRICE,
      ownerShare:  MARKER_OWNER_SHARE,
      systemShare: MARKER_GP_PRICE - MARKER_OWNER_SHARE,
      markerId:    markerRef.id,
      createdAt:   now,
    });
  }

  return { id: markerRef.id, gpSpent: MARKER_GP_PRICE, ownerShare: shopOwnerUid ? MARKER_OWNER_SHARE : 0 };
}

async function getUserMarkers() {
  const now  = new Date();
  const snap = await db.collection('user_markers').where('active', '==', true).get();
  return {
    markers: snap.docs
      .filter(d => {
        const exp = d.data().expiresAt;
        // Legacy docs (no expiresAt) are shown; docs with future expiresAt are shown
        if (!exp) return true;
        const expMs = exp.toMillis ? exp.toMillis() : new Date(exp).getTime();
        return expMs > now.getTime();
      })
      .map(d => {
        const data = d.data();
        return {
          id:          d.id,
          uid:         data.uid,
          displayName: data.displayName,
          imageUrl:    data.imageUrl,
          linkUrl:     data.linkUrl,
          lat:         data.lat,
          lng:         data.lng,
        };
      }),
  };
}

module.exports = { CATALOG, placeUserObject, getMyPlacedObjects, getUserPlacePrices, adminSetUserPlacePrices, useTicket, getMyPlacementTickets, placeUserMarker, getUserMarkers };
