const fs = require('fs');

let content = fs.readFileSync('merchant-qr.html', 'utf8');

// Replace the old Currency Selection div with the Mode Selection div
const modeHtml = `
            <!-- 모드 선택 -->
            <div class="field" style="margin-bottom:16px; padding:12px; border:1px solid var(--accent); border-radius:12px; background:#f5f3ff;">
              <span class="label" style="color:var(--accent);">QR 모드 선택</span>
              <div style="display:flex; flex-direction:column; gap:8px; margin-top:8px;">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.95rem;">
                  <input type="radio" name="qrMode" id="modePay" value="PAY" checked />
                  <span>💳 <b>KM 결제 (고객 포인트 즉시 차감)</b></span>
                </label>
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.95rem;">
                  <input type="radio" name="qrMode" id="modeReward" value="REWARD" />
                  <span>🎟️ <b>BT 리워드 지급 (현장 현금/카드 결제 시)</b></span>
                </label>
              </div>
            </div>
`;

content = content.replace(/<!-- 통화 선택 -->[\s\S]*?<\/div>[\s\S]*?<\/div>\s*<\/div>/, modeHtml);

// Change the amount label dynamically inside merchant-qr.js instead of html
content = content.replace(/결제 금액 \(원\)/, '결제할 KM 금액');
content = content.replace(/<div class="help" id="qrAmountHelp">최소 1,000원 이상 입력해 주세요.<\/div>/, '<div class="help" id="qrAmountHelp">최소 10,000 KM 이상 입력해 주세요.</div>');

// Add a BT counter to the form
const btCounterHtml = `
            <div id="btCalcSection" style="display:none; margin-top:6px; padding:10px; background:#fdf4ff; border-radius:8px; color:#a21caf; font-size:0.9rem;">
              현금 결제액 입력 시, 지급할 <b style="font-size:1.1rem;" id="btCalcResult">0 BT</b> 가 자동차감됩니다.<br>
              <span style="font-size:0.8rem; color:#d946ef;">내 잔여 BT: <span id="myBtCount">0</span> BT</span>
            </div>
`;
content = content.replace(/<div id="qrAmountConvert"[\s\S]*?<\/div>\s*<\/label>/, btCounterHtml + '\n            </label>');

fs.writeFileSync('merchant-qr.html', content, 'utf8');
console.log('Fixed merchant-qr.html');
