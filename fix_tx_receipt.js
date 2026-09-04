const fs = require('fs');
let js = fs.readFileSync('functions/handlers/transaction.js', 'utf8');

const s1 = `tx.set(checkTxRef, { ...txBase, uid, type: 'pay_merchant' });`;
const r1 = `tx.set(checkTxRef, { ...txBase, uid, type: 'pay_merchant', pointsEarned: extraPoints });`;

const s2 = `tx.set(db.collection('transactions').doc(), { ...txBase, uid: merchantOwnerUid, buyerUid: uid, type: 'merchant_income', netAmountVnd: netVnd, feeAmountVnd: feeVnd, feeBps });`;
const r2 = `tx.set(db.collection('transactions').doc(), { ...txBase, uid: merchantOwnerUid, buyerUid: uid, type: 'merchant_income', netAmountVnd: netVnd, feeAmountVnd: feeVnd, feeBps, customerPointsEarned: extraPoints });`;

if (js.includes(s1)) {
    js = js.replace(s1, r1);
}
if (js.includes(s2)) {
    js = js.replace(s2, r2);
}
fs.writeFileSync('functions/handlers/transaction.js', js, 'utf8');
console.log("Updated transactions doc writes.");
