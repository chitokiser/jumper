const fs = require('fs');

const path = 'partials/header.html';
let html = fs.readFileSync(path, 'utf8');

const target = `<nav class="nav" id="hdrNav">`;

const injection = `<nav class="nav" id="hdrNav">
      <!-- 🚀 빠른 실행 (Quick Actions) -->
      <div class="nav-group" data-role="user merchant guide admin" style="background:#f8fafc; border-radius:12px; padding:12px; margin-bottom:12px;">
        <div style="font-size:0.75rem; color:#64748b; font-weight:700; margin-bottom:10px;">⚡ 빠른 실행</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <a href="/mypage.html#merchantPaySection" style="text-align:center; background:#ffedd5; color:#ea580c; border-radius:8px; padding:10px 4px; text-decoration:none; font-weight:700; font-size:0.85rem; display:flex; flex-direction:column; align-items:center; gap:4px;">
            <span style="font-size:1.4rem;">📷</span>결제하기
          </a>
          <a href="/mypage.html#hex-topup" style="text-align:center; background:#dcfce7; color:#166534; border-radius:8px; padding:10px 4px; text-decoration:none; font-weight:700; font-size:0.85rem; display:flex; flex-direction:column; align-items:center; gap:4px;">
            <span style="font-size:1.4rem;">💵</span>머니 충전
          </a>
          <a href="/merchant-qr.html" style="text-align:center; background:#dbeafe; color:#1d4ed8; border-radius:8px; padding:10px 4px; text-decoration:none; font-weight:700; font-size:0.85rem; display:flex; flex-direction:column; align-items:center; gap:4px; grid-column:span 2;">
            <span style="font-size:1.4rem;">📲</span>내 QR로 결제받기 (P2P/가맹)
          </a>
        </div>
      </div>`;

if (html.includes(target)) {
    html = html.replace(target, injection);
    fs.writeFileSync(path, html, 'utf8');
    console.log("Header injected successfully!");
} else {
    console.log("Could not find <nav> tag in header.html");
}
