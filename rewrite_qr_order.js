const fs = require('fs');
let content = fs.readFileSync('assets/js/pages/merchant-qr.js', 'utf8');

content = content.replace(/qrUrl = baseUrl \+ \`\?mid=\$\{merchantId\}&amountVnd=\$\{val\}\`;/g, 'qrUrl = baseUrl + `?mid=${merchantId}&amountVnd=${val}&orderId=${Date.now()}`;');
content = content.replace(/qrUrl = baseUrl \+ \`\?mid=\$\{merchantId\}&amountKrw=\$\{val\}\`;/g, 'qrUrl = baseUrl + `?mid=${merchantId}&amountKrw=${val}&orderId=${Date.now()}`;');

fs.writeFileSync('assets/js/pages/merchant-qr.js', content, 'utf8');
console.log('Fixed merchant-qr.js qr orderId generation');
