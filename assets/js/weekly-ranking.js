// weekly-ranking.js — 수박게임·2048 주간 랭킹 보드 / 점수 접수 / 홍보 카드
// 데이터: weekly_rankings/{gameType}_{weekId}/entries (서버 전용 쓰기), weekly_settlements
// 주간 기준: 베트남 시간 일요일 00:00 마감 (서버 functions/handlers/weeklyRanking.js 와 동일 계산)
import { db, functions } from '/assets/js/firebase-init.js';
import { collection, doc, getDoc, getDocs, setDoc, query, orderBy, limit }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

const VN_OFFSET_MS = 7 * 3600 * 1000;
const DAY_MS = 86400 * 1000;
const WEEK_MS = 7 * DAY_MS;
const DEFAULT_PRIZE_STEP = 500_000;

export const WEEKLY_GAMES = {
  billiards: { label: '베스트당구장', icon: '🎱', href: '/billiards.html', tier: '👑 최고 티어 (S)', prizeStep: 5_000_000 }, // 1위 5,000만 ~ 10위 500만 GP (총 2억 7,500만 GP)
  tetris:    { label: '네온테트리스', icon: '🧱', href: '/tetris.html',    tier: '🔥 상급 티어 (A)', prizeStep: 500_000   }, // 1위 500만 ~ 10위 50만 GP (총 2,750만 GP)
  game2048:  { label: '2048',        icon: '🔢', href: '/2048.html',      tier: '⚡ 중상 티어 (B)', prizeStep: 300_000   }, // 1위 300만 ~ 10위 30만 GP (총 1,650만 GP)
  suika:     { label: '수박게임',     icon: '🍉', href: '/suika.html',     tier: '🎯 중급 티어 (C)', prizeStep: 200_000   }, // 1위 200만 ~ 10위 20만 GP (총 1,100만 GP)
  bankpanic: { label: '뱅크패닉',     icon: '🤠', href: '/bankpanic.html', tier: '🔫 캐주얼 티어 (D)', prizeStep: 100_000 }, // 1위 100만 ~ 10위 10만 GP (총 550만 GP)
};

export const prizeForRank = (r, gameType) => {
  if (r < 1 || r > 10) return 0;
  const step = WEEKLY_GAMES[gameType]?.prizeStep || DEFAULT_PRIZE_STEP;
  return (11 - r) * step;
};

export const totalWeeklyPrize = (gameType) => 55 * (WEEKLY_GAMES[gameType]?.prizeStep || DEFAULT_PRIZE_STEP);

export function weekInfo(ms = Date.now()) {
  const vn = ms + VN_OFFSET_MS;
  const dayStart = Math.floor(vn / DAY_MS) * DAY_MS;
  const startVn = dayStart - new Date(dayStart).getUTCDay() * DAY_MS;
  const startsAt = startVn - VN_OFFSET_MS;
  return { weekId: new Date(startVn).toISOString().slice(0, 10), startsAt, endsAt: startsAt + WEEK_MS };
}

export const fmtGp = n => {
  if (n >= 100_000_000) {
    const eok = Math.floor(n / 100_000_000);
    const man = Math.round((n % 100_000_000) / 10_000);
    return man > 0 ? `${eok}억 ${man.toLocaleString()}만` : `${eok}억`;
  }
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString()}만`;
  return n.toLocaleString();
};
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
.wr-av{width:22px;height:22px;border-radius:50%;object-fit:cover;flex-shrink:0;background:#312e81;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#c7d2fe}
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
.wr-promo-tier{display:inline-block;font-size:10px;font-weight:800;color:#86efac;background:rgba(0,0,0,.35);padding:2px 6px;border-radius:6px;margin-top:2px;margin-bottom:3px}
.wr-promo-cd{margin-top:8px;font-size:12px;color:#c7d2fe}`;
  document.head.appendChild(st);
}

