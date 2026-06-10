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
// itemPool 은 {itemId, weight} 객체 배열 또는 순수 itemId 문자열 배열 둘 다 허용
function pickWeightedItem(itemPool) {
  const pool = itemPool.map(e => (typeof e === 'string' ? { itemId: e, weight: 1 } : e));
  const total = pool.reduce((s, e) => s + (e.weight || 1), 0);
  let r = Math.random() * total;
  for (const e of pool) {
    r -= (e.weight || 1);
    if (r <= 0) return e.itemId;
  }
  return pool[pool.length - 1].itemId;
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

  // 서버측 거리 확인 — 박스에 설정된 radius 사용 (기본 30m)
  const claimRadius = Number(box.radius ?? 30);
  const dist = haversine(userLat, userLng, box.lat, box.lng);
  if (dist > claimRadius)
    throw new HttpsError('failed-precondition', `너무 멀리 있습니다 (${Math.round(dist)}m / 획득범위 ${claimRadius}m)`);

  // 리스폰 기반 수집 제한 (같은 사람은 리스폰 전까지 재수집 불가)
  const respawnMs = box.respawnIntervalMs || 86400000; // 기본 24시간
  const invBoxKey = `${uid}_${boxId}`;
  const logRef  = db.collection('treasure_logs').doc(invBoxKey);
  const logSnap = await logRef.get();
  if (logSnap.exists) {
    const lastMs = logSnap.data().collectedAt?.toMillis?.() || 0;
    const remainMs = lastMs + respawnMs - Date.now();
    if (remainMs > 0) {
      const remainMin = Math.ceil(remainMs / 60000);
      throw new HttpsError('already-exists',
        `이미 획득한 보물박스입니다. ${remainMin >= 60 ? Math.ceil(remainMin/60) + '시간' : remainMin + '분'} 후 다시 시도하세요`,
        { respawnRemainingMs: remainMs }
      );
    }
  }

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
  const invBoxSnap = await invBoxRef.get();
  if (invBoxSnap.exists)
    throw new HttpsError('already-exists', '먼저 인벤토리의 보물박스를 열어주세요');

  const isFirstEver = !logSnap.exists;
  await db.runTransaction(async (tx) => {
    tx.set(invBoxRef, {
      uid, boxId,
      boxName:   box.name      || '',
      itemPool,
      dropCount: box.dropCount || 1,
      hiddenBox: box.hiddenBox === true,
      keyId:     box.keyId     || null,
      collectedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.set(logRef, {
      uid, boxId,
      collectedAt: admin.firestore.FieldValue.serverTimestamp(),
      respawnIntervalMs: respawnMs,
    });
  });

  // 통계 업데이트 (비동기, 실패해도 무시)
  const statsRef = db.collection('treasure_stats').doc('global');
  const statsUpdate = { foundCount: admin.firestore.FieldValue.increment(1) };
  if (isFirstEver) statsUpdate.participants = admin.firestore.FieldValue.increment(1);
  statsRef.set(statsUpdate, { merge: true }).catch(() => {});

  // 플레이어 보물 수집 카운터 + 코인 보상
  const coinReward = box.coinReward > 0 ? box.coinReward : 0;
  const playerUpdate = { treasuresFound: admin.firestore.FieldValue.increment(1) };
  if (coinReward > 0) playerUpdate.gold = admin.firestore.FieldValue.increment(coinReward);
  db.collection('battle_players').doc(uid).set(playerUpdate, { merge: true }).catch(() => {});

  return { ok: true, boxName: box.name || '보물박스', coinReward };
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

  const respawnMs = box.respawnIntervalMs || 86400000;
  const logKey = `${adminUid}_${boxId}`;
  const logRef = db.collection('treasure_logs').doc(logKey);
  const logSnap = await logRef.get();
  if (logSnap.exists) {
    const lastMs = logSnap.data().collectedAt?.toMillis?.() || 0;
    const remainMs = lastMs + respawnMs - Date.now();
    if (remainMs > 0) {
      const remainMin = Math.ceil(remainMs / 60000);
      throw new HttpsError('already-exists',
        `이미 획득한 보물박스입니다. ${remainMin >= 60 ? Math.ceil(remainMin/60) + '시간' : remainMin + '분'} 후 다시 시도하세요`,
        { respawnRemainingMs: remainMs }
      );
    }
  }

  const invBoxRef = db.collection('treasure_inventory_boxes').doc(logKey);
  const invBoxSnap = await invBoxRef.get();
  if (invBoxSnap.exists)
    throw new HttpsError('already-exists', '먼저 인벤토리의 보물박스를 열어주세요');

  await db.runTransaction(async (tx) => {
    tx.set(invBoxRef, {
      uid: adminUid, boxId,
      boxName:   box.name      || '',
      itemPool,
      dropCount: box.dropCount || 1,
      hiddenBox: box.hiddenBox === true,
      keyId:     box.keyId     || null,
      collectedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.set(logRef, {
      uid: adminUid, boxId,
      collectedAt: admin.firestore.FieldValue.serverTimestamp(),
      respawnIntervalMs: respawnMs,
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

  // dropCount만큼 랜덤 아이템 선택
  const dropCount = Math.max(1, invBox.dropCount || 1);
  const droppedIds = Array.from({ length: dropCount }, () => pickWeightedItem(itemPool));
  const uniqueIds  = [...new Set(droppedIds)];

  // 아이템 정보 조회 (유니크 ID만)
  const itemDataMap = {};
  await Promise.all(uniqueIds.map(async id => {
    const snap = await db.collection('treasure_items').doc(String(id)).get();
    itemDataMap[id] = snap.exists ? snap.data() : { name: `아이템 #${id}`, image: `${id}.png` };
  }));

  // 아이템별 드랍 수 집계
  const dropCountMap = {};
  droppedIds.forEach(id => { dropCountMap[id] = (dropCountMap[id] || 0) + 1; });

  // 트랜잭션: 모든 읽기 → 검증 → 모든 쓰기 순서 엄수 (Firestore 규칙)
  await db.runTransaction(async (tx) => {
    // ── 모든 읽기 ──────────────────────────────────────────────────────────────
    const keySnap2 = keyInvRef ? await tx.get(keyInvRef) : null;
    const invRefs  = uniqueIds.map(id => db.collection('treasure_inventory').doc(`${uid}_${id}`));
    const invSnaps = await Promise.all(invRefs.map(ref => tx.get(ref)));

    // ── 검증 ──────────────────────────────────────────────────────────────────
    let currentKey = 0;
    if (keySnap2 !== null) {
      currentKey = keySnap2.exists ? (keySnap2.data().count || 0) : 0;
      if (currentKey <= 0)
        throw new HttpsError('failed-precondition', '열쇠가 없습니다 (동시 처리 중 소진)');
    }

    // ── 모든 쓰기 ─────────────────────────────────────────────────────────────
    if (keyInvRef) {
      if (currentKey - 1 <= 0) tx.delete(keyInvRef);
      else tx.update(keyInvRef, { count: currentKey - 1, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    uniqueIds.forEach((id, i) => {
      const current = invSnaps[i].exists ? (invSnaps[i].data().count || 0) : 0;
      tx.set(invRefs[i], {
        uid, itemId: String(id), count: current + dropCountMap[id],
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    tx.delete(invBoxRef);
  });

  const firstId = droppedIds[0];
  return {
    ok: true,
    items:     droppedIds.map(id => ({
      itemId:    String(id),
      itemName:  itemDataMap[id]?.name  || `아이템 #${id}`,
      itemImage: itemDataMap[id]?.image || `${id}.png`,
    })),
    itemId:    String(firstId),
    itemName:  itemDataMap[firstId]?.name  || `아이템 #${firstId}`,
    itemImage: itemDataMap[firstId]?.image || `${firstId}.png`,
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

  // GP 보상 범위 계산 (트랜잭션 밖에서 랜덤 결정 → 재시도 시에도 동일하게 보장됨)
  const gpMin = Math.max(0, Math.floor(Number(voucher.gpRewardMin) || 0));
  const gpMax = Math.max(gpMin, Math.floor(Number(voucher.gpRewardMax) || 0));
  const gpGranted = gpMin > 0 ? (Math.floor(Math.random() * (gpMax - gpMin + 1)) + gpMin) : 0;

  return await db.runTransaction(async (tx) => {
    // ── 모든 읽기를 쓰기 전에 완료 (Firestore 트랜잭션 규칙) ──────────────────

    // 1) 중복 구매 방지
    const purchaseRef = db.collection('treasure_voucher_purchases').doc(`${uid}_${voucherId}`);
    const purchaseSnap = await tx.get(purchaseRef);
    if (purchaseSnap.exists) {
      throw new HttpsError('already-exists', '이미 구매한 바우처입니다');
    }

    // 2) 코인(gold) + 마정석(token) 잔액 / GP 보상 시에도 battle_players 읽기 필요
    const magicStoneCost = parseInt(voucher.magicStoneCost || 0);
    let playerRef, currentGold = 0, currentToken = 0;
    if (goldNeeded > 0 || magicStoneCost > 0 || gpGranted > 0) {
      playerRef = db.collection('battle_players').doc(uid);
      const pSnap = await tx.get(playerRef);
      currentGold  = pSnap.exists ? (pSnap.data().gold  || 0) : 0;
      currentToken = pSnap.exists ? (pSnap.data().token || 0) : 0;
      if (currentGold < goldNeeded)
        throw new HttpsError('failed-precondition',
          `코인 부족 (보유 ${currentGold}, 필요 ${goldNeeded})`);
      if (currentToken < magicStoneCost)
        throw new HttpsError('failed-precondition',
          `마정석 부족 (보유 ${currentToken}, 필요 ${magicStoneCost})`);
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

    // 코인 차감 + 마정석 차감 + GP 보상 지급 (한 번의 write로 처리)
    if (goldNeeded > 0 || magicStoneCost > 0 || gpGranted > 0) {
      const upd = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
      const finalGold = currentGold - goldNeeded + gpGranted;
      upd.gold  = finalGold;
      if (magicStoneCost > 0)  upd.token = currentToken - magicStoneCost;
      tx.update(playerRef, upd);
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

    return { ok: true, voucherName: voucher.name, reward: voucher.reward, gpGranted };
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
  const { boxId, name, lat, lng, radius, scanRadius, startHour, endHour, itemPool, active, hp, memberOnly, hiddenBox, keyId, respawnIntervalMs, description } = data;
  if (!lat || !lng) throw new HttpsError('invalid-argument', 'lat/lng가 필요합니다');

  const ref = boxId
    ? db.collection('treasure_boxes').doc(boxId)
    : db.collection('treasure_boxes').doc();

  await ref.set({
    name:               name || '',
    description:        description || '',
    lat:                Number(lat),
    lng:                Number(lng),
    radius:             Number(radius ?? 30),
    scanRadius:         Number(scanRadius ?? 100),
    startHour:          Number(startHour ?? 0),
    endHour:            Number(endHour ?? 24),
    itemPool:           itemPool || [],
    hp:                 Number(hp ?? 300),
    respawnIntervalMs:  Number(respawnIntervalMs ?? 86400000),
    active:             active !== false,
    memberOnly:         memberOnly === true,
    hiddenBox:          hiddenBox === true,
    keyId:              (hiddenBox === true && keyId) ? String(keyId) : null,
    updatedAt:          admin.firestore.FieldValue.serverTimestamp(),
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

// ── 관리자: 보물박스 목록 조회 ────────────────────────────────────────────────
async function adminListTreasureBoxes(adminUid) {
  await requireAdmin(adminUid);
  const snap = await db.collection('treasure_boxes').orderBy('updatedAt', 'desc').get();
  const boxes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return { boxes };
}

// ── 관리자: 바우처 저장 ────────────────────────────────────────────────────────
async function adminSaveVoucher(adminUid, data = {}) {
  await requireAdmin(adminUid);
  const { voucherId, name, requirements, reward, image, active, minCoins, minLevel,
          gpRewardMin, gpRewardMax } = data;
  if (!name) throw new HttpsError('invalid-argument', 'name이 필요합니다');

  const gpMin = Math.max(0, Math.floor(Number(gpRewardMin) || 0));
  const gpMax = Math.max(gpMin, Math.floor(Number(gpRewardMax) || 0));

  const ref = voucherId
    ? db.collection('treasure_vouchers').doc(voucherId)
    : db.collection('treasure_vouchers').doc();

  await ref.set({
    name,
    requirements: requirements || [],
    reward:       reward || '',
    gpRewardMin:  gpMin,
    gpRewardMax:  gpMax,
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
  const playerRef = db.collection('battle_players').doc(uid);
  return await db.runTransaction(async (tx) => {
    const [snap, playerSnap] = await Promise.all([tx.get(invRef), tx.get(playerRef)]);
    const current = snap.exists ? (snap.data().count || 0) : 0;
    if (current <= 0) throw new HttpsError('failed-precondition', 'No revive ticket available');
    const newCount = current - 1;
    if (newCount <= 0) {
      tx.delete(invRef);
    } else {
      tx.update(invRef, { count: newCount, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    // Restore XP penalty that was deducted on death
    const playerData = playerSnap.exists ? playerSnap.data() : {};
    const penalty = playerData.xpDeathPenalty || 0;
    if (penalty > 0) {
      const restoredXp = (playerData.xp || 0) + penalty;
      tx.update(playerRef, {
        xp: restoredXp,
        xpDeathPenalty: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    return { ok: true, remaining: newCount, xpRestored: penalty };
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

// ── 바닥 드랍 상수 ─────────────────────────────────────────────────────────────
const DROP_EXPIRE_MS = 10 * 60 * 1000; // 10분
const DROP_PICKUP_RANGE_M = 20;

// ── 유저: 인벤토리 아이템 바닥에 버리기 ────────────────────────────────────────
async function dropInventoryItem(uid, { itemId, count = 1, userLat, userLng } = {}) {
  if (!itemId) throw new HttpsError('invalid-argument', 'itemId가 필요합니다');
  if (userLat == null || userLng == null)
    throw new HttpsError('invalid-argument', '위치 정보가 필요합니다');
  count = Math.max(1, parseInt(count) || 1);

  const invRef = db.collection('treasure_inventory').doc(`${uid}_${itemId}`);
  let actualCount = count;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(invRef);
    if (!snap.exists) throw new HttpsError('not-found', '인벤토리에 없는 아이템입니다');
    const current = snap.data().count || 0;
    if (current < count) throw new HttpsError('failed-precondition', `아이템이 부족합니다 (보유: ${current})`);
    actualCount = count;
    const remaining = current - count;
    if (remaining <= 0) tx.delete(invRef);
    else tx.update(invRef, { count: remaining, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });

  const expireTs = admin.firestore.Timestamp.fromMillis(Date.now() + DROP_EXPIRE_MS);
  const dropRef = db.collection('dropped_items').doc();
  await dropRef.set({
    dropperUid: uid,
    itemId,
    count: actualCount,
    lat: userLat,
    lng: userLng,
    droppedAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: expireTs,
  });

  return { ok: true, dropId: dropRef.id };
}

// ── 유저: 바닥 아이템 줍기 ────────────────────────────────────────────────────
async function pickupDroppedItem(uid, { dropId, userLat, userLng } = {}) {
  if (!dropId) throw new HttpsError('invalid-argument', 'dropId가 필요합니다');
  if (userLat == null || userLng == null)
    throw new HttpsError('invalid-argument', '위치 정보가 필요합니다');

  const dropRef = db.collection('dropped_items').doc(dropId);
  let resultItemId, resultCount;

  await db.runTransaction(async (tx) => {
    const dropSnap = await tx.get(dropRef);
    if (!dropSnap.exists)
      throw new HttpsError('not-found', '아이템을 찾을 수 없습니다 (이미 줍혔거나 소각됨)');
    const dropData = dropSnap.data();

    const expiresAt = dropData.expiresAt?.toMillis?.() || 0;
    if (Date.now() > expiresAt) {
      tx.delete(dropRef);
      throw new HttpsError('failed-precondition', '아이템이 이미 소각되었습니다');
    }

    const dist = haversine(userLat, userLng, dropData.lat, dropData.lng);
    if (dist > DROP_PICKUP_RANGE_M)
      throw new HttpsError('failed-precondition', `너무 멀리 있습니다 (${Math.round(dist)}m)`);

    resultItemId = dropData.itemId;
    resultCount = dropData.count;

    const invRef = db.collection('treasure_inventory').doc(`${uid}_${resultItemId}`);
    const invSnap = await tx.get(invRef);
    const current = invSnap.exists ? (invSnap.data().count || 0) : 0;
    tx.set(invRef, {
      uid, itemId: resultItemId, count: current + resultCount,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.delete(dropRef);
  });

  return { ok: true, itemId: resultItemId, count: resultCount };
}

// ── 스케줄: 만료된 바닥 아이템 소각 ──────────────────────────────────────────
async function cleanupExpiredDrops() {
  const now = admin.firestore.Timestamp.now();
  const snap = await db.collection('dropped_items')
    .where('expiresAt', '<=', now)
    .limit(200)
    .get();
  if (snap.empty) return { deleted: 0 };
  const batch = db.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  return { deleted: snap.size };
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
  adminListTreasureBoxes,
  adminSaveVoucher,
  adminGrantItem,
  earnKey,
  adminSaveTreasureKey,
  adminDeleteTreasureKey,
  dropInventoryItem,
  pickupDroppedItem,
  cleanupExpiredDrops,
};
