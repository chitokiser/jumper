// functions/handlers/merchantReward.js
'use strict';

const admin = require('firebase-admin');
const db = admin.firestore();
const ledgerH = require('./ledger');
const { HttpsError } = require('firebase-functions/v2/https');

/**
 * Configure Merchant Reward Rates
 * @param {string} adminUid 
 * @param {string} merchantId 
 * @param {object} config { merchantFeeRate: 0.03, customerRewardRate: 0.50 }
 */
async function adminSetMerchantRewardPolicy(adminUid, merchantId, { merchantFeeRate, customerRewardRate }) {
    // Authorization is handled in index.js via requireAdmin
    if (merchantFeeRate < 0 || merchantFeeRate > 1.0) throw new HttpsError('invalid-argument', 'merchantFeeRate must be between 0 and 1');
    if (customerRewardRate < 0 || customerRewardRate > 1.0) throw new HttpsError('invalid-argument', 'customerRewardRate must be between 0 and 1');

    const platformRate = 1.0 - customerRewardRate; // Remaining goes to platform

    await db.collection('merchants').doc(String(merchantId)).set({
        merchant_fee_rate: merchantFeeRate,
        customer_reward_rate: customerRewardRate,
        platform_rate: platformRate,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return { success: true, merchantId, merchantFeeRate, customerRewardRate, platformRate };
}

/**
 * Process QR Payment from Customer to Merchant
 * 1. Deduct strict payment_balance_krw from Customer (Warning if insufficient)
 * 2. Calculate fee from payment
 * 3. Add net payment to Merchant's payment_balance_krw
 * 4. Issue Reward Points to Customer based on customer_reward_rate
 * 
 * @param {string} customerUid 
 * @param {string} merchantId 
 * @param {number} amountKrw 
 */
async function processQrPayment(customerUid, merchantId, amountKrw) {
    if (amountKrw <= 0) throw new HttpsError('invalid-argument', 'Amount must be greater than 0');

    const merchantSnap = await db.collection('merchants').doc(String(merchantId)).get();
    if (!merchantSnap.exists) throw new HttpsError('not-found', 'Merchant not found');

    const merchantData = merchantSnap.data();
    if (merchantData.active === false) throw new HttpsError('failed-precondition', 'Merchant is inactive');

    const merchantOwnerUid = merchantData.ownerUid || (merchantData.ownerAddress ? merchantData.ownerAddress : null);
    if (!merchantOwnerUid) throw new HttpsError('failed-precondition', 'Merchant owner not properly assigned');

    // Default Policy if not set: 3% fee, 50% reward
    const feeRate = merchantData.merchant_fee_rate ?? 0.03;
    const rewardRate = merchantData.customer_reward_rate ?? 0.50;

    const feeAmount = Math.floor(amountKrw * feeRate);
    const netMerchantAmount = amountKrw - feeAmount;
    const customerRewardPoints = Math.floor(feeAmount * rewardRate);

    const orderId = `ORDER_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    // Note: We use runTransaction sequentially since processLedgerTransaction wraps its own transaction.
    // In a high-concurrency production env, these could be batched, but for this pilot, sequential awaits suffice.

    try {
        // 1. Deduct Payment from Customer
        await ledgerH.processLedgerTransaction({
            uid: customerUid,
            type: 'PAY',
            paymentKrwAmount: -amountKrw,
            source: `merchant_${merchantId}`,
            referenceId: orderId
        });
    } catch (err) {
        if (err.message.includes('Insufficient Payment Balance')) {
            throw new HttpsError('failed-precondition', '잔액이 부족합니다. 결제 잔액을 충전해주세요.');
        }
        throw err;
    }

    // 2. Add Net Payment to Merchant Owner
    await ledgerH.processLedgerTransaction({
        uid: merchantOwnerUid,
        type: 'MERCHANT_INCOME',
        paymentKrwAmount: netMerchantAmount,
        source: `customer_${customerUid}`,
        referenceId: orderId
    });

    // 3. Issue Reward Point to Customer
    if (customerRewardPoints > 0) {
        await ledgerH.processLedgerTransaction({
            uid: customerUid,
            type: 'PURCHASE_REWARD',
            pointAmount: customerRewardPoints,
            source: `merchant_${merchantId}`,
            referenceId: orderId
        });
    }

    // Record Order
    await db.collection('orders').doc(orderId).set({
        orderId,
        customerUid,
        merchantId,
        merchantName: merchantData.name || '',
        amountKrw,
        feeAmount,
        netMerchantAmount,
        customerRewardPoints,
        status: 'completed',
        created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    return { success: true, orderId, amountKrw, customerRewardPoints, merchantName: merchantData.name };
}

module.exports = { merchantSendBtDirect,
    adminSetMerchantRewardPolicy,
    processQrPayment
};


// 주문 merchant_id 는 숫자/문자/옛 별칭으로 저장된 경우가 있음
const MERCHANT_ALIASES = { '1791002036': ['daehan_kimchi'], '1791605366': ['bestwinner'] };
function sameMerchant(a, b) {
    const x = String(a), y = String(b);
    if (x === y) return true;
    return (MERCHANT_ALIASES[x] || []).includes(y) || (MERCHANT_ALIASES[y] || []).includes(x);
}

// v2 onCall(request) 와 v1 (data, context) 호출 모두 지원
async function merchantSendBtDirect(reqOrData, ctx) {
    const data = ctx ? (reqOrData || {}) : (reqOrData?.data || {});
    const auth = ctx ? ctx.auth : reqOrData?.auth;
    if (!auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    const merchantUid = auth.uid;
    const orderId = data.orderId ? String(data.orderId) : null;
    let { customerEmail, amountVnd } = data;

    // 주문 기반 전송: 고객 이메일·금액은 주문 원장 값을 사용 (클라이언트 값 무시)
    if (orderId) {
        const oSnap = await db.collection('merchant_orders').doc(orderId).get();
        if (!oSnap.exists) throw new HttpsError('not-found', '주문을 찾을 수 없습니다.');
        const o = oSnap.data() || {};
        customerEmail = o.buyer_email;
        amountVnd = Number(o.total_amount) || 0;
    }
    amountVnd = Number(amountVnd);
    
    if (!customerEmail || !amountVnd || amountVnd < 10000) {
        throw new HttpsError('invalid-argument', '고객 이메일과 결제금액(VND)을 올바르게 입력해주세요.');
    }
    
    // 1. Find the customer
    const userSnap = await db.collection('users').where('email', '==', customerEmail).limit(1).get();
    if (userSnap.empty) {
        throw new HttpsError('not-found', '해당 이메일의 고객을 찾을 수 없습니다.');
    }
    const customer = userSnap.docs[0];
    const customerUid = customer.id;
    
    // 2. Find the merchant
    const merchSnap = await db.collection('users').doc(merchantUid).get();
    const merchantId = merchSnap.data()?.merchantId;
    if (!merchantId) {
        throw new HttpsError('permission-denied', '가맹점이 아닙니다.');
    }
    
    const mDoc = await db.collection('merchants').doc(String(merchantId)).get();
    const mData = mDoc.exists ? mDoc.data() : {};
    const btPerVnd = Math.max(1000, Number(mData.btPerVnd || mData.btGrantThresholdVnd || 100000));
    
    // 3. Process exactly like receiveBtQrFirebase
    const btAmountToGive = Math.floor(amountVnd / btPerVnd);
    if (btAmountToGive < 1) {
        throw new HttpsError('invalid-argument', `결제 금액이 BT 지급 기준(${btPerVnd.toLocaleString()} VND) 미만입니다.`);
    }

    // Wrap in transaction
    return await db.runTransaction(async (tx) => {
        // 주문 기반이면 같은 주문으로 중복 전송 방지 + 본인 가맹점 주문인지 확인 (읽기는 쓰기보다 먼저)
        let orderRef = null;
        if (orderId) {
            orderRef = db.collection('merchant_orders').doc(orderId);
            const oDoc = await tx.get(orderRef);
            const o = oDoc.data() || {};
            if (!sameMerchant(o.merchant_id, merchantId)) throw new HttpsError('permission-denied', '본인 가맹점의 주문만 처리할 수 있습니다.');
            if (o.bt_sent) throw new HttpsError('already-exists', '이미 BT를 보낸 주문입니다.');
            if (o.status === 'cancelled') throw new HttpsError('failed-precondition', '취소된 주문입니다.');
            if (!(o.payment_status === 'paid' || ['payment_confirmed', 'shipped', 'completed'].includes(o.status))) {
                throw new HttpsError('failed-precondition', '입금 확인(주문 승인) 후에 BT를 보낼 수 있습니다.');
            }
        }

        
        const mOwnerRef = db.collection('users').doc(merchantUid);
        const mOwnerDoc = await tx.get(mOwnerRef);
        const mOwnerData = mOwnerDoc.data() || {};
        
        let mRef = db.collection('merchants').doc(String(merchantId));
        let mDoc = await tx.get(mRef);
        if (!mDoc.exists) {
          if (String(merchantId) === "bestwinner") {
            mRef = db.collection('merchants').doc("1791605366");
            mDoc = await tx.get(mRef);
          } else if (String(merchantId) === "1791605366") {
            mRef = db.collection('merchants').doc("bestwinner");
            mDoc = await tx.get(mRef);
          }
        }
        if (!mDoc.exists) throw new HttpsError('not-found', '가맹점 정보를 찾을 수 없습니다.');
        const mData = mDoc.data() || {};

        let mBtBalance = Math.max(Number(mOwnerData.btBalance || 0), Number(mData.btBalance || 0));
        if (mBtBalance < btAmountToGive) {
            throw new HttpsError('failed-precondition', `보유하신 BT 잔고가 부족합니다! (현재잔고: ${mBtBalance} BT)`);
        }
        
        // Deduct from merchant's user and merchant account
        tx.set(mOwnerRef, {
            btBalance: admin.firestore.FieldValue.increment(-btAmountToGive)
        }, { merge: true });
        tx.set(mRef, {
            btBalance: admin.firestore.FieldValue.increment(-btAmountToGive)
        }, { merge: true });
        
        // Add to customer
        const cRef = db.collection('users').doc(customerUid);
        tx.update(cRef, {
            btBalance: admin.firestore.FieldValue.increment(btAmountToGive)
        });
        
        // Record log
        const logRef = db.collection('bt_transactions').doc();
        tx.set(logRef, {
            type: 'remote_send',
            merchantId: Number(merchantId) || String(merchantId),
            merchantUid,
            customerUid,
            customerEmail,
            amountVnd,
            btIssued: btAmountToGive,
            orderId: orderId || null,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        if (orderRef) {
            tx.update(orderRef, {
                bt_sent: true,
                bt_issued: btAmountToGive,
                bt_sent_to: customerEmail,
                bt_tx_id: logRef.id,
                bt_sent_at: admin.firestore.FieldValue.serverTimestamp(),
                updated_at: admin.firestore.FieldValue.serverTimestamp()
            });
        }
        
        return { success: true, btIssued: btAmountToGive, customerEmail };
    });
};
