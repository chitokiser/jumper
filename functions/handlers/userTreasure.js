// functions/handlers/userTreasure.js
// 사용자 보물 등록 + NPC 자동 생성 시스템
'use strict';

const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');

const db = admin.firestore();

const HINT_COST      = 10;   // 힌트/댓글 잠금 해제 코인
const MANDATORY_COIN = 100;  // 보물 등록 시 필수 추가 코인 보상

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 보물 위치에서 10~100m 랜덤 오프셋 — NPC용
function randomNearbyPos(lat, lng) {
  const dist  = 10 + Math.random() * 90;
  const angle = Math.random() * 2 * Math.PI;
  const dLat  = (dist * Math.cos(angle)) / 111320;
  const dLng  = (dist * Math.sin(angle)) / (111320 * Math.cos(lat * Math.PI / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

// 보물 위치에서 20~50m 랜덤 오프셋 — 경비 몬스터/타워용
function _randomGuardPos(lat, lng) {
  const dist  = 20 + Math.random() * 30;
  const angle = Math.random() * 2 * Math.PI;
  const dLat  = (dist * Math.cos(angle)) / 111320;
  const dLng  = (dist * Math.sin(angle)) / (111320 * Math.cos(lat * Math.PI / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

// 보물 등록 시 경비 몬스터 2마리 + 대포타워 1개 자동 배치
async function _autoSpawnGuards(lat, lng) {
  const MONSTERS = [
    { name: 'Shadow Lurker', image: '22.png', hp: 600, atk: 60, detect: 30 },
    { name: 'Stone Sentry',  image: '22.png', hp: 800, atk: 50, detect: 35 },
  ];
  const batch = db.batch();
  const now   = admin.firestore.FieldValue.serverTimestamp();

  for (let i = 0; i < 2; i++) {
    const pos = _randomGuardPos(lat, lng);
    const mon = MONSTERS[i];
    batch.set(db.collection('battle_monsters').doc(), {
      name:           mon.name,
      image:          mon.image,
      monsterType:    'normal',
      lat:            pos.lat,
      lng:            pos.lng,
      maxHp:          mon.hp,
      hp:             mon.hp,
      atk:            mon.atk,
      detectRadius:   mon.detect,
      respawnMinutes: 5,
      active:         true,
      createdAt:      now,
    });
  }

  const towerPos = _randomGuardPos(lat, lng);
  batch.set(db.collection('battle_towers').doc(), {
    name:      'Treasure Cannon',
    lat:       towerPos.lat,
    lng:       towerPos.lng,
    atk:       80,
    radius:    30,
    image:     '/assets/images/shops/tower2.png',
    type:      'cannon',
    hp:        1000,
    active:    true,
    createdAt: now,
  });

  await batch.commit();
}

// ── 보물 등록 ────────────────────────────────────────────────────────────────
async function registerUserTreasure(uid, {
  type, itemId, itemCount, lat, lng, hint, story, comment, radiusM,
} = {}) {
  if (!type || lat == null || lng == null)
    throw new HttpsError('invalid-argument', 'type, lat, lng 필수');
  if (type !== 'item' && type !== 'coin')
    throw new HttpsError('invalid-argument', 'type은 item 또는 coin');
  if (!hint || String(hint).trim().length < 5)
    throw new HttpsError('invalid-argument', '힌트는 5자 이상 입력하세요');

  const radius = Math.max(5, Math.min(50, Number(radiusM) || 5));
  const count  = Math.max(1, Math.floor(Number(itemCount) || 1));

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) throw new HttpsError('not-found', '유저 없음');
  const user        = userSnap.data();
  const displayName = user.displayName || user.name || '익명';
  const photoURL    = user.photoURL || null;

  // 골드 잔액 확인 (아이템 등록 시에도 100 Coin 필수)
  const bpSnap = await db.collection('battle_players').doc(uid).get();
  const gold   = bpSnap.exists ? (bpSnap.data().gold || 0) : 0;

  if (type === 'item') {
    if (!itemId) throw new HttpsError('invalid-argument', 'itemId 필수');
    const invSnap = await db.collection('treasure_inventory').doc(`${uid}_${itemId}`).get();
    const current = invSnap.exists ? (invSnap.data().count || 0) : 0;
    if (current < count)
      throw new HttpsError('failed-precondition', `아이템 수량 부족 (보유: ${current})`);
    if (gold < MANDATORY_COIN)
      throw new HttpsError('failed-precondition',
        `Coin 부족. 보물 등록에는 아이템 외 ${MANDATORY_COIN} Coin이 추가로 필요합니다 (보유: ${gold})`);
  } else {
    // 코인 타입: 등록 금액 + 필수 100 Coin
    const totalNeeded = count + MANDATORY_COIN;
    if (gold < totalNeeded)
      throw new HttpsError('failed-precondition',
        `Coin 부족 (보유: ${gold}, 필요: ${totalNeeded} = 보물 ${count} + 기본보상 ${MANDATORY_COIN})`);
  }

  const npcImageNum = Math.ceil(Math.random() * 10);
  const npcPos      = randomNearbyPos(Number(lat), Number(lng));
  const expiresAt   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const treasureRef = db.collection('user_treasures').doc();
  const npcRef      = db.collection('user_treasure_npcs').doc();

  const commonData = {
    hint:      String(hint).slice(0, 200),
    story:     String(story   || '').slice(0, 500),
    comment:   String(comment || '').slice(0, 200),
    radiusM:   radius,
    type,
    itemId:    type === 'item' ? String(itemId) : null,
    itemCount: count,
    bonusCoin: MANDATORY_COIN,
  };

  await db.runTransaction(async tx => {
    if (type === 'item') {
      const invRef = db.collection('treasure_inventory').doc(`${uid}_${itemId}`);
      const invSnap2 = await tx.get(invRef);
      const current2 = invSnap2.exists ? (invSnap2.data().count || 0) : 0;
      if (current2 < count)
        throw new HttpsError('failed-precondition', `아이템 수량 부족`);
      tx.set(invRef, {
        uid, itemId, count: current2 - count,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    // 공통: 골드 차감 (아이템 타입=100, 코인 타입=count+100)
    const deductGold = type === 'item' ? MANDATORY_COIN : (count + MANDATORY_COIN);
    tx.set(db.collection('battle_players').doc(uid), {
      gold:      admin.firestore.FieldValue.increment(-deductGold),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.set(treasureRef, {
      ...commonData,
      ownerId:    uid,
      ownerName:  displayName,
      ownerPhoto: photoURL,
      lat:  Number(lat),
      lng:  Number(lng),
      status:    'active',
      foundBy:   null,
      foundAt:   null,
      npcId:     npcRef.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
    });
    tx.set(npcRef, {
      ...commonData,
      userTreasureId: treasureRef.id,
      ownerId:        uid,
      ownerName:      displayName,
      npcImageNum,
      lat:         npcPos.lat,
      lng:         npcPos.lng,
      treasureLat: Number(lat),
      treasureLng: Number(lng),
      status:    'active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
    });
  });

  // 경비 몬스터 + 타워 자동 배치 (비동기, 실패해도 등록은 완료)
  _autoSpawnGuards(Number(lat), Number(lng)).catch(() => {});

  return { ok: true, treasureId: treasureRef.id, npcId: npcRef.id };
}

// ── 보물 발견 ─────────────────────────────────────────────────────────────────
async function discoverUserTreasure(uid, { npcId, userLat, userLng } = {}) {
  if (!npcId || userLat == null || userLng == null)
    throw new HttpsError('invalid-argument', 'npcId, userLat, userLng 필수');

  const npcSnap = await db.collection('user_treasure_npcs').doc(npcId).get();
  if (!npcSnap.exists) throw new HttpsError('not-found', 'NPC를 찾을 수 없습니다');
  const npc = npcSnap.data();
  if (npc.status !== 'active')
    throw new HttpsError('failed-precondition', '이미 발견된 보물입니다');

  const treasureRef  = db.collection('user_treasures').doc(npc.userTreasureId);
  const treasureSnap = await treasureRef.get();
  if (!treasureSnap.exists) throw new HttpsError('not-found', '보물을 찾을 수 없습니다');
  const treasure = treasureSnap.data();
  if (treasure.status !== 'active')
    throw new HttpsError('failed-precondition', '이미 발견된 보물입니다');
  if (treasure.ownerId === uid)
    throw new HttpsError('permission-denied', '자신의 보물은 발견할 수 없습니다');

  const dist = haversine(
    Number(userLat), Number(userLng),
    treasure.lat,    treasure.lng
  );
  if (dist > treasure.radiusM)
    throw new HttpsError('failed-precondition',
      `보물과 ${Math.round(dist)}m 떨어져 있습니다. ${treasure.radiusM}m 이내로 접근하세요.`);

  const finderSnap = await db.collection('users').doc(uid).get();
  const finderName = finderSnap.exists
    ? (finderSnap.data().displayName || finderSnap.data().name || '익명')
    : '익명';

  const bonusCoin = treasure.bonusCoin || 0;

  await db.runTransaction(async tx => {
    tx.update(treasureRef, {
      status:      'found',
      foundBy:     uid,
      foundByName: finderName,
      foundAt:     admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.delete(db.collection('user_treasure_npcs').doc(npcId));

    if (treasure.type === 'item') {
      const invRef = db.collection('treasure_inventory').doc(`${uid}_${treasure.itemId}`);
      tx.set(invRef, {
        uid, itemId: treasure.itemId,
        count: admin.firestore.FieldValue.increment(treasure.itemCount || 1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      // 보너스 코인도 지급
      if (bonusCoin > 0) {
        tx.set(db.collection('battle_players').doc(uid), {
          gold:      admin.firestore.FieldValue.increment(bonusCoin),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    } else {
      // 코인 타입: 보물 코인 + 보너스 코인
      const totalCoin = (treasure.itemCount || 0) + bonusCoin;
      tx.set(db.collection('battle_players').doc(uid), {
        gold:      admin.firestore.FieldValue.increment(totalCoin),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });

  db.collection('battle_players').doc(uid).set(
    { treasuresFound: admin.firestore.FieldValue.increment(1) },
    { merge: true }
  ).catch(() => {});

  return {
    ok: true,
    type:      treasure.type,
    itemId:    treasure.itemId,
    itemCount: treasure.itemCount,
    bonusCoin,
    ownerName: treasure.ownerName,
  };
}

// ── NPC 목록 조회 (활성 상태) ─────────────────────────────────────────────────
async function listUserTreasureNpcs(uid = null) {
  let isAdmin = false;
  if (uid) {
    const adminSnap = await db.collection('admins').doc(uid).get();
    isAdmin = adminSnap.exists;
  }

  const snap = await db.collection('user_treasure_npcs')
    .where('status', '==', 'active')
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get();

  return snap.docs.map(d => {
    const r = d.data();
    const showActual = isAdmin || (uid && r.ownerId === uid);
    return {
      id:          d.id,
      ownerId:     r.ownerId,
      ownerName:   r.ownerName,
      npcImageNum: r.npcImageNum || 1,
      lat:         r.lat,
      lng:         r.lng,
      hint:        r.hint,
      story:       r.story,
      comment:     r.comment,
      radiusM:     r.radiusM,
      type:        r.type,
      itemId:      r.itemId,
      itemCount:   r.itemCount,
      bonusCoin:   r.bonusCoin || 0,
      ...(showActual && r.treasureLat != null
        ? { treasureLat: r.treasureLat, treasureLng: r.treasureLng }
        : {}),
    };
  });
}

// ── 내 보물 목록 ──────────────────────────────────────────────────────────────
async function getMyUserTreasures(uid) {
  const snap = await db.collection('user_treasures')
    .where('ownerId', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── 내 보물 취소 (아이템/코인 + 보너스 코인 반환) ─────────────────────────────
async function cancelUserTreasure(uid, { treasureId } = {}) {
  if (!treasureId) throw new HttpsError('invalid-argument', 'treasureId 필수');

  const treasureRef  = db.collection('user_treasures').doc(treasureId);
  const treasureSnap = await treasureRef.get();
  if (!treasureSnap.exists) throw new HttpsError('not-found', '보물 없음');
  const treasure = treasureSnap.data();
  if (treasure.ownerId !== uid)
    throw new HttpsError('permission-denied', '권한 없음');
  if (treasure.status !== 'active')
    throw new HttpsError('failed-precondition', '활성 상태가 아닙니다');

  const bonusCoin = treasure.bonusCoin || 0;

  await db.runTransaction(async tx => {
    tx.update(treasureRef, {
      status:      'cancelled',
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (treasure.npcId) {
      tx.update(db.collection('user_treasure_npcs').doc(treasure.npcId), { status: 'cancelled' });
    }
    if (treasure.type === 'item') {
      const invRef = db.collection('treasure_inventory').doc(`${uid}_${treasure.itemId}`);
      tx.set(invRef, {
        uid, itemId: treasure.itemId,
        count:     admin.firestore.FieldValue.increment(treasure.itemCount || 1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      // 보너스 코인 반환
      if (bonusCoin > 0) {
        tx.set(db.collection('battle_players').doc(uid), {
          gold:      admin.firestore.FieldValue.increment(bonusCoin),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    } else {
      // 코인 타입: 보물 코인 + 보너스 코인 반환
      const totalReturn = (treasure.itemCount || 0) + bonusCoin;
      tx.set(db.collection('battle_players').doc(uid), {
        gold:      admin.firestore.FieldValue.increment(totalReturn),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });

  return { ok: true };
}

// ── 힌트 잠금 해제 여부 확인 ─────────────────────────────────────────────────
async function checkHintUnlock(uid, { npcId } = {}) {
  if (!npcId) throw new HttpsError('invalid-argument', 'npcId 필수');
  const npcSnap = await db.collection('user_treasure_npcs').doc(npcId).get();
  if (!npcSnap.exists) throw new HttpsError('not-found', 'NPC를 찾을 수 없습니다');
  // 본인 보물은 항상 잠금 해제
  if (npcSnap.data().ownerId === uid) return { unlocked: true };
  const unlockSnap = await db.collection('hint_unlocks').doc(`${uid}_${npcId}`).get();
  return { unlocked: unlockSnap.exists };
}

// ── 힌트 잠금 해제 (10 Coin → 보물 소유자에게 지급) ─────────────────────────
async function unlockHint(uid, { npcId } = {}) {
  if (!npcId) throw new HttpsError('invalid-argument', 'npcId 필수');

  const npcSnap = await db.collection('user_treasure_npcs').doc(npcId).get();
  if (!npcSnap.exists) throw new HttpsError('not-found', 'NPC를 찾을 수 없습니다');
  const npc = npcSnap.data();

  // 본인 보물은 무료
  if (npc.ownerId === uid) return { ok: true, alreadyUnlocked: true };

  const unlockRef = db.collection('hint_unlocks').doc(`${uid}_${npcId}`);
  const unlockSnap = await unlockRef.get();
  if (unlockSnap.exists) return { ok: true, alreadyUnlocked: true };

  await db.runTransaction(async tx => {
    const bpRef  = db.collection('battle_players').doc(uid);
    const bpSnap = await tx.get(bpRef);
    const gold   = bpSnap.exists ? (bpSnap.data().gold || 0) : 0;
    if (gold < HINT_COST)
      throw new HttpsError('failed-precondition',
        `Coin 부족 (보유: ${gold}, 필요: ${HINT_COST})`);

    tx.set(bpRef, {
      gold:      admin.firestore.FieldValue.increment(-HINT_COST),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(db.collection('battle_players').doc(npc.ownerId), {
      gold:      admin.firestore.FieldValue.increment(HINT_COST),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(unlockRef, {
      uid, npcId,
      unlockedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, alreadyUnlocked: false };
}

// ── 댓글 추가 (힌트 잠금 해제 필수) ─────────────────────────────────────────
async function addTreasureComment(uid, { npcId, text } = {}) {
  if (!npcId || !text || !String(text).trim())
    throw new HttpsError('invalid-argument', 'npcId, text 필수');
  const trimmed = String(text).trim().slice(0, 500);
  if (trimmed.length < 1)
    throw new HttpsError('invalid-argument', '댓글 내용을 입력하세요');

  const npcSnap = await db.collection('user_treasure_npcs').doc(npcId).get();
  if (!npcSnap.exists) throw new HttpsError('not-found', 'NPC를 찾을 수 없습니다');
  const npcData = npcSnap.data();

  // 본인 보물이 아니면 힌트 잠금 해제 확인
  if (npcData.ownerId !== uid) {
    const unlockSnap = await db.collection('hint_unlocks').doc(`${uid}_${npcId}`).get();
    if (!unlockSnap.exists)
      throw new HttpsError('failed-precondition',
        '댓글 작성 전 힌트를 먼저 잠금 해제하세요 (10 Coin)');
  }

  const userSnap = await db.collection('users').doc(uid).get();
  const displayName = userSnap.exists
    ? (userSnap.data().displayName || userSnap.data().name || '익명')
    : '익명';

  const ref = db.collection('user_treasure_npcs').doc(npcId).collection('comments').doc();
  await ref.set({
    uid,
    displayName,
    text: trimmed,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true, commentId: ref.id };
}

// ── 댓글 삭제 (본인 또는 NPC 소유자 또는 관리자) ─────────────────────────────
async function deleteTreasureComment(uid, { npcId, commentId } = {}, isAdmin = false) {
  if (!npcId || !commentId)
    throw new HttpsError('invalid-argument', 'npcId, commentId 필수');

  const npcSnap = await db.collection('user_treasure_npcs').doc(npcId).get();
  if (!npcSnap.exists) throw new HttpsError('not-found', 'NPC를 찾을 수 없습니다');
  const npcData = npcSnap.data();

  const commentRef  = db.collection('user_treasure_npcs').doc(npcId).collection('comments').doc(commentId);
  const commentSnap = await commentRef.get();
  if (!commentSnap.exists) throw new HttpsError('not-found', '댓글을 찾을 수 없습니다');
  const comment = commentSnap.data();

  if (comment.uid !== uid && npcData.ownerId !== uid && !isAdmin)
    throw new HttpsError('permission-denied', '삭제 권한이 없습니다');

  await commentRef.delete();
  return { ok: true };
}

// ── 댓글 목록 조회 ───────────────────────────────────────────────────────────
async function listTreasureComments({ npcId } = {}) {
  if (!npcId) throw new HttpsError('invalid-argument', 'npcId 필수');

  const snap = await db.collection('user_treasure_npcs').doc(npcId)
    .collection('comments')
    .orderBy('createdAt', 'asc')
    .limit(50)
    .get();

  return snap.docs.map(d => {
    const r = d.data();
    return {
      id:          d.id,
      uid:         r.uid,
      displayName: r.displayName,
      text:        r.text,
      createdAt:   r.createdAt?.toMillis() ?? null,
    };
  });
}

module.exports = {
  registerUserTreasure,
  discoverUserTreasure,
  listUserTreasureNpcs,
  getMyUserTreasures,
  cancelUserTreasure,
  checkHintUnlock,
  unlockHint,
  addTreasureComment,
  deleteTreasureComment,
  listTreasureComments,
};
