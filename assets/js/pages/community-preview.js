// /assets/js/pages/community-preview.js
// index.html 소셜 커뮤니티 미리보기 (최대 4개)

import { getApps, initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getFirestore, collection, query,
  where, orderBy, limit, getDocs }
  from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { firebaseConfig } from '/assets/js/firebase-config.js';

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ── 헬퍼 ──────────────────────────────────────────────────────
const DAY_KO = ['일','월','화','수','목','금','토'];

function fmtSchedule(d) {
  if (!d.scheduleType || d.scheduleType === 'once') {
    if (!d.eventDate) return '-';
    const dt = d.eventDate.toDate ? d.eventDate.toDate() : new Date(d.eventDate);
    return dt.toLocaleDateString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
  }
  const time = d.scheduleTime || '';
  if (d.scheduleType === 'daily') return `매일 ${time}`;
  if (d.scheduleType === 'weekly') {
    const days = (d.scheduleDays || []).slice().sort((a,b)=>a-b).map(n=>DAY_KO[n]).join('·');
    return `매주 ${days} ${time}`;
  }
  return '-';
}

function getStatus(d) {
  if (d.scheduleType === 'daily' || d.scheduleType === 'weekly') return 'ongoing';
  if (!d.eventDate) return 'upcoming';
  const dt   = d.eventDate.toDate ? d.eventDate.toDate() : new Date(d.eventDate);
  const diff = (dt - new Date()) / 3600000;
  if (diff > 0)   return 'upcoming';
  if (diff > -24) return 'ongoing';
  return 'past';
}

function statusLabel(s) {
  return { upcoming:'예정', ongoing:'진행 중', past:'종료' }[s] || s;
}

function thumbPh() {
  const ph = document.createElement('div');
  ph.className = 'comm-preview-thumb-ph';
  ph.textContent = '🎉';
  return ph;
}

function buildCard(d) {
  const status = getStatus(d);
  const card = document.createElement('a');
  card.className = 'comm-preview-card';
  card.href = '/events.html';

  // 썸네일
  if (d.photoUrl) {
    const img = document.createElement('img');
    img.className = 'comm-preview-thumb';
    img.src = d.photoUrl;
    img.alt = d.name || '';
    img.loading = 'lazy';
    img.onerror = () => img.replaceWith(thumbPh());
    card.appendChild(img);
  } else {
    card.appendChild(thumbPh());
  }

  // 본문
  const body = document.createElement('div');
  body.className = 'comm-preview-body';

  const badge = document.createElement('span');
  badge.className = `comm-preview-badge comm-preview-badge--${status}`;
  badge.textContent = statusLabel(status);

  const title = document.createElement('div');
  title.className = 'comm-preview-title';
  title.textContent = d.name || '';

  const date = document.createElement('div');
  date.className = 'comm-preview-date';
  date.textContent = fmtSchedule(d);

  if (d.location) {
    const loc = document.createElement('div');
    loc.className = 'comm-preview-loc';
    loc.textContent = `📍 ${d.location}`;
    body.append(badge, title, date, loc);
  } else {
    body.append(badge, title, date);
  }

  card.appendChild(body);
  return card;
}

const DEFAULT_COMMUNITY_EVENTS = [
  {
    id: 'seed_1',
    name: 'OceanPark K-Food 페스티벌',
    scheduleType: 'weekly',
    scheduleDays: [5, 6],
    scheduleTime: '18:00',
    location: 'OceanPark 그랜드 플라자',
    photoUrl: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=400&q=80'
  },
  {
    id: 'seed_2',
    name: '주말 버스킹 & 럭키드로우',
    scheduleType: 'weekly',
    scheduleDays: [0, 6],
    scheduleTime: '19:30',
    location: '센트럴 파크 야외무대',
    photoUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=400&q=80'
  },
  {
    id: 'seed_3',
    name: '베스트클럽 가맹점 특별 할인전',
    scheduleType: 'daily',
    scheduleTime: '매일',
    location: '전 가맹점 매장',
    photoUrl: 'https://images.unsplash.com/photo-1556742049-0a67e557224f?w=400&q=80'
  }
];

