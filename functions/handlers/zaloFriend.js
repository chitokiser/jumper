// functions/handlers/zaloFriend.js
// Zalo 친구추가 BT 보상 이벤트
//
// 흐름
//   1) 최고 관리자가 이벤트를 만들고 BT 풀을 충전한다 (zalo_friend_events/{campaignId}.btPool)
//   2) 회원이 이벤트 화면에서 운영자 Zalo를 친구추가한다
//   3) 운영자가 관리 화면에서 만든 일회용 코드(ZL-XXXX-XXXX)를 Zalo 메시지로 보낸다
//   4) 회원이 코드를 입력하면 서버가 풀에서 rewardBt 만큼 꺼내 회원 btBalance에 넣는다
//
// 보장
//   - 1계정 1회: zalo_friend_claims/{campaignId}_{uid} 결정적 문서 ID
//   - 코드 1회: zalo_friend_codes/{code}.status 'unused' → 'used' (트랜잭션)
//   - 풀 고갈 시 지급 없음, 풀은 음수가 되지 않음 (트랜잭션 안에서 검사)
//   - 풀/코드/수령 기록은 클라이언트가 쓸 수 없다 (firestore.rules: write false)
//
// 풀 충전은 adminChargeBt 와 같은 최고 관리자 공급이며 bt_transactions 에 기록된다.

'use strict';

const admin = require('firebase-admin');
const crypto = require('crypto');
const { requireAdmin } = require('../wallet/admin');

const FieldValue = admin.firestore.FieldValue;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^ZL-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const MAX_CODES_PER_CALL = 50;
const MAX_POOL_CHARGE = 100000;
const EXP_PER_BT = 100;

function getDb() {
  if (!admin.apps.length) admin.initializeApp();
  return admin.firestore();
}

function _err(message, httpCode = 'failed-precondition') {
  const e = new Error(message);
  e.httpCode = httpCode;
  return e;
}

function generateCode() {
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_CHARS.charAt(crypto.randomInt(CODE_CHARS.length));
  return `ZL-${s.slice(0, 4)}-${s.slice(4)}`;
}

function normalizeCode(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = s.startsWith('ZL') ? s.slice(2) : s;
  if (body.length !== 8) return '';
  return `ZL-${body.slice(0, 4)}-${body.slice(4)}`;
}

function cleanZaloUrl(raw, { optional = false } = {}) {
  const url = String(raw || '').trim();
  if (optional && !url) return '';
  if (!/^https:\/\/(zalo\.me|chat\.zalo\.me|oa\.zalo\.me)\//i.test(url)) {
    throw _err('Zalo 링크는 https://zalo.me/... 형식이어야 합니다.', 'invalid-argument');
  }
  return url;
}

// QR 이미지: https 주소 또는 사이트 안 경로(/assets/...)
function cleanQrImageUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return '';
  if (!/^(https:\/\/|\/assets\/)/i.test(url)) {
    throw _err('QR 이미지는 https:// 주소 또는 /assets/ 경로여야 합니다.', 'invalid-argument');
  }
  return url.slice(0, 500);
}

function toPositiveInt(v, max, label) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) throw _err(`${label}은(는) 1 이상이어야 합니다.`, 'invalid-argument');
  if (n > max) throw _err(`${label}은(는) 최대 ${max.toLocaleString()}까지 가능합니다.`, 'invalid-argument');
  return n;
}

