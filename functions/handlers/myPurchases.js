'use strict';
/**
 * 마이페이지 "내 구매 내역": 로그인한 회원이 고객으로서 모든 가맹점에서 결제한 내역.
 * 가맹점주·직원도 다른 가맹점(또는 자기 가맹점)에서 소비할 수 있으므로 역할과 관계없이 본인 결제만 모은다.
 *
 * 결제 경로 (가맹점 매출 요약 getMerchantSalesSummary 와 같은 분류):
 *   storeBm        매장 BM 결제      transactions 'pay_merchant' (buyerUid/uid = 본인)
 *   cashBt         현금 결제 + BT     transactions 'receive_bt' · bt_transactions 'remote_send'(주문 없는 것)
 *   onlineBm       온라인 BM 결제     merchant_orders bm_wallet 결제 확인 (같은 txHash 의 pay_merchant 와 한 번만)
 *   onlineTransfer 온라인 계좌이체    merchant_orders bank_transfer 입금 확인
 *   onlineOther    기타 결제 확인 주문
 * 결제 대기·취소 주문은 목록에만 보이고 합계에서 뺀다.
 */
const admin = require('firebase-admin');

const db = admin.firestore();

const CHANNELS = {
  storeBm: '매장 BM 결제',
  cashBt: '현금 결제 + BT 수령',
  onlineBm: '온라인 BM 결제',
  onlineTransfer: '온라인 계좌이체',
  onlineOther: '기타 온라인 주문',
};
const PAID_ORDER_STATUSES = new Set(['payment_confirmed', 'preparing', 'shipped', 'delivered', 'completed', '결제확인', '배송중', '배송완료', '완료']);
const CANCELLED_ORDER_STATUSES = new Set(['cancelled', 'canceled', 'rejected', 'refunded', '취소', '환불']);
const SLUG_TO_ID = {
  bestwinner: '1791605366', best_winner: '1791605366',
  daehan_kimchi: '1791002036', daehankimchi: '1791002036',
  baekje_galbi: '1794710386', baekjegalbi: '1794710386',
  best_mario: '1793671043', bestmario: '1793671043',
};
const MAX_PER_QUERY = 500;

function toMillis(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts._seconds === 'number') return ts._seconds * 1000;
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  if (typeof ts === 'string' || typeof ts === 'number') { const t = new Date(ts).getTime(); return Number.isFinite(t) ? t : null; }
  return null;
}
const normMerchantId = (v) => {
  const s = String(v ?? '').trim();
  return SLUG_TO_ID[s.toLowerCase()] || s;
};

