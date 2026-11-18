'use strict';
/**
 * BestERP 고객 목록(clients)용 가맹점 QR 결제 고객 조회.
 *
 * - 호출자는 해당 가맹점 소속(users.merchantId/tenantId)이거나 최고관리자여야 한다.
 * - QR 결제(transactions: pay_merchant, receive_bt)와 원격 BT 전송(bt_transactions: remote_send)을
 *   서버(Admin SDK)에서 가맹점 ID 기준으로 모아 반환한다.
 * - 회원 문서에 email이 없으면 Firebase Auth의 로그인 이메일로 채운다.
 *   (이메일은 이 가맹점과 연결된 회원 것만 반환: QR 결제 고객, 이 가맹점 가입 회원, 호출자의 멘티)
 */
const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');

const db = admin.firestore();

const QR_TX_TYPES = ['pay_merchant', 'receive_bt'];
const MERCHANT_ALIASES = {
  '1791605366': ['bestwinner', 'best_winner'],
  '1791002036': ['daehan_kimchi', 'daehankimchi'],
  '1794710386': ['baekje_galbi', 'baekjegalbi'],
  '1793671043': ['best_mario', 'bestmario'],
};
const MAX_EVENTS_PER_TYPE = 2000;
const MAX_REQUESTED_UIDS = 300;

function merchantIdVariants(merchantId) {
  const s = String(merchantId);
  const variants = [s, ...(MERCHANT_ALIASES[s] || [])];
  const n = Number(s);
  if (Number.isSafeInteger(n) && String(n) === s) variants.push(n);
  return variants.slice(0, 10);
}

function toMillis(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts._seconds === 'number') return ts._seconds * 1000;
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return null;
}

async function isSuperAdmin(uid, userData) {
  if (userData.role === 'SUPER_ADMIN') return true;
  const adminSnap = await db.collection('admins').doc(uid).get();
  return adminSnap.exists;
}

function belongsToMerchant(userData, merchantId) {
  const own = [userData.merchantId, userData.merchant_id, userData.tenantId, userData.tenant_id]
    .filter(v => v !== undefined && v !== null && v !== '')
    .map(String);
  const variants = merchantIdVariants(merchantId).map(String);
  return own.some(v => variants.includes(v));
}

