const fs = require('fs');
const path = 'mypage.html';
let html = fs.readFileSync(path, 'utf8');

// Target the top-up section header
const originalHeader = `<section class="panel mp-section collapsible is-collapsed" id="hex-topup">
        <div class="mp-section-head">
          <h2 class="mp-section-title" data-i18n="section_deposit">Point 충전 (원화)</h2>
        </div>`;

const newHeader = `<section class="panel mp-section collapsible is-collapsed" id="hex-topup">
        <div class="mp-section-head">
          <h2 class="mp-section-title" data-i18n="section_deposit">Point 충전</h2>
        </div>
        
        <div class="field" style="margin-bottom:12px;">
          <span style="font-size:0.85rem;font-weight:600;color:#374151;margin-bottom:6px;display:block;" data-i18n="label_deposit_currency">충전 통화 선택</span>
          <div class="curr-seg">
            <label><input type="radio" name="depositCurrencyRadio" id="depositCurrencyKRW" value="KRW" checked /><span>🇰🇷 KRW (원)</span></label>
            <label><input type="radio" name="depositCurrencyRadio" id="depositCurrencyVND" value="VND" /><span>🇻🇳 VND (동)</span></label>
          </div>
          <input type="hidden" id="depositCurrency" value="KRW" />
        </div>`;

// Target the bank info block (from mp-result-box start to form start)
const originalBankBox = `<!-- 입금 계좌 안내 (항상 표시) -->
        <div class="mp-result-box" style="margin-bottom:14px;">
          <div style="margin:0 0 8px; font-size:0.82em; font-weight:700; color:var(--accent);"
            data-i18n="label_kr_account">🇰🇷 한국 계좌 (KRW 입금)</div>
          <div class="mp-kv"><span class="k" data-i18n="label_bank">은행</span><span class="v">하나은행</span></div>
          <div class="mp-kv"><span class="k" data-i18n="label_account_no">계좌번호</span><span class="v mono">381. 19.
              03076. 2</span></div>
          <div class="mp-kv"><span class="k" data-i18n="label_account_holder">예금주</span><span class="v">오용진</span></div>
          <div style="margin:10px 0 8px; font-size:0.82em; font-weight:700; color:#0ea5e9;"
            data-i18n="label_vn_account">🇻🇳 베트남 계좌 (VND 입금)</div>
          <div class="mp-kv"><span class="k" data-i18n="label_bank">은행</span><span class="v">TECHCOM BANK</span></div>
          <div class="mp-kv"><span class="k" data-i18n="label_account_no">계좌번호</span><span
              class="v mono">19037852768012</span></div>
          <div class="mp-kv"><span class="k" data-i18n="label_account_holder">예금주</span><span class="v">신헌철 (SHIN HEON
              CHEOL)</span></div>
        </div>`;

const newBankBox = `<!-- 입금 계좌 안내 -->
        <div class="mp-result-box" style="margin-bottom:14px;">
          <div id="depositAccountKRW">
            <div style="margin:0 0 8px; font-size:0.82em; font-weight:700; color:var(--accent);" data-i18n="label_kr_account">🇰🇷 한국 계좌 (KRW 입금)</div>
            <div class="mp-kv"><span class="k" data-i18n="label_bank">은행</span><span class="v">하나은행</span></div>
            <div class="mp-kv"><span class="k" data-i18n="label_account_no">계좌번호</span><span class="v mono">381. 19. 03076. 2</span></div>
            <div class="mp-kv"><span class="k" data-i18n="label_account_holder">예금주</span><span class="v">오용진</span></div>
          </div>
          <div id="depositAccountVND" style="display:none;">
            <div style="margin:0 0 8px; font-size:0.82em; font-weight:700; color:#0ea5e9;" data-i18n="label_vn_account">🇻🇳 베트남 계좌 (VND 입금)</div>
            <div class="mp-kv"><span class="k" data-i18n="label_bank">은행</span><span class="v">TECHCOM BANK</span></div>
            <div class="mp-kv"><span class="k" data-i18n="label_account_no">계좌번호</span><span class="v mono">19037852768012</span></div>
            <div class="mp-kv"><span class="k" data-i18n="label_account_holder">예금주</span><span class="v">신헌철 (SHIN HEON CHEOL)</span></div>
          </div>
        </div>`;

html = html.replace(originalHeader, newHeader);
html = html.replace(originalBankBox, newBankBox);

// Change form labels
html = html.replace('<span><span data-i18n="label_deposit_amt">충전 금액 (원)</span>', '<span><span id="labelDepositAmount" data-i18n="label_deposit_amt">충전 금액 (원)</span>');
html = html.replace('placeholder="최소 10,000원"', 'placeholder="최소 10,000"');

fs.writeFileSync(path, html, 'utf8');
console.log('mypage.html customized successfully.');
