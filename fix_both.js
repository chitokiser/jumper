const fs = require('fs');

// 1. Fix transaction.js merchant deposit bug
let txjs = fs.readFileSync('functions/handlers/transaction.js', 'utf8');

txjs = txjs.replace(
    "const merchantBalanceRef = db.collection('k_culture_balances').doc(String(merchantId));",
    "// merchantBalanceRef removed, sending directly to owner's pointBalanceVnd"
);

txjs = txjs.replace(
    "tx.get(merchantBalanceRef)",
    "// old balance ref removed"
);

let oldS = `    // 3. 가맹점 정산
    const currentMerchantBal = balanceSnap.exists ? Number(balanceSnap.data().paymentBalanceVnd || 0) : 0;
    tx.set(merchantBalanceRef, {
      paymentBalanceVnd: currentMerchantBal + netVnd
    }, { merge: true });`;

let newS = `    // 3. 가맹점 정산
    // If the buyer is identical to the merchant owner (self-payment), adjust the calculated decrement instead
    if (uid === merchantOwnerUid) {
      tx.update(userRef, {
        pointBalanceVnd: userBalanceVnd - paymentVnd + netVnd
      });
    } else {
      const ownerBal = ownerSnap.exists ? Number(ownerSnap.data().pointBalanceVnd || 0) : 0;
      tx.update(merchantOwnerRef, {
        pointBalanceVnd: ownerBal + netVnd
      });
    }`;

txjs = txjs.replace(oldS, newS);

fs.writeFileSync('functions/handlers/transaction.js', txjs, 'utf8');
console.log('Fixed transaction.js');

// 2. Fix Quick Actions position
let headerHtml = fs.readFileSync('partials/header.html', 'utf8');

const quickActionsBlock = `      <!-- 🚀 빠른 실행 (Quick Actions) -->
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
      </div>
`;

if (headerHtml.includes('<!-- 🚀 빠른 실행 (Quick Actions) -->')) {
    headerHtml = headerHtml.replace(quickActionsBlock, "");
    fs.writeFileSync('partials/header.html', headerHtml, 'utf8');
    console.log('Removed Quick Actions from header.html');
}

let mypageHtml = fs.readFileSync('mypage.html', 'utf8');
const quickActionsNewHTML = `
    <!-- 🚀 빠른 실행 (Quick Actions) -->
    <div style="background:#f8fafc; border-radius:12px; padding:12px; margin: 0 auto 16px; margin-top:20px; max-width:600px;">
      <div style="font-size:0.75rem; color:#64748b; font-weight:700; margin-bottom:10px; text-align:center;">⚡ 빠른 클릭 (Quick Actions)</div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
        <a href="#merchantPaySection" style="text-align:center; background:#ffedd5; color:#ea580c; border-radius:8px; padding:10px 4px; text-decoration:none; font-weight:700; font-size:0.85rem; display:flex; flex-direction:column; align-items:center; gap:4px;">
          <span style="font-size:1.4rem;">📷</span>결제하기
        </a>
        <a href="#hex-topup" style="text-align:center; background:#dcfce7; color:#166534; border-radius:8px; padding:10px 4px; text-decoration:none; font-weight:700; font-size:0.85rem; display:flex; flex-direction:column; align-items:center; gap:4px;">
          <span style="font-size:1.4rem;">💵</span>머니 충전
        </a>
        <a href="/merchant-qr.html" style="text-align:center; background:#dbeafe; color:#1d4ed8; border-radius:8px; padding:10px 4px; text-decoration:none; font-weight:700; font-size:0.85rem; display:flex; flex-direction:column; align-items:center; gap:4px; grid-column:span 2;">
          <span style="font-size:1.4rem;">📲</span>가맹점 QR 결제받기
        </a>
      </div>
    </div>
`;
if (!mypageHtml.includes('가맹점 QR 결제받기')) {
    mypageHtml = mypageHtml.replace(
        '<div class="mp-cards">',
        quickActionsNewHTML + '\n    <div class="mp-cards">'
    );
    fs.writeFileSync('mypage.html', mypageHtml, 'utf8');
    console.log('Injected Quick Actions to mypage.html');
}
