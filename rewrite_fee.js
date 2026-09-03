const fs = require('fs');

const file = 'functions/handlers/transaction.js';
let content = fs.readFileSync(file, 'utf8');

const regex = /async function adminSetMerchantFeeOnChain\(merchantId, feeBps\).*?return.*?;\n\}/s;

const newLogic = `async function adminSetMerchantFeeOnChain(merchantId, feeBps) {
  const db = admin.firestore();
  
  await db.collection('merchants').doc(String(merchantId)).set({
    feeBps: Number(feeBps),
    approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    active: true
  }, { merge: true });

  return { txHash: 'FIREBASE_NATIVE', merchantId, feeBps };
}`;

content = content.replace(regex, newLogic);
fs.writeFileSync(file, content, 'utf8');
console.log('Replaced adminSetMerchantFeeOnChain successfully');
