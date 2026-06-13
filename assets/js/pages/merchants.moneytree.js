// assets/js/pages/merchants.moneytree.js
// 돈나무(Money Tree) 프론트엔드 모듈

import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { playSound } from './merchants.battle.js';

let _functions = null;
let _map = null;
let _ctx = null;
let _activeShopId = null;
let _activeShopData = null;
let _treeMarkers = [];
let _treeShadows = [];
let _cfg = null;
let _inv = null;
let _onEnsurePos = null;
let _isServerConnected = null;

const IMG_BASE = '/assets/images/tree/';

// 이미지별 실제 토양 기저부 Y 좌표 (투명 패딩 보정)
// anchor_y = round(content_bottom_row * 40 / image_height)
const _TREE_ANCHOR_Y = { 1: 26, 2: 37, 5: 38, 6: 38 };
// 3,4,7-11 은 anchor_y=39 (기본값)

export function initMoneyTree(ctx, map, functions, { onEnsurePos, isServerConnected } = {}) {
  _ctx = ctx;
  _map = map;
  _functions = functions;
  _onEnsurePos = onEnsurePos ?? null;
  _isServerConnected = isServerConnected ?? null;
}

// ── 인벤토리 HUD 업데이트 ────────────────────────────────────────────────────
export async function refreshMoneyTreeInventory() {
  try {
    const fn = httpsCallable(_functions, 'getMoneyTreeInventory');
    const { data } = await fn();
    _inv = data;
    _updateHud(data);
    return data;
  } catch (_) { return null; }
}

function _updateHud(inv) {
  const tickets = inv?.harvestTickets ?? 0;
  const sEl = document.getElementById('mtHudSeedlings');
  const tEl = document.getElementById('mtHudTickets');
  const iEl = document.getElementById('mtInvTickets');
  const mEl = document.getElementById('mtMyTreesTicketCount');
  const svEl = document.getElementById('mtHudSv');
  const bEl = document.getElementById('mtHudBoosters');
  if (sEl)  sEl.textContent  = inv?.seedlings ?? 0;
  if (tEl)  tEl.textContent  = tickets;
  if (iEl)  iEl.textContent  = tickets;
  if (mEl)  mEl.textContent  = tickets;
  if (svEl) svEl.textContent = (inv?.sv ?? 0).toLocaleString();
  if (bEl)  bEl.textContent  = inv?.treeBoosters ?? 0;
  // live-update mentor panel SV if shop is open
  const svBalEl = document.getElementById('mtMentorSvBalance');
  if (svBalEl) svBalEl.textContent = (inv?.sv ?? 0).toLocaleString();
}

// ── 나무 마커 로드 ────────────────────────────────────────────────────────────
export async function loadMoneyTreeMarkers(lat, lng) {
  if (!_map || !_functions) return;
  try {
    const fn = httpsCallable(_functions, 'getNearbyTrees');
    const { data } = await fn({ lat, lng, radiusKm: 5 });
    _clearTreeMarkers();
    (data.trees || []).forEach(_addTreeMarker);
  } catch (_) {}
}

function _makeTreeShadowIcon() {
  const sw = 36, h = 12;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + sw + '" height="' + h + '">' +
    '<defs><filter id="tsf"><feGaussianBlur stdDeviation="2"/></filter></defs>' +
    '<ellipse cx="18" cy="6" rx="15" ry="4.5" fill="rgba(0,0,0,0.32)" filter="url(#tsf)"/></svg>';
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(sw, h),
    anchor: new google.maps.Point(18, 6),
  };
}

function _clearTreeMarkers() {
  _treeMarkers.forEach(m => m.setMap(null));
  _treeMarkers = [];
  _treeShadows.forEach(m => m.setMap(null));
  _treeShadows = [];
}

function _addTreeMarker(tree) {
  if (!_map || !window.google) return;
  const shadow = new google.maps.Marker({
    position: { lat: tree.lat, lng: tree.lng },
    map: _map,
    icon: _makeTreeShadowIcon(),
    zIndex: 1,
    clickable: false,
  });
  _treeShadows.push(shadow);

  const icon = {
    url: `${IMG_BASE}${tree.imageNum}.png`,
    scaledSize: new google.maps.Size(40, 40),
    anchor: new google.maps.Point(20, _TREE_ANCHOR_Y[tree.imageNum] ?? 39),
  };
  const marker = new google.maps.Marker({
    position: { lat: tree.lat, lng: tree.lng },
    map: _map,
    icon,
    title: `🌳 ${tree.value.toLocaleString()} GP${tree.isOwn ? ' (My Tree)' : ''}`,
    zIndex: 5,
  });
  marker.addListener('click', () => _onTreeMarkerClick(tree, marker));
  _treeMarkers.push(marker);
}

