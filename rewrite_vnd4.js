const fs = require('fs');

let content = fs.readFileSync('functions/handlers/transaction.js', 'utf8');

const s2 = content.indexOf('async function payMerchantFirebase');
const e2 = content.indexOf('// 관리자: 컨트랙트에 Point 충전');

// Backup back to the prior comment header correctly
const e2_start = content.lastIndexOf('// ──', e2);

const before = content.substring(0, s2);
const after = content.substring(e2_start);

const newFn = `async function payMerchantFirebase(uid, merchantId, amountVnd, { currency = 'VND', amountKrw, reqId } = {}) {
  const db = admin.firestore();
  
  if (!amountVnd || Number(amountVnd) < 10000) throw new Error('최소 결제 금액은 10000 KM (VND)입니다.');
  
  const finalVnd = Math.round(Number(amountVnd));
  const finalKrw = Math.round(Number(amountKrw || (finalVnd / 18)));

  const txHash = reqId ? 'TX_' + reqId : 'TX_' + Date.now() + '_' + Math.floor(Math.random()*10000);
  
  return await db.runTransaction(async (tx) => {
    const checkTxRef = db.collection('transactions').doc(txHash);
    const existingTx = await tx.get(checkTxRef);
    if (existingTx.exists) throw new Error('이미 처리된 결제 요청입니다. (Double payment prevented)');

    const userRef = db.collection('users').doc(uid);
    const merchantRef = db.collection('merchants').doc(String(merchantId));
    const buyerBpRef = db.collection('battle_players').doc(uid);
    const jackpotRef = db.collection('jackpot_config').doc('current');
    
    const [userSnap, merchantSnap, bpSnap, jackpotSnap] = await Promise.all([ 
      tx.get(userRef), tx.get(merchantRef), tx.get(buyerBpRef), tx.get(jackpotRef) 
    ]);
    
    if (!userSnap.exists) throw new Error('유저 정보 없음');
    const userData = userSnap.data();
    const userBalanceVnd = Number(userData.pointBalanceVnd || 0); 
    if (userBalanceVnd < finalVnd) throw new Error('잔액이 부족합니다.');
    
    const merchant = merchantSnap.data();
    if (!merchant || merchant.active === false) throw new Error('비활성 가맹점입니다.');
    let merchantOwnerUid = merchant.ownerUid;
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
    const feeVnd = Math.round((finalVnd * feeBps) / 10000);
    const netVnd = finalVnd - feeVnd;

    let mentorBonusVnd = 0;
    let grandMentorBonusVnd = 0;
    let jackpotBonusVnd = Math.round(feeVnd * 0.30);
    let platformBonusVnd = Math.round(feeVnd * 0.40);

    let remainingVnd = feeVnd - jackpotBonusVnd - platformBonusVnd;

    if (mentorSnap && mentorSnap.exists) {
      mentorBonusVnd = Math.round(feeVnd * 0.20);
      remainingVnd -= mentorBonusVnd;
    } else {
      platformBonusVnd += Math.round(feeVnd * 0.20);
      remainingVnd -= Math.round(feeVnd * 0.20);
    }
    if (grandMentorSnap && grandMentorSnap.exists) {
      grandMentorBonusVnd = Math.round(feeVnd * 0.10);
      remainingVnd -= grandMentorBonusVnd;
    } else {
      platformBonusVnd += Math.round(feeVnd * 0.10);
      remainingVnd -= Math.round(feeVnd * 0.10);
    }
    if (remainingVnd !== 0) platformBonusVnd += remainingVnd;

    const gsLevel = typeof bpSnap !== 'undefined' && bpSnap.exists ? Math.max(1, Number(bpSnap.data().gsLevel || 1)) : 1;
    const randomValue = Math.floor(Math.random() * 10000);
    const winThreshold = gsLevel * 100;
    const isWinner = randomValue < winThreshold;
    
    let jackpotRewardVnd = 0;
    if (isWinner) {
      jackpotRewardVnd = jackpotSnap.exists ? Number(jackpotSnap.data().jackpotAccVnd || 0) : 0;
      tx.set(jackpotRef, { jackpotAccVnd: jackpotBonusVnd, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      tx.set(db.collection('jackpot_wins').doc(txHash), { uid, userName: userData.name || userData.kakaoId || 'User', amountVnd: jackpotRewardVnd, amountKrw: jackpotRewardVnd, timestamp: admin.firestore.FieldValue.serverTimestamp(), txHash });
    } else {
      if (jackpotBonusVnd > 0) {
        tx.set(jackpotRef, { jackpotAccVnd: admin.firestore.FieldValue.increment(jackpotBonusVnd), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      }
    }

    tx.set(db.collection('jackpot_rounds').doc(txHash), { isWinner, randomValue, finalWinWei: jackpotRewardVnd > 0 ? "1000000000000000000" : "0", timestamp: admin.firestore.FieldValue.serverTimestamp() });
    tx.update(userRef, { pointBalanceVnd: userBalanceVnd - finalVnd + jackpotRewardVnd });
    
    const txBase = { createdAt: admin.firestore.FieldValue.serverTimestamp(), currency: 'VND', amountKrw: finalKrw, amountVnd: finalVnd, merchantId: Number(merchantId), merchantName: merchant.name || '', txHash };
    tx.set(checkTxRef, { ...txBase, uid, type: 'pay_merchant' });
    
    const currentMerchantBal = ownerSnap.exists ? Number(ownerSnap.data().pointBalanceVnd || 0) : 0;
    tx.set(merchantOwnerRef, { pointBalanceVnd: currentMerchantBal + netVnd }, { merge: true });
    tx.set(db.collection('transactions').doc(), { ...txBase, uid: merchantOwnerUid, buyerUid: uid, type: 'merchant_income', netAmountVnd: netVnd, feeAmountVnd: feeVnd, feeBps });

    if (mentorBonusVnd > 0 && mentorSnap && mentorSnap.exists) {
      tx.update(mentorRef, { pointBalanceVnd: admin.firestore.FieldValue.increment(mentorBonusVnd) });
      tx.set(db.collection('transactions').doc(), { ...txBase, uid: mentorUid, sourceUid: uid, type: 'mentor_bonus_tier1', amountVnd: mentorBonusVnd, amountKrw: mentorBonusVnd });
    }
    if (grandMentorBonusVnd > 0 && grandMentorSnap && grandMentorSnap.exists) {
      tx.update(grandMentorRef, { pointBalanceVnd: admin.firestore.FieldValue.increment(grandMentorBonusVnd) });
      tx.set(db.collection('transactions').doc(), { ...txBase, uid: grandMentorUid, sourceUid: uid, type: 'mentor_bonus_tier2', amountVnd: grandMentorBonusVnd, amountKrw: grandMentorBonusVnd });
    }
    if (platformBonusVnd > 0) {
      tx.set(db.collection('platform_config').doc('revenue'), { totalRevenueVnd: admin.firestore.FieldValue.increment(platformBonusVnd), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    
    return { txHash, isJackpot: isWinner, amountHex: finalVnd, amountKrw: finalKrw, amountVnd: finalVnd, merchantName: merchant.name || '' };
  });
}

`;

const res = before + newFn + after;
fs.writeFileSync('functions/handlers/transaction.js', res, 'utf8');
console.log('Fixed syntax correctly, e2 =', e2, 'e2_start =', e2_start);