async function getMerchantQrCustomers(callerUid, data = {}) {
  const merchantId = String(data.merchantId || '').trim();
  if (!merchantId || merchantId.length > 64) {
    throw new HttpsError('invalid-argument', 'merchantId가 필요합니다.');
  }

  const callerSnap = await db.collection('users').doc(callerUid).get();
  const caller = callerSnap.exists ? (callerSnap.data() || {}) : {};
  const superAdmin = await isSuperAdmin(callerUid, caller);
  const allMerchants = merchantId === 'ALL';
  if (allMerchants && !superAdmin) {
    throw new HttpsError('permission-denied', '전체 가맹점 조회는 최고관리자만 가능합니다.');
  }
  if (!allMerchants && !superAdmin && !belongsToMerchant(caller, merchantId)) {
    throw new HttpsError('permission-denied', '본인 가맹점의 고객만 조회할 수 있습니다.');
  }

  const variants = allMerchants ? null : merchantIdVariants(merchantId);
  const scoped = (q) => (variants ? q.where('merchantId', 'in', variants) : q);

  // 1) QR 결제 / BT 수령 / 원격 BT 전송 원장
  const [txSnaps, btSnap] = await Promise.all([
    Promise.all(QR_TX_TYPES.map(type =>
      scoped(db.collection('transactions').where('type', '==', type)).limit(MAX_EVENTS_PER_TYPE).get())),
    scoped(db.collection('bt_transactions').where('type', '==', 'remote_send')).limit(MAX_EVENTS_PER_TYPE).get(),
  ]);

  const events = [];
  txSnaps.forEach(snap => snap.forEach(d => {
    const tx = d.data() || {};
    const buyerUid = String(tx.buyerUid || tx.uid || '').trim();
    const buyerEmail = String(tx.buyerEmail || '').toLowerCase().trim();
    if (!buyerUid && !buyerEmail) return;
    const amountVnd = Number(tx.amountVnd || (tx.amountKrw ? Math.round(Number(tx.amountKrw) * 18) : 0)) || 0;
    events.push({
      txId: String(tx.txHash || tx.rewardId || d.id),
      type: tx.type,
      buyerUid,
      buyerEmail,
      buyerName: tx.buyerName || '',
      buyerPhone: tx.buyerPhone || '',
      merchantId: String(tx.merchantId ?? ''),
      amountVnd,
      issuedBt: Number(tx.issuedBt || tx.bt || 0) || 0,
      createdAtMs: toMillis(tx.createdAt),
    });
  }));
  btSnap.forEach(d => {
    const btx = d.data() || {};
    if (btx.orderId) return; // merchant_orders에서 이미 집계
    const buyerUid = String(btx.customerUid || '').trim();
    const buyerEmail = String(btx.customerEmail || '').toLowerCase().trim();
    if (!buyerUid && !buyerEmail) return;
    events.push({
      txId: d.id,
      type: 'remote_send',
      buyerUid,
      buyerEmail,
      buyerName: '',
      buyerPhone: '',
      merchantId: String(btx.merchantId ?? ''),
      amountVnd: Number(btx.amountVnd || 0) || 0,
      issuedBt: Number(btx.btIssued || 0) || 0,
      createdAtMs: toMillis(btx.createdAt),
    });
  });

  // 2) 프로필(이메일) 조회 대상: QR 결제 고객 + 화면이 요청한 이메일 없는 회원(이 가맹점과 연결된 경우만)
  const buyerUids = new Set(events.map(e => e.buyerUid).filter(Boolean));
  const requested = Array.isArray(data.uids)
    ? data.uids.map(u => String(u || '').trim()).filter(u => /^[A-Za-z0-9_-]{6,128}$/.test(u)).slice(0, MAX_REQUESTED_UIDS)
    : [];
  const allUids = Array.from(new Set([...buyerUids, ...requested]));

  const userDocs = new Map();
  for (let i = 0; i < allUids.length; i += 300) {
    const refs = allUids.slice(i, i + 300).map(u => db.collection('users').doc(u));
    const snaps = refs.length ? await db.getAll(...refs) : [];
    snaps.forEach(s => { if (s.exists) userDocs.set(s.id, s.data() || {}); });
  }

  const variantStrs = variants ? variants.map(String) : null;
  const isLinked = (uid) => {
    if (buyerUids.has(uid)) return true;
    if (!variantStrs) return true; // 최고관리자 전체 조회
    const u = userDocs.get(uid);
    if (!u) return false;
    if (variantStrs.includes(String(u.registeredMerchantId ?? '')) || variantStrs.includes(String(u.registeredStoreId ?? ''))) return true;
    return u.mentorUid === callerUid;
  };

  const linkedUids = allUids.filter(isLinked);
  const missingEmail = linkedUids.filter(u => !String(userDocs.get(u)?.email || '').trim());
  const authEmails = new Map();
  for (let i = 0; i < missingEmail.length; i += 100) {
    try {
      const res = await admin.auth().getUsers(missingEmail.slice(i, i + 100).map(uid => ({ uid })));
      res.users.forEach(r => { if (r.email) authEmails.set(r.uid, r.email.toLowerCase()); });
    } catch (e) {
      // Auth 조회 실패 시 Firestore 값만 사용
    }
  }

  const profiles = {};
  linkedUids.forEach(uid => {
    const u = userDocs.get(uid) || {};
    profiles[uid] = {
      email: String(u.email || authEmails.get(uid) || '').toLowerCase().trim(),
      name: u.name || u.displayName || '',
      phone: u.phone || '',
      points: Number(u.points || u.pointBalance || 0) || 0,
      registeredMerchantId: u.registeredMerchantId != null ? String(u.registeredMerchantId) : '',
      mentorUid: u.mentorUid || '',
      mentorEmail: u.mentorEmail || '',
      role: u.role || '',
      createdAtMs: toMillis(u.createdAt),
    };
  });

  return { merchantId, events, profiles };
}

module.exports = { getMerchantQrCustomers, merchantIdVariants };
