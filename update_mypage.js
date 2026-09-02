const fs = require('fs');
let html = fs.readFileSync('mypage.html', 'utf8');

const regex = /<div class="mp-kv" id="paymentBalanceRow"[\s\S]*?<div id="redeemPointsResult" class="mp-result-box"/m;

const replacement = `<!-- 💸 프리미엄 머니 & 포인트 현황 카드 💸 -->
        <div style="display:flex; gap:12px; margin: 16px 0;">
          
          <!-- 머니 (Money) 카드 -->
          <div id="paymentBalanceRow" style="display:none; flex:1; background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 1.5px solid #86efac; border-radius: 16px; padding: 20px 16px; box-shadow: 0 4px 12px rgba(21,128,61,0.12); text-align:center;">
            <div data-i18n="label_payment_balance" style="font-size:0.85rem; color:#15803d; font-weight:800; display:flex; align-items:center; justify-content:center; gap:4px; margin-bottom:12px;">
              <span>💵 내 머니 (Money)</span>
            </div>
            <div id="paymentBalanceDisplay" style="font-size:1.45rem; font-weight:900; color:#166534; letter-spacing:-0.5px; line-height:1.2;">
              -
            </div>
            <div style="font-size:0.72rem; color:#15803d; margin-top:10px; opacity:0.8; font-weight:700;">가맹점 결제 가능 잔고</div>
          </div>

          <!-- 포인트 (Point) 카드 -->
          <div id="pointRow" style="display:none; flex:1; background: linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%); border: 1.5px solid #d8b4fe; border-radius: 16px; padding: 20px 16px; box-shadow: 0 4px 12px rgba(124,58,237,0.12); text-align:center;">
            <div data-i18n="label_point" style="font-size:0.85rem; color:#6d28d9; font-weight:800; display:flex; align-items:center; justify-content:center; gap:4px; margin-bottom:12px;">
              <span>✨ 잔여 포인트 (Point)</span>
            </div>
            <div id="pointDisplay" style="font-size:1.15rem; font-weight:800; color:#4c1d95; line-height:1.2; display:flex; flex-direction:column; align-items:center; gap:8px;">
              -
            </div>
          </div>

        </div>
        <div id="redeemPointsResult" class="mp-result-box"`;

if (regex.test(html)) {
    html = html.replace(regex, replacement);
    fs.writeFileSync('mypage.html', html, 'utf8');
    console.log("Success regex replace!");
} else {
    console.log("Regex failed.");
}
