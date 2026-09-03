const fs = require('fs');
let content = fs.readFileSync('assets/js/pages/town_home.js', 'utf8');

// Replace formatHexForUi
content = content.replace(/`${n\.toLocaleString\("ko-KR", \{ maximumFractionDigits: 2 \}\)} Point`/g, '`${n.toLocaleString("ko-KR", { maximumFractionDigits: 2 })} KM`');

// Replace fmtJackpotHex
content = content.replace(/`${hexVal\.toLocaleString\("ko-KR", \{ maximumFractionDigits: 4 \}\)} Point`/g, '`${hexVal.toLocaleString("ko-KR", { maximumFractionDigits: 0 })} KM`');

// Replace jackpot UI texts
content = content.replace(/valueText: jackpotPoints > 0 \? `\$\{ptsStr\} Point` : "0 Point",/g, 'valueText: jackpotPoints > 0 ? `${ptsStr} KM` : "0 KM",');

// Replace fiatText to just show VND equivalence
content = content.replace(/fiatText: jackpotPoints > 0 \? _t\('fiat_approx', `\$\{ptsStr\} Point`, krwStr \+ " KRW"\) : _t\('fiat_no_jackpot'\)/g, 'fiatText: jackpotPoints > 0 ? _t(\'fiat_approx\', `${ptsStr} KM`, ptsStr + " VND") : _t(\'fiat_no_jackpot\')');

fs.writeFileSync('assets/js/pages/town_home.js', content, 'utf8');
console.log('Fixed town_home.js Point to KM logic');
