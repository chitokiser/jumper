const fs = require('fs');

let payJs = fs.readFileSync('assets/js/pages/pay.js', 'utf8');

payJs = payJs.replace(
    /\(Number\(currentStr\) - \(d\.amountKrw \|\| 0\)\)\.toLocaleString\(\) \+ \' KM\'/g,
    '(Number(currentStr) - (d.amountVnd || d.amountKrw || 0)).toLocaleString() + " KM"'
);

fs.writeFileSync('assets/js/pages/pay.js', payJs, 'utf8');
console.log('Fixed pay.js KM deduction to use amountVnd');
