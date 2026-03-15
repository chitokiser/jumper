// functions/handlers/treasure.js
// 보물찾기 시스템
'use strict';

const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');
const { requireAdmin } = require('../wallet/admin');

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

  // 하루 1회 수집 제한 (날짜 기준)
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const logKey   = `${uid}_${boxId}_${today}`;         // 날짜 포함 → 익일 자동 해제
  const invBoxKey = `${uid}_${boxId}`;                 // 인벤토리는 박스 단위 (날짜 무관)
  const logRef  = db.collection('treasure_logs').doc(logKey);
  const logSnap = await logRef.get();
  if (logSnap.exists)
    throw new HttpsError('already-exists', '이 보물은 오늘 이미 획득했습니다');

  const itemPool = box.itemPool || [];
  if (!itemPool.length) throw new HttpsError('failed-precondition', '아이템 풀이 비어 있습니다');

  // 트랜잭션: 미개봉 박스 인벤토리 저장 + 수집 로그 기록
  const invBoxRef = db.collection('treasure_inventory_boxes').doc(invBoxKey);
  await db.runTransaction(async (tx) => {
    tx.set(invBoxRef, {
      uid, boxId,
      boxName: box.name || '',
      itemPool,
      collectedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.set(logRef, {
      uid, boxId, claimedDate: today,
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
      boxName: box.name || '',
      itemPool,
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

  // 랜덤 아이템 선택
  const itemId = pickWeightedItem(itemPool);

  // 아이템 정보 조회
  const itemSnap = await db.collection('treasure_items').doc(String(itemId)).get();
  const itemData = itemSnap.exists ? itemSnap.data() : { name: `아이템 #${itemId}`, image: `${itemId}.png` };

  // 트랜잭션: 미개봉 박스 삭제 + 아이템 인벤토리 적립
  await db.runTransaction(async (tx) => {
    const invRef = db.collection('treasure_inventory').doc(`${uid}_${itemId}`);
    const invSnap = await tx.get(invRef);
    const current = invSnap.exists ? (invSnap.data().count || 0) : 0;

    tx.set(invRef, {
      uid, itemId: String(itemId), count: current + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    tx.delete(invBoxRef);
  });

  return { ok: true, itemId: String(itemId), itemName: itemData.name, itemImage: itemData.image };
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
  const goldNeeded = goldReqs.reduce((s, r) => s + (r.count || 0), 0);

  return await db.runTransaction(async (tx) => {
    // 코인(gold) 잔액 확인
    let playerRef, currentGold = 0;
    if (goldNeeded > 0) {
      playerRef = db.collection('battle_players').doc(uid);
      const pSnap = await tx.get(playerRef);
      currentGold = pSnap.exists ? (pSnap.data().gold || 0) : 0;
      if (currentGold < goldNeeded)
        throw new HttpsError('failed-precondition',
          `코인 부족 (보유 ${currentGold}, 필요 ${goldNeeded})`);
    }

    // 아이템 잔액 확인
    const invRefs  = itemReqs.map(r => db.collection('treasure_inventory').doc(`${uid}_${r.itemId}`));
    const invSnaps = await Promise.all(invRefs.map(ref => tx.get(ref)));

    for (let i = 0; i < itemReqs.length; i++) {
      const have = invSnaps[i].exists ? (invSnaps[i].data().count || 0) : 0;
      if (have < itemReqs[i].count)
        throw new HttpsError('failed-precondition',
          `아이템 부족: ${itemReqs[i].itemId} (보유 ${have}개, 필요 ${itemReqs[i].count}개)`);
    }

    // 코인 차감
    if (goldNeeded > 0) {
      tx.update(playerRef, {
        gold: currentGold - goldNeeded,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // 아이템 차감
    for (let i = 0; i < itemReqs.length; i++) {
      const have = invSnaps[i].data().count;
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

    return { ok: true, voucherName: voucher.name, reward: voucher.reward };
  });
}

// ── 관리자: 아이템 저장 ────────────────────────────────────────────────────────
async function adminSaveTreasureItem(adminUid, { itemId, name, image, description } = {}) {
  await requireAdmin(adminUid);
  if (itemId == null) throw new HttpsError('invalid-argument', 'itemId가 필요합니다');

  await db.collection('treasure_items').doc(String(itemId)).set({
    name: name || '',
    image: image || `${itemId}.png`,
    description: description || '',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true };
}

// ── 관리자: 보물박스 저장 ─────────────────────────────────────────────────────
async function adminSaveTreasureBox(adminUid, data = {}) {
  await requireAdmin(adminUid);
  const { boxId, name, lat, lng, startHour, endHour, itemPool, active, hp } = data;
  if (!lat || !lng) throw new HttpsError('invalid-argument', 'lat/lng가 필요합니다');

  const ref = boxId
    ? db.collection('treasure_boxes').doc(boxId)
    : db.collection('treasure_boxes').doc();

  await ref.set({
    name:      name || '',
    lat:       Number(lat),
    lng:       Number(lng),
    startHour: Number(startHour ?? 0),
    endHour:   Number(endHour ?? 24),
    itemPool:  itemPool || [],
    hp:        Number(hp ?? 300),   // 타격 필요 HP (0이면 자동수집)
    active:    active !== false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, boxId: ref.id };
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
  const { voucherId, name, requirements, reward, image, active } = data;
  if (!name) throw new HttpsError('invalid-argument', 'name이 필요합니다');

  const ref = voucherId
    ? db.collection('treasure_vouchers').doc(voucherId)
    : db.collection('treasure_vouchers').doc();

  await ref.set({
    name,
    requirements: requirements || [],
    reward:       reward || '',
    image:        image  || '',
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
  useReviveTicket,
  adminSaveTreasureItem,
  adminSaveTreasureBox,
  adminDeleteTreasureBox,
  adminSaveVoucher,
};
