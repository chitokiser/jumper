const fs = require('fs');

let content = fs.readFileSync('merchant-qr.html', 'utf8');

// Remove the currency radio buttons
content = content.replace(/<div class="form-group">\s*<label class="form-label">결제 통화<\/label>\s*<div class="curr-toggle" style="display:flex;gap:7px;">[\s\S]*?<\/div>\s*<\/div>/g, '');

// Change the placeholder
content = content.replace(/id="qrAmount" type="number" placeholder="금액 입력" required/g, 'id="qrAmount" type="number" placeholder="KM 금액 입력" required');

// Force qrCurrency to VND logic in merchant-qr.js
let js = fs.readFileSync('assets/js/pages/merchant-qr.js', 'utf8');
js = js.replace(/const isVnd = form\.querySelector\("input\[name='qrCurrency'\]:checked"\)\?\.value === "VND";/g, 'const isVnd = true;');
js = js.replace(/const qrCurrency = form\.querySelector\("input\[name='qrCurrency'\]:checked"\)\?\.value \|\| "KRW";/g, 'const qrCurrency = "VND";');

fs.writeFileSync('merchant-qr.html', content, 'utf8');
fs.writeFileSync('assets/js/pages/merchant-qr.js', js, 'utf8');

console.log('Fixed merchant-qr UI for VND Only');
