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

// ─────────────────────────────────────────────────────────────────────────────
// 가맹점 매출·고객 요약 (단일 기준) — BestERP 대시보드와 BestClub 마이페이지가 같이 쓴다.
//
// 매출 채널 4가지 (모두 결제 확정 건만, 같은 결제는 한 번만 집계):
//   1) storeBm        매장 BM 결제      transactions 'pay_merchant' (가맹점 주문과 연결되지 않은 것)
//   2) cashBt         현금 결제 + BT 발급 transactions 'receive_bt'(BT 보상 QR) · bt_transactions 'remote_send'(주문 없는 원격 발급)
//                                       의 amountVnd = 고객이 매장에 현금으로 낸 금액
//   3) onlineBm       온라인 BM 결제     merchant_orders payment_method 'bm_wallet' + 결제 확인
//                                       (금액은 같은 txHash 의 pay_merchant 와 한 번만 집계)
//   4) onlineTransfer 온라인 계좌이체    merchant_orders payment_method 'bank_transfer' + 입금 확인(paid)
//   (기타 결제 확인된 주문은 onlineOther)
// 수수료: BM 결제(1·3)의 10% → 정산 예정 = BM 결제의 90%. 현금·계좌이체는 가맹점이 직접 받은 돈.
// 고객: 위 결제·BT 수령 회원 + 이 가맹점 가입 회원 + 가맹점 대표의 멘티 (대표·직원·관리자 제외)
// ─────────────────────────────────────────────────────────────────────────────
const PAID_ORDER_STATUSES = new Set(['payment_confirmed', 'preparing', 'shipped', 'delivered', 'completed', '결제확인', '배송중', '배송완료', '완료']);
const CANCELLED_ORDER_STATUSES = new Set(['cancelled', 'canceled', 'rejected', 'refunded', '취소', '환불']);
const STAFF_ROLES = new Set(['SUPER_ADMIN', 'CEO', 'STAFF', 'EMPLOYEE', 'ADMIN', 'FRANCHISE', 'MERCHANT', 'STORE_ADMIN', 'SYSTEM_MASTER']);
const FEE_RATE = 0.10;
const CHANNELS = {
  storeBm: '매장 BM 결제',
  cashBt: '현금 결제 + BT 발급',
  onlineBm: '온라인 BM 결제',
  onlineTransfer: '온라인 계좌이체',
  onlineOther: '기타 온라인 주문',
};

