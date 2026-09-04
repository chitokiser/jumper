const fs = require('fs');

let js = fs.readFileSync('functions/handlers/transaction.js', 'utf8');

const s = `const gsLevel = typeof bpSnap !== 'undefined' && bpSnap.exists ? Math.max(1, Number(bpSnap.data().gsLevel || 1)) : 1;
    const randomValue = Math.floor(Math.random() * 10000);
    const winThreshold = gsLevel * 100;
    const isWinner = randomValue < winThreshold;

    let jackpotRewardVnd = 0;
    if (isWinner) {
      jackpotRewardVnd = jackpotSnap.exists ? Number(jackpotSnap.data().jackpotAccVnd || 0) : 0;
      // When jackpot is won, reset it with current transaction's bonus, but use set to not increment the past total
      tx.set(jackpotRef, { jackpotAccVnd: jackpotBonusVnd, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      tx.set(db.collection('jackpot_wins').doc(txHash), { uid, userName: userData.name || userData.kakaoId || 'User', amountVnd: jackpotRewardVnd, amountKrw: jackpotRewardVnd, timestamp: admin.firestore.FieldValue.serverTimestamp(), txHash });
    } else {
      if (jackpotBonusVnd > 0) {
        tx.set(jackpotRef, { jackpotAccVnd: admin.firestore.FieldValue.increment(jackpotBonusVnd), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      }
    }

    tx.set(db.collection('jackpot_rounds').doc(txHash), { isWinner, randomValue, finalWinWei: jackpotRewardVnd > 0 ? "1000000000000000000" : "0", timestamp: admin.firestore.FieldValue.serverTimestamp() });`;

const r = `const gsLevel = typeof bpSnap !== 'undefined' && bpSnap.exists ? Math.max(1, Number(bpSnap.data().gsLevel || 1)) : 1;
    
    // User requested jackpot algorithm
    const r_grade = Math.random() * 100;
    let grade = 0;
    if (r_grade < 0.1) grade = Math.floor(Math.random() * (20 - 10 + 1)) + 10;
    else if (r_grade < 0.6) grade = Math.floor(Math.random() * (50 - 21 + 1)) + 21;
    else if (r_grade < 2.6) grade = Math.floor(Math.random() * (100 - 51 + 1)) + 51;
    else if (r_grade < 12.6) grade = Math.floor(Math.random() * (300 - 101 + 1)) + 101;
    else if (r_grade < 37.6) grade = Math.floor(Math.random() * (500 - 301 + 1)) + 301;
    else if (r_grade < 72.6) grade = Math.floor(Math.random() * (800 - 501 + 1)) + 501;
    else grade = Math.floor(Math.random() * (1000 - 801 + 1)) + 801;

    const currentJackpotPool = jackpotSnap.exists ? Number(jackpotSnap.data().jackpotAccVnd || 0) : 0;
    // Formula: [(수수료금액+잭팟자금풀) / 그레이드] + [수수료 금액 /그레이드]
    let jackpotRewardVnd = Math.floor((feeVnd + currentJackpotPool) / grade) + Math.floor(feeVnd / grade);
    
    // We treat every payment as a "win" of some degree now
    const isWinner = true; 
    
    let newJackpotPool = currentJackpotPool + jackpotBonusVnd - jackpotRewardVnd;
    if (newJackpotPool < 0) {
        jackpotRewardVnd += newJackpotPool; // Cap reward
        newJackpotPool = 0;
    }

    tx.set(jackpotRef, { jackpotAccVnd: newJackpotPool, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    tx.set(db.collection('jackpot_wins').doc(txHash), { uid, userName: userData.name || userData.kakaoId || 'User', amountVnd: jackpotRewardVnd, amountKrw: jackpotRewardVnd, grade, timestamp: admin.firestore.FieldValue.serverTimestamp(), txHash });
    tx.set(db.collection('jackpot_rounds').doc(txHash), { isWinner, grade, finalWinWei: jackpotRewardVnd > 0 ? "1000000000000000000" : "0", timestamp: admin.firestore.FieldValue.serverTimestamp() });`;

if (js.includes(s)) {
    js = js.replace(s, r);
    fs.writeFileSync('functions/handlers/transaction.js', js, 'utf8');
    console.log("Algorithm rewritten");
} else {
    console.log("Could not find algo");
}
