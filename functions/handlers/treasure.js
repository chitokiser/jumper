// functions/handlers/treasure.js
// 보물찾기 시스템
'use strict';

const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');
const { requireAdmin } = require('../wallet/admin');
const { getProvider, getCoopMallContract } = require('../wallet/chain');

const db = admin.firestore();

// ── 하버사인 거리 계산 (m) ────────────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── 가중 랜덤 아이템 선택 ──────────────────────────────────────────────────────
function pickWeightedItem(itemPool) {
  const total = itemPool.reduce((s, e) => s + (e.weight || 1), 0);
  let r = Math.random() * total;
  for (const e of itemPool) {
    r -= (e.weight || 1);
    if (r <= 0) return e.itemId;
  }
  return itemPool[itemPool.length - 1].itemId;
}

// ── 시간 범위 확인 ─────────────────────────────────────────────────────────────
// startHour, endHour (0-23)
function isInTimeRange(startHour, endHour) {
  const now = new Date();
  // Vietnam time (UTC+7)
  const h = (now.getUTCHours() + 7) % 24;
  if (startHour <= endHour) return h >= startHour && h < endHour;
  return h >= startHour || h < endHour; // 야간 범위 (ex: 22~06)
}

// ── 유저: 몬스터 열쇠 드랍 수령 ──────────────────────────────────────────────
async function earnKey(uid, { keyId } = {}) {
  if (!keyId) throw new HttpsError('invalid-argument', 'keyId가 필요합니다');

  const keySnap = await db.collection('treasure_keys').doc(String(keyId)).get();
  if (!keySnap.exists) throw new HttpsError('not-found', '열쇠 정의를 찾을 수 없습니다');
  const keyDef = keySnap.data();
  if (!keyDef.active) throw new HttpsError('failed-precondition', '비활성 열쇠입니다');

  const itemId = `key_${keyId}`;
  const invRef = db.collection('treasure_inventory').doc(`${uid}_${itemId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(invRef);
    const current = snap.exists ? (snap.data().count || 0) : 0;
    tx.set(invRef, {
      uid, itemId, count: current + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  return { ok: true, keyId: String(keyId), keyName: keyDef.name || `열쇠 #${keyId}` };
}

// ── 유저: 보물박스 수집 (GPS 근접 → 박스를 인벤토리에 저장, 미개봉) ──────────
async function collectTreasureBox(uid, { boxId, userLat, userLng } = {}) {
  if (!boxId)        throw new HttpsError('invalid-argument', 'boxId가 필요합니다');
  if (userLat == null || userLng == null)
    throw new HttpsError('invalid-argument', '위치 정보가 필요합니다');

  // 박스 조회
  const boxSnap = await db.collection('treasure_boxes').doc(boxId).get();
  if (!boxSnap.exists) throw new HttpsError('not-found', '보물박스를 찾을 수 없습니다');
  const box = boxSnap.data();
  if (!box.active)   throw new HttpsError('failed-precondition', '비활성 보물박스입니다');

  // 시간 범위 확인
  if (!isInTimeRange(box.startHour ?? 0, box.endHour ?? 24))
    throw new HttpsError('failed-precondition', '보물박스가 현재 시간에 열려있지 않습니다');

  // 서버측 거리 확인 (30m 허용 — GPS 오차 고려)
  const dist = haversine(userLat, userLng, box.lat, box.lng);
  if (dist > 30)
    throw new HttpsError('failed-precondition', `너무 멀리 있습니다 (${Math.round(dist)}m)`);

  // 평생 1회 수집 제한
  const invBoxKey = `${uid}_${boxId}`;
  const logRef  = db.collection('treasure_logs').doc(invBoxKey);
  const logSnap = await logRef.get();
  if (logSnap.exists)
    throw new HttpsError('already-exists', '이미 획득한 보물박스입니다');

  // 정회원 전용 박스: CoopMall 멤버십 확인
  if (box.memberOnly) {
    const userSnap = await db.collection('users').doc(uid).get();
    const walletAddress = userSnap.data()?.wallet?.address;
    if (!walletAddress) throw new HttpsError('failed-precondition', '수탁 지갑이 없습니다');
    const provider = getProvider();
    const coopMall = getCoopMallContract(provider);
    const info = await coopMall.getUserInfo(walletAddress);
    if (!info.member) throw new HttpsError('permission-denied', '정회원 전용 보물박스입니다. CoopMall 정회원 가입 후 이용하세요.');
  }

  const itemPool = box.itemPool || [];
  if (!itemPool.length) throw new HttpsError('failed-precondition', '아이템 풀이 비어 있습니다');

  // 트랜잭션: 미개봉 박스 인벤토리 저장 + 수집 로그 기록
  const invBoxRef = db.collection('treasure_inventory_boxes').doc(invBoxKey);
  await db.runTransaction(async (tx) => {
    tx.set(invBoxRef, {
      uid, boxId,
      boxName:   box.name      || '',
      itemPool,
      hiddenBox: box.hiddenBox === true,
      keyId:     box.keyId     || null,
      collectedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.set(logRef, {
      uid, boxId,
      collectedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, boxName: box.name || '보물박스' };
}

// ── 관리자: GPS 없이 박스 수집 (테스트/PC용) ─────────────────────────────────
async function adminCollectTreasureBox(adminUid, { boxId } = {}) {
  await requireAdmin(adminUid);
  if (!boxId) throw new HttpsError('invalid-argument', 'boxId가 필요합니다');

  const boxSnap = await db.collection('treasure_boxes').doc(boxId).get();
  if (!boxSnap.exists) throw new HttpsError('not-found', '보물박스를 찾을 수 없습니다');
  const box = boxSnap.data();
  if (!box.active) throw new HttpsError('failed-precondition', '비활성 보물박스입니다');

  const itemPool = box.itemPool || [];
  if (!itemPool.length) throw new HttpsError('failed-precondition', '아이템 풀이 비어 있습니다');

  const logKey = `${adminUid}_${boxId}`;
  const logRef = db.collection('treasure_logs').doc(logKey);
  const logSnap = await logRef.get();
  if (logSnap.exists) throw new HttpsError('already-exists', '이미 수집한 보물박스입니다');

  const invBoxRef = db.collection('treasure_inventory_boxes').doc(logKey);
  await db.runTransaction(async (tx) => {
    tx.set(invBoxRef, {
      uid: adminUid, boxId,
      boxName:   box.name      || '',
      itemPool,
      hiddenBox: box.hiddenBox === true,
      keyId:     box.keyId     || null,
      collectedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.set(logRef, {
      uid: adminUid, boxId,
      collectedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { ok: true, boxName: box.name || '보물박스' };
}

// ── 유저: 보물박스 오픈 (인벤토리의 미개봉 박스 → 랜덤 아이템 획득) ──────────
async function openTreasureBox(uid, { boxId } = {}) {
  if (!boxId) throw new HttpsError('invalid-argument', 'boxId가 필요합니다');

  const invBoxRef = db.collection('treasure_inventory_boxes').doc(`${uid}_${boxId}`);
  const invBoxSnap = await invBoxRef.get();
  if (!invBoxSnap.exists)
    throw new HttpsError('not-found', '인벤토리에 해당 보물박스가 없습니다');

  const invBox = invBoxSnap.data();
  const itemPool = invBox.itemPool || [];
  if (!itemPool.length) throw new HttpsError('failed-precondition', '아이템 풀이 비어 있습니다');

  // 숨김 보물박스만 열쇠 확인 (정확한 keyId 매칭)
  const needKey = invBox.hiddenBox === true && invBox.keyId;
  let keyInvRef = null;
  if (needKey) {
    const keyDocId = `${uid}_key_${invBox.keyId}`;
    const keyDocRef = db.collection('treasure_inventory').doc(keyDocId);
    const keyDocSnap = await keyDocRef.get();
    if (!keyDocSnap.exists || (keyDocSnap.data().count || 0) <= 0)
      throw new HttpsError('failed-precondition',
        `열쇠가 없습니다. Key #${invBox.keyId} 을(를) 몬스터 처치로 획득하세요.`);
    keyInvRef = keyDocRef;
  }

  // 랜덤 아이템 선택
  const itemId = pickWeightedItem(itemPool);

  // 아이템 정보 조회
  const itemSnap = await db.collection('treasure_items').doc(String(itemId)).get();
  const itemData = itemSnap.exists ? itemSnap.data() : { name: `아이템 #${itemId}`, image: `${itemId}.png` };

  // 트랜잭션: 열쇠 소비(해당 시) + 미개봉 박스 삭제 + 아이템 인벤토리 적립
  await db.runTransaction(async (tx) => {
    if (keyInvRef) {
      const keySnap2 = await tx.get(keyInvRef);
      const currentKey = keySnap2.exists ? (keySnap2.data().count || 0) : 0;
      if (currentKey <= 0)
        throw new HttpsError('failed-precondition', '열쇠가 없습니다 (동시 처리 중 소진)');
      if (currentKey - 1 <= 0) {
        tx.delete(keyInvRef);
      } else {
        tx.update(keyInvRef, { count: currentKey - 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      }
    }

    const invRef = db.collection('treasure_inventory').doc(`${uid}_${itemId}`);
    const invSnap = await tx.get(invRef);
    const current = invSnap.exists ? (invSnap.data().count || 0) : 0;
    tx.set(invRef, {
      uid, itemId: String(itemId), count: current + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.delete(invBoxRef);
  });

  return {
    ok: true,
    itemId:    String(itemId),
    itemName:  itemData.name,
    itemImage: itemData.image,
    keyId:     needKey ? String(invBox.keyId) : null,
  };
}

// ── 유저: 아이템 조합 → 바우처 획득 ──────────────────────────────────────────
async function craftVoucher(uid, { voucherId } = {}) {
  if (!voucherId) throw new HttpsError('invalid-argument', 'voucherId가 필요합니다');

  const vSnap = await db.collection('treasure_vouchers').doc(voucherId).get();
  if (!vSnap.exists) throw new HttpsError('not-found', '바우처를 찾을 수 없습니다');
  const voucher = vSnap.data();
  if (!voucher.active) throw new HttpsError('failed-precondition', '비활성 바우처입니다');

  const reqs = voucher.requirements || [];
  const goldReqs = reqs.filter(r => r.type === 'gold' || r.itemId === 'coin');
  const itemReqs = reqs.filter(r => r.type !== 'gold' && r.itemId !== 'coin');
  const goldNeeded = goldReqs.reduce((s, r) => s + (r.count || 0), 0)
                   + (voucher.minCoins || 0);

  // 보상 아이템 ID 미리 결정 (트랜잭션 밖에서 계산)
  const rewardItemId = (voucher.reward || '').trim();
  const isItemReward = /^(weapon_|armo_|potion_|revive_ticket)/.test(rewardItemId);

  return await db.runTransaction(async (tx) => {
    // ── 모든 읽기를 쓰기 전에 완료 (Firestore 트랜잭션 규칙) ──────────────────

    // 1) 중복 구매 방지
    const purchaseRef = db.collection('treasure_voucher_purchases').doc(`${uid}_${voucherId}`);
    const purchaseSnap = await tx.get(purchaseRef);
    if (purchaseSnap.exists) {
      throw new HttpsError('already-exists', '이미 구매한 바우처입니다');
    }

    // 2) 코인(gold) 잔액
    let playerRef, currentGold = 0;
    if (goldNeeded > 0) {
      playerRef = db.collection('battle_players').doc(uid);
      const pSnap = await tx.get(playerRef);
      currentGold = pSnap.exists ? (pSnap.data().gold || 0) : 0;
      if (currentGold < goldNeeded)
        throw new HttpsError('failed-precondition',
          `코인 부족 (보유 ${currentGold}, 필요 ${goldNeeded})`);
    }

    // 3) 재료 아이템 잔액
    const invRefs  = itemReqs.map(r => db.collection('treasure_inventory').doc(`${uid}_${r.itemId}`));
    const invSnaps = await Promise.all(invRefs.map(ref => tx.get(ref)));
    for (let i = 0; i < itemReqs.length; i++) {
      const have = invSnaps[i].exists ? (invSnaps[i].data().count || 0) : 0;
      if (have < itemReqs[i].count)
        throw new HttpsError('failed-precondition',
          `아이템 부족: ${itemReqs[i].itemId} (보유 ${have}개, 필요 ${itemReqs[i].count}개)`);
    }

    // 4) 보상 아이템 현재 수량 (쓰기 전에 미리 읽기)
    let rewardInvRef, rewardCurrentCount = 0;
    if (isItemReward) {
      rewardInvRef = db.collection('treasure_inventory').doc(`${uid}_${rewardItemId}`);
      const rewardSnap = await tx.get(rewardInvRef);
      rewardCurrentCount = rewardSnap.exists ? (rewardSnap.data().count || 0) : 0;
    }

    // ── 이하 쓰기만 ──────────────────────────────────────────────────────────

    // 코인 차감
    if (goldNeeded > 0) {
      tx.update(playerRef, {
        gold: currentGold - goldNeeded,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // 재료 아이템 차감
    for (let i = 0; i < itemReqs.length; i++) {
      const have = invSnaps[i].exists ? (invSnaps[i].data().count || 0) : 0;
      tx.update(invRefs[i], {
        count: have - itemReqs[i].count,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // 바우처 지급 기록
    tx.set(db.collection('treasure_voucher_logs').doc(), {
      uid, voucherId,
      voucherName: voucher.name  || '',
      reward:      voucher.reward || '',
      image:       voucher.image  || '',
      craftedAt:   admin.firestore.FieldValue.serverTimestamp(),
    });

    // 중복 구매 방지 마커
    tx.set(purchaseRef, {
      uid, voucherId,
      purchasedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 보상 아이템 지급
    if (isItemReward) {
      tx.set(rewardInvRef, {
        uid, itemId: rewardItemId,
        count: rewardCurrentCount + 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    return { ok: true, voucherName: voucher.name, reward: voucher.reward };
  });
}

// ── 관리자: 유저에게 아이템 직접 지급 ──────────────────────────────────────────
async function adminGrantItem(adminUid, { targetUid, targetEmail, itemId, count } = {}) {
  await requireAdmin(adminUid);
  if (!itemId) throw new HttpsError('invalid-argument', 'itemId가 필요합니다');
  count = parseInt(count) || 1;
  if (count < 1) throw new HttpsError('invalid-argument', 'count는 1 이상이어야 합니다');

  // targetEmail로 uid 조회
  let uid = targetUid;
  if (!uid && targetEmail) {
    const snap = await db.collection('users').where('email', '==', targetEmail).limit(1).get();
    if (snap.empty) throw new HttpsError('not-found', `이메일 ${targetEmail} 유저를 찾을 수 없습니다`);
    uid = snap.docs[0].id;
  }
  if (!uid) throw new HttpsError('invalid-argument', 'targetUid 또는 targetEmail이 필요합니다');

  const invRef = db.collection('treasure_inventory').doc(`${uid}_${itemId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(invRef);
    const current = snap.exists ? (snap.data().count || 0) : 0;
    tx.set(invRef, {
      uid, itemId: String(itemId),
      count: current + count,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  return { ok: true, uid, itemId, count };
}

// ── 관리자: 아이템 저장 ────────────────────────────────────────────────────────
async function adminSaveTreasureItem(adminUid, { itemId, name, image, description, category, armoFolder } = {}) {
  await requireAdmin(adminUid);
  if (itemId == null) throw new HttpsError('invalid-argument', 'itemId가 필요합니다');

  const docData = {
    name: name || '',
    image: image || `${itemId}.png`,
    description: description || '',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (category) docData.category = category;
  if (armoFolder != null) docData.armoFolder = armoFolder;

  await db.collection('treasure_items').doc(String(itemId)).set(docData, { merge: true });

  return { ok: true };
}

// ── 관리자: 보물박스 저장 ─────────────────────────────────────────────────────
async function adminSaveTreasureBox(adminUid, data = {}) {
  await requireAdmin(adminUid);
  const { boxId, name, lat, lng, startHour, endHour, itemPool, active, hp, memberOnly, hiddenBox, keyId } = data;
  if (!lat || !lng) throw new HttpsError('invalid-argument', 'lat/lng가 필요합니다');

  const ref = boxId
    ? db.collection('treasure_boxes').doc(boxId)
    : db.collection('treasure_boxes').doc();

  await ref.set({
    name:       name || '',
    lat:        Number(lat),
    lng:        Number(lng),
    startHour:  Number(startHour ?? 0),
    endHour:    Number(endHour ?? 24),
    itemPool:   itemPool || [],
    hp:         Number(hp ?? 300),
    active:     active !== false,
    memberOnly: memberOnly === true,
    hiddenBox:  hiddenBox === true,
    keyId:      (hiddenBox === true && keyId) ? String(keyId) : null,
    updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, boxId: ref.id };
}

// ── 관리자: 열쇠 저장 ─────────────────────────────────────────────────────────
async function adminSaveTreasureKey(adminUid, data = {}) {
  await requireAdmin(adminUid);
  const { keyId, name, dropRate, active } = data;
  if (!keyId) throw new HttpsError('invalid-argument', 'keyId가 필요합니다');

  await db.collection('treasure_keys').doc(String(keyId)).set({
    name:     name || `열쇠 #${keyId}`,
    dropRate: Number(dropRate ?? 0.1),
    active:   active !== false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true };
}

// ── 관리자: 열쇠 비활성화 ─────────────────────────────────────────────────────
async function adminDeleteTreasureKey(adminUid, { keyId } = {}) {
  await requireAdmin(adminUid);
  if (!keyId) throw new HttpsError('invalid-argument', 'keyId가 필요합니다');
  await db.collection('treasure_keys').doc(String(keyId)).update({ active: false });
  return { ok: true };
}

// ── 관리자: 보물박스 삭제 ─────────────────────────────────────────────────────
async function adminDeleteTreasureBox(adminUid, { boxId } = {}) {
  await requireAdmin(adminUid);
  if (!boxId) throw new HttpsError('invalid-argument', 'boxId가 필요합니다');
  await db.collection('treasure_boxes').doc(boxId).update({ active: false });
  return { ok: true };
}

// ── 관리자: 바우처 저장 ────────────────────────────────────────────────────────
async function adminSaveVoucher(adminUid, data = {}) {
  await requireAdmin(adminUid);
  const { voucherId, name, requirements, reward, image, active, minCoins, minLevel } = data;
  if (!name) throw new HttpsError('invalid-argument', 'name이 필요합니다');

  const ref = voucherId
    ? db.collection('treasure_vouchers').doc(voucherId)
    : db.collection('treasure_vouchers').doc();

  await ref.set({
    name,
    requirements: requirements || [],
    reward:       reward || '',
    image:        image  || '',
    minCoins:     Number(minCoins) || 0,
    minLevel:     Number(minLevel) || 0,
    active:       active !== false,
    updatedAt:    admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, voucherId: ref.id };
}

// ── 유저: 부활권 사용 ─────────────────────────────────────────────────────────
async function useReviveTicket(uid) {
  const invRef = db.collection('treasure_inventory').doc(`${uid}_revive_ticket`);
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(invRef);
    const current = snap.exists ? (snap.data().count || 0) : 0;
    if (current <= 0) throw new HttpsError('failed-precondition', '부활권이 없습니다');
    const newCount = current - 1;
    if (newCount <= 0) {
      tx.delete(invRef);
    } else {
      tx.update(invRef, { count: newCount, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    return { ok: true, remaining: newCount };
  });
}

// ── 유저: 마법약 사용 (MP 전체 회복) ─────────────────────────────────────────
async function useMpPotion(uid) {
  const invRef = db.collection('treasure_inventory').doc(`${uid}_potion_mp`);
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(invRef);
    const current = snap.exists ? (snap.data().count || 0) : 0;
    if (current <= 0) throw new HttpsError('failed-precondition', '마법약이 없습니다');
    const newCount = current - 1;
    if (newCount <= 0) {
      tx.delete(invRef);
    } else {
      tx.update(invRef, { count: newCount, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    return { ok: true, remaining: newCount };
  });
}

// ── 유저: 빨간약 사용 (HP +100) ───────────────────────────────────────────────
async function usePotion(uid) {
  const invRef = db.collection('treasure_inventory').doc(`${uid}_potion_red`);
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(invRef);
    const current = snap.exists ? (snap.data().count || 0) : 0;
    if (current <= 0) throw new HttpsError('failed-precondition', '빨간약이 없습니다');
    const newCount = current - 1;
    if (newCount <= 0) {
      tx.delete(invRef);
    } else {
      tx.update(invRef, { count: newCount, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    return { ok: true, remaining: newCount };
  });
}

module.exports = {
  collectTreasureBox,
  openTreasureBox,
  adminCollectTreasureBox,
  craftVoucher,
  usePotion,
  useMpPotion,
  useReviveTicket,
  adminSaveTreasureItem,
  adminSaveTreasureBox,
  adminDeleteTreasureBox,
  adminSaveVoucher,
  adminGrantItem,
  earnKey,
  adminSaveTreasureKey,
  adminDeleteTreasureKey,
};
