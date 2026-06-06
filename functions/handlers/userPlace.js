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
    hp: 200, itemPool: ['item1','item2','item3'],
  },
  box_lv2: {
    price: 10000, type: 'box', label: '보물박스 Lv2',
    hp: 300, itemPool: ['item4','item5','item6','item7'],
  },
  box_lv3: {
    price: 15000, type: 'box', label: '보물박스 Lv3',
    hp: 500, itemPool: ['item8','item9','item10','item11'],
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
    monsterType: 'zombie_villager1', maxHp: 5500, atk: 220, detectRadius: 45,
  },
  mon_zvil2: {
    price: 60000, type: 'monster', label: 'Zombie Villager 2',
    monsterType: 'zombie_villager2', maxHp: 6000, atk: 240, detectRadius: 50,
  },
  mon_zvil3: {
    price: 65000, type: 'monster', label: 'Zombie Villager 3',
    monsterType: 'zombie_villager3', maxHp: 6500, atk: 260, detectRadius: 50,
  },
  mon_troll: {
    price: 70000, type: 'monster', label: 'Troll',
    monsterType: 'troll', maxHp: 7000, atk: 280, detectRadius: 50,
  },
  mon_knight1: {
    price: 75000, type: 'monster', label: 'Knight 1',
    monsterType: 'knight1', maxHp: 7500, atk: 300, detectRadius: 50,
  },
  mon_knight2: {
    price: 80000, type: 'monster', label: 'Knight 2',
    monsterType: 'knight2', maxHp: 8000, atk: 320, detectRadius: 55,
  },
  mon_knight3: {
    price: 85000, type: 'monster', label: 'Knight 3',
    monsterType: 'knight3', maxHp: 8500, atk: 340, detectRadius: 55,
  },
  mon_dragon: {
    price: 200000, type: 'monster', label: 'Dragon',
    monsterType: 'dragon', maxHp: 20000, atk: 500, detectRadius: 60,
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
  shop_misc: {
    price: 300000, type: 'shop', label: '잡템상점',
    shopType: 'shop_misc', image: '/assets/images/shops/castle.png',
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
      throw new Error(`GP 부족. 필요: ${price.toLocaleString()} GP, 보유: ${gold.toLocaleString()} GP`);
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
    // type 정규화 맵 — admin 배치(potion)와 유저 배치(shop_potion) 동일 카테고리 처리
    const TYPE_ALIASES = {
      shop_potion:       ['shop_potion', 'potion'],
      shop_weapon_armor: ['shop_weapon_armor', 'weapon_armor'],
      shop_misc:         ['shop_misc', 'misc'],
    };
    const aliasTypes = TYPE_ALIASES[def.shopType] || [def.shopType];

    // 5km 반경 내 동일 카테고리 중복 금지 — 모든 alias 타입 체크
    const nearbySnap = await db.collection('game_shops')
      .where('active', '==', true)
      .get();
    for (const doc of nearbySnap.docs) {
      const s = doc.data();
      if (!s.lat || !s.lng) continue;
      if (!aliasTypes.includes(s.type)) continue;
      if (haversineM(Number(lat), Number(lng), s.lat, s.lng) <= 5000) {
        throw new Error(
          `⛔ A "${s.type}" shop already exists within 5km: "${s.name}". ` +
          `Only one shop per category is allowed within a 5km radius.`
        );
      }
    }
    const ref = await db.collection('game_shops').add({
      ...base,
      name:  `${nim} ${def.label}${placeNo}`,
      type:  def.shopType,
      image: def.image ?? null,
      items: [],
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

module.exports = { CATALOG, placeUserObject, getMyPlacedObjects, getUserPlacePrices, adminSetUserPlacePrices };
