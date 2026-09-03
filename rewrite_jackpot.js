const fs = require('fs');
let content = fs.readFileSync('functions/handlers/transaction.js', 'utf8');

// Replace payMerchantFirebase exactly
const s2 = content.indexOf('async function payMerchantFirebase');
const e2 = content.indexOf('return result;', s2);
const endBrace = content.indexOf('}', e2) + 1;

const newFn = `async function payMerchantFirebase(uid, merchantId, amountKrw, { currency = 'KRW', amountVnd } = {}) {
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

  const txHash = 'TX_' + Date.now() + '_' + Math.floor(Math.random()*10000);

  const result = await db.runTransaction(async (tx) => {
    const userRef = db.collection('users').doc(uid);
    const merchantRef = db.collection('merchants').doc(String(merchantId));
    const buyerBpRef = db.collection('battle_players').doc(uid);
    const jackpotRef = db.collection('jackpot_config').doc('current');
    
    const [userSnap, merchantSnap, bpSnap, jackpotSnap] = await Promise.all([ 
      tx.get(userRef), tx.get(merchantRef), tx.get(buyerBpRef), tx.get(jackpotRef) 
    ]);
    
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

    // Jackpot Logic
    const gsLevel = typeof bpSnap !== 'undefined' && bpSnap.exists ? Math.max(1, Number(bpSnap.data().gsLevel || 1)) : 1;
    const randomValue = Math.floor(Math.random() * 10000);
    const winThreshold = gsLevel * 100; // 1% per level
    const isWinner = randomValue < winThreshold;
    
    let jackpotReward = 0;
    if (isWinner) {
      jackpotReward = jackpotSnap.exists ? Number(jackpotSnap.data().jackpotAccVnd || 0) : 0;
      tx.set(jackpotRef, { jackpotAccVnd: jackpotBonusKrw, updatedAt: admin.firestore.FieldValue.serverTimestamp() }); // reset to just the current tx bonus
      
      tx.set(db.collection('jackpot_wins').doc(txHash), {
        uid,
        userName: userData.name || userData.kakaoId || 'User',
        amountVnd: jackpotReward,
        amountKrw: jackpotReward,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        txHash
      });
    } else {
      if (jackpotBonusKrw > 0) {
        tx.set(jackpotRef, { jackpotAccVnd: admin.firestore.FieldValue.increment(jackpotBonusKrw), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      }
    }

    // Write Jackpot Round state for UI
    tx.set(db.collection('jackpot_rounds').doc(txHash), {
      isWinner,
      randomValue,
      finalWinWei: String(jackpotReward) + "000000000000000000",
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    tx.update(userRef, { pointBalanceVnd: userBalanceKrw - finalKrw + jackpotReward });
    
    const txBase = { createdAt: admin.firestore.FieldValue.serverTimestamp(), currency: 'KRW', amountKrw: finalKrw, amountVnd: finalVnd, merchantId: Number(merchantId), merchantName: merchant.name || '', txHash };
    tx.set(db.collection('transactions').doc(), { ...txBase, uid, type: 'pay_merchant' });

    const currentMerchantBal = ownerSnap.exists ? Number(ownerSnap.data().pointBalanceVnd || 0) : 0;
    tx.set(merchantOwnerRef, { pointBalanceVnd: currentMerchantBal + netKrw }, { merge: true });
    tx.set(db.collection('transactions').doc(), { ...txBase, uid: merchantOwnerUid, buyerUid: uid, type: 'merchant_income', netAmountVnd: netKrw, feeAmountVnd: feeKrw, feeBps });

    if (platformBonusKrw > 0) {
      tx.set(db.collection('platform_config').doc('revenue'), { totalRevenueVnd: admin.firestore.FieldValue.increment(platformBonusKrw), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    
    return { txHash, isJackpot: isWinner, amountHex: finalKrw, amountKrw: finalKrw, amountVnd: finalVnd, merchantName: merchant.name || '' };
  });
  return result;
}`;

content = content.substring(0, s2) + newFn + content.substring(endBrace);
fs.writeFileSync('functions/handlers/transaction.js', content, 'utf8');
console.log('Math + Jackpot logic injected correctly');
