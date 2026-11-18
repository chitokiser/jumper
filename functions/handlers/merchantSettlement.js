'use strict';
/**
 * 가맹점 BM 정산 관리 (BestERP 정산 화면).
 *
 * - 정산 예정액 = BM 결제(매장 QR + 온라인 BM 주문)의 90% — getMerchantSalesSummary 와 같은 기준.
 * - 지급 내역 = merchant_settlement_payouts (서버만 기록, 최고관리자만 지급 등록·취소).
 *   취소는 문서를 지우지 않고 status 'void' 로 남긴다 (원장 보존).
 * - 미지급 = 정산 예정액 − 지급 완료 합계. 월별 상태는 오래된 달부터 지급액을 채워 계산한다.
 * - 점주·직원은 본인 가맹점만, 최고관리자는 전체 가맹점을 본다.
 */
const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');
const mc = require('./merchantCustomers');

const db = admin.firestore();
const PAYOUT_COL = 'merchant_settlement_payouts';
const PAYOUT_METHODS = new Set(['USDT', 'BANK_TRANSFER', 'CASH', 'OTHER']);
const MAX_MERCHANTS = 60;

function toMillis(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts._seconds === 'number') return ts._seconds * 1000;
  return null;
}

async function loadCaller(uid) {
  const snap = await db.collection('users').doc(uid).get();
  const caller = snap.exists ? (snap.data() || {}) : {};
  return { caller, isAdmin: await mc.isSuperAdmin(uid, caller) };
}

async function loadPayouts(merchantId) {
  const snap = await db.collection(PAYOUT_COL).where('merchantId', '==', merchantId).get();
  return snap.docs.map(d => {
    const p = d.data() || {};
    return {
      id: d.id,
      amountVnd: Number(p.amountVnd || 0) || 0,
      method: p.method || 'OTHER',
      reference: p.reference || '',
      usdtAmount: p.usdtAmount != null ? Number(p.usdtAmount) : null,
      periodLabel: p.periodLabel || '',
      note: p.note || '',
      status: p.status || 'paid',
      paidAtMs: toMillis(p.paidAt),
      createdByEmail: p.createdByEmail || '',
      voidReason: p.voidReason || '',
      voidedAtMs: toMillis(p.voidedAt),
    };
  }).sort((a, b) => (b.paidAtMs || 0) - (a.paidAtMs || 0));
}

// 월별 정산 예정액에 지급액을 오래된 달부터 채워 상태를 붙인다
function allocateMonths(months, paidTotal) {
  let left = paidTotal;
  return months.map(m => {
    const paid = Math.max(0, Math.min(m.settlementVnd, left));
    left -= paid;
    const unpaid = m.settlementVnd - paid;
    const status = m.settlementVnd <= 0 ? 'none' : (unpaid <= 0 ? 'paid' : (paid > 0 ? 'partial' : 'unpaid'));
    return { ...m, paidVnd: paid, unpaidVnd: unpaid, status };
  });
}

async function buildMerchantSettlement(callerUid, merchantId) {
  const summary = await mc.getMerchantSalesSummary(callerUid, { merchantId });
  const payouts = await loadPayouts(merchantId);
  const s = summary.sales || {};
  const expectedVnd = Number(s.settlementVnd || 0) || 0;
  const paidVnd = payouts.filter(p => p.status === 'paid').reduce((t, p) => t + p.amountVnd, 0);
  const lastPaid = payouts.find(p => p.status === 'paid');
  return {
    merchantId,
    merchantName: summary.merchantName || '',
    bmVnd: Number(s.bmVnd || 0) || 0,
    feeVnd: Number(s.feeVnd || 0) || 0,
    expectedVnd,
    paidVnd,
    unpaidVnd: expectedVnd - paidVnd,
    status: expectedVnd <= 0 && paidVnd <= 0 ? 'none' : (expectedVnd - paidVnd <= 0 ? 'paid' : (paidVnd > 0 ? 'partial' : 'unpaid')),
    lastPaidAtMs: lastPaid ? lastPaid.paidAtMs : null,
    months: allocateMonths(summary.settlementByMonth || [], paidVnd),
    payouts,
    basis: '정산 예정액 = BM 결제(매장 QR + 온라인 BM 주문)의 90% (수수료 10% 제외). 현금·계좌이체 매출은 가맹점이 직접 받은 돈이라 정산 대상이 아님.',
  };
}

async function getMerchantSettlementOverview(callerUid, data = {}) {
  const merchantId = String(data.merchantId || '').trim();
  if (!merchantId || merchantId.length > 64) throw new HttpsError('invalid-argument', '가맹점 ID가 필요합니다.');
  const { caller, isAdmin } = await loadCaller(callerUid);

  if (merchantId !== 'ALL') {
    if (!isAdmin && !mc.belongsToMerchant(caller, merchantId)) {
      throw new HttpsError('permission-denied', '본인 가맹점의 정산만 조회할 수 있습니다.');
    }
    const one = await buildMerchantSettlement(callerUid, merchantId);
    return { scope: 'merchant', isAdmin, merchants: [one], totals: totalsOf([one]) };
  }

  if (!isAdmin) throw new HttpsError('permission-denied', '전체 가맹점 정산은 최고관리자만 볼 수 있습니다.');
  const mSnap = await db.collection('merchants').limit(MAX_MERCHANTS).get();
  const ids = mSnap.docs
    .filter(d => !['deleted', 'inactive', 'rejected'].includes(String((d.data() || {}).status || '').toLowerCase()))
    .map(d => d.id);
  const merchants = [];
  for (let i = 0; i < ids.length; i += 5) {
    const part = await Promise.all(ids.slice(i, i + 5).map(id => buildMerchantSettlement(callerUid, id).catch(() => null)));
    part.forEach(m => { if (m) merchants.push(m); });
  }
  merchants.sort((a, b) => (b.unpaidVnd - a.unpaidVnd) || (b.expectedVnd - a.expectedVnd));
  return { scope: 'all', isAdmin, merchants, totals: totalsOf(merchants) };
}

