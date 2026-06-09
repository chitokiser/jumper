// assets/js/pages/merchants.moneytree.js
// 돈나무(Money Tree) 프론트엔드 모듈

import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

let _functions = null;
let _map = null;
let _ctx = null;
let _activeShopId = null;
let _treeMarkers = [];
let _cfg = null;
let _inv = null;
let _onEnsurePos = null;
let _isServerConnected = null;

const IMG_BASE = '/assets/images/tree/';

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
  const sEl = document.getElementById('mtHudSeedlings');
  const tEl = document.getElementById('mtHudTickets');
  if (sEl) sEl.textContent = inv?.seedlings ?? 0;
  if (tEl) tEl.textContent = inv?.harvestTickets ?? 0;
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

function _clearTreeMarkers() {
  _treeMarkers.forEach(m => m.setMap(null));
  _treeMarkers = [];
}

function _addTreeMarker(tree) {
  if (!_map || !window.google) return;
  const icon = {
    url: `${IMG_BASE}${tree.imageNum}.png`,
    scaledSize: new google.maps.Size(40, 40),
    anchor: new google.maps.Point(20, 40),
  };
  const marker = new google.maps.Marker({
    position: { lat: tree.lat, lng: tree.lng },
    map: _map,
    icon,
    title: `🌳 ${tree.value.toLocaleString()} GP${tree.isOwn ? ' (내 나무)' : ''}`,
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
  document.getElementById('mtTreeOwner').textContent = tree.isOwn ? '내 나무' : '다른 유저';
  document.getElementById('mtTreeId').textContent    = tree.treeId;

  const boostBtn    = document.getElementById('mtBtnBoost');
  const harvestBtn  = document.getElementById('mtBtnHarvest');
  if (boostBtn)   { boostBtn.dataset.treeid = tree.treeId;   boostBtn.classList.toggle('hidden', !tree.isOwn); }
  if (harvestBtn) { harvestBtn.dataset.treeid = tree.treeId; harvestBtn.classList.toggle('hidden', tree.value <= 0); }

  modal.classList.add('open');
}

export function closeTreeInfoModal() {
  document.getElementById('mtTreeModal')?.classList.remove('open');
}

// ── 물약상점 돈나무 섹션 렌더링 ──────────────────────────────────────────────
export function renderMoneyTreeShopSection(shop, cfg) {
  _activeShopId = shop.id || shop.shopId;
  _cfg = cfg;
  const seedPrice = cfg?.seedlingPriceGp?.toLocaleString() ?? '100,000';
  const boostPrice = cfg?.boosterPriceGp?.toLocaleString() ?? '1,000';
  const inv = _inv;
  return `<div id="mtShopSection" style="margin-top:14px;padding:12px;background:rgba(16,185,129,.06);
    border:1px solid rgba(16,185,129,.25);border-radius:10px">
    <div style="font-weight:700;font-size:13px;color:#34d399;margin-bottom:10px">🌳 돈나무 아이템</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px;
        background:rgba(255,255,255,.03);border-radius:8px;border:1px solid #1f2937">
        <div>
          <div style="font-size:13px;font-weight:600;color:#f3f4f6">🌱 묘목</div>
          <div style="font-size:11px;color:#9ca3af">💰 ${seedPrice} GP · 보유: <span id="mtInvSeedlings">${inv?.seedlings ?? 0}</span>개</div>
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
                   cursor:pointer;background:linear-gradient(135deg,#059669,#047857);color:#fff">구매</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px;
        background:rgba(255,255,255,.03);border-radius:8px;border:1px solid #1f2937">
        <div>
          <div style="font-size:13px;font-weight:600;color:#f3f4f6">💊 영양제</div>
          <div style="font-size:11px;color:#9ca3af">💰 ${boostPrice} GP · 보유: <span id="mtInvBoosters">${inv?.treeBoosters ?? 0}</span>개</div>
        </div>
        <button id="mtBuyBoosterBtn" onclick="window._mtBuyBooster()"
          style="padding:8px 14px;border-radius:8px;border:none;font-weight:700;font-size:12px;
                 cursor:pointer;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff">구매</button>
      </div>
      <button onclick="window._mtOpenMyTrees()"
        style="width:100%;padding:10px;border-radius:8px;border:none;font-weight:700;font-size:13px;
               cursor:pointer;background:rgba(59,130,246,.15);color:#60a5fa;border:1px solid rgba(59,130,246,.3)">
        🌳 내 나무 보기 / 식재
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
  if (btn) btn.disabled = true;
  try {
    const fn = httpsCallable(_functions, 'buySeedling');
    const { data } = await fn({ shopId: _activeShopId, qty });
    _showMtToast(`🌱 묘목 ${data.qty}개 구매! (-${data.cost.toLocaleString()} GP)`, 'success');
    await refreshMoneyTreeInventory();
    document.getElementById('mtInvSeedlings').textContent = _inv?.seedlings ?? 0;
  } catch (e) { _showMtToast(e?.message || '구매 실패', 'error'); }
  finally { if (btn) btn.disabled = false; }
};

window._mtBuyBooster = async function() {
  if (!_activeShopId || !_functions) return;
  _onEnsurePos?.();
  try {
    const fn = httpsCallable(_functions, 'buyTreeBooster');
    const { data } = await fn({ shopId: _activeShopId, qty: 1 });
    _showMtToast(`💊 영양제 ${data.qty}개 구매! (-${data.cost.toLocaleString()} GP)`, 'success');
    await refreshMoneyTreeInventory();
    document.getElementById('mtInvBoosters').textContent = _inv?.treeBoosters ?? 0;
  } catch (e) { _showMtToast(e?.message || '구매 실패', 'error'); }
};

// ── 내 나무 모달 ─────────────────────────────────────────────────────────────
window._mtOpenMyTrees = async function() {
  const modal = document.getElementById('mtMyTreesModal');
  if (!modal || !_functions) return;
  modal.classList.add('open');
  const list = document.getElementById('mtMyTreeList');
  if (list) list.innerHTML = '<div style="color:#9ca3af;text-align:center;padding:20px">로딩중...</div>';

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
    list.innerHTML = '<div style="color:#9ca3af;text-align:center;padding:24px">심은 나무가 없습니다.<br>물약상점 근처에서 묘목을 심으세요.</div>';
    return;
  }
  list.innerHTML = trees.map(t => `
    <div style="padding:10px;border-radius:8px;border:1px solid #1f2937;background:rgba(255,255,255,.02);margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <img src="${IMG_BASE}${t.imageNum}.png" style="width:36px;height:36px;object-fit:contain">
        <div style="flex:1">
          <div style="font-size:12px;font-weight:700;color:#f3f4f6">${t.treeId}</div>
          <div style="font-size:12px;color:#fbbf24">💰 ${t.value.toLocaleString()} GP</div>
          <div style="font-size:11px;color:#6b7280">부스트: +${t.boostTotal} | 복권: ${t.lotteryNumber ?? '없음'}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <button onclick="window._mtDoBoost('${t.treeId}')"
            style="padding:5px 10px;border-radius:6px;border:none;font-size:11px;cursor:pointer;
                   background:#7c3aed;color:#fff;font-weight:600">영양제</button>
          <button onclick="window._mtDoHarvest('${t.treeId}')"
            style="padding:5px 10px;border-radius:6px;border:none;font-size:11px;cursor:pointer;
                   background:${t.value > 0 ? '#059669' : '#374151'};color:${t.value > 0 ? '#fff' : '#6b7280'};font-weight:600"
            ${t.value <= 0 ? 'disabled' : ''}>수확</button>
        </div>
      </div>
    </div>`).join('');
}

// ── 식재 버튼 (물약상점에서 호출) ────────────────────────────────────────────
export function openPlantModal(shopId) {
  if (_isServerConnected && !_isServerConnected()) {
    _showMtToast('Please connect to the game server first.\nTap the ▶ Play button to join before planting.', 'error');
    return;
  }
  _activeShopId = shopId;
  const modal = document.getElementById('mtPlantModal');
  if (!modal || !_functions) return;
  const inv = _inv;
  document.getElementById('mtPlantSeedCount').textContent = inv?.seedlings ?? '?';
  modal.classList.add('open');
}

window._mtConfirmPlant = async function() {
  if (!_activeShopId || !_functions) return;
  const btn = document.getElementById('mtPlantConfirmBtn');
  if (btn) btn.disabled = true;
  try {
    const fn = httpsCallable(_functions, 'plantSeedling');
    const { data } = await fn({ shopId: _activeShopId });
    document.getElementById('mtPlantModal')?.classList.remove('open');
    let msg = `🌱 식재 완료! (${data.treeId})`;
    if (data.ticketGranted) msg += '\n🎟️ 묘목 10개 달성 — 수확권 +1!';
    if (data.lotteryTriggeredWin) msg += '\n🎉 복권 당첨 발생 (다른 유저 수확권 +1)';
    if (data.lotteryNumber) msg += `\n🎲 복권 번호: ${data.lotteryNumber}`;
    _showMtToast(msg, 'success');
    await refreshMoneyTreeInventory();
    if (_ctx?.gpsPos) loadMoneyTreeMarkers(_ctx.gpsPos.lat, _ctx.gpsPos.lng);
  } catch (e) {
    _showMtToast(e?.message || '식재 실패', 'error');
  } finally {
    if (btn) btn.disabled = false;
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
    setTimeout(() => {
      _stopSlotAnimation(data.boostResult);
      document.getElementById('mtSlotResultRow').classList.remove('hidden');
    }, 1500);
    await refreshMoneyTreeInventory();
  } catch (e) {
    clearInterval(window._mtSlotInterval);
    _showMtToast(e?.message || '영양제 사용 실패', 'error');
    if (btn) btn.disabled = false;
  }
};

function _startSlotAnimation() {
  const el = document.getElementById('mtSlotResult');
  if (!el) return;
  let n = 0;
  window._mtSlotInterval = setInterval(() => {
    n = Math.floor(Math.random() * 100) + 1;
    el.textContent = n;
  }, 80);
}

function _stopSlotAnimation(result) {
  clearInterval(window._mtSlotInterval);
  const el = document.getElementById('mtSlotResult');
  if (el) el.textContent = result;
  const valEl = document.getElementById('mtSlotResultVal');
  if (valEl) valEl.textContent = result;
  _showMtToast(`💊 슬롯 결과: +${result} 성장치!`, 'success');
}

// ── 수확 ─────────────────────────────────────────────────────────────────────
window._mtDoHarvest = async function(treeId) {
  document.getElementById('mtMyTreesModal')?.classList.remove('open');
  if (!confirm(`🌳 나무(${treeId})를 수확하시겠습니까?\n수확권 1장이 소모됩니다.`)) return;
  try {
    const fn = httpsCallable(_functions, 'harvestTree');
    const { data } = await fn({ treeId });
    _showMtToast(`✅ 수확 완료! +${data.amount.toLocaleString()} GP (세금 ${data.tax.toLocaleString()} GP)`, 'success');
    await refreshMoneyTreeInventory();
    if (_ctx?.gpsPos) loadMoneyTreeMarkers(_ctx.gpsPos.lat, _ctx.gpsPos.lng);
  } catch (e) { _showMtToast(e?.message || '수확 실패', 'error'); }
};

// ── 유틸 ─────────────────────────────────────────────────────────────────────
function _showMtToast(msg, type = 'info') {
  const toast = document.getElementById('collectToast');
  if (!toast) return;
  toast.textContent = msg;
  toast.style.cssText = `display:block;position:fixed;bottom:120px;left:50%;transform:translateX(-50%);
    z-index:9999;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:600;white-space:pre-line;
    background:${type === 'error' ? '#7f1d1d' : type === 'success' ? '#14532d' : '#1e3a5f'};
    color:#fff;border:1px solid ${type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : '#3b82f6'};
    max-width:280px;text-align:center;`;
  clearTimeout(window._mtToastTimer);
  window._mtToastTimer = setTimeout(() => { toast.style.display = 'none'; }, 3500);
}
