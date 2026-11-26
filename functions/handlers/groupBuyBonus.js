'use strict';
/**
 * 공동구매(타임딜) 판매 수량 집계 + 목표 달성 Point 보너스 지급 (서버 전용)
 *
 * 집계 기준 (2026-11-25)
 *  - 목표·현재 수량 = 결제(입금) 확인된 주문의 공동구매 상품 "구매 수량" 합계. 사람 수가 아님.
 *  - 결제 확인: payment_status == 'paid' 또는 status ∈ {payment_confirmed, shipped, delivered, completed}
 *  - 취소(status == 'cancelled')된 주문은 수량에서 빠진다.
 *  - 브라우저는 수량을 쓰지 않는다. merchant_orders 변경을 이 트리거가 보고 merchant_products 의
 *    group_buy_current / group_buy.current_count 를 고친다.
 *
 * 보너스 지급
 *  - 상품의 누적 판매 수량이 목표(group_buy.target_count / group_buy_target)에 닿으면,
 *    그 상품을 산 결제 확인 주문마다 "1개당 보너스 × 산 수량" Point 를 구매자 users.pointBalance 에 넣는다.
 *    (2026-11-26 대표 지시: 보상 재화 BM → Point)
 *    1개당 보너스 = group_buy.bonus_point / group_buy_bonus_point (없으면 예전 필드 bonus_bm / group_buy_bonus_bm 숫자를 Point 로 사용)
 *    금액은 서버의 상품 설정 기준 (주문서에 적힌 값은 쓰지 않음).
 *  - 목표 달성 뒤에 결제 확인된 주문도 그때 바로 지급.
 *  - 멱등: group_buy_bonus_payouts/{주문ID}_{상품ID} 문서가 있으면 다시 지급하지 않는다.
 *  - 원장: transactions/TX_GB_BONUS_{주문ID}_{상품ID} (type GROUP_BUY_BONUS_POINT, amountPoint)
 *
 * 취소 시 회수
 *  - 보너스를 받은 주문이 취소되면 지급한 Point 를 회수한다 (TX_GB_BONUS_REV_…, type GROUP_BUY_BONUS_POINT_REVERSAL).
 *    잔액이 모자라면 남은 잔액까지만 회수하고 모자란 수량(shortfallPoint)을 기록한다 (잔액을 음수로 만들지 않음).
 *  - 다른 사람의 취소로 수량이 목표 아래로 내려가도, 이미 지급된 다른 구매자의 보너스는 회수하지 않는다.
 */
const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');

const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const PAID_STATUSES = new Set(['payment_confirmed', 'shipped', 'delivered', 'completed']);
const ADMIN_EMAILS = ['daguri75@gmail.com'];

function isCancelled(o) {
  const st = String(o?.status || '').toLowerCase();
  return st === 'cancelled' || st === 'canceled';
}

function isPaid(o) {
  if (!o || isCancelled(o)) return false;
  return o.payment_status === 'paid' || PAID_STATUSES.has(String(o.status || '').toLowerCase());
}

/** 집계에 들어가는 주문이면 {상품ID: 수량}, 아니면 빈 Map */
function countedQty(o) {
  const m = new Map();
  if (!isPaid(o)) return m;
  for (const it of Array.isArray(o.items) ? o.items : []) {
    if (!it || it.is_group_buy !== true) continue;
    const pid = String(it.product_id || it.id || '').trim();
    if (!pid) continue;
    const q = Math.max(0, Math.floor(Number(it.qty ?? it.quantity ?? 1) || 0));
    if (q > 0) m.set(pid, (m.get(pid) || 0) + q);
  }
  return m;
}

/** 주문에 들어 있는 공동구매 상품 수량 (결제 여부 무관) */
function groupBuyQty(o) {
  return countedQty({ ...o, status: 'completed', payment_status: 'paid' });
}

function gbConfig(p) {
  const gb = (p && typeof p.group_buy === 'object' && p.group_buy) ? p.group_buy : {};
  return {
    current: Math.max(0, Number(gb.current_count ?? p?.group_buy_current ?? 0) || 0),
    target: Math.max(2, Number(gb.target_count ?? p?.group_buy_target ?? 10) || 10),
    bonusPoint: Math.max(0, Math.floor(Number(gb.bonus_point ?? p?.group_buy_bonus_point ?? gb.bonus_bm ?? p?.group_buy_bonus_bm ?? 0) || 0)),
    reachedAt: gb.goal_reached_at || p?.group_buy_goal_reached_at || null,
    name: p?.product_name || p?.name || '',
    merchantId: p?.merchant_id ?? p?.merchantId ?? null,
  };
}

/** 상품 누적 수량에 delta 를 더한다. 목표 처음 달성 시 시각을 남긴다. */
async function applyDelta(pid, delta) {
  const ref = db.collection('merchant_products').doc(pid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const cfg = gbConfig(snap.data());
    const next = Math.max(0, cfg.current + delta);
    const upd = { group_buy_current: next, 'group_buy.current_count': next, updated_at: FV.serverTimestamp() };
    let justReached = false;
    if (next >= cfg.target && !cfg.reachedAt) {
      upd['group_buy.goal_reached_at'] = FV.serverTimestamp();
      upd.group_buy_goal_reached_at = FV.serverTimestamp();
      justReached = true;
    }
    tx.update(ref, upd);
    return { ...cfg, current: next, reached: next >= cfg.target || !!cfg.reachedAt, justReached };
  });
}

