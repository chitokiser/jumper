// functions/handlers/ledger.js
'use strict';

const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * Creates a generic ledger entry and updates the user's balances atomically.
 * @param {string} uid User ID
 * @param {string} type Transaction Type (e.g., PURCHASE_REWARD, CHARGE, PAY)
 * @param {number} pointAmount Amount of K-CULTURE Points to add (can be negative)
 * @param {number} paymentKrwAmount Amount of Payment Balance (KRW) to add (can be negative)
 * @param {number} paymentVndAmount Amount of Payment Balance (VND) to add (can be negative)
 * @param {string} source Source of the transaction
 * @param {string} referenceId Reference ID (e.g. orderId)
 * @returns {Promise<Object>} The new balances
 */
async function processLedgerTransaction({
  uid,
  type,
  pointAmount = 0,
  paymentKrwAmount = 0,
  paymentVndAmount = 0,
  source = 'system',
  referenceId = null
}) {
  const balanceRef = db.collection('k_culture_balances').doc(uid);
  const pointLedgerRef = db.collection('point_ledger').doc();
  const paymentLedgerRef = db.collection('payment_ledger').doc();

  return await db.runTransaction(async (transaction) => {
    const balanceSnap = await transaction.get(balanceRef);
    let currentPoint = 0;
    let currentKrw = 0;
    let currentVnd = 0;

    if (balanceSnap.exists) {
      const data = balanceSnap.data();
      currentPoint = data.point_balance || 0;
      currentKrw = data.payment_balance_krw || 0;
      currentVnd = data.payment_balance_vnd || 0;
    }

    const newPoint = currentPoint + pointAmount;
    const newKrw = currentKrw + paymentKrwAmount;
    const newVnd = currentVnd + paymentVndAmount;

    // Validate balances do not drop below zero unless strictly allowed
    if (newPoint < 0) throw new Error('Insufficient K-CULTURE Point balance');
    if (newKrw < 0 || newVnd < 0) throw new Error('Insufficient Payment Balance');

    // Update or create balances
    transaction.set(balanceRef, {
      user_id: uid,
      point_balance: newPoint,
      payment_balance_krw: newKrw,
      payment_balance_vnd: newVnd,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    const serverTime = admin.firestore.FieldValue.serverTimestamp();

    // Log to Point Ledger if there's a point change
    if (pointAmount !== 0) {
      transaction.set(pointLedgerRef, {
        id: pointLedgerRef.id,
        user_id: uid,
        transaction_id: pointLedgerRef.id,
        type: type,
        amount: pointAmount,
        balance_after: newPoint,
        source: source,
        reference_id: referenceId,
        created_at: serverTime
      });
    }

    // Log to Payment Ledger if there's a fiat change
    if (paymentKrwAmount !== 0 || paymentVndAmount !== 0) {
      transaction.set(paymentLedgerRef, {
        id: paymentLedgerRef.id,
        user_id: uid,
        transaction_id: paymentLedgerRef.id,
        type: type,
        amount_krw: paymentKrwAmount,
        amount_vnd: paymentVndAmount,
        balance_after_krw: newKrw,
        balance_after_vnd: newVnd,
        source: source,
        reference_id: referenceId,
        created_at: serverTime
      });
    }

    return {
      point_balance: newPoint,
      payment_balance_krw: newKrw,
      payment_balance_vnd: newVnd
    };
  });
}

/**
 * Points Transfer (P2P)
 */
async function transferPoints(senderUid, receiverUid, amount) {
  if (amount <= 0) throw new Error('Amount must be strictly positive.');

  return await db.runTransaction(async (transaction) => {
    // 1. Get Sender Balances
    const senderRef = db.collection('k_culture_balances').doc(senderUid);
    const senderSnap = await transaction.get(senderRef);
    let senderPoints = 0;
    if (senderSnap.exists) senderPoints = senderSnap.data().point_balance || 0;

    if (senderPoints < amount) {
      throw new Error(`Insufficient Points. Available: ${senderPoints}, Required: ${amount}`);
    }

    // 2. Get Receiver Balances
    const receiverRef = db.collection('k_culture_balances').doc(receiverUid);
    const receiverSnap = await transaction.get(receiverRef);
    let receiverPoints = 0;
    if (receiverSnap.exists) receiverPoints = receiverSnap.data().point_balance || 0;

    const newSenderPoints = senderPoints - amount;
    const newReceiverPoints = receiverPoints + amount;

    // 3. Update Balances
    transaction.set(senderRef, { point_balance: newSenderPoints, updated_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    transaction.set(receiverRef, { point_balance: newReceiverPoints, updated_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    const serverTime = admin.firestore.FieldValue.serverTimestamp();
    const txId = `TX_${Date.now()}_${Math.floor(Math.random()*1000)}`;

    // 4. Record Ledgers
    const senderLedgerRef = db.collection('point_ledger').doc();
    transaction.set(senderLedgerRef, {
      id: senderLedgerRef.id,
      user_id: senderUid,
      transaction_id: txId,
      type: 'TRANSFER_SEND',
      amount: -amount,
      balance_after: newSenderPoints,
      source: receiverUid,
      reference_id: txId,
      created_at: serverTime
    });

    const receiverLedgerRef = db.collection('point_ledger').doc();
    transaction.set(receiverLedgerRef, {
      id: receiverLedgerRef.id,
      user_id: receiverUid,
      transaction_id: txId,
      type: 'TRANSFER_RECEIVE',
      amount: amount,
      balance_after: newReceiverPoints,
      source: senderUid,
      reference_id: txId,
      created_at: serverTime
    });

    return { success: true, txId, newSenderPoints };
  });
}

module.exports = {
  processLedgerTransaction,
  transferPoints
};
