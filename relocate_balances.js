const fs = require('fs');
const path = 'mypage.html';
let html = fs.readFileSync(path, 'utf8');

// 1. Extract the premium cards and the redeem results box
// The cards are wrapped in `<div style="display:flex; gap:12px; margin: 16px 0;">` up to `</div>` 
// and then `<div id="redeemPointsResult"` right below it.

// For safety, let's target the exact string block
const startMarkers = [
    '<!-- 💸 프리미엄 머니 & 포인트 현황 카드 💸 -->'
];

const match = html.match(/<!-- 💸 프리미엄 머니 & 포인트 현황 카드 💸 -->[\s\S]*?<div id="redeemPointsResult"[^>]*><\/div>/);
if (match) {
    let cardsHtml = match[0];

    // Remove from original position
    html = html.replace(cardsHtml, '');

    // Clean up padding of cards to fit profile space
    // We'll subtly adjust margin for better placing inside myinfo
    cardsHtml = cardsHtml.replace('margin: 16px 0;', 'margin: 20px 0 0 0;');

    // Insert at the bottom of ProfileInfo section
    // find:
    /*
          <div class="mp-kv-list" id="profileInfo">
            <div class="mp-kv"><span class="k" data-i18n="label_name">이름</span><span class="v" id="infoName">-</span>
            </div>
            <div class="mp-kv"><span class="k" data-i18n="label_email">이메일</span><span class="v" id="infoEmail">-</span>
            </div>
            <div class="mp-kv"><span class="k" data-i18n="label_phone">전화번호</span><span class="v" id="infoPhone">-</span>
            </div>
          </div>
        </section>
    */

    const insertTarget = '</div>\n      </section>';
    const profileInfoMatch = html.match(/<div class="mp-kv-list" id="profileInfo">[\s\S]*?<\/div>[\s]*<\/section>/);
    if (profileInfoMatch) {
        let newProfileInfo = profileInfoMatch[0].replace('</section>', `\n        ${cardsHtml}\n      </section>`);
        html = html.replace(profileInfoMatch[0], newProfileInfo);
        fs.writeFileSync(path, html, 'utf8');
        console.log("SUCCESS: Premium cards successfully relocated to MyInfo section.");
    } else {
        console.log("ERROR: Could not find profileInfo section.");
    }
} else {
    console.log("ERROR: Could not find premium cards block.", html.includes('프리미엄 머니'));
}
