const fs = require('fs');

let js = fs.readFileSync('functions/handlers/transaction.js', 'utf8');

const search2 = `return { txHash, isJackpot: isWinner, amountHex: finalVnd, amountKrw: finalKrw, amountVnd: finalVnd, merchantName: merchant.name || '', pointsEarned: extraPoints };`;

const replace2 = `return { txHash, isJackpot: isWinner, amountHex: finalVnd, amountKrw: finalKrw, amountVnd: finalVnd, merchantName: merchant.name || '', pointsEarned: extraPoints, potionsAdded, mpPotionsAdded, reviveAdded };`;

if (js.includes(search2)) {
    js = js.replace(search2, replace2);
    fs.writeFileSync('functions/handlers/transaction.js', js, 'utf8');
    console.log("Replaced return logic for potions");
} else {
    console.log("Search string 2 not found!");
}
