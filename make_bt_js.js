const fs = require('fs');
let js = fs.readFileSync('assets/js/pages/bt_receive.js', 'utf8');

js = js.replace(/const amount = Number\(params\.get\("amount"\)\);/, 'const amount = Number(params.get("amount"));\nconst bt = Number(params.get("bt"));\nconst nonce = params.get("nonce");');

js = js.replace(/if \(!confirm\([\s\S]*?\)\) return;/,
    'if (!confirm(`${merchantName} 가맹점으로부터 ${bt} BT를 수령하시겠습니까?`)) return;');

js = js.replace(/btn\.textContent = "결제 중\.\.\.";/, 'btn.textContent = "티켓 수령 중...";');
js = js.replace(/stateEl\.textContent = "블록체인 처리 중입니다\. 잠시 기다려 주세요\.\.\.";/, 'stateEl.textContent = "티켓을 적립하고 있습니다...";');

js = js.replace(/const payFn = httpsCallable\(functions, "payMerchantFirebase"\);[\s\S]*?const res = await payFn\(payload\);/,
    `const payFn = httpsCallable(functions, "receiveBtQrFirebase");
      const payload = { merchantId, amount, currency, bt, txHash: String(nonce), nonce };
      const res = await payFn(payload);`);

js = js.replace(/const paidAmountStr = \[krwStr, vndStr\]\.filter\(Boolean\)\.join\(' \/ '\);/,
    'let paidAmountStr = [krwStr, vndStr].filter(Boolean).join(" / "); paidAmountStr += ` (수령 BT: ${bt} BT)`;');

js = js.replace(/alert\("결제 실패: " \+ \(err\?\.message \|\| "서버 오류가 발생했습니다\."\)\);/, 'alert("수령 실패: " + (err?.message || "서버 오류가 발생했습니다."));');
js = js.replace(/btn\.textContent = "결제하기";/, 'btn.textContent = "수령하기";');

fs.writeFileSync('assets/js/pages/bt_receive.js', js, 'utf8');
console.log('done modifying js');
