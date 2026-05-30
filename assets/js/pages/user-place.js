// /assets/js/pages/user-place.js
// 유저 배치 상점 — GP로 보물박스 / 몬스터 / 아쳐타워를 지도에 배치

import { functions } from '/assets/js/firebase-init.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

const cfPlace    = httpsCallable(functions, 'placeUserObject', { timeout: 30000 });
const cfGetMine  = httpsCallable(functions, 'getMyPlacedObjects');

// ── 카탈로그 (서버와 동일) ────────────────────────────────────────────────────
const CATALOG = [
  // 보물박스
  { key: 'box_lv1',     emoji: '🎁', label: '보물박스 Lv1', desc: '아이템 1~3 랜덤 1개',  price: 5000,  tag: 'box' },
  { key: 'box_lv2',     emoji: '🎁', label: '보물박스 Lv2', desc: '아이템 4~7 랜덤 1개',  price: 10000, tag: 'box' },
  { key: 'box_lv3',     emoji: '🎁', label: '보물박스 Lv3', desc: '아이템 8~11 랜덤 1개', price: 15000, tag: 'box' },
  // 몬스터
  { key: 'mon_cabi',    emoji: '👾', label: 'cabi',          desc: 'HP 500 · ATK 20',     price: 5000,  tag: 'monster' },
  { key: 'mon_eyes',    emoji: '👁️', label: 'Monster eyes', desc: 'HP 800 · ATK 80',     price: 10000, tag: 'monster' },
  { key: 'mon_orc1',    emoji: '🐗', label: 'Orc',           desc: 'HP 1200 · ATK 60',    price: 15000, tag: 'monster' },
  { key: 'mon_orc2',    emoji: '🗡️', label: 'Orc2',          desc: 'HP 1800 · ATK 80',    price: 20000, tag: 'monster' },
  { key: 'mon_orc3',    emoji: '⚔️', label: 'Orc3',          desc: 'HP 2500 · ATK 100',   price: 25000, tag: 'monster' },
  // 타워
  { key: 'archer_tower', emoji: '🏹', label: '아쳐타워',  desc: 'ATK 50 · 반경 40m · HP 500',   price:  20000, tag: 'tower' },
  { key: 'cannon_tower', emoji: '💣', label: '대포타워',  desc: 'ATK 120 · 반경 35m · HP 1000', price: 100000, tag: 'tower' },
  // 상점
  { key: 'shop_potion',  emoji: '🧪', label: '약물상점',   desc: '물약·버프 아이템 판매',       price: 600000, tag: 'shop' },
  { key: 'shop_weapon',  emoji: '⚔️', label: '무기상점',   desc: '무기 장비 아이템 판매',       price: 400000, tag: 'shop' },
  { key: 'shop_armor',   emoji: '🛡️', label: '방어구 상점', desc: '방어구 장비 아이템 판매',   price: 400000, tag: 'shop' },
  { key: 'shop_misc',    emoji: '🎒', label: '잡템상점',   desc: '소모품·기타 아이템 판매',     price: 300000, tag: 'shop' },
];

// ── 상태 ─────────────────────────────────────────────────────────────────────
let _map          = null;
let _infoWin      = null;
let _getGold      = null;   // () => number
let _refreshCb    = null;   // 배치 후 데이터 새로고침 콜백
let _placingKey   = null;   // 현재 배치 중인 아이템 키
let _clickListener = null;

const $ = id => document.getElementById(id);

// ── 초기화 ────────────────────────────────────────────────────────────────────
export function initUserPlace(map, infoWindow, getGoldFn, onPlacedCb) {
  _map       = map;
  _infoWin   = infoWindow;
  _getGold   = getGoldFn;
  _refreshCb = onPlacedCb;

  $('btnUserPlaceShop')?.addEventListener('click', openShopPanel);
  $('btnUserPlaceClose')?.addEventListener('click', closeShopPanel);
  $('btnUserPlaceCancelMode')?.addEventListener('click', _cancelPlaceMode);
  $('btnUserPlaceMyList')?.addEventListener('click', loadMyList);
}

// ── 상점 패널 ─────────────────────────────────────────────────────────────────
function openShopPanel() {
  const panel = $('userPlacePanel');
  if (!panel) return;
  _renderCatalog();
  panel.style.display = 'flex';
}

function closeShopPanel() {
  const panel = $('userPlacePanel');
  if (panel) panel.style.display = 'none';
  _cancelPlaceMode();
}