function vnDayKey(ms) {
  return new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

async function getMerchantSalesSummary(callerUid, data = {}) {
  const merchantId = String(data.merchantId || '').trim();
  if (!merchantId || merchantId === 'ALL' || merchantId.length > 64) {
    throw new HttpsError('invalid-argument', '가맹점 ID가 필요합니다.');
  }
  const callerSnap = await db.collection('users').doc(callerUid).get();
  const caller = callerSnap.exists ? (callerSnap.data() || {}) : {};
  if (!(await isSuperAdmin(callerUid, caller)) && !belongsToMerchant(caller, merchantId)) {
    throw new HttpsError('permission-denied', '본인 가맹점의 매출만 조회할 수 있습니다.');
  }

  const variants = merchantIdVariants(merchantId);
  const merchantSnap = await db.collection('merchants').doc(merchantId).get();
  const merchant = merchantSnap.exists ? (merchantSnap.data() || {}) : {};
  const ownerUid = merchant.ownerUid || merchant.ownerId || merchant.userId || merchant.uid || '';
  const ownerEmail = String(merchant.ownerEmail || merchant.email || '').toLowerCase().trim();

  const byMerchant = (col, field = 'merchantId') => db.collection(col).where(field, 'in', variants);
  const [payTx, btTx, remoteTx, ordersA, ordersB, registered, menteesUid, menteesEmail, menteesAddr] = await Promise.all([
    byMerchant('transactions').where('type', '==', 'pay_merchant').get(),
    byMerchant('transactions').where('type', '==', 'receive_bt').get(),
    byMerchant('bt_transactions').where('type', '==', 'remote_send').get(),
    byMerchant('merchant_orders', 'merchant_id').get(),
    byMerchant('merchant_orders', 'merchantId').get(),
    db.collection('users').where('registeredMerchantId', 'in', variants).limit(1000).get(),
    ownerUid ? db.collection('users').where('mentorUid', '==', ownerUid).limit(1000).get() : null,
    ownerEmail ? db.collection('users').where('mentorEmail', '==', ownerEmail).limit(1000).get() : null,
    ownerEmail ? db.collection('users').where('mentorAddressInput', '==', ownerEmail).limit(1000).get() : null,
  ]);

  const now = Date.now();
  const todayKey = vnDayKey(now);
  const monthKey = todayKey.slice(0, 7);
  const channels = {};
  Object.entries(CHANNELS).forEach(([k, label]) => { channels[k] = { label, vnd: 0, count: 0, todayVnd: 0, monthVnd: 0 }; });
  const sales = {
    totalVnd: 0, todayVnd: 0, monthVnd: 0, count: 0,
    bmVnd: 0, feeVnd: 0, settlementVnd: 0,
    pendingOrderCount: 0, pendingOrderVnd: 0, btIssued: 0,
  };
  const ledger = []; // 최근 매출 원장 (화면 표시용)

  const customers = new Map(); // uid|email -> stats
  const touch = (uid, email, patch = {}) => {
    const key = uid || (email ? `email:${email}` : '');
    if (!key || (ownerUid && uid === ownerUid)) return null;
    if (!customers.has(key)) {
      customers.set(key, { uid: uid || '', email: email || '', name: '', phone: '', spendVnd: 0, payCount: 0, btReceived: 0, channels: [], isMember: false, isMentee: false, lastAtMs: null });
    }
    const c = customers.get(key);
    if (!c.email && email) c.email = email;
    if (!c.name && patch.name) c.name = patch.name;
    if (!c.phone && patch.phone) c.phone = patch.phone;
    if (patch.atMs && (!c.lastAtMs || patch.atMs > c.lastAtMs)) c.lastAtMs = patch.atMs;
    return c;
  };
  const addSale = (channel, amt, atMs, c, ref) => {
    const ch = channels[channel];
    ch.vnd += amt; ch.count += 1;
    sales.totalVnd += amt; sales.count += 1;
    if (atMs) {
      const k = vnDayKey(atMs);
      if (k === todayKey) { sales.todayVnd += amt; ch.todayVnd += amt; }
      if (k.slice(0, 7) === monthKey) { sales.monthVnd += amt; ch.monthVnd += amt; }
    }
    if (c) {
      c.spendVnd += amt; c.payCount += 1;
      if (!c.channels.includes(channel)) c.channels.push(channel);
    }
    ledger.push({ channel, label: ch.label, amountVnd: amt, atMs: atMs || null, customerUid: c?.uid || '', customerEmail: c?.email || '', customerName: c?.name || '', ref: ref || '' });
  };

  // 주문 먼저 정리: BM 결제 주문의 txHash → 온라인 BM 결제로 분류하기 위해
  const orders = [];
  const seenOrders = new Set();
  [ordersA, ordersB].forEach(snap => snap.forEach(d => {
    if (seenOrders.has(d.id)) return;
    seenOrders.add(d.id);
    orders.push({ id: d.id, ...(d.data() || {}) });
  }));
  const onlineBmTxHashes = new Set(orders
    .filter(o => o.txHash && (o.payment_method === 'bm_wallet' || o.payment_status === 'paid'))
    .map(o => String(o.txHash)));

  // 1) BM 결제 (매장 QR / 온라인 주문 결제 모두 pay_merchant 로 기록됨)
  const payTxHashes = new Set();
  payTx.forEach(d => {
    const tx = d.data() || {};
    const amt = Number(tx.amountVnd || 0) || 0;
    const atMs = toMillis(tx.createdAt);
    const hash = String(tx.txHash || d.id);
    payTxHashes.add(hash);
    const c = touch(String(tx.buyerUid || tx.uid || ''), String(tx.buyerEmail || '').toLowerCase().trim(),
      { name: tx.buyerName, phone: tx.buyerPhone, atMs });
    sales.bmVnd += amt;
    addSale(onlineBmTxHashes.has(hash) ? 'onlineBm' : 'storeBm', amt, atMs, c, hash);
  });

  // 2) 현금 결제 + BT 발급
  btTx.forEach(d => {
    const tx = d.data() || {};
    const bt = Number(tx.bt || tx.issuedBt || 0) || 0;
    const atMs = toMillis(tx.createdAt);
    sales.btIssued += bt;
    const c = touch(String(tx.buyerUid || tx.uid || ''), String(tx.buyerEmail || '').toLowerCase().trim(),
      { name: tx.buyerName, phone: tx.buyerPhone, atMs });
    if (c) c.btReceived += bt;
    const amt = Number(tx.amountVnd || 0) || 0;
    if (amt > 0) addSale('cashBt', amt, atMs, c, String(tx.rewardId || d.id));
  });
  remoteTx.forEach(d => {
    const tx = d.data() || {};
    const bt = Number(tx.btIssued || 0) || 0;
    const atMs = toMillis(tx.createdAt);
    sales.btIssued += bt;
    const c = touch(String(tx.customerUid || ''), String(tx.customerEmail || '').toLowerCase().trim(), { atMs });
    if (c) c.btReceived += bt;
    if (tx.orderId) return; // 주문 매출로 이미 집계
    const amt = Number(tx.amountVnd || 0) || 0;
    if (amt > 0) addSale('cashBt', amt, atMs, c, d.id);
  });

  // 3·4) 온라인 주문 (BM 결제분은 pay_merchant 로 이미 집계 → 중복 제외)
  orders.forEach(o => {
    const status = String(o.status || '').trim();
    if (CANCELLED_ORDER_STATUSES.has(status)) return;
    const buyerUid = String(o.buyer_id || o.buyer_uid || o.buyerUid || o.userId || o.user_id || '').trim();
    const buyerEmail = String(o.buyer_email || o.buyerEmail || o.email || '').toLowerCase().trim();
    const atMs = toMillis(o.paid_at || o.created_at || o.createdAt);
    const c = touch(buyerUid, buyerEmail, { name: o.buyer_name || o.buyerName, phone: o.buyer_phone || o.buyerPhone, atMs });
    const amt = Number(o.total_amount || o.totalAmount || o.amount || o.amountVnd || 0) || 0;
    const paid = o.payment_status === 'paid' || PAID_ORDER_STATUSES.has(status);
    if (!paid) { sales.pendingOrderCount += 1; sales.pendingOrderVnd += amt; return; }
    if (o.txHash && payTxHashes.has(String(o.txHash))) return;
    if (amt <= 0) return;
    const channel = o.payment_method === 'bank_transfer' ? 'onlineTransfer'
      : (o.payment_method === 'bm_wallet' ? 'onlineBm' : 'onlineOther');
    if (channel === 'onlineBm') sales.bmVnd += amt;
    addSale(channel, amt, atMs, c, o.id);
  });

  sales.feeVnd = Math.round(sales.bmVnd * FEE_RATE);
  sales.settlementVnd = sales.bmVnd - sales.feeVnd;

  // 회원(가입 가맹점) · 대표의 멘티
  const memberDocs = new Map();
  [[registered, 'isMember'], [menteesUid, 'isMentee'], [menteesEmail, 'isMentee'], [menteesAddr, 'isMentee']].forEach(([snap, flag]) => {
    if (!snap) return;
    snap.forEach(d => {
      memberDocs.set(d.id, d.data() || {});
      const u = d.data() || {};
      const c = touch(d.id, String(u.email || '').toLowerCase().trim(), { name: u.name || u.displayName, phone: u.phone });
      if (c) c[flag] = true;
    });
  });

  // 고객 프로필 보강 + 직원·관리자 제외
  const uids = Array.from(customers.values()).map(c => c.uid).filter(u => u && !memberDocs.has(u));
  for (let i = 0; i < uids.length; i += 300) {
    const snaps = await db.getAll(...uids.slice(i, i + 300).map(u => db.collection('users').doc(u)));
    snaps.forEach(s => { if (s.exists) memberDocs.set(s.id, s.data() || {}); });
  }
  const missingEmail = [];
  for (const [key, c] of customers) {
    const u = c.uid ? memberDocs.get(c.uid) : null;
    if (u) {
      const role = String(u.role || '').toUpperCase().trim();
      if (STAFF_ROLES.has(role) || u.isMerchantOwner === true || (u.merchantId != null && u.merchantId !== '')) {
        customers.delete(key);
        continue;
      }
      if (!c.email && u.email) c.email = String(u.email).toLowerCase().trim();
      if (!c.name) c.name = u.name || u.displayName || '';
      if (!c.phone && u.phone) c.phone = u.phone;
      c.points = Number(u.points || u.pointBalance || 0) || 0;
      if (variants.map(String).includes(String(u.registeredMerchantId ?? ''))) c.isMember = true;
    }
    if (ownerEmail && c.email === ownerEmail) { customers.delete(key); continue; }
    if (!c.email && c.uid) missingEmail.push(c.uid);
  }
  for (let i = 0; i < missingEmail.length; i += 100) {
    try {
      const res = await admin.auth().getUsers(missingEmail.slice(i, i + 100).map(uid => ({ uid })));
      res.users.forEach(r => {
        const c = customers.get(r.uid);
        if (c && r.email) c.email = r.email.toLowerCase();
      });
    } catch (e) { /* Auth 조회 실패 시 생략 */ }
  }

  // 매출 원장 표시용 고객 정보 최신화 (Auth 이메일 등)
  ledger.forEach(e => {
    const c = e.customerUid ? customers.get(e.customerUid) : null;
    if (c) { e.customerEmail = c.email || e.customerEmail; e.customerName = c.name || e.customerName; }
  });

  const list = Array.from(customers.values())
    .map(c => ({ ...c, isBuyer: c.payCount > 0, name: c.name || (c.email ? c.email.split('@')[0] : '고객') }))
    .sort((a, b) => (b.spendVnd - a.spendVnd) || ((b.lastAtMs || 0) - (a.lastAtMs || 0)));

  return {
    merchantId,
    merchantName: merchant.name || merchant.merchantName || '',
    generatedAtMs: now,
    basis: '매장 BM 결제 + 현금 결제(BT 발급) + 온라인 BM 결제 + 온라인 계좌이체(입금 확인). 대기·취소 주문 제외, 같은 결제는 1회만. 정산 예정 = BM 결제의 90%.',
    sales: { ...sales, pendingSettlementVnd: Number(merchant.pendingSettlementVnd || 0) || 0 },
    channels,
    ledger: ledger.sort((x, y) => (y.atMs || 0) - (x.atMs || 0)).slice(0, 100),
    customers: {
      total: list.length,
      buyers: list.filter(c => c.isBuyer).length,
      members: list.filter(c => c.isMember).length,
      mentees: list.filter(c => c.isMentee).length,
      btOnly: list.filter(c => !c.isBuyer && c.btReceived > 0).length,
      list: list.slice(0, 500),
    },
  };
}

module.exports = { getMerchantQrCustomers, getMerchantSalesSummary, merchantIdVariants };
