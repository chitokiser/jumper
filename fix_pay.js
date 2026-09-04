const fs = require('fs');
let js = fs.readFileSync('assets/js/pages/pay.js', 'utf8');

const search = '  if (d.potionsAdded > 0) items.push';
const replace = `
  if (d.pointsEarned > 0) items.push(\`<div style="font-size:1.1em; color:#7c3aed;">✨ 리워드 <b>+\${d.pointsEarned.toLocaleString()} Point</b> 추가!</div>\`);
  if (d.potionsAdded > 0) items.push`;

if (js.includes(search)) {
    js = js.replace(search, replace);
    fs.writeFileSync('assets/js/pages/pay.js', js, 'utf8');
    console.log("Replaced pay.js");
} else {
    console.log("pay.js search string not found!");
}