function _renderCatalog() {
  const container = $('userPlaceCatalog');
  if (!container) return;
  const gold = _getGold ? _getGold() : 0;

  const rows = CATALOG.map(item => {
    const canAfford = gold >= item.price;
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;
                  border:1px solid var(--border,#e5e7eb);margin-bottom:6px;
                  background:${canAfford ? 'var(--surface,#fff)' : '#f9fafb'};">
        <span style="font-size:1.4rem;">${item.emoji}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:0.88rem;">${item.label}</div>
          <div style="font-size:0.75rem;color:var(--muted,#6b7280);">${item.desc}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:0.8rem;font-weight:700;color:${canAfford ? '#d97706' : '#9ca3af'};">
            🪙 ${item.price.toLocaleString()} GP
          </div>
          <button data-key="${item.key}" ${canAfford ? '' : 'disabled'}
            style="margin-top:3px;padding:4px 10px;border:none;border-radius:6px;font-size:0.78rem;
                   font-weight:600;cursor:${canAfford ? 'pointer' : 'not-allowed'};
                   background:${canAfford ? '#1d4ed8' : '#e5e7eb'};
                   color:${canAfford ? '#fff' : '#9ca3af'};">
            배치
          </button>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div style="font-size:0.8rem;color:var(--muted);margin-bottom:8px;">
      보유 GP: <strong style="color:#d97706;">🪙 ${gold.toLocaleString()}</strong>
    </div>
    ${rows}`;

  container.querySelectorAll('button[data-key]').forEach(btn => {
    btn.addEventListener('click', () => _startPlaceMode(btn.dataset.key));
  });
}

// ── 배치 모드 ─────────────────────────────────────────────────────────────────
function _startPlaceMode(itemKey) {
  _placingKey = itemKey;
  const item  = CATALOG.find(c => c.key === itemKey);
  closeShopPanel();

  // 지도 위 안내 배너 표시
  const banner = $('userPlaceBanner');
  if (banner) {
    banner.textContent = `📍 ${item.emoji} ${item.label} 배치할 위치를 지도에서 클릭하세요`;
    banner.style.display = 'block';
  }
  $('btnUserPlaceCancelMode').style.display = 'inline-block';

  // 지도 클릭 리스너 등록
  _clickListener = _map.addListener('click', e => {
    _onMapClick(e.latLng.lat(), e.latLng.lng(), item);
  });
}

function _cancelPlaceMode() {
  _placingKey = null;
  if (_clickListener) { google.maps.event.removeListener(_clickListener); _clickListener = null; }
  const banner = $('userPlaceBanner');
  if (banner) banner.style.display = 'none';
  $('btnUserPlaceCancelMode').style.display = 'none';
}

// ── 지도 클릭 → 확인 모달 ────────────────────────────────────────────────────
function _onMapClick(lat, lng, item) {
  _cancelPlaceMode(); // 리스너 해제

  const modal = $('userPlaceConfirmModal');
  if (!modal) return;
  $('upConfirmLabel').textContent  = `${item.emoji} ${item.label}`;
  $('upConfirmPrice').textContent  = `🪙 ${item.price.toLocaleString()} GP`;
  $('upConfirmCoord').textContent  = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  $('upConfirmMsg').textContent    = '';
  const confirmBtn = $('btnUpConfirm');
  confirmBtn.disabled    = false;
  confirmBtn.textContent = '✅ 배치 확인';

  const doPlace = async () => {
    confirmBtn.disabled    = true;
    confirmBtn.textContent = '처리 중...';
    try {
      const res = await cfPlace({ itemKey: item.key, lat, lng });
      const spent = item.price;
      $('upConfirmMsg').textContent = `✅ 배치 완료! (🪙 ${spent.toLocaleString()} GP 차감)`;
      $('upConfirmMsg').style.color = '#22c55e';
      _refreshCb?.(); // loadPlayerState + 지도 새로고침
      setTimeout(() => {
        modal.style.display = 'none';
        // 카탈로그가 열려 있으면 GP 표시 갱신
        if ($('userPlacePanel')?.style.display !== 'none') _renderCatalog();
      }, 1500);
    } catch (e) {
      $('upConfirmMsg').textContent  = '오류: ' + e.message;
      $('upConfirmMsg').style.color  = '#ef4444';
      confirmBtn.disabled = false; confirmBtn.textContent = '✅ 배치 확인';
    }
  };

  confirmBtn.onclick = doPlace;
  $('btnUpCancel').onclick = () => { modal.style.display = 'none'; };
  modal.style.display = 'flex';
}

// ── 내 배치 목록 ──────────────────────────────────────────────────────────────
async function loadMyList() {
  const listEl = $('userPlaceMyList');
  if (!listEl) return;
  listEl.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;">불러오는 중...</div>';
  try {
    const res  = await cfGetMine();
    const { boxes, monsters, towers } = res.data;
    const shopEmoji = (t) => ({ shop_potion:'🧪', shop_weapon_armor:'⚔️', shop_misc:'🎒' }[t] ?? '🏪');
    const all  = [
      ...boxes.map(o    => ({ ...o, emoji: '🎁', label: o.name })),
      ...monsters.map(o => ({ ...o, emoji: '👾', label: o.name })),
      ...towers.map(o   => ({ ...o, emoji: '🏹', label: o.name })),
      ...(res.data.shops ?? []).map(o => ({ ...o, emoji: shopEmoji(o.type), label: o.name })),
    ];
    if (!all.length) { listEl.innerHTML = '<div style="color:var(--muted);">배치한 오브젝트 없음</div>'; return; }

    listEl.innerHTML = all.map(o => {
      const d = o.createdAt?._seconds
        ? new Date(o.createdAt._seconds * 1000).toLocaleDateString('ko-KR')
        : '-';
      return `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;
                border:1px solid var(--border);margin-bottom:5px;font-size:0.82rem;">
        <span>${o.emoji}</span>
        <div style="flex:1;">
          <div style="font-weight:600;">${o.label}</div>
          <div style="color:var(--muted);">배치일 ${d}</div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    listEl.innerHTML = `<div style="color:#ef4444;">오류: ${e.message}</div>`;
  }
}