/** 주문 1건·상품 1개에 대한 보너스 지급 (멱등) */
async function payBonus(orderId, pid, cfg) {
  const payoutRef = db.collection('group_buy_bonus_payouts').doc(`${orderId}_${pid}`);
  const orderRef = db.collection('merchant_orders').doc(orderId);
  return db.runTransaction(async (tx) => {
    const [pSnap, oSnap] = await Promise.all([tx.get(payoutRef), tx.get(orderRef)]);
    if (pSnap.exists || !oSnap.exists) return 0;
    const o = oSnap.data() || {};
    const qty = countedQty(o).get(pid) || 0;
    if (!qty) return 0; // 결제 확인 전이거나 취소된 주문
    const amount = cfg.bonusPoint * qty;
    const buyer = String(o.buyer_uid || '');
    const base = { orderId, productId: pid, productName: cfg.name, merchantId: String(o.merchant_id ?? cfg.merchantId ?? ''), buyerUid: buyer, qty, bonusPerUnit: cfg.bonusPoint, currency: 'POINT', amountPoint: amount, createdAt: FV.serverTimestamp() };
    if (amount <= 0) { tx.set(payoutRef, { ...base, status: 'no_bonus' }); return 0; }
    if (!buyer || buyer === 'GUEST' || buyer === 'TABLE_GUEST') { tx.set(payoutRef, { ...base, status: 'no_buyer' }); return 0; }
    const userRef = db.collection('users').doc(buyer);
    const uSnap = await tx.get(userRef);
    if (!uSnap.exists) { tx.set(payoutRef, { ...base, status: 'no_buyer' }); return 0; }

    const txId = `TX_GB_BONUS_${orderId}_${pid}`;
    tx.update(userRef, { pointBalance: FV.increment(amount), updatedAt: FV.serverTimestamp() });
    tx.set(db.collection('transactions').doc(txId), {
      userId: buyer, uid: buyer, type: 'GROUP_BUY_BONUS_POINT', amountPoint: amount, currency: 'POINT', status: 'completed',
      orderId, productId: pid, qty, bonusPerUnit: cfg.bonusPoint,
      description: `[공동구매 목표 달성 보너스] ${cfg.name || pid} ${qty}개 × ${cfg.bonusPoint.toLocaleString()} Point`,
      createdAt: FV.serverTimestamp(),
    });
    tx.set(payoutRef, { ...base, status: 'paid', txId });
    tx.update(orderRef, { [`group_buy_bonus.${pid}`]: { amountPoint: amount, currency: 'POINT', qty, status: 'paid', paidAt: FV.serverTimestamp() } });
    return amount;
  });
}

/** 취소된 주문의 보너스 회수 (멱등) */
async function reverseBonus(orderId, pid) {
  const payoutRef = db.collection('group_buy_bonus_payouts').doc(`${orderId}_${pid}`);
  return db.runTransaction(async (tx) => {
    const pSnap = await tx.get(payoutRef);
    if (!pSnap.exists) return 0;
    const p = pSnap.data() || {};
    if (p.status !== 'paid') return 0;
    const amount = Math.max(0, Number(p.amountPoint ?? p.amountBm ?? 0));
    const userRef = db.collection('users').doc(String(p.buyerUid || ''));
    const uSnap = await tx.get(userRef);
    const bal = uSnap.exists ? Math.max(0, Number(uSnap.data()?.pointBalance || 0)) : 0;
    const take = Math.min(amount, bal);
    const shortfall = amount - take;
    if (take > 0) tx.update(userRef, { pointBalance: FV.increment(-take), updatedAt: FV.serverTimestamp() });
    const txId = `TX_GB_BONUS_REV_${orderId}_${pid}`;
    tx.set(db.collection('transactions').doc(txId), {
      userId: p.buyerUid, uid: p.buyerUid, type: 'GROUP_BUY_BONUS_POINT_REVERSAL', amountPoint: -take, currency: 'POINT', status: 'completed',
      orderId, productId: pid, shortfallPoint: shortfall,
      description: `[공동구매 보너스 회수] 주문 취소 — ${p.productName || pid}${shortfall ? ` (잔액 부족 ${shortfall.toLocaleString()} Point 미회수)` : ''}`,
      createdAt: FV.serverTimestamp(),
    });
    tx.update(payoutRef, { status: 'reversed', reversedPoint: take, shortfallPoint: shortfall, reversedAt: FV.serverTimestamp(), reversalTxId: txId });
    tx.update(db.collection('merchant_orders').doc(orderId), { [`group_buy_bonus.${pid}.status`]: 'reversed', [`group_buy_bonus.${pid}.reversedPoint`]: take });
    return take;
  });
}

