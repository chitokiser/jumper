const fs = require('fs');
const path = require('path');

// 1. Fix town_home.js (jackpotAccPoints -> jackpotAccVnd)
let townJs = fs.readFileSync('assets/js/pages/town_home.js', 'utf8');
townJs = townJs.replace(/jackpotAccPoints/g, 'jackpotAccVnd');
fs.writeFileSync('assets/js/pages/town_home.js', townJs, 'utf8');
console.log('Fixed town_home.js jackpotAccVnd');

// 2. Fix merchant-qr.js (watch ownerUid pointBalanceVnd instead of k_culture_balances)
let merchQr = fs.readFileSync('assets/js/pages/merchant-qr.js', 'utf8');
// Previously:
// const merchantRef = doc(db, "k_culture_balances", String(merchantId));
// onSnapshot(merchantRef, (snap) => {
merchQr = merchQr.replace(/const merchantRef = doc\(db, "k_culture_balances", String\(merchantId\)\);/g,
    'const mOwner = (await getDoc(doc(db, "merchants", String(merchantId)))).data()?.ownerUid;')
    .replace(/onSnapshot\(merchantRef, \(snap\) => \{[\s\S]*?\}\);/g,
        `if (mOwner) {
    onSnapshot(doc(db, "users", mOwner), (snap) => {
      if (snap.exists()) {
        const { pointBalanceVnd = 0 } = snap.data();
        setText("qrMerchantPaymentBal", pointBalanceVnd.toLocaleString("ko-KR") + " KM (결제대금)");
        setText("qrMerchantPointBal", pointBalanceVnd.toLocaleString("ko-KR") + " KM (포인트)");
      }
    });
  }`);
fs.writeFileSync('assets/js/pages/merchant-qr.js', merchQr, 'utf8');
console.log('Fixed merchant-qr.js');

// 3. Fix HTML Titles replacing "Jump" and "Ocean Park" with "K-MOA"
function walkHtml(dir) {
    fs.readdirSync(dir).forEach(f => {
        const d = path.join(dir, f);
        if (fs.statSync(d).isDirectory() && !d.includes('node_modules') && !d.includes('.git')) {
            walkHtml(d);
        } else if (f.endsWith('.html')) {
            let content = fs.readFileSync(d, 'utf8');
            let changed = false;
            if (content.includes('Jump')) {
                content = content.replace(/Jump([^eA-Za-z])/g, 'K-MOA$1').replace(/Jump<\//g, 'K-MOA</');
                changed = true;
            }
            // Also specifically fix any raw title matches
            if (content.match(/<title>.*Jump.*<\/title>/i)) {
                content = content.replace(/(<title>.*)Jump(.*<\/title>)/ig, '$1K-MOA$2');
                changed = true;
            }
            if (content.match(/<title>.*Ocean Park.*<\/title>/i)) {
                content = content.replace(/(<title>.*)Ocean Park(.*<\/title>)/ig, '$1K-MOA$2');
                changed = true;
            }
            if (changed) {
                fs.writeFileSync(d, content, 'utf8');
            }
        }
    });
}
walkHtml('.');
console.log('Fixed HTML titles');
