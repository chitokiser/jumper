const fs = require('fs');
let js = fs.readFileSync('assets/js/pages/index.js', 'utf8');

// Replace renderCategoryRanking and renderGuideLeaderboard logic
const regex = /renderCategoryRanking\(items\);[\s\S]*?renderGuideLeaderboard\(items\);/i;
js = js.replace(regex, `loadJackpotRanking();\n  `);

const fnRegex = /function renderCategoryRanking.*?function renderGuideLeaderboard.*?}/is;

const jackpotLogic = `
async function loadJackpotRanking() {
  const { collection, query, orderBy, limit, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js");
  const el = document.getElementById("jackpotRankingList");
  if (!el) return;
  
  try {
    const q = query(collection(db, "jackpot_wins"), orderBy("amountVnd", "desc"), limit(20));
    const snap = await getDocs(q);
    
    if (snap.empty) {
      el.innerHTML = '<div class="ranking-empty">아직 잭팟 당첨자가 없습니다. 첫 당첨자가 되어보세요!</div>';
      return;
    }
    
    let html = '';
    let rank = 1;
    snap.forEach(docS => {
      const d = docS.data();
      const amount = (d.amountVnd || 0).toLocaleString();
      const rawName = d.userName || 'K-MOA User';
      const name = rawName.length > 2 ? rawName.substring(0, 1) + '*' + rawName.substring(2) : rawName.substring(0, 1) + '*';
      const date = d.timestamp ? new Date(d.timestamp.seconds * 1000).toLocaleDateString() : '';
      
      let rankClass = 'ranking-num';
      if (rank === 1) rankClass += ' gold';
      else if (rank === 2) rankClass += ' silver';
      else if (rank === 3) rankClass += ' bronze';
      
      html += \`
        <div class="ranking-row">
          <div class="\${rankClass}">\${rank}</div>
          <div style="flex:1;">
            <div style="font-size:0.9rem;font-weight:600;color:var(--text);">\${name}</div>
            <div style="font-size:0.75rem;color:var(--muted);">\${date} 당첨</div>
          </div>
          <div style="font-weight:700;color:#f59e0b;font-size:0.95rem;">
            \${amount} KM
          </div>
        </div>
      \`;
      rank++;
    });
    
    el.innerHTML = html;
  } catch (e) {
    console.error(e);
    el.innerHTML = '<div class="ranking-empty">랭킹을 불러올 수 없습니다.</div>';
  }
}
`;

js += '\n' + jackpotLogic;

fs.writeFileSync('assets/js/pages/index.js', js, 'utf8');
console.log('index.js logic added');
