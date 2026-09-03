const fs = require('fs');

// 1. Update merchant-qr.html
let html = fs.readFileSync('merchant-qr.html', 'utf8');

const modeHtml = `
            <!-- QR 모드 선택 -->
            <div class="field" style="margin-bottom:12px; background:#f4f4f5; padding:12px; border-radius:8px;">
              <span class="label" style="margin-bottom:8px; display:block; font-weight:700;">QR 모드 선택</span>
              <div style="display:flex;gap:16px; flex-wrap:wrap;">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.95rem;">
                  <input type="radio" name="qrMode" id="modePay" value="pay" checked />
                  <span>💳 간편 결제 (Payment)</span>
                </label>
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.95rem;">
                  <input type="radio" name="qrMode" id="modeBt" value="bt" />
                  <span>🎟️ BT (보너스 티켓) 발급</span>
                </label>
              </div>
            </div>`;

if (!html.includes('id="modeBt"')) {
    html = html.replace(/<form id="qrForm">/, `<form id="qrForm">\n` + modeHtml);

    // Add btBal
    html = html.replace(
        /<div class="mp-kv" style="margin-bottom:20px;">\s*<span class="k">K-CULTURE Reward<\/span>\s*<span class="v" id="qrMerchantPointBal".*?<\/div>/s,
        `<div class="mp-kv" style="margin-bottom:8px;">
        <span class="k">포인트(Point)</span>
        <span class="v" id="qrMerchantPointBal" style="font-weight:700; color:#7c3aed;">0 P</span>
    </div>
    <div class="mp-kv" style="margin-bottom:20px;">
        <span class="k">보너스 티켓(BT) 보유량</span>
        <span class="v" id="qrMerchantBtBal" style="font-weight:700; color:#f59e0b;">0 BT</span>
    </div>`
    );

    // Add calculated BT display in form
    html = html.replace(
        /<\/form>/,
        `
    <div id="qrBtCalcResult" style="display:none; margin-top:12px; padding:10px; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; text-align:center;">
        <div style="font-size:0.85rem; color:#b45309;">고객 지급 예정 BT</div>
        <div style="font-size:1.4rem; font-weight:800; color:#d97706;" id="qrBtCount">0 BT</div>
    </div>
    </form>`
    );
}

fs.writeFileSync('merchant-qr.html', html, 'utf8');

// 2. Update merchant-qr.js
let js = fs.readFileSync('assets/js/pages/merchant-qr.js', 'utf8');

js = js.replace(
    /setText\("qrMerchantPointBal", pointBalanceVnd\.toLocaleString\("ko-KR"\) \+ " KM \(포인트\)"\);/,
    `setText("qrMerchantPointBal", (snap.data().pointBalance || 0).toLocaleString("ko-KR") + " P");\n        setText("qrMerchantBtBal", (snap.data().btBalance || 0).toLocaleString("ko-KR") + " BT");`
);

const btCalcLogic = `
  const modePay = $("modePay");
  const modeBt = $("modeBt");
  const btCalcResult = $("qrBtCalcResult");
  const btCountText = $("qrBtCount");

  function getBtAmount(amount, currency) {
    let vnd = amount;
    if (currency === "KRW") vnd = amount * 20; // 대략 1원=20동
    if (vnd >= 1000000) return 5;
    if (vnd >= 500000) return 3;
    if (vnd >= 300000) return 2;
    if (vnd >= 100000) return 1;
    return 0;
  }

  function updateModeAndBt() {
    const isBt = modeBt?.checked;
    const amount = Number($("qrAmount")?.value || 0);
    const currency = form.querySelector("input[name='qrCurrency']:checked")?.value || "KRW";

    if (isBt && amount > 0) {
      if (btCalcResult) btCalcResult.style.display = "";
      if (btCountText) btCountText.textContent = getBtAmount(amount, currency) + " 장";
    } else {
      if (btCalcResult) btCalcResult.style.display = "none";
    }
    
    // 모드에 따라 버튼 텍스트 변경
    const btnGen = $("btnGenQr");
    if (btnGen) {
       btnGen.textContent = isBt ? "BT 무료 보상 QR 생성" : "결제 QR 생성";
    }
  }

  modePay?.addEventListener("change", updateModeAndBt);
  modeBt?.addEventListener("change", updateModeAndBt);
  $("qrAmount")?.addEventListener("input", updateModeAndBt);
  form.querySelectorAll("input[name='qrCurrency']").forEach(r => r.addEventListener("change", updateModeAndBt));
`;

if (!js.includes('updateModeAndBt')) {
    js = js.replace(/form\.addEventListener\("submit"/, btCalcLogic + '\n  form.addEventListener("submit"');
}

js = js.replace(
    /generateQr\(merchantId, merchantName, amount, currency\);/,
    `
    const mode = form.querySelector("input[name='qrMode']:checked")?.value || "pay";
    generateQr(merchantId, merchantName, amount, currency, mode);`
);

js = js.replace(
    /function generateQr\(merchantId, merchantName, amount, currency = "KRW"\) \{/,
    `function generateQr(merchantId, merchantName, amount, currency = "KRW", mode = "pay") {`
);

js = js.replace(
    /const url = \`\$\{baseOrigin\}\/pay\.html\?merchant=\$\{merchantId\}&amount=\$\{amount\}&currency=\$\{currency\}\`;/,
    `
  let url = \`\$\{baseOrigin\}/pay.html?merchant=\$\{merchantId\}&amount=\$\{amount\}&currency=\$\{currency\}\`;
  if (mode === "bt") {
    const btTokens = getBtAmount(amount, currency);
    url = \`\$\{baseOrigin\}/bt_receive.html?merchant=\$\{merchantId\}&amount=\$\{amount\}&currency=\$\{currency\}&bt=\$\{btTokens\}&nonce=\$\{Date.now()\}\`;
  }
  `
);

fs.writeFileSync('assets/js/pages/merchant-qr.js', js, 'utf8');
console.log('Update BT done');
