const fs = require('fs');

let headerCode = fs.readFileSync('partials/header.html', 'utf8');
headerCode = headerCode.replace('🗺️ 지도(Map)', '가맹점');
fs.writeFileSync('partials/header.html', headerCode);
console.log('updated header');

let payCode = fs.readFileSync('assets/js/pages/pay.js', 'utf8');
const search = "try { const topArr = document.querySelectorAll('.info-header span, .head-coins span'); topArr.forEach(el => { if(el.textContent.includes('KM')||el.textContent.includes('원')) { const currentStr = el.textContent.replace(/[^0-9]/g, ''); if(currentStr) { el.textContent = (Number(currentStr) - (d.amountKrw || 0)).toLocaleString() + ' KM'; } } }); } catch(e){} // 완료 패널 표시";

if (payCode.includes(search)) {
    const replace = `try { 
  const topArr = document.querySelectorAll('.info-header span, .head-coins span, .head-point span'); 
  topArr.forEach(el => { 
    if(el.textContent.includes('KM')||el.textContent.includes('원')) { 
      const currentStr = el.textContent.replace(/[^0-9]/g, ''); 
      if(currentStr) { el.textContent = (Number(currentStr) - (d.amountKrw || 0)).toLocaleString() + ' KM'; }
    }
  });
  const pointEl = document.querySelector('[data-point="true"]') || document.querySelector('.head-point span');
  if (pointEl && d.pointsEarned) {
      pointEl.textContent = (Number(pointEl.textContent.replace(/[^0-9]/g, '')) + d.pointsEarned).toLocaleString() + ' P';
  }
} catch(e){} // 완료 패널 표시`;
    payCode = payCode.replace(search, replace);
    fs.writeFileSync('assets/js/pages/pay.js', payCode);
    console.log('updated pay.js');
}

let qrCode = fs.readFileSync('assets/js/pages/merchant-qr.js', 'utf8');
const qrSearch = `<div class="ri-hex">+\${vndVal.toLocaleString("ko-KR")} VND</div>`;
if (qrCode.includes(qrSearch)) {
    const qrReplace = `<div class="ri-hex">+\${vndVal.toLocaleString("ko-KR")} VND</div>
      \${data.customerPointsEarned ? \`<div class="ri-fiat" style="color:#7c3aed;margin-top:2px;">✨ 고객 적립: +\${data.customerPointsEarned.toLocaleString()} P</div>\` : ""}`;
    qrCode = qrCode.replace(qrSearch, qrReplace);
    fs.writeFileSync('assets/js/pages/merchant-qr.js', qrCode);
    console.log('updated merchant-qr.js');
}