function totalsOf(list) {
  return list.reduce((t, m) => ({
    bmVnd: t.bmVnd + m.bmVnd, feeVnd: t.feeVnd + m.feeVnd, expectedVnd: t.expectedVnd + m.expectedVnd,
    paidVnd: t.paidVnd + m.paidVnd, unpaidVnd: t.unpaidVnd + m.unpaidVnd,
  }), { bmVnd: 0, feeVnd: 0, expectedVnd: 0, paidVnd: 0, unpaidVnd: 0 });
}

async function recordMerchantSettlementPayout(callerUid, data = {}) {
  const { caller, isAdmin } = await loadCaller(callerUid);
  if (!isAdmin) throw new HttpsError('permission-denied', '정산 지급 등록은 최고관리자만 할 수 있습니다.');

  const merchantId = String(data.merchantId || '').trim();
  const amountVnd = Number(data.amountVnd);
  const method = String(data.method || '').toUpperCase().trim();
  const idem = String(data.idempotencyKey || '').trim();
  if (!merchantId || merchantId === 'ALL' || merchantId.length > 64) throw new HttpsError('invalid-argument', '가맹점 ID가 필요합니다.');
  if (!Number.isSafeInteger(amountVnd) || amountVnd <= 0) throw new HttpsError('invalid-argument', '지급액은 1 VND 이상의 정수여야 합니다.');
  if (!PAYOUT_METHODS.has(method)) throw new HttpsError('invalid-argument', '지급 방법을 선택해 주세요.');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(idem)) throw new HttpsError('invalid-argument', '요청 키가 올바르지 않습니다.');
  const usdtAmount = data.usdtAmount === '' || data.usdtAmount == null ? null : Number(data.usdtAmount);
  if (usdtAmount !== null && !(Number.isFinite(usdtAmount) && usdtAmount > 0)) throw new HttpsError('invalid-argument', 'USDT 수량이 올바르지 않습니다.');
  const clip = (v, n) => String(v || '').trim().slice(0, n);

  // 미지급액을 넘는 지급은 막는다 (정산 예정액은 서버 기준으로 다시 계산)
  const current = await buildMerchantSettlement(callerUid, merchantId);
  if (amountVnd > current.unpaidVnd) {
    throw new HttpsError('failed-precondition', `미지급액(₫${current.unpaidVnd.toLocaleString()})보다 많이 지급할 수 없습니다.`);
  }

  const ref = db.collection(PAYOUT_COL).doc(`payout_${merchantId}_${idem}`);
  const merchantRef = db.collection('merchants').doc(merchantId);
  const result = await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) return { duplicate: true, id: ref.id };
    tx.create(ref, {
      merchantId,
      merchantName: current.merchantName,
      amountVnd,
      method,
      reference: clip(data.reference, 200),
      usdtAmount,
      periodLabel: clip(data.periodLabel, 40),
      note: clip(data.note, 500),
      status: 'paid',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      createdByUid: callerUid,
      createdByEmail: String(caller.email || '').toLowerCase(),
      idempotencyKey: idem,
      expectedAtPayoutVnd: current.expectedVnd,
      unpaidBeforeVnd: current.unpaidVnd,
    });
    tx.set(merchantRef, {
      settledTotalVnd: admin.firestore.FieldValue.increment(amountVnd),
      lastSettledAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { duplicate: false, id: ref.id };
  });
  return { success: true, ...result };
}

async function voidMerchantSettlementPayout(callerUid, data = {}) {
  const { caller, isAdmin } = await loadCaller(callerUid);
  if (!isAdmin) throw new HttpsError('permission-denied', '지급 취소는 최고관리자만 할 수 있습니다.');
  const payoutId = String(data.payoutId || '').trim();
  const reason = String(data.reason || '').trim().slice(0, 300);
  if (!/^payout_[A-Za-z0-9_-]{1,140}$/.test(payoutId)) throw new HttpsError('invalid-argument', '지급 기록이 올바르지 않습니다.');
  if (!reason) throw new HttpsError('invalid-argument', '취소 사유를 입력해 주세요.');

  const ref = db.collection(PAYOUT_COL).doc(payoutId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', '지급 기록이 없습니다.');
    const p = snap.data() || {};
    if (p.status === 'void') return { success: true, alreadyVoid: true };
    tx.update(ref, {
      status: 'void',
      voidReason: reason,
      voidedAt: admin.firestore.FieldValue.serverTimestamp(),
      voidedByUid: callerUid,
      voidedByEmail: String(caller.email || '').toLowerCase(),
    });
    tx.set(db.collection('merchants').doc(String(p.merchantId)), {
      settledTotalVnd: admin.firestore.FieldValue.increment(-(Number(p.amountVnd || 0) || 0)),
    }, { merge: true });
    return { success: true, alreadyVoid: false };
  });
}

module.exports = { getMerchantSettlementOverview, recordMerchantSettlementPayout, voidMerchantSettlementPayout, allocateMonths };
