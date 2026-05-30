// functions/handlers/userPlace.js
// 유저가 GP로 보물박스 / 몬스터 / 아쳐타워를 지도 위에 배치
'use strict';

const admin = require('firebase-admin');
const db    = admin.firestore();


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
    shopType: 'shop_potion', image: '/assets/images/shops/potion.png',
  },
  shop_weapon: {
    price: 400000, type: 'shop', label: '무기상점',
    shopType: 'shop_weapon_armor', image: '/assets/images/shops/weapon.png',
  },
  shop_armor: {
    price: 400000, type: 'shop', label: '방어구 상점',
    shopType: 'shop_weapon_armor', image: '/assets/images/shops/armor.png',
  },
  shop_misc: {
    price: 300000, type: 'shop', label: '잡템상점',
    shopType: 'shop_misc', image: '/assets/images/shops/misc.png',
  },
};

// ── 1. 오브젝트 배치 ──────────────────────────────────────────────────────────
async function placeUserObject(uid, { itemKey, lat, lng }) {
  const def = CATALOG[itemKey];
  if (!def)           throw new Error('유효하지 않은 아이템 키');
  if (!lat || !lng)   throw new Error('좌표가 필요합니다');
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('유효하지 않은 좌표');

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
    if (gold < def.price) {
      throw new Error(`GP 부족. 필요: ${def.price.toLocaleString()} GP, 보유: ${gold.toLocaleString()} GP`);
    }
    placeNo = (uSnap.data()?.placeCount ?? 0) + 1;

    // ② 모든 write 나중
    t.set(bpRef,   { gold: admin.firestore.FieldValue.increment(-def.price) }, { merge: true });
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
    const ref = await db.collection('game_shops').add({
      ...base,
      name:  `${nim} ${def.label}${placeNo}`,
      type:  def.shopType,
      image: def.image ?? null,
      items: [],  // 관리자가 이후 아이템 등록
    });
    docId = ref.id;
  }

  return { ok: true, docId, itemKey, label: def.label, price: def.price };
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

module.exports = { CATALOG, placeUserObject, getMyPlacedObjects };
