const fs = require('fs');
let html = fs.readFileSync('mypage.html', 'utf8');

// Remove Vietnam Account
html = html.replace(/<div style="margin:10px 0 8px; font-size:0\.82em; font-weight:700; color:#0ea5e9;"[\s\S]*?CHEOL\)<\/span><\/div>/g, '');

// Remove Vietnam Deposit result lines
html = html.replace(/<div style="margin:10px 0 6px; font-size:0\.82em; font-weight:700; color:#0ea5e9;">🇻🇳 베트남 계좌 \(VND 입금\)<\/div>[\s\S]*?drHolderVnd" \/><\/span><\/div>/g, '');

// The older regex for drHolderVnd didn't have self closing span, let's just make it simple
html = html.replace(/<div style="margin:10px 0 6px; font-size:0\.82em; font-weight:700; color:#0ea5e9;">🇻🇳 베트남 계좌 \(VND 입금\)<\/div>[\s\S]*?id="drHolderVnd">-<\/span><\/div>/g, '');

// Remove Offline Merchant currency selection
html = html.replace(/<div class="field">\s*<span style="font-size:0\.85rem;font-weight:600;color:#374151;margin-bottom:6px;display:block;"\s*data-i18n="label_currency">통화 선택<\/span>\s*<div class="curr-seg">\s*<label><input type="radio" name="merchantPayCurrencyRadio" id="merchantPayCurrencyVND" value="VND"\s*checked \/><span>🇻🇳 VND \(동\)<\/span><\/label>\s*<label><input type="radio" name="merchantPayCurrencyRadio" id="merchantPayCurrencyKRW"\s*value="KRW" \/><span>🇰🇷 KRW \(원\)<\/span><\/label>\s*<\/div>\s*<input type="hidden" id="merchantPayCurrency" value="VND" \/>\s*<\/div>\s*<label class="field">\s*<span id="merchantPayAmountLabel" data-i18n="label_pay_amount_vnd">결제 금액 \(동 VND\) <em\s*class="req">\*<\/em><\/span>\s*<input type="number" id="merchantPayAmount" min="10000" step="1000" placeholder="예: 200000" \/>\s*<\/label>/g,
    `<label class="field"><input type="hidden" id="merchantPayCurrency" value="KRW" /></label>\n          <label class="field">\n            <span id="merchantPayAmountLabel" data-i18n="label_pay_amount_krw">결제 금액 (원 KRW) <em class="req">*</em></span>\n            <input type="number" id="merchantPayAmount" min="1000" step="100" placeholder="예: 5000" />\n          </label>`);

fs.writeFileSync('mypage.html', html, 'utf8');
console.log('Vietnam elements removed');
