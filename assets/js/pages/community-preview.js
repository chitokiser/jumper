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

// ── 로드 ──────────────────────────────────────────────────────
function renderEventCards(grid, list) {
  if (!grid) return;
  grid.innerHTML = '';
  if (!list || list.length === 0) {
    grid.innerHTML = '<div class="comm-preview-empty">등록된 행사가 없습니다.</div>';
    return;
  }
  list.slice(0, 4).forEach(e => grid.appendChild(buildCard(e)));
}

async function loadCommunityPreview() {
  const grid = document.getElementById('communityPreviewGrid');
  if (!grid) return;

  // 1) 0초 즉시 캐시 / 기본값 렌더링
  let cached = null;
  try {
    const raw = localStorage.getItem('bc_cache_community_events');
    if (raw) cached = JSON.parse(raw);
  } catch (_) {}

  renderEventCards(grid, (cached && cached.length) ? cached : DEFAULT_COMMUNITY_EVENTS);

  // 2) 백그라운드에서 최신 데이터 조회 후 업데이트
  try {
    const events = [];
    const seen   = new Set();

    const push = (docSnap) => {
      if (!seen.has(docSnap.id) && events.length < 4) {
        seen.add(docSnap.id);
        const data = docSnap.data ? docSnap.data() : docSnap;
        events.push({ id: docSnap.id, ...data });
      }
    };

    // 1) 반복 행사 (매일·특정요일)
    try {
      const rSnap = await getDocs(
        query(collection(db,'community_events'),
          where('scheduleType','in',['daily','weekly']), limit(4))
      );
      rSnap.docs.forEach(push);
    } catch (_) {}

    // 2) 예정 행사 (eventDate 오름차순)
    if (events.length < 4) {
      try {
        const snap = await getDocs(
          query(collection(db,'community_events'),
            where('eventDate','>',new Date()),
            orderBy('eventDate','asc'),
            limit(4 - events.length))
        );
        snap.docs.forEach(push);
      } catch (_) {}
    }

    // 3) 그래도 4개 미만이면 최근 행사로 채우기
    if (events.length < 4) {
      try {
        const snap = await getDocs(
          query(collection(db,'community_events'),
            orderBy('eventDate','desc'),
            limit(8))
        );
        snap.docs.forEach(push);
      } catch (_) {}
    }

    if (events.length > 0) {
      renderEventCards(grid, events);
      try {
        localStorage.setItem('bc_cache_community_events', JSON.stringify(events.slice(0, 4)));
      } catch (_) {}
    }
  } catch (err) {
    console.warn('[community-preview] silent background fetch error (retaining cached UI):', err?.message || err);
  }
}

loadCommunityPreview();
