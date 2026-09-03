const fs = require('fs');
let c = fs.readFileSync('assets/js/pages/pay.js', 'utf8');
c = c.replace(/show\("payPanel", false\);\s*show\("donePanel", true\);/,
    'show("payPanel", false);\n      show("donePanel", true);\n      watchJackpotResult(d.txHash);');
fs.writeFileSync('assets/js/pages/pay.js', c);
console.log('Fixed pay.js watchJackpotResult');
