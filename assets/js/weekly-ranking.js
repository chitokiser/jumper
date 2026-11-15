// weekly-ranking.js — 수박게임·2048 주간 랭킹 보드 / 점수 접수 / 홍보 카드
// 데이터: weekly_rankings/{gameType}_{weekId}/entries (서버 전용 쓰기), weekly_settlements
// 주간 기준: 베트남 시간 일요일 00:00 마감 (서버 functions/handlers/weeklyRanking.js 와 동일 계산)
import { db, functions } from '/assets/js/firebase-init.js';
import { collection, doc, getDoc, getDocs, query, orderBy, limit }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

const VN_OFFSET_MS = 7 * 3600 * 1000;
const DAY_MS = 86400 * 1000;
const WEEK_MS = 7 * DAY_MS;
const PRIZE_STEP = 5_000_000;

export const WEEKLY_GAMES = {
  suika:    { label: '수박게임', icon: '🍉', href: '/suika.html' },
  game2048: { label: '2048',    icon: '🔢', href: '/2048.html' },
};

export const prizeForRank = r => (r >= 1 && r <= 10) ? (11 - r) * PRIZE_STEP : 0;

export function weekInfo(ms = Date.now()) {
  const vn = ms + VN_OFFSET_MS;
  const dayStart = Math.floor(vn / DAY_MS) * DAY_MS;
  const startVn = dayStart - new Date(dayStart).getUTCDay() * DAY_MS;
  const startsAt = startVn - VN_OFFSET_MS;
  return { weekId: new Date(startVn).toISOString().slice(0, 10), startsAt, endsAt: startsAt + WEEK_MS };
}

const fmtGp = n => n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString()}백만` : n.toLocaleString();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

function countdownText(endsAt) {
  let s = Math.max(0, Math.floor((endsAt - Date.now()) / 1000));
  const d = Math.floor(s / 86400); s %= 86400;
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60);
  return d > 0 ? `${d}일 ${h}시간 ${m}분` : `${h}시간 ${m}분 ${s % 60}초`;
}

let _cssDone = false;
function injectCss() {
  if (_cssDone) return; _cssDone = true;
  const st = document.createElement('style');
  st.textContent = `
