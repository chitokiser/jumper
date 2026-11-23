// 테이블 QR 체크인 보너스 티켓 발급 (BestERP table-qr.html)
//
// 예전에는 고객 브라우저가 user_coupons 에 티켓을 직접 만들고 merchants.btBalance 를 직접 깎았다.
// 그래서 user_coupons 를 누구나 쓸 수 있게 열어 둬야 했다. 이제 서버가 한 트랜잭션으로 처리한다.
//  - 로그인(구글) 고객만, 같은 가맹점에서 하루 1회
//  - 방금 등록된 store_customers 문서(customerId + merchantId)가 있어야 함
//  - 가맹점 BT 잔고가 1장 이상일 때만 발급, 발급하면 1장 차감
'use strict';

const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');

function vnDay(d = new Date()) {
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function makeCode() {
  return `BT-${Math.floor(100000 + Math.random() * 900000)}`;
}

async function tableQrCheckinReward(request, { db = admin.firestore(), now = new Date() } = {}) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');

  const merchantId = String(request.data?.merchantId || '').trim();
  const customerId = String(request.data?.customerId || '').trim();
  if (!merchantId || !customerId || merchantId.length > 64 || customerId.length > 64) {
    throw new HttpsError('invalid-argument', 'merchantId, customerId 가 필요합니다.');
  }

  const custSnap = await db.collection('store_customers')
    .where('customerId', '==', customerId)
    .where('merchantId', '==', merchantId)
    .limit(1).get();
  if (custSnap.empty) throw new HttpsError('not-found', '고객 등록 정보를 찾을 수 없습니다.');
  const custRef = custSnap.docs[0].ref;

  const merchantRef = db.collection('merchants').doc(merchantId);
  const guardRef = db.collection('table_qr_rewards').doc(`${merchantId}_${uid}_${vnDay(now)}`);
  const couponRef = db.collection('user_coupons').doc();
  const code = makeCode();
  const FieldValue = admin.firestore.FieldValue;

  const result = await db.runTransaction(async (tx) => {
    const [guard, merchant, cust] = await Promise.all([tx.get(guardRef), tx.get(merchantRef), tx.get(custRef)]);
    if (guard.exists) return { issued: false, reason: 'already_today', code: guard.data().couponCode || null };
    if (!merchant.exists) throw new HttpsError('not-found', '가맹점을 찾을 수 없습니다.');
    if (cust.data()?.rewardCouponId) return { issued: false, reason: 'already_rewarded', code: cust.data().btTicketCode || null };

    const bal = Number(merchant.data().btBalance || 0);
    if (!(bal >= 1)) return { issued: false, reason: 'merchant_no_bt', code: null };

    const c = cust.data() || {};
    tx.set(couponRef, {
      couponCode: code,
      ticketType: 'BT_BONUS_TICKET',
      amount: 1,
      name: '1 BT 보너스 티켓 (가맹점주 지급)',
      merchantId,
      customerId,
      customerName: c.name || '',
      customerEmail: c.email || '',
      userId: uid,
      uid,
      status: 'ACTIVE',
      source: 'TABLE_QR_ZALO_REGISTRATION',
      createdAt: FieldValue.serverTimestamp(),
      expiryDate: new Date(now.getTime() + 90 * 24 * 3600 * 1000).toISOString().split('T')[0]
    });
    tx.update(merchantRef, {
      btBalance: FieldValue.increment(-1),
      lastBtAwardedAt: FieldValue.serverTimestamp(),
      totalBtAwarded: FieldValue.increment(1)
    });
    tx.update(custRef, { btTicketCode: code, awardedBt: 1, rewardCouponId: couponRef.id, rewardUid: uid });
    tx.set(guardRef, { uid, merchantId, customerId, couponCode: code, createdAt: FieldValue.serverTimestamp() });
    return { issued: true, code };
  });
  return result;
}

module.exports = { tableQrCheckinReward };
