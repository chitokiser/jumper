// /games.html — 게임모음 + 트레져헌터 랭킹
// 랭킹 로직은 merchants.js 의 트레져헌터 랭킹과 동일 (battle_players, 5분 로컬캐시 공유)
import { auth, db } from '/assets/js/firebase-init.js';
import { collection, getDocs, query, where, orderBy, limit }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { weekInfo, fetchTop, fetchLastSettlement, prizeForRank } from '/assets/js/weekly-ranking.js';

const FIELD = { gp: 'gold' };
const LABEL = { gp: 'GP', suika: '점', game2048: '점' };
// 수이카·2048 탭 = 이번 주 토너먼트 랭킹 (weekly_rankings, 일요일 00:00 VN 마감)
const WEEKLY_TABS = ['suika', 'game2048'];
const RANK_TTL = 5 * 60 * 1000;
const cache = { gp: null, suika: null, game2048: null };
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

async function loadWeeklyRanking(tab) {
  const list = $('hunterRankList');
  const note = $('hunterRankNote');
  list.innerHTML = '<div class="hunter-rank-loading">Loading...</div>';
  if (note) { note.style.display = 'block'; note.textContent = '이번 주 기록 · 매주 일요일 00:00(베트남 시간) 마감 · TOP10 GP 자동 지급 (1위 5,000만 ~ 10위 500만 GP)'; }
  try {
    const rows = (await fetchTop(tab, weekInfo().weekId)).map(e => ({
      uid: e.uid, val: e.bestScore || 0, displayName: e.displayName || null, photoURL: null, gsLevel: null,
    }));
    cache[tab] = rows;
    if (tab === currentTab) render(rows, tab);
  } catch {
    if (tab === currentTab) list.innerHTML = '<div class="hunter-rank-empty">랭킹을 불러오지 못했습니다.</div>';
  }
  // 지난주 확정 결과 (마감 즉시 정산되어 표시)
  try {
    const last = await fetchLastSettlement(tab);
    if (tab === currentTab && note && last?.winners?.length) {
      const top3 = last.winners.slice(0, 3).map(w => `${w.rank}위 ${w.displayName || 'Player'} (${Number(w.bestScore).toLocaleString()}점, ${Number(w.prizeGp).toLocaleString()} GP)`).join(' · ');
      note.textContent += ` | 지난주(${last.weekId}) 확정: ${top3}`;
    }
  } catch { /* 무시 */ }
}

async function loadRanking(tab) {
  const list = $('hunterRankList');
  if (!list) return;
  if (WEEKLY_TABS.includes(tab)) return loadWeeklyRanking(tab);
  const note = $('hunterRankNote');
  if (note) note.style.display = 'none';
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
      <div class="hunter-rank-name">${r.gsLevel ? `Lv.${Number(r.gsLevel) || 1} ` : ''}${name}</div>
      <div>
        <div class="hunter-rank-score">${Number(r.val || 0).toLocaleString()}</div>
        <div class="hunter-rank-sub">${WEEKLY_TABS.includes(tab) ? `${LABEL[tab]} · 🎁 ${prizeForRank(i + 1).toLocaleString()} GP` : LABEL[tab]}</div>
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