.wr-box{background:linear-gradient(160deg,#1e1b4b,#0f172a);border:1px solid #6366f1;border-radius:14px;padding:12px 14px;color:#e5e7eb;font-size:13px;width:100%;box-sizing:border-box}
.wr-hd{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}
.wr-t{font-weight:900;font-size:15px;color:#fde047}
.wr-cd{font-size:11px;color:#a5b4fc;text-align:right}
.wr-prize{font-size:11px;color:#c7d2fe;margin-bottom:8px;line-height:1.5}
.wr-row{display:flex;align-items:center;gap:8px;padding:4px 0;border-top:1px solid rgba(255,255,255,.06)}
.wr-rk{width:22px;text-align:center;font-weight:900}
.wr-nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wr-sc{font-weight:800;color:#fbbf24;min-width:56px;text-align:right}
.wr-gp{font-size:10px;color:#86efac;min-width:52px;text-align:right}
.wr-me{background:rgba(250,204,21,.12);border-radius:6px}
.wr-empty{color:#9ca3af;text-align:center;padding:8px 0}
.wr-last{margin-top:8px;font-size:11px;color:#a5b4fc}
.wr-msg{margin-top:6px;font-size:12px;color:#fde047;text-align:center}
.wr-promo{display:block;text-decoration:none;background:linear-gradient(120deg,#4c1d95,#1e3a8a 55%,#065f46);color:#fff;border-radius:16px;padding:16px 18px;margin:14px 0;box-shadow:0 6px 20px rgba(76,29,149,.3)}
.wr-promo h3{margin:0 0 4px;font-size:18px;font-weight:900;color:#fde047}
.wr-promo p{margin:0 0 10px;font-size:13px;color:#e0e7ff;line-height:1.5}
.wr-promo-games{display:flex;gap:8px;flex-wrap:wrap}
.wr-promo-g{flex:1;min-width:140px;background:rgba(0,0,0,.25);border-radius:10px;padding:8px 10px;font-size:12px;color:#fff;text-decoration:none}
.wr-promo-g b{color:#fde047}
.wr-promo-cd{margin-top:8px;font-size:12px;color:#c7d2fe}`;
  document.head.appendChild(st);
}

export async function fetchTop(gameType, weekId) {
  const q = query(
    collection(db, 'weekly_rankings', `${gameType}_${weekId}`, 'entries'),
    orderBy('bestScore', 'desc'), limit(30));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }))
    .filter(e => (e.bestScore || 0) > 0)
    .sort((a, b) => (b.bestScore - a.bestScore) || ((a.achievedAt || 0) - (b.achievedAt || 0)))
    .slice(0, 10);
}

export async function fetchLastSettlement(gameType) {
  const last = weekInfo(Date.now() - WEEK_MS).weekId;
  const s = await getDoc(doc(db, 'weekly_settlements', `${gameType}_${last}`));
  return s.exists() ? s.data() : null;
}

/** 게임 로비용 주간 TOP10 보드 */
export function mountWeeklyBoard(el, gameType, { getUid = () => null } = {}) {
  if (!el || !WEEKLY_GAMES[gameType]) return { refresh() {}, showMessage() {} };
  injectCss();
  const g = WEEKLY_GAMES[gameType];
  el.innerHTML = `
    <div class="wr-box">
      <div class="wr-hd"><div class="wr-t">🏆 ${g.label} 주간 토너먼트</div><div class="wr-cd" data-cd></div></div>
      <div class="wr-prize">매주 일요일 00:00(베트남 시간) 마감 · TOP10 GP 자동 지급<br>
        🥇 5,000만 · 🥈 4,500만 · 🥉 4,000만 … 10위 500만 GP · 참가비 낸 판만 집계</div>
      <div data-list><div class="wr-empty">불러오는 중…</div></div>
      <div class="wr-msg" data-msg hidden></div>
      <div class="wr-last" data-last></div>
    </div>`;
  const listEl = el.querySelector('[data-list]');
  const cdEl = el.querySelector('[data-cd]');
  const msgEl = el.querySelector('[data-msg]');
  const lastEl = el.querySelector('[data-last]');

  const tick = () => { cdEl.textContent = `마감까지 ${countdownText(weekInfo().endsAt)}`; };
  tick();
  const timer = setInterval(tick, 1000);

  async function refresh() {
    const wk = weekInfo();
    try {
      const rows = await fetchTop(gameType, wk.weekId);
      const me = getUid();
      listEl.innerHTML = rows.length ? rows.map((r, i) => `
        <div class="wr-row${r.uid === me ? ' wr-me' : ''}">
          <span class="wr-rk">${['🥇','🥈','🥉'][i] || i + 1}</span>
          <span class="wr-nm">${esc(r.displayName || 'Player')}</span>
          <span class="wr-sc">${(r.bestScore || 0).toLocaleString()}</span>
          <span class="wr-gp">${fmtGp(prizeForRank(i + 1))}</span>
        </div>`).join('')
        : '<div class="wr-empty">이번 주 첫 기록의 주인공이 되어보세요!</div>';
    } catch {
      listEl.innerHTML = '<div class="wr-empty">랭킹을 불러오지 못했습니다.</div>';
    }
    try {
      const last = await fetchLastSettlement(gameType);
      if (last?.winners?.length) {
        const w = last.winners[0];
        lastEl.textContent = `지난주(${last.weekId}) 우승: ${w.displayName || 'Player'} · ${Number(w.bestScore).toLocaleString()}점 · ${fmtGp(w.prizeGp)} GP 지급 완료`;
      } else lastEl.textContent = '';
    } catch { lastEl.textContent = ''; }
  }
  refresh();

  return {
    refresh,
    showMessage(text) { msgEl.hidden = !text; msgEl.textContent = text || ''; },
    destroy() { clearInterval(timer); },
  };
}

/** 참가비 낸 판의 최종 점수를 주간 랭킹에 접수 (서버가 1판 1회만 허용) */
export async function submitWeeklyScore(gameType, score) {
  try {
    const res = await httpsCallable(functions, 'submitWeeklyScore')({ gameType, score });
    return res.data || {};
  } catch (e) {
    return { accepted: false, error: e?.message || String(e) };
  }
}

/** 이벤트·게임 목록 페이지용 홍보 카드 */
export function mountWeeklyPromo(el) {
  if (!el) return;
  injectCss();
  el.innerHTML = `
    <div class="wr-promo">
      <h3>🏆 주간 게임 토너먼트 · 게임별 총상금 2억 7,500만 GP</h3>
      <p>수박게임과 2048에서 이번 주 최고 점수를 겨루세요! 매주 일요일 00:00(베트남 시간)에 마감하고
        각 게임 TOP10에게 GP를 자동 지급합니다. 1위 5,000만 GP부터 10위 500만 GP까지.</p>
      <div class="wr-promo-games">
        ${Object.entries(WEEKLY_GAMES).map(([k, g]) => `
          <a class="wr-promo-g" href="${g.href}">${g.icon} <b>${g.label}</b><br><span data-top="${k}">현재 1위 불러오는 중…</span></a>`).join('')}
      </div>
      <div class="wr-promo-cd" data-cd></div>
    </div>`;
  const cdEl = el.querySelector('[data-cd]');
  const tick = () => { cdEl.textContent = `⏰ 이번 주 마감까지 ${countdownText(weekInfo().endsAt)}`; };
  tick(); setInterval(tick, 1000);
  const wk = weekInfo().weekId;
  for (const k of Object.keys(WEEKLY_GAMES)) {
    const span = el.querySelector(`[data-top="${k}"]`);
    fetchTop(k, wk).then(rows => {
      span.textContent = rows[0]
        ? `현재 1위 ${rows[0].displayName || 'Player'} · ${rows[0].bestScore.toLocaleString()}점`
        : '아직 기록 없음 — 지금 1위에 도전!';
    }).catch(() => { span.textContent = '지금 도전하기 →'; });
  }
}
