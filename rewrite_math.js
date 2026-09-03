const fs = require('fs');
let text = fs.readFileSync('functions/handlers/transaction.js', 'utf8');
const startMatch = 'async function payMerchantFirebase(uid, merchantId, amountKrw, { currency';
const endMatch = 'return result;\n}';

const idxStart = text.indexOf(startMatch);
const idxEnd = text.indexOf(endMatch, idxStart);
if (idxStart === -1 || idxEnd === -1) {
    console.log('Error: Function bounds not found.', idxStart, idxEnd);
    process.exit(1);
}

const beforeBlock = text.substring(0, idxStart);
const afterBlock = text.substring(idxEnd + endMatch.length);

const rawReplacement = `async function payMerchantFirebase(uid, merchantId, amountKrw, { currency = 'KRW', amountVnd } = {}) {
  const db = admin.firestore();
  const { fetchExchangeRates } = require('../wallet/exchange');
  const rates = await fetchExchangeRates();

  let finalKrw = 0;
  let finalVnd = 0;
  
  if (currency === 'VND' && amountVnd) {
    finalVnd = Number(amountVnd);
    finalKrw = Math.round((finalVnd / rates.vndPerUsd) * rates.krwPerUsd);
  } else {
    finalKrw = Number(amountKrw);
    finalVnd = Math.round((finalKrw / rates.krwPerUsd) * rates.vndPerUsd);
  }

  if (finalKrw < 10) throw new Error('결제 금액이 너무 작습니다: ' + finalKrw + '원');

  const result = await db.runTransaction(async (tx) => {
    const userRef = db.collection('users').doc(uid);
    const merchantRef = db.collection('merchants').doc(String(merchantId));
    const buyerBpRef = db.collection('battle_players').doc(uid);

    const [userSnap, merchantSnap, bpSnap] = await Promise.all([
      tx.get(userRef), tx.get(merchantRef), tx.get(buyerBpRef)
    ]);

    if (!userSnap.exists) throw new Error('유저 정보를 찾을 수 없습니다.');
    const userData = userSnap.data();

    // 1 KM = 1 KRW. Database field 'pointBalanceVnd' actually stores KM.
    const userBalanceKrw = Number(userData.pointBalanceVnd || 0);
    if (userBalanceKrw < finalKrw) {
      throw new Error(\`잔액이 부족합니다. (내 지갑: \${userBalanceKrw.toLocaleString()} KM, 결제요청: \${finalKrw.toLocaleString()} KM)\`);
    }

    if (!merchantSnap.exists) throw new Error(\`가맹점 ID \${merchantId}를 찾을 수 없습니다.\`);
    const merchant = merchantSnap.data();
    if (merchant.active === false) throw new Error('비활성 가맹점입니다.');

    let merchantOwnerUid = merchant.ownerUid;
    if (!merchantOwnerUid) throw new Error('가맹점 소유자의 UID 정보가 없습니다.');
    
    const merchantOwnerRef = db.collection('users').doc(merchantOwnerUid);
    const [ownerSnap] = await Promise.all([tx.get(merchantOwnerRef)]);

    const mentorUid = userData.mentorUid || null;
    let grandMentorUid = null;
    let mentorRef = null, grandMentorRef = null;
    let mentorSnap = null, grandMentorSnap = null;

    if (mentorUid) {
      mentorRef = db.collection('users').doc(mentorUid);
      mentorSnap = await tx.get(mentorRef);
      if (mentorSnap.exists) {
        grandMentorUid = mentorSnap.data().mentorUid || null;
        if (grandMentorUid) {
          grandMentorRef = db.collection('users').doc(grandMentorUid);
          grandMentorSnap = await tx.get(grandMentorRef);
        }
      }
    }

    const feeBps = Number(merchant.feeBps || 0);
    const feeKrw = Math.round((finalKrw * feeBps) / 10000);
    const netKrw = finalKrw - feeKrw;

    let currentExp = typeof bpSnap !== 'undefined' && bpSnap.exists ? Number(bpSnap.data().gsExp || 0) : 0;
    let currentLevel = typeof bpSnap !== 'undefined' && bpSnap.exists ? Math.max(1, Number(bpSnap.data().gsLevel || 1)) : 1;
    currentExp += feeKrw;
    let requiredExp = Math.pow(currentLevel, 2) * 10000;
    while (currentExp >= requiredExp) { currentLevel++; requiredExp = Math.pow(currentLevel, 2) * 10000; }
    tx.set(buyerBpRef, { gsExp: currentExp, gsLevel: currentLevel, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    let mentorBonusKrw = 0;
    let grandMentorBonusKrw = 0;
    let jackpotBonusKrw = Math.round(feeKrw * 0.30);
    let platformBonusKrw = Math.round(feeKrw * 0.40);
    let remainingKrw = feeKrw - jackpotBonusKrw - platformBonusKrw;

    if (mentorSnap && mentorSnap.exists) {
      mentorBonusKrw = Math.round(feeKrw * 0.20);
      remainingKrw -= mentorBonusKrw;
    } else {
      platformBonusKrw += Math.round(feeKrw * 0.20);
      remainingKrw -= Math.round(feeKrw * 0.20);
    }

    if (grandMentorSnap && grandMentorSnap.exists) {
      grandMentorBonusKrw = Math.round(feeKrw * 0.10);
      remainingKrw -= grandMentorBonusKrw;
    } else {
      platformBonusKrw += Math.round(feeKrw * 0.10);
      remainingKrw -= Math.round(feeKrw * 0.10);
    }
    if (remainingKrw !== 0) platformBonusKrw += remainingKrw;

    // Deduct finalKrw from pointBalanceVnd (which stores KM inherently)
    tx.update(userRef, { pointBalanceVnd: userBalanceKrw - finalKrw });

    const txBase = {
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      currency: 'KRW', amountKrw: finalKrw, amountVnd: finalVnd,
      merchantId: Number(merchantId), merchantName: merchant.name || ''
    };

    const userTxRef = db.collection('transactions').doc();
    tx.set(userTxRef, { ...txBase, uid, type: 'pay_merchant' });

    // Merchant receives netKrw in KM natively
    const currentMerchantBal = ownerSnap.exists ? Number(ownerSnap.data().pointBalanceVnd || 0) : 0;
    tx.set(merchantOwnerRef, { pointBalanceVnd: currentMerchantBal + netKrw }, { merge: true });
    
    const merchantTxRef = db.collection('transactions').doc();
    tx.set(merchantTxRef, { ...txBase, uid: merchantOwnerUid, buyerUid: uid, type: 'merchant_income', netAmountVnd: netKrw, feeAmountVnd: feeKrw, feeBps });

    // Mentors receive mentorBonusKrw natively in KM
    if (mentorBonusKrw > 0 && mentorSnap && mentorSnap.exists) {
      tx.update(mentorRef, { pointBalanceVnd: admin.firestore.FieldValue.increment(mentorBonusKrw) });
      tx.set(db.collection('transactions').doc(), { uid: mentorUid, sourceUid: uid, merchantId: Number(merchantId), type: 'mentor_bonus_tier1', amountVnd: mentorBonusKrw, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    if (grandMentorBonusKrw > 0 && grandMentorSnap && grandMentorSnap.exists) {
      tx.update(grandMentorRef, { pointBalanceVnd: admin.firestore.FieldValue.increment(grandMentorBonusKrw) });
      tx.set(db.collection('transactions').doc(), { uid: grandMentorUid, sourceUid: uid, merchantId: Number(merchantId), type: 'mentor_bonus_tier2', amountVnd: grandMentorBonusKrw, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    if (jackpotBonusKrw > 0) {
      const jackpotRef = db.collection('jackpot_config').doc('current');
      tx.set(jackpotRef, { jackpotAccVnd: admin.firestore.FieldValue.increment(jackpotBonusKrw), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    if (platformBonusKrw > 0) {
      const platformRef = db.collection('platform_config').doc('revenue');
      tx.set(platformRef, { totalRevenueVnd: admin.firestore.FieldValue.increment(platformBonusKrw), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }

    return { txHash: 'FIREBASE_NATIVE', amountHex: finalKrw, amountKrw: finalKrw, amountVnd: finalVnd, merchantName: merchant.name || '' };
  });

  return result;
}
`;

fs.writeFileSync('functions/handlers/transaction.js', beforeBlock + rawReplacement + afterBlock, 'utf8');
