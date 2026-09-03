const fs = require('fs');

let indexContent = fs.readFileSync('functions/index.js', 'utf8');

const targetStr = `const result = await txH.payMerchantFirebase(
      uid, Number(merchantId), amountKrw ? Number(amountKrw) : 0,
      { currency: cur, amountVnd: amountVnd ? Number(amountVnd) : undefined }
    );`;

const newTargetStr = `const result = await txH.payMerchantFirebase(
      uid, Number(merchantId), amountVnd ? Number(amountVnd) : 0,
      { currency: cur, amountKrw: amountKrw ? Number(amountKrw) : undefined, reqId: request.data.reqId }
    );`;

indexContent = indexContent.replace(targetStr, newTargetStr);

// To be safe, try regex too if exact string matching fails
const regex = /const result = await txH\.payMerchantFirebase\(\s*uid, Number\(merchantId\), amountKrw \? Number\(amountKrw\) : 0,\s*\{\s*currency: cur, amountVnd: amountVnd \? Number\(amountVnd\) : undefined\s*\}\s*\);/g;
indexContent = indexContent.replace(regex, newTargetStr);

fs.writeFileSync('functions/index.js', indexContent, 'utf8');
console.log('Fixed index.js payMerchantFirebase call signature');
