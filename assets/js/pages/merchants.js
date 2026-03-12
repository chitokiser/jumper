// /assets/js/pages/merchants.js
// 가맹점 지도 전용 페이지

import { initializeApp }   from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, collection, getDocs }
                           from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig }  from '/assets/js/firebase-config.js';

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

const $ = id => document.getElementById(id);

let allMerchants = [];
let map = null;
let infoWindow = null;
let markers = [];

// ── 유틸 ───────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function parseLatLng(gmapUrl) {
  if (!gmapUrl) return null;
  try {
    const m1 = gmapUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m1) return { lat: parseFloat(m1[1]), lng: parseFloat(m1[2]) };
    const url = new URL(gmapUrl);
    const q   = url.searchParams.get('q');
    if (q) {
      const m2 = q.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
      if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]) };
    }
  } catch { /* ignore */ }
  return null;
}

// ── Google Maps 로드 ───────────────────────────────────────────────
function loadMapsScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) return resolve();
    window.__merchantMapCb = resolve;
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${window.__mapsKey || ''}&callback=__merchantMapCb&language=ko&region=KR`;
    s.async = true;
    s.onerror = () => reject(new Error('Google Maps 로드 실패'));
    document.head.appendChild(s);
  });
}

// ── 지도 초기화 ────────────────────────────────────────────────────
function initMap() {
  map = new google.maps.Map($('merchantMap'), {
    center: { lat: 20.9947, lng: 105.9487 },
    zoom: 13,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  });
  infoWindow = new google.maps.InfoWindow();
}

// ── 마커 렌더링 ────────────────────────────────────────────────────
function renderMarkers(list) {
  markers.forEach(m => m.setMap(null));
  markers = [];
  if (!map) return;

  const bounds = new google.maps.LatLngBounds();
  let hasPoint = false;

  list.forEach(m => {
    const latLng = m._latLng;
    if (!latLng) return;

    const marker = new google.maps.Marker({
      position: latLng,
      map,
      title: m.name || '',
      icon: {
        url: '/assets/images/jump/favicon.png',
        scaledSize: new google.maps.Size(18, 18),
        anchor: new google.maps.Point(9, 9),
      },
      zIndex: 10,
    });

    marker.addListener('click', () => {
      infoWindow.setContent(`
        <div style="max-width:240px;font-size:13px;line-height:1.6;">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">🏪 ${escHtml(m.name)}</div>
          ${m.career ? `<div style="color:#f59e0b;font-size:12px;">${escHtml(m.career)}</div>` : ''}
          ${m.region ? `<div style="color:#6b7280;">📍 ${escHtml(m.region)}</div>` : ''}
          ${m.phone  ? `<div style="color:#374151;">📞 ${escHtml(m.phone)}</div>` : ''}
          ${m.description ? `<div style="color:#6b7280;margin-top:4px;">${escHtml(m.description)}</div>` : ''}
          <a href="${escHtml(m.gmap)}" target="_blank" rel="noopener"
             style="display:inline-block;margin-top:6px;color:#2563eb;font-size:12px;">
            구글 지도에서 보기 →
          </a>
        </div>
      `);
      infoWindow.open(map, marker);
      // 카드 하이라이트
      document.querySelectorAll('.mc-card').forEach(el => el.style.borderColor = '');
      const card = document.querySelector(`.mc-card[data-id="${m.id}"]`);
      if (card) {
        card.style.borderColor = '#f59e0b';
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    markers.push(marker);
    bounds.extend(latLng);
    hasPoint = true;
    m._marker = marker;
  });

  if (hasPoint && markers.length > 1) map.fitBounds(bounds);
  else if (hasPoint && markers.length === 1) {
    map.setCenter(markers[0].getPosition());
    map.setZoom(16);
  }
}

// ── 카드 렌더링 ────────────────────────────────────────────────────
function renderCards(list) {
  const grid = $('mcGrid');
  if (!list.length) {
    grid.innerHTML = '<p class="mc-state">등록된 가맹점이 없습니다.</p>';
    $('mcCount').textContent = '';
    return;
  }

  $('mcCount').textContent = `${list.length}개`;
  grid.innerHTML = '';

  list.forEach(m => {
    const hasMap = !!m._latLng;
    const el = document.createElement('div');
    el.className = 'mc-card';
    el.dataset.id = m.id;
    el.innerHTML = `
      <div class="mc-card-name">
        ${escHtml(m.name || '(이름없음)')}
        ${hasMap ? '<span class="mc-badge-map">지도</span>' : ''}
      </div>
      ${m.career  ? `<div class="mc-card-career">${escHtml(m.career)}</div>` : ''}
      ${m.region  ? `<div class="mc-card-region">📍 ${escHtml(m.region)}</div>` : ''}
      ${m.phone   ? `<div class="mc-card-phone">📞 ${escHtml(m.phone)}</div>` : ''}
      ${m.description ? `<div class="mc-card-desc">${escHtml(m.description)}</div>` : ''}
      ${hasMap
        ? `<a class="mc-card-gmap" href="${escHtml(m.gmap)}" target="_blank" rel="noopener">구글 지도에서 보기 →</a>`
        : `<div class="mc-card-no-map">지도 미등록</div>`
      }
    `;

    if (hasMap) {
      el.addEventListener('click', e => {
        if (e.target.tagName === 'A') return;
        map?.panTo(m._latLng);
        map?.setZoom(17);
        if (m._marker) google.maps.event.trigger(m._marker, 'click');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    grid.appendChild(el);
  });
}

// ── 검색 필터 ──────────────────────────────────────────────────────
$('mcSearch').addEventListener('input', () => {
  const q = $('mcSearch').value.trim().toLowerCase();
  const filtered = q
    ? allMerchants.filter(m =>
        [m.name, m.career, m.region, m.description].some(v =>
          (v || '').toLowerCase().includes(q)))
    : allMerchants;
  renderCards(filtered);
  renderMarkers(filtered);
});

// ── 메인 ──────────────────────────────────────────────────────────
async function init() {
  // 가맹점 로드
  const snap = await getDocs(collection(db, 'merchants'));
  allMerchants = [];
  snap.forEach(d => {
    const m = d.data();
    if (m.active === false) return;
    const latLng = (m.lat && m.lng)
      ? { lat: m.lat, lng: m.lng }
      : parseLatLng(m.gmap);
    allMerchants.push({
      id: d.id, ...m, _latLng: latLng,
    });
  });

  // 지도가 있는 가맹점을 앞으로 정렬
  allMerchants.sort((a, b) => (b._latLng ? 1 : 0) - (a._latLng ? 1 : 0));

  // Google Maps 로드
  try {
    await loadMapsScript();
    initMap();
    renderMarkers(allMerchants);
  } catch {
    $('merchantMap').innerHTML = '<p style="padding:20px;color:#888;">지도를 불러오지 못했습니다.</p>';
  }

  renderCards(allMerchants);
}

init();
