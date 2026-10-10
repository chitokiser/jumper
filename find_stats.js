const fs = require('fs');

const mypage = fs.readFileSync('mypage.html', 'utf8');
const lines = mypage.split('\n');

lines.forEach((l, i) => {
    if (l.toLowerCase().includes('point') || l.toLowerCase().includes('gp') || l.toLowerCase().includes('결제') || l.toLowerCase().includes('balance')) {
        console.log(`${i}: ${l.trim()}`);
    }
});
