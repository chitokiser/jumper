const fs = require('fs');

let js = fs.readFileSync('functions/handlers/transaction.js', 'utf8');

const s = `const gsLevel = typeof bpSnap !== 'undefined' && bpSnap.exists ? Math.max(1, Number(bpSnap.data().gsLevel || 1)) : 1;
      const randomValue = Math.floor(Math.random() * 10000);
      const winThreshold = gsLevel * 100;
      const isWinner = randomValue < winThreshold;

      let jackpotRewardVnd = 0;
      if (isWinner) {
        jackpotRewardVnd = jackpotSnap.exists ? Number(jackpotSnap.data().jackpotAccVnd || 0) : 0;
        tx.set(jackpotRef, { jackpotAccVnd: 0, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        tx.set(db.collection('jackpot_wins').doc(txHash), { uid, userName: req.auth.token.name || '유저', amount: jackpotRewardVnd, timestamp: admin.firestore.FieldValue.serverTimestamp() });
      } else {
        if (jackpotBonusVnd > 0) {
          tx.set(jackpotRef, { jackpotAccVnd: admin.firestore.FieldValue.increment(jackpotBonusVnd), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          tx.set(db.collection('transactions').doc(), { ...txBase, uid: 'SYSTEM_JACKPOT', sourceUid: uid, type: 'jackpot_accumulation', amountVnd: jackpotBonusVnd, amountKrw: Math.round(jackpotBonusVnd / 18) });
        }
      }`;

const r = `const isWinner = true; // Every payment is a "win" since they draw from a grade
      
      const r_grade = Math.random() * 100;
      let grade = 0;
      if (r_grade < 0.1) {
          grade = Math.floor(Math.random() * (20 - 10 + 1)) + 10;
      } else if (r_grade < 0.6) {
          grade = Math.floor(Math.random() * (50 - 21 + 1)) + 21;
      } else if (r_grade < 2.6) {
          grade = Math.floor(Math.random() * (100 - 51 + 1)) + 51;
      } else if (r_grade < 12.6) {
          grade = Math.floor(Math.random() * (300 - 101 + 1)) + 101;
      } else if (r_grade < 37.6) {
          grade = Math.floor(Math.random() * (500 - 301 + 1)) + 301;
      } else if (r_grade < 72.6) {
          grade = Math.floor(Math.random() * (800 - 501 + 1)) + 501;
      } else {
          grade = Math.floor(Math.random() * (1000 - 801 + 1)) + 801;
      }

      // Formula: [(수수료금액+잭팟자금풀) / 그레이드] + [수수료 금액 /그레이드]
      const currentJackpotPool = jackpotSnap.exists ? Number(jackpotSnap.data().jackpotAccVnd || 0) : 0;
      let jackpotRewardVnd = Math.floor((feeVnd + currentJackpotPool) / grade) + Math.floor(feeVnd / grade);
      
      // Update the jackpot pool: we add the 30% fee as usual, but subtract the reward we just gave out
      let newJackpotPool = currentJackpotPool + jackpotBonusVnd - jackpotRewardVnd;
      if (newJackpotPool < 0) {
          jackpotRewardVnd += newJackpotPool; // adjust reward so pool doesn't go negative
          newJackpotPool = 0;
      }

      tx.set(jackpotRef, { jackpotAccVnd: newJackpotPool, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      if (jackpotBonusVnd > 0) {
          tx.set(db.collection('transactions').doc(), { ...txBase, uid: 'SYSTEM_JACKPOT', sourceUid: uid, type: 'jackpot_accumulation', amountVnd: jackpotBonusVnd, amountKrw: Math.round(jackpotBonusVnd / 18) });
      }
      tx.set(db.collection('jackpot_wins').doc(txHash), { uid, userName: req.auth.token.name || '유저', amount: jackpotRewardVnd, grade, timestamp: admin.firestore.FieldValue.serverTimestamp() });
`;

if (js.includes(s)) {
    js = js.replace(s, r);
    fs.writeFileSync('functions/handlers/transaction.js', js);
    console.log("Updated jackpot algorithm");
} else {
    // Try to find the bounds manually
    const minS = `const gsLevel = typeof bpSnap !== 'undefined'`;
    const maxS = `amountVnd: jackpotBonusVnd, amountKrw: Math.round(jackpotBonusVnd / 18) });
        }
      }`;

    if (js.includes(minS) && js.includes(maxS)) {
        let newJs = js.substring(0, js.indexOf(minS)) + r + js.substring(js.indexOf(maxS) + maxS.length);
        fs.writeFileSync('functions/handlers/transaction.js', newJs);
        console.log("Manually updated jackpot algorithm");
    } else {
        console.log("Could not find string blocks!");
    }
}
