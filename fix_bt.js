const fs = require('fs');
let js = fs.readFileSync('assets/js/pages/bt_receive.js', 'utf8');

js = js.replace(/const amount = Number\(params.get\(\"amount\"\)\);/, 'const amount = Number(params.get(\"amount\"));\nconst bt = Number(params.get(\"bt\"));\nconst nonce = params.get(\"nonce\");');

js = js.replace(/const payload = isVnd[\s\S]*?\};\n\s*const res = await payFn\(payload\);/g, 'const res = await (httpsCallable(functions, \"receiveBtQrFirebase\"))({ merchantId, amount, currency, bt, nonce, txHash: String(nonce) });');

fs.writeFileSync('assets/js/pages/bt_receive.js', js, 'utf8');
console.log('fixed');
