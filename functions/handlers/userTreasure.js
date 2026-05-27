// functions/handlers/userTreasure.js
// 사용자 보물 등록 + NPC 자동 생성 시스템
'use strict';

const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');

const db = admin.firestore();

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 보물 위치에서 10~100m 랜덤 오프셋에 NPC 배치
function randomNearbyPos(lat, lng) {
  const dist  = 10 + Math.random() * 90;
  const angle = Math.random() * 2 * Math.PI;
  const dLat  = (dist * Math.cos(angle)) / 111320;
  const dLng  = (dist * Math.sin(angle)) / (111320 * Math.cos(lat * Math.PI / 180));
  return { lat: lat + dLat, lng: lng + dLng };
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

  if (type === 'item') {
    if (!itemId) throw new HttpsError('invalid-argument', 'itemId 필수');
    const invSnap = await db.collection('treasure_inventory').doc(`${uid}_${itemId}`).get();
    const current = invSnap.exists ? (invSnap.data().count || 0) : 0;
    if (current < count)
      throw new HttpsError('failed-precondition', `아이템 수량 부족 (보유: ${current})`);
    await db.collection('treasure_inventory').doc(`${uid}_${itemId}`).set({
      uid, itemId, count: current - count,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } else {
    const bpSnap = await db.collection('battle_players').doc(uid).get();
    const gold   = bpSnap.exists ? (bpSnap.data().gold || 0) : 0;
    if (gold < count)
      throw new HttpsError('failed-precondition', `골드 부족 (보유: ${gold})`);
    await db.collection('battle_players').doc(uid).set({
      gold: admin.firestore.FieldValue.increment(-count),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  const npcImageNum = Math.ceil(Math.random() * 10);
  const npcPos      = randomNearbyPos(Number(lat), Number(lng));
  const expiresAt   = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const treasureRef = db.collection('user_treasures').doc();
  const npcRef      = db.collection('user_treasure_npcs').doc();

  const commonData = {
    hint:    String(hint).slice(0, 200),
    story:   String(story   || '').slice(0, 500),
    comment: String(comment || '').slice(0, 200),
    radiusM: radius,
    type,
    itemId:    type === 'item' ? String(itemId) : null,
    itemCount: count,
  };

  await db.runTransaction(async tx => {
    tx.set(treasureRef, {
      ...commonData,
      ownerId:    uid,
      ownerName:  displayName,
      ownerPhoto: photoURL,
      lat:  Number(lat),
      lng:  Number(lng),
      status:   'active',
      foundBy:  null,
      foundAt:  null,
      npcId:    npcRef.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
    });
    tx.set(npcRef, {
      ...commonData,
      userTreasureId: treasureRef.id,
      ownerId:      uid,
      ownerName:    displayName,
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

  await db.runTransaction(async tx => {
    tx.update(treasureRef, {
      status:      'found',
      foundBy:     uid,
      foundByName: finderName,
      foundAt:     admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.update(db.collection('user_treasure_npcs').doc(npcId), { status: 'found' });

    if (treasure.type === 'item') {
      const invRef = db.collection('treasure_inventory').doc(`${uid}_${treasure.itemId}`);
      tx.set(invRef, {
        uid, itemId: treasure.itemId,
        count: admin.firestore.FieldValue.increment(treasure.itemCount || 1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } else {
      tx.set(db.collection('battle_players').doc(uid), {
        gold:      admin.firestore.FieldValue.increment(treasure.itemCount || 0),
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
    ownerName: treasure.ownerName,
  };
}

// ── NPC 목록 조회 (활성 상태) ─────────────────────────────────────────────────
async function listUserTreasureNpcs() {
  const snap = await db.collection('user_treasure_npcs')
    .where('status', '==', 'active')
    .orderBy('createdAt', 'desc')
    .limit(200)
    .get();

  return snap.docs.map(d => {
    const r = d.data();
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

// ── 내 보물 취소 (아이템 반환) ────────────────────────────────────────────────
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
    } else {
      tx.set(db.collection('battle_players').doc(uid), {
        gold:      admin.firestore.FieldValue.increment(treasure.itemCount || 0),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });

  return { ok: true };
}

// ── 댓글 추가 ────────────────────────────────────────────────────────────────
async function addTreasureComment(uid, { npcId, text } = {}) {
  if (!npcId || !text || !String(text).trim())
    throw new HttpsError('invalid-argument', 'npcId, text 필수');
  const trimmed = String(text).trim().slice(0, 200);
  if (trimmed.length < 1)
    throw new HttpsError('invalid-argument', '댓글 내용을 입력하세요');

  const npcSnap = await db.collection('user_treasure_npcs').doc(npcId).get();
  if (!npcSnap.exists) throw new HttpsError('not-found', 'NPC를 찾을 수 없습니다');

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

// ── 댓글 삭제 (본인 또는 관리자) ─────────────────────────────────────────────
async function deleteTreasureComment(uid, { npcId, commentId } = {}, isAdmin = false) {
  if (!npcId || !commentId)
    throw new HttpsError('invalid-argument', 'npcId, commentId 필수');

  const npcSnap = await db.collection('user_treasure_npcs').doc(npcId).get();
  if (!npcSnap.exists) throw new HttpsError('not-found', 'NPC를 찾을 수 없습니다');
  const npcData = npcSnap.data();

  const commentRef = db.collection('user_treasure_npcs').doc(npcId).collection('comments').doc(commentId);
  const commentSnap = await commentRef.get();
  if (!commentSnap.exists) throw new HttpsError('not-found', '댓글을 찾을 수 없습니다');
  const comment = commentSnap.data();

  // 댓글 작성자, NPC 소유자(보물 숨긴 사람), 관리자만 삭제 가능
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
  addTreasureComment,
  deleteTreasureComment,
  listTreasureComments,
};