function _onTreeMarkerClick(tree, marker) {
  openTreeInfoModal(tree);
}

// ── 나무 정보 모달 ────────────────────────────────────────────────────────────
export function openTreeInfoModal(tree) {
  const modal = document.getElementById('mtTreeModal');
  if (!modal) return;
  const cfg = _cfg || {};
  document.getElementById('mtTreeImg').src       = `${IMG_BASE}${tree.imageNum}.png`;
  document.getElementById('mtTreeValue').textContent = tree.value.toLocaleString() + ' GP';
  document.getElementById('mtTreeOwner').textContent = tree.isOwn ? 'My Tree' : 'Other User';
  document.getElementById('mtTreeId').textContent    = tree.treeId;

  const boostBtn    = document.getElementById('mtBtnBoost');
  const harvestBtn  = document.getElementById('mtBtnHarvest');
  if (boostBtn)   { boostBtn.dataset.treeid = tree.treeId;   boostBtn.classList.toggle('hidden', !tree.isOwn); }
  if (harvestBtn) { harvestBtn.dataset.treeid = tree.treeId; harvestBtn.classList.toggle('hidden', !tree.isOwn || tree.value <= 0); }

  modal.classList.add('open');
}

export function closeTreeInfoModal() {
  document.getElementById('mtTreeModal')?.classList.remove('open');
}

// ── 물약상점 돈나무 섹션 렌더링 ──────────────────────────────────────────────
export function renderMoneyTreeShopSection(shop, cfg) {
  _activeShopId = shop.id || shop.shopId;
  _activeShopData = { name: shop.name, lat: shop.lat, lng: shop.lng };
  _cfg = cfg;
  const seedPrice = cfg?.seedlingPriceGp?.toLocaleString() ?? '10,000';
  const boostPrice = cfg?.boosterPriceGp?.toLocaleString() ?? '1,000';
  const inv = _inv;
  return `<div id="mtShopSection" style="margin-top:14px;padding:12px;background:rgba(16,185,129,.06);
    border:1px solid rgba(16,185,129,.25);border-radius:10px">
    <div style="font-weight:700;font-size:13px;color:#34d399;margin-bottom:10px">🌳 Money Tree Items</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px;
        background:rgba(255,255,255,.03);border-radius:8px;border:1px solid #1f2937">
        <div>
          <div style="font-size:13px;font-weight:600;color:#f3f4f6">🌱 Seedling</div>
          <div style="font-size:11px;color:#9ca3af">💰 ${seedPrice} GP · Owned: <span id="mtInvSeedlings">${inv?.seedlings ?? 0}</span></div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <div style="display:flex;align-items:center;border:1px solid #374151;border-radius:8px;overflow:hidden">
            <button onclick="window._mtSeedQtyStep(-1)"
              style="padding:6px 10px;border:none;background:#1f2937;color:#9ca3af;font-size:16px;cursor:pointer;line-height:1">−</button>
            <input id="mtSeedQtyInput" type="number" min="1" max="99" value="1"
              style="width:38px;border:none;background:#111827;color:#f3f4f6;text-align:center;font-size:13px;font-weight:700;padding:6px 0;-moz-appearance:textfield">
            <button onclick="window._mtSeedQtyStep(1)"
              style="padding:6px 10px;border:none;background:#1f2937;color:#9ca3af;font-size:16px;cursor:pointer;line-height:1">+</button>
          </div>
          <button id="mtBuySeedlingBtn" onclick="window._mtBuySeedling()"
            style="padding:8px 14px;border-radius:8px;border:none;font-weight:700;font-size:12px;
                   cursor:pointer;background:linear-gradient(135deg,#059669,#047857);color:#fff">Buy</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px;
        background:rgba(255,255,255,.03);border-radius:8px;border:1px solid #1f2937">
        <div>
          <div style="font-size:13px;font-weight:600;color:#f3f4f6">💊 Booster</div>
          <div style="font-size:11px;color:#9ca3af">💰 ${boostPrice} GP · Owned: <span id="mtInvBoosters">${inv?.treeBoosters ?? 0}</span></div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <div style="display:flex;align-items:center;border:1px solid #374151;border-radius:8px;overflow:hidden">
            <button onclick="window._mtBoostQtyStep(-1)"
              style="padding:6px 10px;border:none;background:#1f2937;color:#9ca3af;font-size:16px;cursor:pointer;line-height:1">−</button>
            <input id="mtBoostQtyInput" type="number" min="1" max="99" value="1"
              style="width:38px;border:none;background:#111827;color:#f3f4f6;text-align:center;font-size:13px;font-weight:700;padding:6px 0;-moz-appearance:textfield">
            <button onclick="window._mtBoostQtyStep(1)"
              style="padding:6px 10px;border:none;background:#1f2937;color:#9ca3af;font-size:16px;cursor:pointer;line-height:1">+</button>
          </div>
          <button id="mtBuyBoosterBtn" onclick="window._mtBuyBooster()"
            style="padding:8px 14px;border-radius:8px;border:none;font-weight:700;font-size:12px;
                   cursor:pointer;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff">Buy</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px;
        background:rgba(251,191,36,.06);border-radius:8px;border:1px solid rgba(251,191,36,.25)">
        <div>
          <div style="font-size:13px;font-weight:600;color:#fbbf24">🎟️ Harvest Tickets</div>
          <div style="font-size:11px;color:#9ca3af">1 ticket per 10 plants · use to harvest trees</div>
        </div>
        <div style="font-size:22px;font-weight:700;color:#fbbf24"><span id="mtInvTickets">${inv?.harvestTickets ?? 0}</span></div>
      </div>
      <button onclick="window._mtOpenMyTrees()"
        style="width:100%;padding:10px;border-radius:8px;border:none;font-weight:700;font-size:13px;
               cursor:pointer;background:rgba(59,130,246,.15);color:#60a5fa;border:1px solid rgba(59,130,246,.3)">
        🌳 View My Trees / Plant
      </button>
      ${_renderMentorSection(inv, cfg)}
    </div>
  </div>`;
}

