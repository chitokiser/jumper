const fs = require('fs');

let js = fs.readFileSync('functions/handlers/transaction.js', 'utf8');

// I will find where `const checkTxRef` is defined in payMerchantFirebase
const search = `tx.update(userRef, { 
        pointBalanceVnd: userBalanceVnd - finalVnd,
        pointBalance: admin.firestore.FieldValue.increment(extraPoints)
    });`;

const replace = `
    let potionsAdded = 0;
    let mpPotionsAdded = 0;
    let reviveAdded = 0;

    const r = Math.random();
    if (r < 0.2) potionsAdded = 1;
    else if (r < 0.3) mpPotionsAdded = 1;
    else if (r < 0.35) reviveAdded = 1;

    if (potionsAdded > 0 || mpPotionsAdded > 0 || reviveAdded > 0) {
        tx.set(buyerBpRef, {
            potions: admin.firestore.FieldValue.increment(potionsAdded),
            mpPotions: admin.firestore.FieldValue.increment(mpPotionsAdded),
            reviveTickets: admin.firestore.FieldValue.increment(reviveAdded)
        }, { merge: true });
    }

    tx.update(userRef, { 
        pointBalanceVnd: userBalanceVnd - finalVnd,
        pointBalance: admin.firestore.FieldValue.increment(extraPoints)
    });
`;

if (js.includes(search)) {
    js = js.replace(search, replace);
    fs.writeFileSync('functions/handlers/transaction.js', js, 'utf8');
    console.log("Replaced potion logic");
} else {
    console.log("Search string not found!");
}
