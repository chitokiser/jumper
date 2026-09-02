const fs = require('fs');
let payjs = fs.readFileSync('assets/js/pages/pay.js', 'utf8');

// Replace VND variables with KRW
payjs = payjs.replace(/const isVnd = \$\("merchantPayCurrency"\)\s*\?\s*\$\("merchantPayCurrency"\)\.value === "VND"\s*:\s*false;/g, 'const isVnd = false;');
payjs = payjs.replace(/const isVnd = elCurrency && elCurrency\.value === "VND";/g, 'const isVnd = false;');

fs.writeFileSync('assets/js/pages/pay.js', payjs, 'utf8');

let depjs = fs.readFileSync('assets/js/pages/deposit.js', 'utf8');
depjs = depjs.replace(/const isVnd = \$\("depositCurrency"\)\s*\?\s*\$\("depositCurrency"\)\.value === "VND"\s*:\s*false;/g, 'const isVnd = false;');
// Strip `amountVnd` entirely from the deposit endpoint if needed, but if isVnd is false, it uses KRW by default.

fs.writeFileSync('assets/js/pages/deposit.js', depjs, 'utf8');
console.log('Frontend controllers patched');