function _renderMentorSection(inv, cfg) {
  const regPrice = cfg?.mentorRegTicketPriceGp?.toLocaleString() ?? '50,000';
  if (!inv?.isMentor) {
    return `<div style="margin-top:8px;padding:10px;background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.25);border-radius:8px">
      <div style="font-size:12px;font-weight:700;color:#fbbf24;margin-bottom:6px">⭐ Mentor Registration</div>
      <div style="font-size:11px;color:#9ca3af;margin-bottom:8px">Register as a mentor to earn 40% SV when your mentees buy. Cost: <b style="color:#fbbf24">${regPrice} GP</b></div>
      <button id="mtBuyMentorRegBtn" onclick="window._mtBuyMentorReg()"
        style="width:100%;padding:8px;border-radius:8px;border:none;font-weight:700;font-size:12px;
               cursor:pointer;background:linear-gradient(135deg,#d97706,#b45309);color:#fff">
        Register as Mentor — ${regPrice} GP
      </button>
    </div>`;
  }
  const sv = inv?.sv ?? 0;
  return `<div style="margin-top:8px;padding:10px;background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.25);border-radius:8px">
    <div style="font-size:12px;font-weight:700;color:#fbbf24;margin-bottom:8px">⭐ Mentor Panel</div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <div style="font-size:12px;color:#9ca3af">SV Balance</div>
      <div style="font-size:16px;font-weight:700;color:#fbbf24" id="mtMentorSvBalance">${sv.toLocaleString()}</div>
    </div>
    <div style="display:flex;gap:6px">
      <button onclick="window._mtOpenConvertSv()"
        style="flex:1;padding:8px;border-radius:8px;border:none;font-weight:700;font-size:11px;
               cursor:pointer;background:linear-gradient(135deg,#059669,#047857);color:#fff">
        Convert SV → GP
      </button>
      <button onclick="window._mtOpenMentees()"
        style="flex:1;padding:8px;border-radius:8px;border:none;font-weight:700;font-size:11px;
               cursor:pointer;background:rgba(99,102,241,.2);color:#818cf8;border:1px solid rgba(99,102,241,.4)">
        My Mentees
      </button>
    </div>
  </div>`;
}

