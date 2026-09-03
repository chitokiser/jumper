const fs = require('fs');
let payJs = fs.readFileSync('assets/js/pages/pay.js', 'utf8');

// Parse orderId in pay.js
if (!payJs.includes('const orderId = params.get("orderId");')) {
    payJs = payJs.replace(/const amountKrw = params\.get\("amountKrw"\);/, 'const amountKrw = params.get("amountKrw");\nconst orderId = params.get("orderId");');
}

// Pass reqId to payload
payJs = payJs.replace(/const payload = isVnd[\s\S]*?\{ merchantId: Number\(merchantId\), amountKrw: Number\(amountKrw\) \};/,
    `const payload = isVnd
        ? { merchantId: Number(merchantId), amountVnd: Number(amountVnd), currency: "VND", reqId: orderId }
        : { merchantId: Number(merchantId), amountKrw: Number(amountKrw), reqId: orderId };`);

fs.writeFileSync('assets/js/pages/pay.js', payJs, 'utf8');
console.log('Fixed pay.js payload assignment');
