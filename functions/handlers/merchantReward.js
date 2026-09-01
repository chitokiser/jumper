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