// ── 묘목 구매 ────────────────────────────────────────────────────────────────
window._mtSeedQtyStep = function(delta) {
  const el = document.getElementById('mtSeedQtyInput');
  if (!el) return;
  const v = Math.min(99, Math.max(1, (parseInt(el.value) || 1) + delta));
  el.value = v;
};

window._mtBuySeedling = async function() {
  if (!_activeShopId || !_functions) return;
  _onEnsurePos?.();
  const qtyEl = document.getElementById('mtSeedQtyInput');
  const qty = Math.min(99, Math.max(1, parseInt(qtyEl?.value) || 1));
  const btn = document.getElementById('mtBuySeedlingBtn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const fn = httpsCallable(_functions, 'buySeedling');
    const { data } = await fn({ shopId: _activeShopId, qty });
    // Optimistic update — accurate refresh runs in background
    if (_inv) { _inv.seedlings = (_inv.seedlings ?? 0) + data.qty; _updateHud(_inv); }
    document.getElementById('mtInvSeedlings').textContent = _inv?.seedlings ?? data.qty;
    _showMtToast(`🌱 Seedling ×${data.qty} purchased! −${data.cost.toLocaleString()} GP`, 'success');
    refreshMoneyTreeInventory(); // background — no await
  } catch (e) { _showMtToast(e?.message || 'Purchase failed', 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Buy'; } }
};

window._mtBoostQtyStep = function(delta) {
  const el = document.getElementById('mtBoostQtyInput');
  if (!el) return;
  el.value = Math.min(99, Math.max(1, (parseInt(el.value) || 1) + delta));
};

window._mtBuyBooster = async function() {
  if (!_activeShopId || !_functions) return;
  _onEnsurePos?.();
  const qtyEl = document.getElementById('mtBoostQtyInput');
  const qty = Math.min(99, Math.max(1, parseInt(qtyEl?.value) || 1));
  const btn = document.getElementById('mtBuyBoosterBtn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const fn = httpsCallable(_functions, 'buyTreeBooster');
    const { data } = await fn({ shopId: _activeShopId, qty });
    if (_inv) { _inv.treeBoosters = (_inv.treeBoosters ?? 0) + data.qty; _updateHud(_inv); }
    document.getElementById('mtInvBoosters').textContent = _inv?.treeBoosters ?? data.qty;
    _showMtToast(`💊 Booster ×${data.qty} purchased! −${data.cost.toLocaleString()} GP`, 'success');
    refreshMoneyTreeInventory(); // background — no await
  } catch (e) { _showMtToast(e?.message || 'Purchase failed', 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = 'Buy'; } }
};

// ── 내 나무 모달 ─────────────────────────────────────────────────────────────
window._mtOpenMyTrees = async function() {
  const modal = document.getElementById('mtMyTreesModal');
  if (!modal || !_functions) return;
  modal.classList.add('open');
  const list = document.getElementById('mtMyTreeList');
  if (list) list.innerHTML = '<div style="color:#9ca3af;text-align:center;padding:20px">Loading...</div>';

  try {
    const [treeRes, cfgRes] = await Promise.all([
      httpsCallable(_functions, 'getMyTrees')(),
      httpsCallable(_functions, 'getMoneyTreeConfig')(),
    ]);
    _cfg = cfgRes.data;
    _renderMyTreeList(treeRes.data.trees || []);
  } catch (e) {
    if (list) list.innerHTML = `<div style="color:#ef4444;text-align:center;padding:20px">${e.message}</div>`;
  }
};

function _renderMyTreeList(trees) {
  const list = document.getElementById('mtMyTreeList');
  if (!list) return;
  if (!trees.length) {
    list.innerHTML = '<div style="color:#9ca3af;text-align:center;padding:24px">No trees planted yet.<br>Go near a Potion Shop to plant a seedling.</div>';
    return;
  }
  list.innerHTML = trees.map(t => `
    <div style="padding:10px;border-radius:8px;border:1px solid #1f2937;background:rgba(255,255,255,.02);margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <img src="${IMG_BASE}${t.imageNum}.png" style="width:36px;height:36px;object-fit:contain">
        <div style="flex:1">
          <div style="font-size:12px;font-weight:700;color:#f3f4f6">${t.treeId}</div>
          <div style="font-size:12px;color:#fbbf24">💰 ${t.value.toLocaleString()} GP</div>
          <div style="font-size:11px;color:#6b7280">Boost: +${t.boostTotal} | Lottery: ${t.lotteryNumber ?? 'None'}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <button onclick="window._mtDoBoost('${t.treeId}')"
            style="padding:5px 10px;border-radius:6px;border:none;font-size:11px;cursor:pointer;
                   background:#7c3aed;color:#fff;font-weight:600">Boost</button>
          <button onclick="window._mtDoHarvest('${t.treeId}')"
            style="padding:5px 10px;border-radius:6px;border:none;font-size:11px;cursor:pointer;
                   background:${t.value > 0 ? '#059669' : '#374151'};color:${t.value > 0 ? '#fff' : '#6b7280'};font-weight:600"
            ${t.value <= 0 ? 'disabled' : ''}>Harvest</button>
        </div>
      </div>
    </div>`).join('');
}

// ── 식재 버튼 (물약상점에서 호출) ────────────────────────────────────────────
export function openPlantModal(shopId, shopData = null) {
  _activeShopId = shopId;
  if (shopData) _activeShopData = shopData;
  const modal = document.getElementById('mtPlantModal');
  if (!modal || !_functions) return;
  const inv = _inv;
  const seeds = inv?.seedlings ?? 0;
  document.getElementById('mtPlantSeedCount').textContent = seeds;
  const tcEl = document.getElementById('mtPlantTicketCount');
  if (tcEl) tcEl.textContent = inv?.harvestTickets ?? '?';
  const allCountEl = document.getElementById('mtPlantAllCount');
  if (allCountEl) allCountEl.textContent = seeds;
  modal.classList.add('open');
}

window._mtConfirmPlant = async function() {
  if (!_functions) { _showMtToast('Functions not initialized. Please reload.', 'error'); return; }
  if (!_activeShopId) { _showMtToast('No shop selected. Walk near a shop and try again.', 'error'); return; }
  const btn = document.getElementById('mtPlantConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Planting…'; }
  await _onEnsurePos?.();
  try {
    const fn = httpsCallable(_functions, 'plantSeedling');
    const { data } = await fn({ shopId: _activeShopId });
    document.getElementById('mtPlantModal')?.classList.remove('open');
    const extras = [];
    if (data.ticketGranted) extras.push('🎟️ Harvest ticket +1!');
    if (data.lotteryTriggeredWin) extras.push('🎉 Lottery triggered');
    if (data.lotteryNumber) extras.push(`🎲 #${data.lotteryNumber}`);
    const msg = `🌱 Planted! (${data.treeId})` + (extras.length ? ' · ' + extras.join(' · ') : '');
    playSound('plant_seedling');
    _showMtToast(msg, 'success');
    // Optimistic inventory decrement — background refresh syncs accurate count
    if (_inv) { _inv.seedlings = Math.max(0, (_inv.seedlings ?? 1) - 1); _updateHud(_inv); }
    const refPos = _ctx?.lastPos || _ctx?.gpsPos;
    const mapLat = refPos?.lat ?? data.lat;
    const mapLng = refPos?.lng ?? data.lng;
    if (mapLat != null && mapLng != null) loadMoneyTreeMarkers(mapLat, mapLng); // no await
    refreshMoneyTreeInventory(); // background — no await
  } catch (e) {
    const msg = e?.message || 'Unknown error';
    if (msg.includes('5 km') || msg.includes('too far') || msg.includes('within')) {
      const shopName = _activeShopData?.name || 'the potion shop';
      const coords = (_activeShopData?.lat && _activeShopData?.lng)
        ? ` (${_activeShopData.lat.toFixed(5)}, ${_activeShopData.lng.toFixed(5)})`
        : '';
      _showMtToast(`Cannot plant here — go back to "${shopName}" to plant.`, 'error');
    } else {
      _showMtToast(`Plant failed: ${msg}`, 'error');
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🌱 Plant 1'; }
  }
};

window._mtPlantAll = async function() {
  if (!_functions) { _showMtToast('Functions not initialized. Please reload.', 'error'); return; }
  if (!_activeShopId) { _showMtToast('No shop selected. Walk near a shop and try again.', 'error'); return; }
  const seeds = _inv?.seedlings ?? 0;
  if (seeds < 1) { _showMtToast('No seedlings to plant.', 'error'); return; }

  const confirmBtn = document.getElementById('mtPlantConfirmBtn');
  const allBtn     = document.getElementById('mtPlantAllBtn');
  if (confirmBtn) confirmBtn.disabled = true;
  if (allBtn)     allBtn.disabled = true;

  await _onEnsurePos?.();
  try {
    _showMtToast(`🌱 Planting ${seeds} seedling${seeds > 1 ? 's' : ''}…`, 'info');
    const fn = httpsCallable(_functions, 'plantBulkSeedlings', { timeout: 300000 });
    const { data } = await fn({ shopId: _activeShopId });
    document.getElementById('mtPlantModal')?.classList.remove('open');
    const msg = data.skipped > 0
      ? `🌳 Planted ${data.planted}/${seeds} — ${data.skipped} spot(s) blocked (10m rule).`
      : `🌳 All ${data.planted} seedling${data.planted > 1 ? 's' : ''} planted!`;
    playSound('plant_seedling');
    _showMtToast(msg, 'success');
    // Optimistic: clear all seedlings — background refresh syncs accurate count
    if (_inv) { _inv.seedlings = 0; _updateHud(_inv); }
    const refPos = _ctx?.lastPos || _ctx?.gpsPos;
    const firstTree = data.trees?.[0];
    const mapLat = refPos?.lat ?? firstTree?.lat;
    const mapLng = refPos?.lng ?? firstTree?.lng;
    if (mapLat != null && mapLng != null) loadMoneyTreeMarkers(mapLat, mapLng); // no await
    refreshMoneyTreeInventory(); // background — no await
  } catch (e) {
    const msg = e?.message || 'Plant failed';
    if (msg.includes('5 km') || msg.includes('within')) {
      const shopName = _activeShopData?.name || 'the potion shop';
      _showMtToast(`Cannot plant here — go back to "${shopName}".`, 'error');
    } else {
      _showMtToast(`Plant failed: ${msg}`, 'error');
    }
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
    if (allBtn)     allBtn.disabled = false;
  }
};

// ── 영양제 슬롯머신 ───────────────────────────────────────────────────────────
window._mtDoBoost = async function(treeId) {
  document.getElementById('mtMyTreesModal')?.classList.remove('open');
  openBoosterSlotModal(treeId);
};

export function openBoosterSlotModal(treeId) {
  const modal = document.getElementById('mtBoosterModal');
  if (!modal) return;
  modal.dataset.treeid = treeId;
  document.getElementById('mtSlotResult').textContent = '?';
  document.getElementById('mtSlotResultRow').classList.add('hidden');
  document.getElementById('mtSlotSpinBtn').disabled = false;
  const cntEl = document.getElementById('mtSlotBoosterCount');
  if (cntEl) cntEl.textContent = _inv?.treeBoosters ?? 0;
  modal.classList.add('open');
}

window._mtSpinBooster = async function() {
  const modal = document.getElementById('mtBoosterModal');
  if (!modal || !_functions) return;
  const treeId = modal.dataset.treeid;
  const btn = document.getElementById('mtSlotSpinBtn');
  if (btn) btn.disabled = true;
  _startSlotAnimation();
  try {
    const fn = httpsCallable(_functions, 'useTreeBooster');
    const { data } = await fn({ treeId });
    await refreshMoneyTreeInventory();
    setTimeout(() => {
      _stopSlotAnimation(data.boostResult);
      document.getElementById('mtSlotResultRow').classList.remove('hidden');
      const cntEl = document.getElementById('mtSlotBoosterCount');
      if (cntEl) cntEl.textContent = _inv?.treeBoosters ?? 0;
    }, 1500);
  } catch (e) {
    clearInterval(window._mtSlotInterval);
    _showMtToast(e?.message || 'Booster failed', 'error');
    if (btn) btn.disabled = false;
  }
};

function _startSlotAnimation() {
  const el = document.getElementById('mtSlotResult');
  if (!el) return;
  window._mtSlotInterval = setInterval(() => {
    el.textContent = Math.floor(Math.random() * 25) + 1;
    playSound('slot_tick');
  }, 80);
}

function _stopSlotAnimation(result) {
  clearInterval(window._mtSlotInterval);
  const el = document.getElementById('mtSlotResult');
  if (el) el.textContent = result;
  const valEl = document.getElementById('mtSlotResultVal');
  if (valEl) valEl.textContent = result;
  playSound('slot_win');
  _showMtToast(`💊 Booster: +${result} growth!`, 'success');
}

// ── 수확 ─────────────────────────────────────────────────────────────────────
window._mtDoHarvest = async function(treeId) {
  document.getElementById('mtMyTreesModal')?.classList.remove('open');
  if (!confirm(`🌳 Harvest tree (${treeId})?\n1 harvest ticket will be consumed.`)) return;
  try {
    const fn = httpsCallable(_functions, 'harvestTree');
    const { data } = await fn({ treeId });
    _showMtToast(`✅ Harvested! +${data.amount.toLocaleString()} GP · tax ${data.tax.toLocaleString()} GP`, 'success');
    await refreshMoneyTreeInventory();
    if (_ctx?.gpsPos) loadMoneyTreeMarkers(_ctx.gpsPos.lat, _ctx.gpsPos.lng);
  } catch (e) { _showMtToast(e?.message || 'Harvest failed', 'error'); }
};

// ── 멘토 등록 ────────────────────────────────────────────────────────────────
window._mtBuyMentorReg = async function() {
  if (!_activeShopId || !_functions) return;
  _onEnsurePos?.();
  const btn = document.getElementById('mtBuyMentorRegBtn');
  if (btn) btn.disabled = true;
  try {
    const fn = httpsCallable(_functions, 'buyMentorRegTicket');
    const { data } = await fn({ shopId: _activeShopId });
    _showMtToast(`⭐ You are now a Mentor! -${data.cost.toLocaleString()} GP`, 'success');
    _inv = await refreshMoneyTreeInventory();
    // Re-render shop section so mentor panel replaces registration row
    const section = document.getElementById('mtShopSection');
    if (section && _cfg) section.outerHTML = renderMoneyTreeShopSection(
      { id: _activeShopId, ..._activeShopData }, _cfg);
  } catch (e) { _showMtToast(e?.message || 'Registration failed', 'error'); }
  finally { const b = document.getElementById('mtBuyMentorRegBtn'); if (b) b.disabled = false; }
};

// ── SV → GP 변환 ─────────────────────────────────────────────────────────────
window._mtOpenConvertSv = function() {
  const existing = document.getElementById('mtConvertSvModal');
  if (existing) existing.remove();
  const sv = _inv?.sv ?? 0;
  const modal = document.createElement('div');
  modal.id = 'mtConvertSvModal';
  modal.setAttribute('data-fs-modal', '');
  modal.style.cssText = `position:fixed;inset:0;z-index:10100;display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,.7);`;
  modal.innerHTML = `
    <div style="background:#111827;border:1px solid #374151;border-radius:14px;padding:20px;width:280px;max-width:90vw">
      <div style="font-size:15px;font-weight:700;color:#fbbf24;margin-bottom:12px">Convert SV → GP</div>
      <div style="font-size:12px;color:#9ca3af;margin-bottom:10px">Available SV: <b style="color:#fbbf24">${sv.toLocaleString()}</b></div>
      <div style="font-size:11px;color:#6b7280;margin-bottom:12px">Converting SV grants the same amount in GP, and cascades 50% SV to your mentor chain (up to 6 levels).</div>
      <input id="mtConvertSvAmt" type="number" min="1" max="${sv}" value="${sv}"
        style="width:100%;padding:8px;border-radius:8px;border:1px solid #374151;background:#1f2937;
               color:#f3f4f6;font-size:14px;font-weight:700;text-align:center;margin-bottom:12px;box-sizing:border-box">
      <div style="display:flex;gap:8px">
        <button onclick="document.getElementById('mtConvertSvModal').remove()"
          style="flex:1;padding:9px;border-radius:8px;border:1px solid #374151;background:transparent;color:#9ca3af;font-size:13px;cursor:pointer">
          Cancel
        </button>
        <button id="mtConvertSvConfirmBtn" onclick="window._mtConfirmConvertSv()"
          style="flex:1;padding:9px;border-radius:8px;border:none;background:linear-gradient(135deg,#059669,#047857);
                 color:#fff;font-size:13px;font-weight:700;cursor:pointer">
          Convert
        </button>
      </div>
    </div>`;
  const fsContainer = document.getElementById('fullscreenContainer') || document.body;
  fsContainer.appendChild(modal);
};

window._mtConfirmConvertSv = async function() {
  if (!_functions) return;
  const amtEl = document.getElementById('mtConvertSvAmt');
  const amount = Math.floor(parseFloat(amtEl?.value) || 0);
  if (amount <= 0) { _showMtToast('Enter a positive amount.', 'error'); return; }
  const btn = document.getElementById('mtConvertSvConfirmBtn');
  if (btn) btn.disabled = true;
  try {
    const fn = httpsCallable(_functions, 'convertSvToGp');
    await fn({ amount });
    document.getElementById('mtConvertSvModal')?.remove();
    _showMtToast(`✅ Converted ${amount.toLocaleString()} SV → GP!`, 'success');
    await refreshMoneyTreeInventory();
  } catch (e) { _showMtToast(e?.message || 'Conversion failed', 'error'); }
  finally { const b = document.getElementById('mtConvertSvConfirmBtn'); if (b) b.disabled = false; }
};

// ── 멘티 목록 ─────────────────────────────────────────────────────────────────
window._mtOpenMentees = async function() {
  const existing = document.getElementById('mtMenteesModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'mtMenteesModal';
  modal.setAttribute('data-fs-modal', '');
  modal.style.cssText = `position:fixed;inset:0;z-index:10100;display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,.7);`;
  modal.innerHTML = `
    <div style="background:#111827;border:1px solid #374151;border-radius:14px;padding:20px;
                width:320px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-size:15px;font-weight:700;color:#818cf8">My Mentees</div>
        <button onclick="document.getElementById('mtMenteesModal').remove()"
          style="background:transparent;border:none;color:#6b7280;font-size:18px;cursor:pointer">✕</button>
      </div>
      <div id="mtMenteeList" style="overflow-y:auto;flex:1;color:#9ca3af;text-align:center;padding:20px">Loading...</div>
    </div>`;
  const fsContainer = document.getElementById('fullscreenContainer') || document.body;
  fsContainer.appendChild(modal);

  try {
    const fn = httpsCallable(_functions, 'getMyMentees');
    const { data } = await fn();
    const list = document.getElementById('mtMenteeList');
    if (!list) return;
    if (!data.mentees?.length) {
      list.innerHTML = '<div style="padding:20px">No mentees yet.</div>';
      return;
    }
    list.style.textAlign = 'left';
    list.style.padding = '0';
    list.innerHTML = data.mentees.map(m => `
      <div style="padding:8px 10px;border-bottom:1px solid #1f2937;display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:13px;font-weight:600;color:#f3f4f6">${m.displayName}</div>
          <div style="font-size:11px;color:#6b7280">Trees: ${m.totalPlantsCount}${m.isMentor ? ' · ⭐ Mentor' : ''}</div>
        </div>
      </div>`).join('');
  } catch (e) {
    const list = document.getElementById('mtMenteeList');
    if (list) list.innerHTML = `<div style="color:#ef4444;padding:20px">${e.message}</div>`;
  }
};

// ── 유틸 ─────────────────────────────────────────────────────────────────────
function _showMtToast(msg, type = 'info') {
  const toast = document.getElementById('collectToast');
  if (!toast) return;
  toast.textContent = msg;
  toast.style.cssText = `display:block;position:fixed;bottom:120px;left:50%;transform:translateX(-50%);
    z-index:9999;padding:8px 16px;border-radius:10px;font-size:12px;font-weight:600;
    white-space:normal;line-height:1.4;
    background:${type === 'error' ? '#7f1d1d' : type === 'success' ? '#14532d' : '#1e3a5f'};
    color:#fff;border:1px solid ${type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : '#3b82f6'};
    max-width:300px;min-width:180px;text-align:center;`;
  clearTimeout(window._mtToastTimer);
  window._mtToastTimer = setTimeout(() => { toast.style.display = 'none'; }, 3500);
}
