// /games.html — 게임모음 + 트레져헌터 랭킹
// 랭킹 로직은 merchants.js 의 트레져헌터 랭킹과 동일 (battle_players, 5분 로컬캐시 공유)
import { auth, db } from '/assets/js/firebase-init.js';
import { collection, getDocs, query, where, orderBy, limit }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

const FIELD = { gp: 'gold', monsters: 'monstersKilled', treasures: 'treasuresFound' };
const LABEL = { gp: 'GP', monsters: 'kills', treasures: 'found' };
const RANK_TTL = 5 * 60 * 1000;
const cache = { gp: null, monsters: null, treasures: null };
let currentTab = 'gp';
let myUid = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loadCache(tab) {
  try {
    const raw = localStorage.getItem(`hunterRank_${tab}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    return Date.now() - ts < RANK_TTL ? data : null;
  } catch { return null; }
}
function saveCache(tab, rows) {
  try { localStorage.setItem(`hunterRank_${tab}`, JSON.stringify({ data: rows, ts: Date.now() })); } catch { /* 무시 */ }
}

async function loadRanking(tab) {
  const list = $('hunterRankList');
  if (!list) return;
  if (cache[tab]) return render(cache[tab], tab);
  const cached = loadCache(tab);
  if (cached) { cache[tab] = cached; return render(cached, tab); }

  list.innerHTML = '<div class="hunter-rank-loading">Loading...</div>';
  try {
    const field = FIELD[tab];
    const snap = await Promise.race([
      getDocs(query(collection(db, 'battle_players'), where(field, '>', 0), orderBy(field, 'desc'), limit(10))),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
    ]);
    const rows = [];
    snap.forEach(d => {
      const data = d.data();
      rows.push({ uid: d.id, val: data[field] || 0, displayName: data.displayName || null, photoURL: data.photoURL || null, gsLevel: data.gsLevel || data.level || 1 });
    });
    cache[tab] = rows;
    saveCache(tab, rows);
    if (tab === currentTab) render(rows, tab);
  } catch {
    if (tab === currentTab) list.innerHTML = '<div class="hunter-rank-empty">Failed to load ranking.</div>';
  }
}

function render(rows, tab) {
  const list = $('hunterRankList');
  if (!list) return;
  if (!rows.length) {
    list.innerHTML = '<div class="hunter-rank-empty">No data yet. Be the first!</div>';
    return;
  }
  const medal = ['gold', 'silver', 'bronze'];
  list.innerHTML = rows.map((r, i) => {
    const name = esc(r.displayName || r.uid.slice(0, 8) + '…');
    const avatar = r.photoURL ? `<img src="${esc(r.photoURL)}" alt="" loading="lazy">` : (name[0] || '?').toUpperCase();
    return `<div class="hunter-rank-row${r.uid === myUid ? ' me' : ''}">
      <div class="hunter-rank-num ${medal[i] || ''}">${i + 1}</div>
      <div class="hunter-rank-avatar">${avatar}</div>
      <div class="hunter-rank-name">Lv.${Number(r.gsLevel) || 1} ${name}</div>
      <div>
        <div class="hunter-rank-score">${Number(r.val || 0).toLocaleString()}</div>
        <div class="hunter-rank-sub">${LABEL[tab]}</div>
      </div>
    </div>`;
  }).join('');
}

function init() {
  const section = $('hunterRankSection');
  if (!section) return;
  section.querySelectorAll('.hunter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      section.querySelectorAll('.hunter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTab = btn.dataset.tab;
      loadRanking(currentTab);
    });
  });
  loadRanking(currentTab);
  onAuthStateChanged(auth, (user) => {
    myUid = user?.uid || null;
    if (cache[currentTab]) render(cache[currentTab], currentTab);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
