const fs = require('fs');
let lines = fs.readFileSync('functions/handlers/transaction.js', 'utf8').split('\n');

const s1 = lines.findIndex(l => l.includes('async function adminSetMerchantFeeOnChain'));
const e1 = lines.findIndex((l, i) => i > s1 && l.includes('return { txHash'));
lines.splice(s1, e1 - s1 + 2, `async function adminSetMerchantFeeOnChain(merchantId, feeBps) {
  const db = admin.firestore();
  await db.collection('merchants').doc(String(merchantId)).set({
    feeBps: Number(feeBps),
    approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    active: true
  }, { merge: true });
  return { txHash: 'FIREBASE_NATIVE', merchantId, feeBps };
}`);

// Refresh lines after splice
const s2 = lines.findIndex(l => l.includes('async function payMerchantFirebase'));
const e2 = lines.findIndex((l, i) => i > s2 && l.includes('return result;'));
lines.splice(s2, e2 - s2 + 2, `async function payMerchantFirebase(uid, merchantId, amountKrw, { currency = 'KRW', amountVnd } = {}) {
  const db = admin.firestore();
  const { fetchExchangeRates } = require('../wallet/exchange');
  const rates = await fetchExchangeRates();
  let finalKrw = 0; let finalVnd = 0;
  if (currency === 'VND' && amountVnd) {
    finalVnd = Number(amountVnd);
    finalKrw = Math.round((finalVnd / rates.vndPerUsd) * rates.krwPerUsd);
  } else {
    finalKrw = Number(amountKrw);
    finalVnd = Math.round((finalKrw / rates.krwPerUsd) * rates.vndPerUsd);
  }
  if (finalKrw < 10) throw new Error('결제 금액오류');
  const result = await db.runTransaction(async (tx) => {
    const userRef = db.collection('users').doc(uid);
    const merchantRef = db.collection('merchants').doc(String(merchantId));
    const buyerBpRef = db.collection('battle_players').doc(uid);
    const [userSnap, merchantSnap, bpSnap] = await Promise.all([ tx.get(userRef), tx.get(merchantRef), tx.get(buyerBpRef) ]);
    if (!userSnap.exists) throw new Error('유저 정보 없음');
    const userData = userSnap.data();
    const userBalanceKrw = Number(userData.pointBalanceVnd || 0); 
    if (userBalanceKrw < finalKrw) throw new Error('잔액이 부족합니다.');
    const merchant = merchantSnap.data();
    if (!merchant || merchant.active === false) throw new Error('비활성 가맹점입니다.');
    let merchantOwnerUid = merchant.ownerUid;
    const merchantOwnerRef = db.collection('users').doc(merchantOwnerUid);
    const [ownerSnap] = await Promise.all([tx.get(merchantOwnerRef)]);
    
    // Fee Calculation
    const feeBps = Number(merchant.feeBps || 0);
    const feeKrw = Math.round((finalKrw * feeBps) / 10000);
    const netKrw = finalKrw - feeKrw;

    let mentorBonusKrw = Math.round(feeKrw * 0.20);
    let grandMentorBonusKrw = Math.round(feeKrw * 0.10);
    let jackpotBonusKrw = Math.round(feeKrw * 0.30);
    let platformBonusKrw = feeKrw - jackpotBonusKrw - mentorBonusKrw - grandMentorBonusKrw;

    tx.update(userRef, { pointBalanceVnd: userBalanceKrw - finalKrw });
    
    const txBase = { createdAt: admin.firestore.FieldValue.serverTimestamp(), currency: 'KRW', amountKrw: finalKrw, amountVnd: finalVnd, merchantId: Number(merchantId), merchantName: merchant.name || '' };
    tx.set(db.collection('transactions').doc(), { ...txBase, uid, type: 'pay_merchant' });

    const currentMerchantBal = ownerSnap.exists ? Number(ownerSnap.data().pointBalanceVnd || 0) : 0;
    tx.set(merchantOwnerRef, { pointBalanceVnd: currentMerchantBal + netKrw }, { merge: true });
    tx.set(db.collection('transactions').doc(), { ...txBase, uid: merchantOwnerUid, buyerUid: uid, type: 'merchant_income', netAmountVnd: netKrw, feeAmountVnd: feeKrw, feeBps });

    if (jackpotBonusKrw > 0) {
      tx.set(db.collection('jackpot_config').doc('current'), { jackpotAccVnd: admin.firestore.FieldValue.increment(jackpotBonusKrw), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    if (platformBonusKrw > 0) {
      tx.set(db.collection('platform_config').doc('revenue'), { totalRevenueVnd: admin.firestore.FieldValue.increment(platformBonusKrw), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    return { txHash: 'FIREBASE_NATIVE', amountHex: finalKrw, amountKrw: finalKrw, amountVnd: finalVnd, merchantName: merchant.name || '' };
  });
  return result;
}`);

fs.writeFileSync('functions/handlers/transaction.js', lines.join('\n'), 'utf8');
console.log('Restored correctly');
