const fs = require('fs');

// 1. Fix header.html
let header = fs.readFileSync('partials/header.html', 'utf8');

const logoRegex = /<a class="brand"[\s\S]*?<\/a>/;
const newLogo = `<a class="brand" href="/" aria-label="K-MOA" style="display: flex; align-items: center; gap: 8px; text-decoration: none;">
      <img src="/assets/images/jump/logo2.png" alt="K-MOA" class="brand-logo" onerror="this.src='/assets/images/jump/favicon.png';" style="max-height: 32px; display: block;" />
      <span style="font-weight: 900; font-size: 1.2rem; background: linear-gradient(to right, #facc15, #f59e0b); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">K-MOA</span>
    </a>`;
header = header.replace(logoRegex, newLogo);

// Remove Quick Actions from nav if they exist, because they break desktop header. We can move them or just remove them from header.
const quickActionsRegex = /<!-- 🚀 빠른 실행 \(Quick Actions\) -->[\s\S]*?<!-- \/빠른 실행 -->/;
header = header.replace(quickActionsRegex, ''); // Remove totally from header to fix layout! (User has them in mypage anyway)

fs.writeFileSync('partials/header.html', header, 'utf8');
console.log('Fixed header.html');

// 2. Fix index.html hero link
let index = fs.readFileSync('index.html', 'utf8');
index = index.replace(/\/find_merchants\.html/g, '/merchants.html');
fs.writeFileSync('index.html', index, 'utf8');
console.log('Fixed index.html link');
