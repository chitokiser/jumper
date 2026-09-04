const fs = require('fs');
let code = fs.readFileSync('assets/js/pages/merchant-qr.js', 'utf8');

const regex = /onSnapshot\(doc\(db, "users", mOwner\), \(snap\) => \{[\s\S]*?qrMerchantBtBal[\s\S]*?\}\);/;

const replace = `onSnapshot(doc(db, "users", mOwner), (snap) => {
      if (snap.exists()) {
        const { pointBalanceVnd = 0 } = snap.data();
        setText("qrMerchantPaymentBal", pointBalanceVnd.toLocaleString("ko-KR") + " KM (결제대금)");
        setText("qrMerchantPointBal", (snap.data().pointBalance || 0).toLocaleString("ko-KR") + " P");
      }
    });
    onSnapshot(doc(db, "merchants", merchantId), (snap) => {
      if (snap.exists()) {
        setText("qrMerchantBtBal", (snap.data().btBalance || 0).toLocaleString("ko-KR") + " BT");
        currentMerchant.btBalance = snap.data().btBalance || 0;
      }
    });`;

if (regex.test(code)) {
    code = code.replace(regex, replace);
    fs.writeFileSync('assets/js/pages/merchant-qr.js', code);
    console.log('fixed BT read');
} else {
    console.log('regex not found');
}
