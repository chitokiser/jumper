const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

const rankingRegex = /<h2 class="section-title" data-i18n="sec_ranking">[\s\S]*?<!-- ── 인기 가맹점\/아이템 ── -->/i;
const newRankingStr = `<h2 class="section-title">💎 K-MOA 잭팟 명예의 전당 💎</h2>
    <div style="background:var(--surface,#fff); border:1px solid var(--border,#e5e7eb); border-radius:14px; padding:16px; margin-bottom:40px;">
      <div id="jackpotRankingList" class="ranking-list" style="max-height: 400px; overflow-y: auto;">
        <div class="ranking-loading">잭팟 당첨자를 불러오고 있습니다...</div>
      </div>
    </div>

    <!-- ── 인기 가맹점/아이템 ── -->`;

html = html.replace(rankingRegex, newRankingStr);
fs.writeFileSync('index.html', html, 'utf8');
console.log('Ranking HTML replaced');
