const fs = require('fs');
let b = fs.readFileSync('partials/header.html', 'utf8');

// 1. Remove the bulky Quick Actions from hdrNav
const bulkyNav = `<div class="nav-group" data-role="user merchant guide admin" style="background:#f8fafc; border-radius:12px; padding:12px; margin-bottom:12px;">
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
b = b.replace(bulkyNav, '');
b = b.replace(/\r\n/g, '\n'); // Normalize just in case

// 2. Add the Fast Action button and Modal menu in hdr-right
const quickActionHtml = `
      <!-- Quick Action Menu -->
      <div id="quickMenuWrapper" style="position:relative; margin-right:8px; display:inline-block;" data-role="user merchant guide admin">
        <button id="btnQuickMenu" type="button" style="background:linear-gradient(135deg, #f59e0b, #ea580c); color:#fff; border:none; border-radius:24px; padding:6px 14px; font-size:0.85rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:4px; box-shadow:0 2px 8px rgba(234, 88, 12, 0.3); transition:all 0.2s;">
          ⚡ 퀵메뉴
        </button>
        <div id="quickMenuDropdown" style="display:none; position:absolute; top:42px; right:0; background:rgba(255,255,255,0.95); backdrop-filter:blur(10px); border:1px solid #e5e7eb; border-radius:12px; padding:12px; width:220px; box-shadow:0 10px 25px rgba(0,0,0,0.1); z-index:100; animation:fadeDrop 0.2s ease;">
          <div style="font-size:0.75rem; color:#6b7280; font-weight:700; margin-bottom:8px; padding-left:4px;">빠른 실행</div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <a href="/mypage.html#merchantPaySection" style="text-decoration:none; display:flex; align-items:center; gap:10px; background:#fff7ed; padding:10px; border-radius:8px; color:#c2410c; font-weight:700; font-size:0.85rem; transition:background 0.15s;">
              <span style="font-size:1.2rem;">📷</span>결제하기
            </a>
            <a href="/mypage.html#hex-topup" style="text-decoration:none; display:flex; align-items:center; gap:10px; background:#f0fdf4; padding:10px; border-radius:8px; color:#15803d; font-weight:700; font-size:0.85rem; transition:background 0.15s;">
              <span style="font-size:1.2rem;">💵</span>머니 충전
            </a>
            <a href="/merchant-qr.html" style="text-decoration:none; display:flex; align-items:center; gap:10px; background:#eff6ff; padding:10px; border-radius:8px; color:#1d4ed8; font-weight:700; font-size:0.85rem; transition:background 0.15s;">
              <span style="font-size:1.2rem;">📲</span>내 QR로 받기
            </a>
          </div>
        </div>
      </div>
      <style>
        #btnQuickMenu:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(234, 88, 12, 0.4); }
        #quickMenuDropdown a:hover { filter: brightness(0.95); }
        @keyframes fadeDrop { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
      </style>
      <script>
        (function(){
          const wrapper = document.getElementById('quickMenuWrapper');
          const btn = document.getElementById('btnQuickMenu');
          const drop = document.getElementById('quickMenuDropdown');
          if(btn && drop) {
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              drop.style.display = drop.style.display === 'none' ? 'block' : 'none';
            });
            document.addEventListener('click', (e) => {
              if(!wrapper.contains(e.target)) drop.style.display = 'none';
            });
          }
        })();
      </script>
`;

b = b.replace(/<div class="hdr-lang"/, quickActionHtml + '\n      <div class="hdr-lang"');

fs.writeFileSync('partials/header.html', b, 'utf8');
console.log("Updated header.html by moving quick actions to a drop-down!");
