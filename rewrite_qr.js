const fs = require('fs');
let lines = fs.readFileSync('assets/js/pages/merchant-qr.js', 'utf8').split('\n');
const s = lines.findIndex(l => l.includes('onSnapshot(merchantRef, (snap) => {'));
if (s > -1) {
    lines.splice(s, 0, `  onSnapshot(doc(db, "users", uid), (docS) => { 
    const el = document.getElementById("merchBal"); 
    if(el && docS.exists()) el.textContent = Number(docS.data().pointBalanceVnd || 0).toLocaleString() + " KM"; 
  });`);
    fs.writeFileSync('assets/js/pages/merchant-qr.js', lines.join('\n'));
    console.log('Fixed merchant-qr.js');
} else {
    console.log('Not found');
}
