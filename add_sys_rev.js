const fs = require('fs');

let html = fs.readFileSync('admin_stats.html', 'utf8');

const newStatsPanel = `
      <div class="panel" style="margin-top:20px;">
        <div class="ph">
          <h2 class="pt">잭팟 및 수익 수수료 (Jackpot & Platform)</h2>
          <span class="pm">플랫폼에서 발생한 수수료 적립 현황 (VND 자동 환산)</span>
        </div>
        <div class="kpi-grid">
          <div class="kpi">
            <div class="k">플랫폼 누적 수익(Platform Revenue)</div>
            <div class="v" id="kSysPlatform">-</div>
            <div class="s">수수료의 40% 누적</div>
          </div>
          <div class="kpi">
            <div class="k">잭팟 누적 풀(Jackpot Accum.)</div>
            <div class="v" id="kSysJackpot">-</div>
            <div class="s">수수료의 30% 누적액</div>
          </div>
        </div>
      </div>
`;
if (!html.includes('kSysPlatform')) {
    html = html.replace(/<div class="panel" style="margin-top:20px;">/, newStatsPanel + '<div class="panel" style="margin-top:20px;">');
    fs.writeFileSync('admin_stats.html', html, 'utf8');
}

let js = fs.readFileSync('assets/js/pages/admin_stats.js', 'utf8');
if (!js.includes('SYSTEM_PLATFORM')) {
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
  
  const toVnd = (vnd, krw) => { return Math.round(vnd + krw / fx.krw * fx.vnd); };
  
  const elJp = document.getElementById("kSysJackpot");
  const elPl = document.getElementById("kSysPlatform");
  if(elJp) elJp.textContent = toVnd(jpVnd, jpKrw).toLocaleString() + " VND";
  if(elPl) elPl.textContent = toVnd(plVnd, plKrw).toLocaleString() + " VND";
}
`;
    // Insert after DOMContentLoaded or async function block
    js = js.replace(/async function loadStats\(\) \{/, extraLogic + '\nasync function loadStats() {\n  loadSystemRevenues().catch(e=>console.warn(e));');
    fs.writeFileSync('assets/js/pages/admin_stats.js', js, 'utf8');
}

console.log("added dashboard system revenues");
