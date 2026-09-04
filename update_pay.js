const fs = require('fs');
let payCode = fs.readFileSync('assets/js/pages/pay.js', 'utf8');

const regex = /try\s*\{\s*const topArr = document\.querySelectorAll\('.info-header span, \.head-coins span'\);.*?catch\(e\)\{\}\s*\/\/\s*완료 패널 표시/;

const replace = `try { 
  const topArr = document.querySelectorAll('.info-header span, .head-coins span, .head-point span, [data-point="true"]'); 
  topArr.forEach(el => { 
    if(el.textContent.includes('KM')||el.textContent.includes('원')) { 
      const currentStr = el.textContent.replace(/[^0-9]/g, ''); 
      if(currentStr) { el.textContent = (Number(currentStr) - (d.amountKrw || 0)).toLocaleString() + ' KM'; }
    }
  });
  // Update Point specifically
  const pointEl = document.querySelector('[data-point="true"]') || document.querySelector('.head-point span') || document.querySelector('.info-header [data-hdr-i18n="hdr_member_badge"]'); 
  // It might be hard to find exact point element class, let's just reload auth.js stats!
  if (window.loadMyBalances) {
      window.loadMyBalances();
  }
} catch(e){} // 완료 패널 표시`;

if (regex.test(payCode)) {
    payCode = payCode.replace(regex, replace);
    fs.writeFileSync('assets/js/pages/pay.js', payCode);
    console.log('updated pay.js effectively');
} else {
    // try to just find "try { const topArr"
    const fallbackRegex = /try \{ const topArr = document\.querySelectorAll\('.info-header span.*?\/\/\s*완료 패널 표시/s;
    if (fallbackRegex.test(payCode)) {
        payCode = payCode.replace(fallbackRegex, replace);
        fs.writeFileSync('assets/js/pages/pay.js', payCode);
        console.log('updated pay.js using fallback');
    } else {
        console.log('NOT FOUND!');
    }
}