// ── 이벤트 쿠폰 & 바우쳐 라운지 미리보기 (2026-10-19: 회원 혜택 → 쿠폰·바우쳐로 교체) ──
// events.html 라운지와 같은 coupon_campaigns 컬렉션의 '진행 중(active)' 항목만, 최신순 최대 4개
function couponThumbPh(isVoucher) {
  const ph = document.createElement('div');
  ph.className = 'comm-preview-thumb-ph';
  ph.textContent = isVoucher ? '🍽️' : '🎟️';
  return ph;
}
function buildCouponCard(c) {
  const isVoucher = c.campaignType === 'VOUCHER';
  const price = Number(c.priceBM || 0);
  const remaining = Math.max(0, Number(c.totalQuantity || 0) - Number(c.issuedQuantity || 0));
  const card = document.createElement('a');
  card.className = 'comm-preview-card';
  card.href = '/events.html';
  if (c.imageUrl) {
    const img = document.createElement('img');
    img.className = 'comm-preview-thumb';
    img.src = c.imageUrl;
    img.alt = c.title || '';
    img.loading = 'lazy';
    img.onerror = () => img.replaceWith(couponThumbPh(isVoucher));
    card.appendChild(img);
  } else {
    card.appendChild(couponThumbPh(isVoucher));
  }
  const body = document.createElement('div');
  body.className = 'comm-preview-body';
  const badge = document.createElement('span');
  badge.className = 'comm-preview-badge comm-preview-badge--ongoing';
  badge.textContent = isVoucher ? '🍽️ 바우쳐' : '🎟️ 할인 쿠폰';
  const title = document.createElement('div');
  title.className = 'comm-preview-title';
  title.textContent = c.title || '';
  const info = document.createElement('div');
  info.className = 'comm-preview-date';
  info.textContent = `${price === 0 ? '무료' : price.toLocaleString() + ' BM'} · 혜택 ${c.discountValue || '-'} · 남은 ${remaining.toLocaleString()}장`;
  const issuer = document.createElement('div');
  issuer.className = 'comm-preview-loc';
  issuer.textContent = `🏪 ${c.issuerNameSnapshot || '공식 가맹점'}`;
  body.append(badge, title, info, issuer);
  card.appendChild(body);
  return card;
}
function renderCouponCards(grid, list) {
  if (!grid) return;
  grid.innerHTML = '';
  if (!list || list.length === 0) {
    grid.innerHTML = '<div class="comm-preview-empty">진행 중인 쿠폰·바우쳐가 없습니다. <a href="/events.html">라운지 바로가기 →</a></div>';
    return;
  }
  list.slice(0, 4).forEach(c => grid.appendChild(buildCouponCard(c)));
}
const _ts = (v) => (v?.toMillis ? v.toMillis() : new Date(v || 0).getTime()) || 0;

async function loadCommunityPreview() {
  const grid = document.getElementById('communityPreviewGrid');
  if (!grid) return;

  // 1) 직전 방문 캐시로 즉시 표시
  try {
    const raw = localStorage.getItem('bc_cache_home_coupons');
    const cached = raw ? JSON.parse(raw) : null;
    if (cached?.length) renderCouponCards(grid, cached);
  } catch (_) {}

  // 2) 최신 데이터로 갱신
  try {
    const snap = await getDocs(query(collection(db, 'coupon_campaigns'), where('status', '==', 'active')));
    const list = snap.docs.map(d => {
      const x = d.data();
      return { id: d.id, title: x.title, campaignType: x.campaignType, priceBM: x.priceBM, discountValue: x.discountValue,
        totalQuantity: x.totalQuantity, issuedQuantity: x.issuedQuantity, issuerNameSnapshot: x.issuerNameSnapshot,
        imageUrl: x.imageUrl, createdAt: _ts(x.createdAt) };
    }).sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
    renderCouponCards(grid, list);
    try { localStorage.setItem('bc_cache_home_coupons', JSON.stringify(list)); } catch (_) {}
  } catch (err) {
    console.warn('[home-coupons] 쿠폰·바우쳐 조회 실패:', err?.message || err);
    if (!grid.querySelector('.comm-preview-card')) renderCouponCards(grid, []);
  }
}

loadCommunityPreview();