/** 목표를 채운 상품: 결제 확인된 모든 주문에 보너스 지급 */
async function payAllForProduct(pid, cfg) {
  const ids = new Set([String(cfg.merchantId ?? '')].filter(Boolean));
  if (/^\d+$/.test(String(cfg.merchantId))) ids.add(Number(cfg.merchantId));
  if (!ids.size) return 0;
  const snap = await db.collection('merchant_orders').where('merchant_id', 'in', [...ids]).get();
  let paid = 0;
  for (const d of snap.docs) {
    if (!countedQty(d.data()).get(pid)) continue;
    paid += await payBonus(d.id, pid, cfg);
  }
  return paid;
}

/** merchant_orders/{orderId} 변경 트리거 */
async function onMerchantOrderWritten(event) {
  const orderId = event.params.orderId;
  const before = event.data?.before?.exists ? event.data.before.data() : null;
  const after = event.data?.after?.exists ? event.data.after.data() : null;
  const b = countedQty(before);
  const a = countedQty(after);
  const pids = new Set([...b.keys(), ...a.keys()]);
  if (!pids.size) return;

  for (const pid of pids) {
    const delta = (a.get(pid) || 0) - (b.get(pid) || 0);
    try {
      let cfg = null;
      if (delta !== 0) cfg = await applyDelta(pid, delta);
      if (!cfg) {
        const ps = await db.collection('merchant_products').doc(pid).get();
        if (!ps.exists) continue;
        const c = gbConfig(ps.data());
        cfg = { ...c, reached: c.current >= c.target || !!c.reachedAt, justReached: false };
      }

      if (b.get(pid) && !a.get(pid)) {
        // 결제 확인됐던 주문이 취소(또는 미결제로 되돌림) → 이 주문 보너스 회수
        await reverseBonus(orderId, pid);
      } else if (cfg.justReached) {
        await payAllForProduct(pid, cfg);
      } else if (cfg.reached && a.get(pid)) {
        await payBonus(orderId, pid, cfg);
      }
    } catch (err) {
      logger.error('[groupBuyBonus] order', orderId, 'product', pid, err);
    }
  }
}

/**
 * 관리자 전용: 결제 확인 주문 기준으로 공동구매 수량을 다시 계산하고, 목표 달성 상품의 Point 보너스를 지급.
 * (이전에 브라우저가 주문 접수 시점에 올려 둔 수량을 바로잡는 용도. 여러 번 실행해도 안전)
 *   클라이언트: httpsCallable(functions, 'adminRecalcGroupBuy')({ dryRun: true })
 */
async function adminRecalcGroupBuy(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  const aSnap = await db.collection('admins').doc(uid).get();
  const email = String(request.auth.token?.email || '').toLowerCase();
  const verified = request.auth.token?.email_verified === true;
  if (!aSnap.exists && !(verified && ADMIN_EMAILS.includes(email))) throw new HttpsError('permission-denied', '관리자만 실행할 수 있습니다.');
  const dryRun = request.data?.dryRun !== false;

  const prodSnap = await db.collection('merchant_products').get();
  const gbProducts = prodSnap.docs.filter((d) => {
    const p = d.data() || {};
    return (p.group_buy && p.group_buy.enabled === true) || p.group_buy_enabled === true || p.group_buy_current != null || p.group_buy?.current_count != null;
  });

  const report = [];
  for (const d of gbProducts) {
    const cfg = gbConfig(d.data());
    const ids = new Set([String(cfg.merchantId ?? '')].filter(Boolean));
    if (/^\d+$/.test(String(cfg.merchantId))) ids.add(Number(cfg.merchantId));
    let sold = 0;
    let pending = 0;
    if (ids.size) {
      const os = await db.collection('merchant_orders').where('merchant_id', 'in', [...ids]).get();
      for (const o of os.docs) {
        const od = o.data();
        sold += countedQty(od).get(d.id) || 0;
        if (!isPaid(od) && !isCancelled(od)) pending += groupBuyQty(od).get(d.id) || 0;
      }
    }
    const row = { productId: d.id, name: cfg.name, before: cfg.current, after: sold, unpaidQty: pending, target: cfg.target, bonusPerUnit: cfg.bonusPoint, reached: sold >= cfg.target, bonusPaidPoint: 0 };
    if (!dryRun) {
      const upd = { group_buy_current: sold, 'group_buy.current_count': sold, updated_at: FV.serverTimestamp() };
      if (sold >= cfg.target && !cfg.reachedAt) { upd['group_buy.goal_reached_at'] = FV.serverTimestamp(); upd.group_buy_goal_reached_at = FV.serverTimestamp(); }
      await d.ref.update(upd);
      if (sold >= cfg.target || cfg.reachedAt) row.bonusPaidPoint = await payAllForProduct(d.id, { ...cfg, current: sold });
    }
    report.push(row);
  }
  return { dryRun, products: report };
}

module.exports = { onMerchantOrderWritten, adminRecalcGroupBuy, _test: { countedQty, gbConfig, isPaid } };
