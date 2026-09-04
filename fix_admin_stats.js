const fs = require('fs');

let js = fs.readFileSync('assets/js/pages/admin_stats.js', 'utf8');

const extraLogic = `
async function loadSystemRevenues() {
  const tQuery = query(collection(db, "transactions"), where("type", "in", ["jackpot_accumulation", "platform_revenue"]));
  const snap = await getDocs(tQuery);
  let jpKrw = 0, jpVnd = 0;
  let plKrw = 0, plVnd = 0;
  snap.forEach(d => {
     const data = d.data();
     if(data.type === 'jackpot_accumulation') {
        jpKrw += Number(data.amountKrw || 0);
        jpVnd += Number(data.amountVnd || 0);
     } else if(data.type === 'platform_revenue') {
        plKrw += Number(data.amountKrw || 0);
        plVnd += Number(data.amountVnd || 0);
     }
  });
  
  const fx = {krw: 1350, vnd: 25400}; // approx
  try{
    const r = await fetch("https://open.er-api.com/v6/latest/USD");
    const dj = await r.json();
    if(dj.result === "success") { fx.krw = dj.rates.KRW; fx.vnd = dj.rates.VND; }
  } catch(e) {}
  
  const toVnd = (vnd, krw) => { return Math.round(vnd + (krw / fx.krw) * fx.vnd); };
  
  const elJp = document.getElementById("kSysJackpot");
  const elPl = document.getElementById("kSysPlatform");
  if(elJp) elJp.textContent = toVnd(jpVnd, jpKrw).toLocaleString() + " VND";
  if(elPl) elPl.textContent = toVnd(plVnd, plKrw).toLocaleString() + " VND";
}
`;
if (!js.includes('loadSystemRevenues')) {
    js = js.replace(/async function render\(\) \{/, extraLogic + '\nasync function render() {\n  loadSystemRevenues().catch(e=>console.warn(e));');
    fs.writeFileSync('assets/js/pages/admin_stats.js', js, 'utf8');
}
console.log('done modifying admin_stats.js');
