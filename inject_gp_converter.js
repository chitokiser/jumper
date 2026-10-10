const fs = require('fs');
const cheerio = require('cheerio');

const html = fs.readFileSync('mypage.html', 'utf8');
const $ = cheerio.load(html, { decodeEntities: false });

const converterHtml = `
          <!-- GP to Point Conversion -->
          <div id="gpConverterRow" style="flex:1; min-width: 280px; background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); border: 1.5px solid #fcd34d; border-radius: 16px; padding: 20px 16px; box-shadow: 0 4px 12px rgba(245,158,11,0.12); text-align:center;">
            <div style="font-size:0.85rem; color:#b45309; font-weight:800; display:flex; align-items:center; justify-content:center; gap:4px; margin-bottom:12px;">
              <span>🎮 내 게임 GP 환전</span>
            </div>
            <div id="gpUserLevelDisplay" style="font-size:0.85rem; font-weight:700; color:#b45309; margin-bottom: 4px;">
               Level: 1
            </div>
            <div id="gpBalanceDisplay" style="font-size:1.45rem; font-weight:900; color:#92400e; letter-spacing:-0.5px; line-height:1.2; margin-bottom: 8px;">
               0 GP
            </div>
            <div style="font-size:0.75rem; color:#b45309; margin-bottom: 12px;">
              전환 공식: (GP × 현재 레벨) / 10 = Point
            </div>
            <button id="btnConvertGpToPoint" style="background:#f59e0b; color:#fff; border:none; padding:8px 20px; border-radius:8px; font-weight:700; cursor:pointer;">
              전환하기 (최소 10 GP 이상)
            </button>
          </div>
`;

// Insert after paymentBalanceRow or pointRow
const target = $('#paymentBalanceRow');
if (target.length > 0) {
    target.after(converterHtml);
} else {
    // Try inserting after #pointDisplay container
    $('#pointDisplay').parent().after(converterHtml);
}

fs.writeFileSync('mypage.html', $.html());
console.log('Injected GP converter HTML into mypage.html');
