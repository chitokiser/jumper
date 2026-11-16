// game-sponsor.js — 게임 로비 하단 소형 스폰서 배너 (홈 화면 Sponsor Banner 와 같은 데이터)
// 각 게임의 #lobbyScreen 맨 아래에만 붙어서 플레이 화면에는 보이지 않는다.
// 데이터: coupon_campaigns(status=active) + sponsorBanners(active!=false), 홈과 같은 캐시 키 공유
import { db } from '/assets/js/firebase-init.js';
import { collection, getDocs, query, where }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const CACHE_KEY = 'bc_cache_sponsor_banners';
const FALLBACK_IMG = '/assets/images/jump/logo2.png';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

function readCache() {
  try {
    const rows = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return Array.isArray(rows) && rows.length ? rows : null;
  } catch { return null; }
}

async function fetchRows() {
  const rows = [];
  try {
    const cSnap = await getDocs(query(collection(db, 'coupon_campaigns'), where('status', '==', 'active')));
    cSnap.forEach(d => {
      const c = d.data() || {};
      const price = Number(c.priceBM || 0) > 0 ? `${Number(c.priceBM).toLocaleString()} BM` : '무료 발급';
      rows.push({
        isCoupon: true,
        badge: c.issuerBadge || (c.campaignType === 'VOUCHER' ? 'VOUCHER' : 'COUPON'),
        title: c.title || '이벤트 쿠폰',
        subtitle: `${c.discountValue ? `[${c.discountValue}] ` : ''}${c.description || ''} · ${price}`,
        imageUrl: c.imageUrl || FALLBACK_IMG,
        linkUrl: '/events.html',
        sortOrder: -100,
      });
    });
  } catch { /* 무시 */ }
  try {
    const snap = await getDocs(collection(db, 'sponsorBanners'));
    snap.forEach(d => {
      const b = d.data() || {};
      if (b.active === false) return;
      rows.push({
        isCoupon: false, badge: 'SPONSOR',
        title: b.title || '스폰서', subtitle: b.subtitle || '',
        imageUrl: b.imageUrl || FALLBACK_IMG, linkUrl: b.linkUrl || '/',
        sortOrder: Number(b.sortOrder || 0),
      });
    });
  } catch { /* 무시 */ }
  rows.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  if (rows.length) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(rows)); } catch { /* 무시 */ } }
  return rows;
}

function injectCss() {
  const st = document.createElement('style');
  st.textContent = `
/* 로비 내용이 화면보다 길어질 때 위쪽이 잘리지 않게 (미지원 브라우저는 기존 center 유지) */
#lobbyScreen{justify-content:safe center}
.gsp-wrap{width:100%;max-width:320px;margin:10px auto 0;box-sizing:border-box}
.gsp-lbl{font-size:10px;color:#6b7280;letter-spacing:.08em;margin:0 0 4px 2px}
.gsp-card{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;text-decoration:none;
  background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#e5e7eb;min-height:56px}
.gsp-card img{width:44px;height:44px;border-radius:9px;object-fit:cover;flex-shrink:0;background:#111827}
.gsp-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.gsp-badge{align-self:flex-start;font-size:9px;font-weight:900;padding:1px 6px;border-radius:999px;background:#7c3aed;color:#fff}
.gsp-badge.coupon{background:#e11d48}
.gsp-t{font-size:12.5px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gsp-s{font-size:11px;color:#9ca3af;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gsp-arr{color:#9ca3af;font-size:14px;flex-shrink:0}
/* 플레이 화면: 게임 요소 아래 남는 빈 공간에만 띄움 (공간이 부족하면 숨김) */
.gsp-play{position:fixed;left:50%;transform:translateX(-50%);width:calc(100% - 24px);max-width:360px;z-index:50;box-sizing:border-box}`;
  document.head.appendChild(st);
}

function cardHtml(r) {
  const link = String(r.linkUrl || '/events.html');
  const ext = /^https?:/.test(link);
  return `<a class="gsp-card" href="${esc(link)}" ${ext ? 'target="_blank" rel="noopener"' : ''}>
    <img src="${esc(r.imageUrl || FALLBACK_IMG)}" alt="" loading="lazy" onerror="this.src='${FALLBACK_IMG}'">
    <span class="gsp-txt">
      <span class="gsp-badge${r.isCoupon ? ' coupon' : ''}">${esc(r.badge || (r.isCoupon ? 'COUPON' : 'SPONSOR'))}</span>
      <span class="gsp-t">${esc(r.title || '스폰서')}</span>
      <span class="gsp-s">${esc(r.subtitle || '')}</span>
    </span>
    <span class="gsp-arr">›</span>
  </a>`;
}

const PLAY_NEED_PX = 84; // 배너(약 66px) + 여백

/** 플레이 화면(#gameScreen)에서 마지막 게임 요소 아래 ~ 하단 메뉴 위 빈 공간을 계산 */
function freeSpace(screen, bar) {
  const barTop = bar && bar.offsetParent !== null ? bar.getBoundingClientRect().top : window.innerHeight;
  let bottom = 0;
  for (const el of screen.children) {
    if (el === bar || el.classList.contains('gsp-play')) continue;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.position === 'fixed' || st.position === 'absolute') continue;
    bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
  }
  return { top: bottom, barTop, space: barTop - bottom };
}

function mount() {
  const lobby = document.getElementById('lobbyScreen');
  if (!lobby || lobby.querySelector('.gsp-wrap')) return;
  injectCss();
  const wrap = document.createElement('div');
  wrap.className = 'gsp-wrap';
  wrap.innerHTML = '<div class="gsp-lbl">SPONSOR</div><div class="gsp-slot"></div>';
  wrap.hidden = true;
  lobby.appendChild(wrap);
  const slot = wrap.querySelector('.gsp-slot');

  // 플레이 화면 하단 빈 공간용 배너
  const screen = document.getElementById('gameScreen');
  const bar = screen?.querySelector('.arcade-bar') || null;
  let play = null;
  if (screen) {
    play = document.createElement('div');
    play.className = 'gsp-play';
    play.hidden = true;
    screen.appendChild(play);
  }
  const placePlay = () => {
    if (!play) return;
    if (!rows.length || screen.classList.contains('hidden')) { play.hidden = true; return; }
    const f = freeSpace(screen, bar);
    if (f.space < PLAY_NEED_PX) { play.hidden = true; return; }
    play.hidden = false;
    // 빈 공간의 세로 가운데에 배치
    const h = play.offsetHeight || 66;
    play.style.top = Math.round(f.top + (f.space - h) / 2) + 'px';
  };

  let rows = [], idx = 0, timer = null;
  const show = () => {
    if (!rows.length) return;
    const html = cardHtml(rows[idx % rows.length]);
    slot.innerHTML = html;
    if (play) { play.innerHTML = html; placePlay(); }
  };
  const render = list => {
    if (!list?.length) return;
    rows = list; idx = 0; wrap.hidden = false; show();
    clearInterval(timer);
    if (rows.length > 1) timer = setInterval(() => { idx++; show(); }, 6000);
  };
  render(readCache());
  fetchRows().then(render);

  // 화면 전환·크기 변경 시 위치 재계산 (가벼운 1초 주기 체크)
  const placeTimer = setInterval(placePlay, 1000);
  window.addEventListener('resize', placePlay);
  if (screen) new MutationObserver(placePlay).observe(screen, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('pagehide', () => { clearInterval(timer); clearInterval(placeTimer); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
else mount();
