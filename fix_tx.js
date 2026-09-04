const fs = require('fs');

let js = fs.readFileSync('functions/handlers/transaction.js', 'utf8');

const search = `tx.update(userRef, { pointBalanceVnd: userBalanceVnd - finalVnd + jackpotRewardVnd });`;

const replace = `
    const cashbackPoints = Math.round(finalVnd * 0.05); // 5% point cashback
    let extraPoints = cashbackPoints;
    if (jackpotRewardVnd > 0) {
        extraPoints += jackpotRewardVnd; // Jackpot is given in Points!
    }
    
    tx.update(userRef, { 
        pointBalanceVnd: userBalanceVnd - finalVnd,
        pointBalance: admin.firestore.FieldValue.increment(extraPoints)
    });
`;

if (js.includes(search)) {
    js = js.replace(search, replace);
    fs.writeFileSync('functions/handlers/transaction.js', js, 'utf8');
    console.log("Replaced tx update logic");
} else {
    console.log("Search string not found!");
}
