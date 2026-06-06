// /assets/js/pages/user-place.js
// 유저 배치 상점 — GP로 보물박스 / 몬스터 / 아쳐타워를 지도에 배치

import { functions } from '/assets/js/firebase-init.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

const cfPlace        = httpsCallable(functions, 'placeUserObject', { timeout: 30000 });
const cfGetMine      = httpsCallable(functions, 'getMyPlacedObjects');
const cfGetPrices    = httpsCallable(functions, 'getUserPlacePrices');
const cfSetPrices    = httpsCallable(functions, 'adminSetUserPlacePrices');

// ── 카탈로그 (서버와 동일) ────────────────────────────────────────────────────
const CATALOG = [
  // Treasure Boxes
  { key: 'box_lv1',     emoji: '🎁', label: 'Treasure Box Lv1', desc: 'Random item (tier 1–3)',   price: 5000,   tag: 'box' },
  { key: 'box_lv2',     emoji: '🎁', label: 'Treasure Box Lv2', desc: 'Random item (tier 4–7)',   price: 10000,  tag: 'box' },
  { key: 'box_lv3',     emoji: '🎁', label: 'Treasure Box Lv3', desc: 'Random item (tier 8–11)',  price: 15000,  tag: 'box' },
  // Monsters
  { key: 'mon_cabi',    emoji: '👾', label: 'Cabi',              desc: 'HP 500 · ATK 20',          price: 5000,   tag: 'monster' },
  { key: 'mon_eyes',    emoji: '👁️', label: 'Monster Eyes',     desc: 'HP 800 · ATK 80',          price: 10000,  tag: 'monster' },
  { key: 'mon_orc1',    emoji: '🐗', label: 'Orc',               desc: 'HP 1,200 · ATK 60',        price: 15000,  tag: 'monster' },
  { key: 'mon_orc2',    emoji: '🗡️', label: 'Orc 2',             desc: 'HP 1,800 · ATK 80',        price: 20000,  tag: 'monster' },
  { key: 'mon_orc3',    emoji: '⚔️', label: 'Orc 3',             desc: 'HP 2,500 · ATK 100',       price: 25000,  tag: 'monster' },
  { key: 'mon_pirate',  emoji: '🏴‍☠️', label: 'Pirate',           desc: 'HP 3,000 · ATK 120',       price: 30000,  tag: 'monster' },
  { key: 'mon_pirate2', emoji: '🏴‍☠️', label: 'Pirate 2',         desc: 'HP 3,500 · ATK 140',       price: 35000,  tag: 'monster' },
  { key: 'mon_pirate3', emoji: '🏴‍☠️', label: 'Pirate 3',         desc: 'HP 4,000 · ATK 160',       price: 40000,  tag: 'monster' },
  { key: 'mon_zombie1', emoji: '🧟', label: 'Zombie',             desc: 'HP 4,500 · ATK 180',       price: 45000,  tag: 'monster' },
  { key: 'mon_zombie3', emoji: '🧟', label: 'Zombie 3',           desc: 'HP 5,000 · ATK 200',       price: 50000,  tag: 'monster' },
  { key: 'mon_zvil1',   emoji: '🧟', label: 'Zombie Villager 1',  desc: 'HP 5,500 · ATK 220',       price: 55000,  tag: 'monster' },
  { key: 'mon_zvil2',   emoji: '🧟', label: 'Zombie Villager 2',  desc: 'HP 6,000 · ATK 240',       price: 60000,  tag: 'monster' },
  { key: 'mon_zvil3',   emoji: '🧟', label: 'Zombie Villager 3',  desc: 'HP 6,500 · ATK 260',       price: 65000,  tag: 'monster' },
  { key: 'mon_troll',   emoji: '👹', label: 'Troll',              desc: 'HP 7,000 · ATK 280',       price: 70000,  tag: 'monster' },
  { key: 'mon_knight1', emoji: '🛡️', label: 'Knight 1',           desc: 'HP 7,500 · ATK 300',       price: 75000,  tag: 'monster' },
  { key: 'mon_knight2', emoji: '⚔️', label: 'Knight 2',           desc: 'HP 8,000 · ATK 320',       price: 80000,  tag: 'monster' },
  { key: 'mon_knight3', emoji: '👑', label: 'Knight 3',           desc: 'HP 8,500 · ATK 340',       price: 85000,  tag: 'monster' },
  { key: 'mon_dragon',  emoji: '🐉', label: 'Dragon',             desc: 'HP 20,000 · ATK 500',      price: 200000, tag: 'monster' },
  // Towers
  { key: 'archer_tower', emoji: '🏹', label: 'Archer Tower',    desc: 'ATK 50 · radius 40m · HP 500',    price: 20000,  tag: 'tower' },
  { key: 'cannon_tower', emoji: '💣', label: 'Cannon Tower',    desc: 'ATK 120 · radius 35m · HP 1000',  price: 100000, tag: 'tower' },
  // Shops
  { key: 'shop_potion',  emoji: '🧪', label: 'Potion Shop',     desc: 'Sell potions & buff items',        price: 600000, tag: 'shop' },
  { key: 'shop_weapon',  emoji: '⚔️', label: 'Weapon Shop',     desc: 'Sell weapon equipment',            price: 400000, tag: 'shop' },
  { key: 'shop_armor',   emoji: '🛡️', label: 'Armor Shop',      desc: 'Sell armor equipment',             price: 400000, tag: 'shop' },
  { key: 'shop_misc',    emoji: '🎒', label: 'General Shop',    desc: 'Sell miscellaneous items',         price: 300000, tag: 'shop' },
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

// ── 서버 가격 캐시 ────────────────────────────────────────────────────────────
let _serverPrices = null; // { key: { price, label, defaultPrice } }

async function _fetchPrices() {
  try {
    const res = await cfGetPrices();
    _serverPrices = res.data?.prices ?? null;
  } catch (_) {}
}

function _effectivePrice(key) {
  return _serverPrices?.[key]?.price ?? CATALOG.find(c => c.key === key)?.price ?? 0;
}

// ── 상점 패널 ─────────────────────────────────────────────────────────────────
async function openShopPanel() {
  const panel = $('userPlacePanel');
  if (!panel) return;
  if (!_serverPrices) await _fetchPrices();
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
    const price     = _effectivePrice(item.key);
    const canAfford = gold >= price;
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
            🪙 ${price.toLocaleString()} GP
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
  const itemDef = CATALOG.find(c => c.key === itemKey);
  const item  = { ...itemDef, price: _effectivePrice(itemKey) };
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
      // 보물 숨기기/발행 생중계
      const evtGame = item.tag === 'box' ? 'treasure_issue' : 'treasure_hide';
      httpsCallable(functions, 'broadcastGpEvent')({ game: evtGame, amount: 0, label: `${item.emoji} ${item.label}` }).catch(() => {});
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

// ── 관리자: 가격 편집 ─────────────────────────────────────────────────────────
export async function loadAdminPriceEditor(containerEl) {
  if (!containerEl) return;
  containerEl.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;">가격 로딩 중...</div>';
  try {
    const res = await cfGetPrices();
    const prices = res.data?.prices ?? {};
    const rows = Object.entries(prices).map(([key, info]) => `
      <tr>
        <td style="padding:7px 10px;font-size:0.85rem;">${info.label}</td>
        <td style="padding:7px 10px;font-size:0.78rem;color:var(--muted);">
          기본 ${info.defaultPrice.toLocaleString()} GP
        </td>
        <td style="padding:7px 8px;">
          <input type="number" data-price-key="${key}" value="${info.price}"
            min="0" step="1000"
            style="width:120px;padding:5px 8px;border:1px solid var(--border);
                   border-radius:6px;font-size:0.85rem;font-family:monospace;box-sizing:border-box;">
        </td>
      </tr>`).join('');

    containerEl.innerHTML = `
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="font-size:0.75rem;color:var(--muted);text-align:left;border-bottom:1px solid var(--border);">
            <th style="padding:6px 10px;">아이템</th>
            <th style="padding:6px 10px;">기본가</th>
            <th style="padding:6px 8px;">현재 GP 가격</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:12px;display:flex;align-items:center;gap:10px;">
        <button id="btnSavePlacePrices" type="button"
          style="padding:8px 20px;background:#1d4ed8;color:#fff;border:none;
                 border-radius:8px;font-size:0.88rem;font-weight:700;cursor:pointer;">
          💾 가격 저장
        </button>
        <span id="placePriceMsg" style="font-size:0.82rem;"></span>
      </div>`;

    containerEl.querySelector('#btnSavePlacePrices')?.addEventListener('click', async () => {
      const btn = containerEl.querySelector('#btnSavePlacePrices');
      const msg = containerEl.querySelector('#placePriceMsg');
      btn.disabled = true; btn.textContent = '저장 중...';
      const data = {};
      containerEl.querySelectorAll('[data-price-key]').forEach(inp => {
        const v = parseInt(inp.value, 10);
        if (Number.isFinite(v) && v >= 0) data[inp.dataset.priceKey] = v;
      });
      try {
        await cfSetPrices(data);
        _serverPrices = null; // 캐시 초기화
        msg.textContent = '✅ 저장 완료';
        msg.style.color = '#22c55e';
      } catch (e) {
        msg.textContent = '오류: ' + e.message;
        msg.style.color = '#ef4444';
      } finally {
        btn.disabled = false; btn.textContent = '💾 가격 저장';
        setTimeout(() => { msg.textContent = ''; }, 3000);
      }
    });
  } catch (e) {
    containerEl.innerHTML = `<div style="color:#ef4444;">오류: ${e.message}</div>`;
  }
}
