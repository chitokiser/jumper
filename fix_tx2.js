const fs = require('fs');

let js = fs.readFileSync('functions/handlers/transaction.js', 'utf8');

const search = `return { txHash, isJackpot: isWinner, amountHex: finalVnd, amountKrw: finalKrw, amountVnd: finalVnd, merchantName: merchant.name || '' };`;

const replace = `return { txHash, isJackpot: isWinner, amountHex: finalVnd, amountKrw: finalKrw, amountVnd: finalVnd, merchantName: merchant.name || '', pointsEarned: extraPoints };`;

if (js.includes(search)) {
    js = js.replace(search, replace);
    fs.writeFileSync('functions/handlers/transaction.js', js, 'utf8');
    console.log("Replaced tx return logic");
} else {
    console.log("Search string not found!");
}