/** 1. 이벤트 생성 (최고 관리자) — 이벤트 페이지 카드(coupon_campaigns) + 풀 문서 */
async function createZaloFriendEvent(adminUid, data = {}) {
  await requireAdmin(adminUid);
  const db = getDb();

  const zaloUrl = cleanZaloUrl(data.zaloUrl, { optional: true });
  const qrImageUrl = cleanQrImageUrl(data.qrImageUrl);
  if (!zaloUrl && !qrImageUrl) throw _err('Zalo 링크 또는 QR 이미지 중 하나는 필요합니다.', 'invalid-argument');
  const zaloName = String(data.zaloName || '').trim().slice(0, 60) || 'BestClub';
  const rewardBt = toPositiveInt(data.rewardBt ?? 1, 10, '지급 BT');
  const initialPool = data.initialPool ? toPositiveInt(data.initialPool, MAX_POOL_CHARGE, '초기 풀') : 0;
  const title = String(data.title || '').trim().slice(0, 80) || `Zalo 친구추가하고 ${rewardBt} BT 받기`;
  const description = String(data.description || '').trim().slice(0, 500) ||
    `운영자 Zalo(${zaloName})를 친구추가하면 Zalo 메시지로 받은 코드로 ${rewardBt} BT를 무료로 받을 수 있습니다.`;
  const imageUrl = String(data.imageUrl || '').trim() || qrImageUrl ||
    'https://images.unsplash.com/photo-1611746872915-64382b5c76da?auto=format&fit=crop&w=800&q=80';

  const campRef = db.collection('coupon_campaigns').doc();
  const eventRef = db.collection('zalo_friend_events').doc(campRef.id);

  await db.runTransaction(async (tx) => {
    tx.set(campRef, {
      campaignId: campRef.id,
      campaignType: 'BT_REWARD',
      issueMethod: 'ZALO_FRIEND',
      issuerType: 'PLATFORM',
      issuerId: 'platform',
      issuerNameSnapshot: 'BestClub',
      issuerBadge: 'SUPER ADMIN',
      title,
      description,
      imageUrl,
      priceBM: 0,
      discountType: 'BT',
      discountValue: `${rewardBt} BT`,
      applicableMerchantIds: ['all'],
      applicableProductIds: [],
      // 카드 표시용 (실제 기준은 zalo_friend_events 문서)
      totalQuantity: Math.floor(initialPool / rewardBt),
      issuedQuantity: 0,
      redeemedQuantity: 0,
      maxPerUser: 1,
      usageMode: 'ONLINE',
      terms: [
        `운영자 Zalo(${zaloName})를 친구추가해 주세요.`,
        '운영자가 Zalo 메시지로 일회용 코드(ZL-XXXX-XXXX)를 보내 드립니다.',
        `코드를 이 화면에 입력하면 ${rewardBt} BT가 무료로 즉시 지급됩니다.`,
        '1계정당 1회만 받을 수 있으며, 준비된 BT가 모두 소진되면 이벤트가 종료됩니다.',
      ].join('\n'),
      status: 'active',
      createdBy: adminUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(eventRef, {
      campaignId: campRef.id,
      zaloUrl,
      qrImageUrl,
      zaloName,
      rewardBt,
      btPool: initialPool,
      btCharged: initialPool,
      btPaid: 0,
      claimCount: 0,
      codesIssued: 0,
      status: 'active',
      createdBy: adminUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (initialPool > 0) {
      tx.set(db.collection('bt_transactions').doc(), {
        type: 'zalo_pool_charge',
        campaignId: campRef.id,
        amount: initialPool,
        adminUid,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  });

  return { success: true, campaignId: campRef.id };
}

/** 2. 이벤트 설정 수정 (최고 관리자) — Zalo 링크/이름/지급 BT/상태 */
async function updateZaloFriendEvent(adminUid, { campaignId, zaloUrl, qrImageUrl, zaloName, rewardBt, status } = {}) {
  await requireAdmin(adminUid);
  const db = getDb();
  if (!campaignId) throw _err('campaignId가 필요합니다.', 'invalid-argument');
  const eventRef = db.collection('zalo_friend_events').doc(String(campaignId));
  const snap = await eventRef.get();
  if (!snap.exists) throw _err('Zalo 이벤트를 찾을 수 없습니다.', 'not-found');

  const updates = { updatedAt: FieldValue.serverTimestamp() };
  if (zaloUrl !== undefined) updates.zaloUrl = cleanZaloUrl(zaloUrl, { optional: true });
  if (qrImageUrl !== undefined) updates.qrImageUrl = cleanQrImageUrl(qrImageUrl);
  const prev = snap.data();
  const nextUrl = updates.zaloUrl !== undefined ? updates.zaloUrl : prev.zaloUrl;
  const nextQr = updates.qrImageUrl !== undefined ? updates.qrImageUrl : prev.qrImageUrl;
  if (!nextUrl && !nextQr) throw _err('Zalo 링크 또는 QR 이미지 중 하나는 필요합니다.', 'invalid-argument');
  if (zaloName !== undefined) updates.zaloName = String(zaloName || '').trim().slice(0, 60) || 'BestClub';
  if (rewardBt !== undefined) updates.rewardBt = toPositiveInt(rewardBt, 10, '지급 BT');
  if (status !== undefined) updates.status = status === 'paused' ? 'paused' : 'active';
  await eventRef.update(updates);
  if (updates.rewardBt !== undefined) {
    const ev = snap.data();
    await db.collection('coupon_campaigns').doc(String(campaignId)).set({
      discountValue: `${updates.rewardBt} BT`,
      totalQuantity: Number(ev.claimCount || 0) + Math.floor(Number(ev.btPool || 0) / updates.rewardBt),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  return { success: true };
}

/** 3. BT 풀 충전 (최고 관리자) */
async function chargeZaloFriendPool(adminUid, { campaignId, amount } = {}) {
  await requireAdmin(adminUid);
  const db = getDb();
  if (!campaignId) throw _err('campaignId가 필요합니다.', 'invalid-argument');
  const amt = toPositiveInt(amount, MAX_POOL_CHARGE, '충전 BT');
  const eventRef = db.collection('zalo_friend_events').doc(String(campaignId));
  const campRef = db.collection('coupon_campaigns').doc(String(campaignId));

  return db.runTransaction(async (tx) => {
    const [snap, campSnap] = await Promise.all([tx.get(eventRef), tx.get(campRef)]);
    if (!snap.exists) throw _err('Zalo 이벤트를 찾을 수 없습니다.', 'not-found');
    const ev = snap.data();
    const newPool = Number(ev.btPool || 0) + amt;
    const rewardBt = Math.max(1, Number(ev.rewardBt || 1));
    tx.update(eventRef, {
      btPool: FieldValue.increment(amt),
      btCharged: FieldValue.increment(amt),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (campSnap.exists) {
      tx.update(campRef, {
        totalQuantity: Number(ev.claimCount || 0) + Math.floor(newPool / rewardBt),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    tx.set(db.collection('bt_transactions').doc(), {
      type: 'zalo_pool_charge',
      campaignId: String(campaignId),
      amount: amt,
      adminUid,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { success: true, btPool: newPool };
  });
}

/** 4. 일회용 코드 발급 (최고 관리자) — 평문 코드를 돌려주고, 코드 문서는 관리자만 읽는다 */
async function generateZaloFriendCodes(adminUid, { campaignId, count } = {}) {
  await requireAdmin(adminUid);
  const db = getDb();
  if (!campaignId) throw _err('campaignId가 필요합니다.', 'invalid-argument');
  const n = toPositiveInt(count ?? 1, MAX_CODES_PER_CALL, '코드 개수');
  const eventRef = db.collection('zalo_friend_events').doc(String(campaignId));
  const evSnap = await eventRef.get();
  if (!evSnap.exists) throw _err('Zalo 이벤트를 찾을 수 없습니다.', 'not-found');

  const codes = [];
  const batch = db.batch();
  for (let i = 0; i < n; i++) {
    const code = generateCode();
    codes.push(code);
    // create(): 아주 드문 충돌 시 커밋 실패 → 관리자가 다시 누르면 된다
    batch.create(db.collection('zalo_friend_codes').doc(code), {
      code,
      campaignId: String(campaignId),
      status: 'unused',
      createdBy: adminUid,
      createdAt: FieldValue.serverTimestamp(),
      usedBy: null,
      usedByEmail: null,
      usedAt: null,
    });
  }
  batch.update(eventRef, { codesIssued: FieldValue.increment(n), updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
  return { success: true, codes };
}

/** 5. 회원 수령: 코드 입력 → 풀에서 rewardBt 지급 (1계정 1회) */
async function claimZaloFriendBt(uid, { campaignId, code } = {}) {
  if (!uid) throw _err('로그인이 필요합니다.', 'unauthenticated');
  const db = getDb();
  if (!campaignId) throw _err('campaignId가 필요합니다.', 'invalid-argument');
  const normCode = normalizeCode(code);
  if (!CODE_RE.test(normCode)) throw _err('코드 형식이 올바르지 않습니다. (예: ZL-AB12-CD34)', 'invalid-argument');

  const cid = String(campaignId);
  const eventRef = db.collection('zalo_friend_events').doc(cid);
  const campRef = db.collection('coupon_campaigns').doc(cid);
  const codeRef = db.collection('zalo_friend_codes').doc(normCode);
  const claimRef = db.collection('zalo_friend_claims').doc(`${cid}_${uid}`);
  const userRef = db.collection('users').doc(uid);
  const txRef = db.collection('transactions').doc(`TX_ZALO_${cid}_${uid}`);

  const result = await db.runTransaction(async (tx) => {
    const [evSnap, campSnap, codeSnap, claimSnap, userSnap] = await Promise.all([
      tx.get(eventRef), tx.get(campRef), tx.get(codeRef), tx.get(claimRef), tx.get(userRef),
    ]);

    if (!evSnap.exists || !campSnap.exists) throw _err('존재하지 않는 이벤트입니다.', 'not-found');
    const ev = evSnap.data();
    const camp = campSnap.data();
    if (ev.status !== 'active' || camp.status !== 'active') throw _err('현재 진행 중인 이벤트가 아닙니다.');
    if (claimSnap.exists) throw _err('이미 이 이벤트의 BT를 받으셨습니다. (1계정 1회)', 'already-exists');
    if (!userSnap.exists) throw _err('회원 정보를 찾을 수 없습니다.', 'not-found');

    if (!codeSnap.exists || codeSnap.data().campaignId !== cid) {
      throw _err('유효하지 않은 코드입니다. Zalo 메시지로 받은 코드를 다시 확인해 주세요.', 'not-found');
    }
    if (codeSnap.data().status !== 'unused') throw _err('이미 사용된 코드입니다.', 'already-exists');

    const rewardBt = Math.max(1, Math.floor(Number(ev.rewardBt || 1)));
    const pool = Math.floor(Number(ev.btPool || 0));
    if (pool < rewardBt) throw _err('준비된 BT가 모두 소진되어 이벤트가 마감되었습니다.', 'resource-exhausted');

    const uData = userSnap.data();
    const userEmail = uData.email || '';
    const remainingPool = pool - rewardBt;

    tx.update(eventRef, {
      btPool: FieldValue.increment(-rewardBt),
      btPaid: FieldValue.increment(rewardBt),
      claimCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(campRef, {
      issuedQuantity: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(codeRef, {
      status: 'used',
      usedBy: uid,
      usedByEmail: userEmail,
      usedAt: FieldValue.serverTimestamp(),
    });
    tx.set(claimRef, {
      campaignId: cid,
      userId: uid,
      userEmail,
      userName: uData.name || uData.displayName || (userEmail ? userEmail.split('@')[0] : '회원'),
      code: normCode,
      rewardBt,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(userRef, { btBalance: FieldValue.increment(rewardBt) });
    tx.set(txRef, {
      txId: txRef.id,
      uid,
      type: 'ZALO_FRIEND_BT',
      btAmount: rewardBt,
      campaignId: cid,
      code: normCode,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.collection('bt_transactions').doc(), {
      type: 'zalo_friend_reward',
      campaignId: cid,
      uid,
      amount: rewardBt,
      poolAfter: remainingPool,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { rewardBt, remainingPool };
  });

  // EXP: BT 1개당 100 EXP (트랜잭션 밖, 실패해도 BT 지급에 영향 없음)
  try {
    const expH = require('./exp');
    await expH.grantExp(uid, result.rewardBt * EXP_PER_BT, 'bt');
  } catch (_) { /* noop */ }

  return { success: true, btReceived: result.rewardBt, remainingPool: result.remainingPool };
}

module.exports = {
  createZaloFriendEvent,
  updateZaloFriendEvent,
  chargeZaloFriendPool,
  generateZaloFriendCodes,
  claimZaloFriendBt,
  _test: { normalizeCode, generateCode, cleanZaloUrl },
};