async function getMyPurchaseHistory(uid) {
  const mine = (col, field, extra) => {
    let q = db.collection(col).where(field, '==', uid);
    if (extra) q = q.where('type', '==', extra);
    return q.limit(MAX_PER_QUERY).get();
  };
  const [payA, payB, btA, btB, remote, oA, oB, oC, oD] = await Promise.all([
    mine('transactions', 'buyerUid', 'pay_merchant'),
    mine('transactions', 'uid', 'pay_merchant'),
    mine('transactions', 'buyerUid', 'receive_bt'),
    mine('transactions', 'uid', 'receive_bt'),
    mine('bt_transactions', 'customerUid', 'remote_send'),
    mine('merchant_orders', 'buyer_id'),
    mine('merchant_orders', 'buyer_uid'),
    mine('merchant_orders', 'buyerUid'),
    mine('merchant_orders', 'userId'),
  ]);

  const dedupe = (...snaps) => {
    const m = new Map();
    snaps.forEach(s => s.forEach(d => { if (!m.has(d.id)) m.set(d.id, d.data() || {}); }));
    return m;
  };
  const pays = dedupe(payA, payB);
  const bts = dedupe(btA, btB);
  const orders = dedupe(oA, oB, oC, oD);

  const items = [];
  const payItemByHash = new Map();
  const onlineHashes = new Set();
  orders.forEach(o => {
    if (o.txHash && (o.payment_method === 'bm_wallet' || o.payment_status === 'paid')) onlineHashes.add(String(o.txHash));
  });

  pays.forEach((tx, id) => {
    const hash = String(tx.txHash || id);
    const item = {
      id, atMs: toMillis(tx.createdAt), channel: onlineHashes.has(hash) ? 'onlineBm' : 'storeBm',
      merchantId: normMerchantId(tx.merchantId), merchantName: tx.merchantName || '',
      amountVnd: Number(tx.amountVnd || 0) || 0, btReceived: Number(tx.issuedBt || 0) || 0,
      status: 'paid', counted: true,
    };
    payItemByHash.set(hash, item);
    items.push(item);
  });
  bts.forEach((tx, id) => {
    items.push({
      id, atMs: toMillis(tx.createdAt), channel: 'cashBt',
      merchantId: normMerchantId(tx.merchantId), merchantName: tx.merchantName || '',
      amountVnd: Number(tx.amountVnd || 0) || 0, btReceived: Number(tx.bt || tx.issuedBt || 0) || 0,
      status: 'paid', counted: true,
    });
  });
  const orderBt = new Map(); // 주문에 딸린 원격 BT 발급
  remote.forEach(d => {
    const tx = d.data() || {};
    const bt = Number(tx.btIssued || 0) || 0;
    if (tx.orderId) { orderBt.set(String(tx.orderId), (orderBt.get(String(tx.orderId)) || 0) + bt); return; }
    items.push({
      id: d.id, atMs: toMillis(tx.createdAt), channel: 'cashBt',
      merchantId: normMerchantId(tx.merchantId), merchantName: '',
      amountVnd: Number(tx.amountVnd || 0) || 0, btReceived: bt,
      status: 'paid', counted: true,
    });
  });
  orders.forEach((o, id) => {
    const status = String(o.status || '').trim();
    const amt = Number(o.total_amount || o.totalAmount || o.amount || o.amountVnd || 0) || 0;
    const paid = o.payment_status === 'paid' || PAID_ORDER_STATUSES.has(status);
    const cancelled = CANCELLED_ORDER_STATUSES.has(status);
    const it = o.txHash ? payItemByHash.get(String(o.txHash)) : null; // BM 결제로 이미 들어감
    if (it) {
      it.orderId = id;
      it.btReceived += orderBt.get(id) || 0;
      if (!it.merchantName) it.merchantName = o.merchant_name || o.merchantName || '';
      return;
    }
    const channel = o.payment_method === 'bank_transfer' ? 'onlineTransfer'
      : (o.payment_method === 'bm_wallet' ? 'onlineBm' : 'onlineOther');
    items.push({
      id, orderId: id, atMs: toMillis(o.paid_at || o.created_at || o.createdAt), channel,
      merchantId: normMerchantId(o.merchant_id || o.merchantId), merchantName: o.merchant_name || o.merchantName || '',
      amountVnd: amt, btReceived: orderBt.get(id) || 0,
      status: cancelled ? 'cancelled' : (paid ? 'paid' : 'pending'),
      counted: paid && !cancelled && amt > 0,
    });
  });

  // 가맹점 이름 보강
  const missing = Array.from(new Set(items.filter(i => !i.merchantName && i.merchantId).map(i => i.merchantId))).slice(0, 100);
  if (missing.length) {
    const snaps = await db.getAll(...missing.map(id => db.collection('merchants').doc(id)));
    const names = new Map(snaps.filter(s => s.exists).map(s => [s.id, (s.data() || {}).name || (s.data() || {}).merchantName || '']));
    items.forEach(i => { if (!i.merchantName) i.merchantName = names.get(i.merchantId) || ''; });
  }

  items.forEach(i => { i.label = CHANNELS[i.channel]; });
  items.sort((a, b) => (b.atMs || 0) - (a.atMs || 0));

  const counted = items.filter(i => i.counted);
  const channels = {};
  Object.entries(CHANNELS).forEach(([k, label]) => { channels[k] = { label, vnd: 0, count: 0 }; });
  const byMerchant = new Map();
  counted.forEach(i => {
    channels[i.channel].vnd += i.amountVnd; channels[i.channel].count += 1;
    const key = i.merchantId || i.merchantName || '-';
    const m = byMerchant.get(key) || { merchantId: i.merchantId, merchantName: i.merchantName, vnd: 0, count: 0, lastAtMs: null };
    m.vnd += i.amountVnd; m.count += 1;
    if (i.atMs && (!m.lastAtMs || i.atMs > m.lastAtMs)) m.lastAtMs = i.atMs;
    if (!m.merchantName && i.merchantName) m.merchantName = i.merchantName;
    byMerchant.set(key, m);
  });
  const bmVnd = channels.storeBm.vnd + channels.onlineBm.vnd;
  const pending = items.filter(i => i.status === 'pending');

  return {
    generatedAtMs: Date.now(),
    totals: {
      totalVnd: counted.reduce((t, i) => t + i.amountVnd, 0),
      count: counted.length,
      bmVnd,
      btReceived: items.filter(i => i.status === 'paid').reduce((t, i) => t + i.btReceived, 0),
      merchantCount: byMerchant.size,
      pendingCount: pending.length,
      pendingVnd: pending.reduce((t, i) => t + i.amountVnd, 0),
    },
    channels,
    merchants: Array.from(byMerchant.values()).sort((a, b) => b.vnd - a.vnd),
    items: items.slice(0, 300).map(({ counted: _c, ...rest }) => rest),
  };
}

module.exports = { getMyPurchaseHistory };