/** 로그인한 본인의 구글 이름·사진을 battle_players 에 맞춰 둔다 (랭킹 표시용, 이메일 저장 안 함) */
export async function syncMyProfile(user) {
  if (!user?.uid) return;
  const displayName = user.displayName ? String(user.displayName).slice(0, 20) : null;
  const photoURL = user.photoURL || null;
  if (!displayName && !photoURL) return;
  try {
    const ref = doc(db, 'battle_players', user.uid);
    const cur = (await getDoc(ref)).data() || {};
    const patch = {};
    if (displayName && cur.displayName !== displayName) patch.displayName = displayName;
    if (photoURL && cur.photoURL !== photoURL) patch.photoURL = photoURL;
    if (Object.keys(patch).length) await setDoc(ref, patch, { merge: true });
  } catch { /* 표시용 — 실패해도 무시 */ }
}

/** 랭킹 행에 프로필(battle_players 의 구글 이름·사진)을 채운다 */
export async function withProfiles(rows) {
  const snaps = await Promise.all(rows.map(r =>
    getDoc(doc(db, 'battle_players', r.uid)).catch(() => null)));
  return rows.map((r, i) => {
    const b = snaps[i]?.data?.() || {};
    return { ...r, displayName: b.displayName || r.displayName, photoURL: b.photoURL || r.photoURL || null };
  });
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
  const p1 = fmtGp(prizeForRank(1, gameType));
  const p2 = fmtGp(prizeForRank(2, gameType));
  const p3 = fmtGp(prizeForRank(3, gameType));
  const p10 = fmtGp(prizeForRank(10, gameType));
  const pTotal = fmtGp(totalWeeklyPrize(gameType));
  el.innerHTML = `
    <div class="wr-box">
      <div class="wr-hd"><div class="wr-t">🏆 ${g.label} 주간 토너먼트 <small style="font-size:11px;color:#86efac">${g.tier}</small></div><div class="wr-cd" data-cd></div></div>
      <div class="wr-prize">매주 일요일 00:00(베트남 시간) 마감 · TOP10 총 <b>${pTotal} GP</b> 자동 지급<br>
        🥇 ${p1} · 🥈 ${p2} · 🥉 ${p3} … 10위 ${p10} GP · 참가비 낸 판만 집계</div>
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
      const rows = await withProfiles(await fetchTop(gameType, wk.weekId));
      const me = getUid();
      listEl.innerHTML = rows.length ? rows.map((r, i) => `
        <div class="wr-row${r.uid === me ? ' wr-me' : ''}">
          <span class="wr-rk">${['🥇','🥈','🥉'][i] || i + 1}</span>
          ${r.photoURL ? `<img class="wr-av" src="${esc(r.photoURL)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="wr-av">${esc((r.displayName || '?')[0])}</span>`}
          <span class="wr-nm">${esc(r.displayName || 'Player')}</span>
          <span class="wr-sc">${(r.bestScore || 0).toLocaleString()}</span>
          <span class="wr-gp">${fmtGp(prizeForRank(i + 1, gameType))}</span>
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
      <h3>🏆 주간 게임 토너먼트 · 난이도별 티어 차등 GP 보상</h3>
      <p>👑 최고 티어 <b>베스트당구장(1위 5,000만 GP · 총 2억 7,500만 GP)</b>부터 네온테트리스(1위 500만 GP) · 2048(1위 300만 GP) · 수박게임(1위 200만 GP) · 뱅크패닉(1위 100만 GP)까지! 매주 일요일 00:00(베트남 시간) 마감 후 각 게임 TOP10에게 GP를 자동 지급합니다.</p>
      <div class="wr-promo-games">
        ${Object.entries(WEEKLY_GAMES).map(([k, g]) => `
          <a class="wr-promo-g" href="${g.href}">
            ${g.icon} <b>${g.label}</b><br>
            <span class="wr-promo-tier">${g.tier} · 1위 ${fmtGp(prizeForRank(1, k))} GP</span><br>
            <span data-top="${k}">현재 1위 불러오는 중…</span>
          </a>`).join('')}
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
