const fs = require('fs');

let content = fs.readFileSync('assets/js/pages/pay.js', 'utf8');

content = content.replace(/동 \(VND\)/g, 'KM');

// Also in the HTML if there is a hero desc
content = content.replace(/가맹점 QR 결제/g, '가맹점 KM 결제');

fs.writeFileSync('assets/js/pages/pay.js', content, 'utf8');
console.log('Fixed pay.js KM terminology');
