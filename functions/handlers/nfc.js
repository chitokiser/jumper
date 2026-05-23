// functions/handlers/nfc.js
// NFC 보물 태그 시스템
'use strict';

const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');
const { requireAdmin } = require('../wallet/admin');

const db = admin.firestore();

function isInTimeRange(startHour, endHour) {
  if (startHour == null || endHour == null) return true;
  const h = (new Date().getUTCHours() + 7) % 24; // Vietnam UTC+7
  if (startHour <= endHour) return h >= startHour && h < endHour;
  return h >= startHour || h < endHour;
}

async function isCoopMember(uid) {
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return false;
  const expiry = snap.data().coopMemberExpiry;
  if (!expiry) return false;
  return expiry.toDate() > new Date();
}

// ── 관리자: NFC 태그 생성/수정 ──────────────────────────────────────────────
async function adminSaveNfcTag(uid, data) {
  await requireAdmin(uid);
  const {
    tagId, label,
    message = '',
    active = true,
    memberOnly = false,
    cooldownMs = 86400000,
    maxClaims = -1,
    rewardType = 'none',
    rewardItemId = null,
    rewardItemCount = 1,
    rewardPoints = 0,
    deviceRestricted = false,
    startHour = null,
    endHour = null,
  } = data;

  if (!tagId || !label) throw new HttpsError('invalid-argument', 'tagId와 label이 필요합니다');

  const tagRef = db.collection('nfc_tags').doc(String(tagId));
  const snap = await tagRef.get();
  const isNew = !snap.exists;

  const saveData = {
    tagId: String(tagId),
    label,
    message,
    active: !!active,
    memberOnly: !!memberOnly,
    cooldownMs: Number(cooldownMs),
    maxClaims: Number(maxClaims),
    rewardType,
    rewardItemId: rewardItemId || null,
    rewardItemCount: Number(rewardItemCount) || 1,
    rewardPoints: Number(rewardPoints) || 0,
    deviceRestricted: !!deviceRestricted,
    startHour: startHour != null ? Number(startHour) : null,
    endHour: endHour != null ? Number(endHour) : null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (isNew) {
    saveData.totalClaims = 0;
    saveData.registeredDevices = [];
    saveData.registeredDeviceMeta = {};
    saveData.createdBy = uid;
    saveData.createdAt = admin.firestore.FieldValue.serverTimestamp();
  }

  await tagRef.set(saveData, { merge: true });
  return { ok: true, tagId: String(tagId), created: isNew };
}

// ── 관리자: NFC 태그 삭제 ────────────────────────────────────────────────────
async function adminDeleteNfcTag(uid, { tagId } = {}) {
  await requireAdmin(uid);
  if (!tagId) throw new HttpsError('invalid-argument', 'tagId가 필요합니다');
  await db.collection('nfc_tags').doc(String(tagId)).delete();
  return { ok: true };
}

// ── 관리자: 기기 지문 등록 ───────────────────────────────────────────────────
async function adminRegisterDevice(uid, { tagId, deviceFingerprint, deviceLabel = '' } = {}) {
  await requireAdmin(uid);
  if (!tagId || !deviceFingerprint) {
    throw new HttpsError('invalid-argument', 'tagId와 deviceFingerprint가 필요합니다');
  }

  const tagRef = db.collection('nfc_tags').doc(String(tagId));
  const snap = await tagRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'NFC 태그를 찾을 수 없습니다');

  const devices = snap.data().registeredDevices || [];
  const meta = snap.data().registeredDeviceMeta || {};

  if (!devices.includes(deviceFingerprint)) {
    devices.push(deviceFingerprint);
  }
  meta[deviceFingerprint] = {
    label: deviceLabel || deviceFingerprint.slice(0, 8),
    registeredAt: new Date().toISOString(),
  };

  await tagRef.update({
    registeredDevices: devices,
    registeredDeviceMeta: meta,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true };
}

// ── 관리자: 기기 지문 제거 ───────────────────────────────────────────────────
async function adminRemoveDevice(uid, { tagId, deviceFingerprint } = {}) {
  await requireAdmin(uid);
  if (!tagId || !deviceFingerprint) {
    throw new HttpsError('invalid-argument', 'tagId와 deviceFingerprint가 필요합니다');
  }

  const tagRef = db.collection('nfc_tags').doc(String(tagId));
  const snap = await tagRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'NFC 태그를 찾을 수 없습니다');

  const devices = (snap.data().registeredDevices || []).filter(d => d !== deviceFingerprint);
  const meta = { ...(snap.data().registeredDeviceMeta || {}) };
  delete meta[deviceFingerprint];

  await tagRef.update({
    registeredDevices: devices,
    registeredDeviceMeta: meta,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { ok: true };
}

// ── 유저: NFC 보물 수령 ──────────────────────────────────────────────────────
async function claimNfcTreasure(uid, { tagId, deviceFingerprint } = {}) {
  if (!tagId) throw new HttpsError('invalid-argument', 'tagId가 필요합니다');
  if (!deviceFingerprint) throw new HttpsError('invalid-argument', 'deviceFingerprint가 필요합니다');

  const tagSnap = await db.collection('nfc_tags').doc(String(tagId)).get();
  if (!tagSnap.exists) throw new HttpsError('not-found', 'NFC 태그를 찾을 수 없습니다');
  const tag = tagSnap.data();

  if (!tag.active) throw new HttpsError('failed-precondition', '비활성화된 NFC 태그입니다');

  if (tag.startHour != null && !isInTimeRange(tag.startHour, tag.endHour)) {
    throw new HttpsError('failed-precondition', `이 보물은 ${tag.startHour}~${tag.endHour}시 사이에만 획득할 수 있습니다`);
  }

  if (tag.maxClaims >= 0 && tag.totalClaims >= tag.maxClaims) {
    throw new HttpsError('resource-exhausted', '이 NFC 보물은 이미 모든 수량이 소진되었습니다');
  }

  if (tag.memberOnly && !(await isCoopMember(uid))) {
    throw new HttpsError('permission-denied', '정회원만 획득할 수 있는 보물입니다');
  }

  if (tag.deviceRestricted) {
    if (!(tag.registeredDevices || []).includes(deviceFingerprint)) {
      throw new HttpsError('permission-denied', '이 기기는 등록되지 않은 기기입니다');
    }
  }

  const claimId = `${tagId}_${uid}`;
  const claimRef = db.collection('nfc_claims').doc(claimId);
  const tagRef = db.collection('nfc_tags').doc(String(tagId));

  const result = await db.runTransaction(async (tx) => {
    const claimSnap = await tx.get(claimRef);

    if (claimSnap.exists && tag.cooldownMs > 0) {
      const lastClaim = claimSnap.data().claimedAt?.toDate?.() || new Date(0);
      const elapsed = Date.now() - lastClaim.getTime();
      if (elapsed < tag.cooldownMs) {
        const remainingH = Math.ceil((tag.cooldownMs - elapsed) / 3600000);
        throw new HttpsError('resource-exhausted', `쿨다운 중입니다. ${remainingH}시간 후 다시 시도하세요`);
      }
    }

    let reward = { type: tag.rewardType };

    if (tag.rewardType === 'item' && tag.rewardItemId) {
      const invRef = db.collection('treasure_inventory').doc(`${uid}_${tag.rewardItemId}`);
      const invSnap = await tx.get(invRef);
      const current = invSnap.exists ? (invSnap.data().count || 0) : 0;
      tx.set(invRef, {
        uid,
        itemId: tag.rewardItemId,
        count: current + (tag.rewardItemCount || 1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      reward.itemId = tag.rewardItemId;
      reward.count = tag.rewardItemCount || 1;
    } else if (tag.rewardType === 'points' && tag.rewardPoints > 0) {
      const userRef = db.collection('users').doc(uid);
      const userSnap = await tx.get(userRef);
      const cur = userSnap.exists ? (userSnap.data().points || 0) : 0;
      tx.update(userRef, {
        points: cur + tag.rewardPoints,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      reward.points = tag.rewardPoints;
    }

    tx.set(claimRef, {
      uid, tagId: String(tagId), deviceFingerprint,
      claimedAt: admin.firestore.FieldValue.serverTimestamp(),
      reward,
    });

    tx.update(tagRef, {
      totalClaims: admin.firestore.FieldValue.increment(1),
    });

    return { ok: true, reward, message: tag.message || '' };
  });

  return result;
}

// ── 관리자: 태그 목록 조회 ───────────────────────────────────────────────────
async function adminListNfcTags(uid) {
  await requireAdmin(uid);
  const snap = await db.collection('nfc_tags').orderBy('createdAt', 'desc').get();
  return snap.docs.map(d => d.data());
}

// ── 관리자: 태그 수령 기록 조회 ──────────────────────────────────────────────
async function adminListNfcClaims(uid, { tagId } = {}) {
  await requireAdmin(uid);
  if (!tagId) throw new HttpsError('invalid-argument', 'tagId가 필요합니다');
  const snap = await db.collection('nfc_claims')
    .where('tagId', '==', String(tagId))
    .orderBy('claimedAt', 'desc')
    .limit(100)
    .get();
  return snap.docs.map(d => d.data());
}

module.exports = {
  adminSaveNfcTag,
  adminDeleteNfcTag,
  adminRegisterDevice,
  adminRemoveDevice,
  claimNfcTreasure,
  adminListNfcTags,
  adminListNfcClaims,
};
