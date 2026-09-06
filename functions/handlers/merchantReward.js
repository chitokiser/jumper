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

module.exports = {
    adminSetMerchantRewardPolicy,
    processQrPayment
};


exports.merchantSendBtDirect = async function(data, context) {
    if (!context.auth) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    const merchantUid = context.auth.uid;
    const { customerEmail, amountVnd } = data;
    
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
    
    // 3. Process exactly like receiveBtQrFirebase
    const btAmountToGive = Math.floor(amountVnd / 10000);
    if (btAmountToGive < 1) {
        throw new HttpsError('invalid-argument', '10,000 VND 미만은 BT를 지급할 수 없습니다.');
    }

    // Wrap in transaction
    return await db.runTransaction(async (tx) => {
        const mRef = db.collection('merchants').doc(String(merchantId));
        const mDoc = await tx.get(mRef);
        if (!mDoc.exists) throw new HttpsError('not-found', '가맹점 정보를 찾을 수 없습니다.');
        const mData = mDoc.data();
        
        let mBtBalance = mData.btBalance || 0;
        if (mBtBalance < btAmountToGive) {
            throw new HttpsError('failed-precondition', `가맹점의 BT 잔고가 부족합니다! (현재잔고: ${mBtBalance} BT)`);
        }
        
        // Deduct from merchant
        tx.update(mRef, {
            btBalance: admin.firestore.FieldValue.increment(-btAmountToGive)
        });
        
        // Add to customer
        const cRef = db.collection('users').doc(customerUid);
        tx.update(cRef, {
            btBalance: admin.firestore.FieldValue.increment(btAmountToGive)
        });
        
        // Record log
        const logRef = db.collection('bt_transactions').doc();
        tx.set(logRef, {
            type: 'remote_send',
            merchantId: Number(merchantId),
            merchantUid,
            customerUid,
            customerEmail,
            amountVnd,
            btIssued: btAmountToGive,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        return { success: true, btIssued: btAmountToGive, customerEmail };
    });
};
