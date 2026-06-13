// assets/js/pages/merchants.goldmine.js
// Gold Mine — map markers, modal UI, Cloud Function calls

import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { isVirtualMode, getVirtualPos } from './merchants.virtual.js';
import { initMiners, updateMiners, clearMiners } from './merchants.goldmine.miners.js';

let _fns  = null;
let _map  = null;
let _ctx  = null;
let _uid  = null;
let _markers = {};  // mineId → google.maps.Marker
let _mines   = {};  // mineId → mine data

// Active install session — ensures only one placement mode is active at a time
let _activeInstall = null; // { clickHandler, circle, previewMarker, cleanup }

const ICON_URL = '/assets/images/shops/gold.png';

export function initGoldMine(ctx, map, functions, uid) {
  _ctx = ctx;
  _map = map;
  _fns = functions;
  _uid = uid;
  initMiners(map);
}

export function setGoldMineUid(uid) { _uid = uid; }

// ── Load / refresh map markers ────────────────────────────────────────────────
export async function loadGoldMineMarkers(centerLat, centerLng) {
  if (!_map || !_fns || !_uid) return;
  const pos = (centerLat != null && centerLng != null)
    ? { lat: centerLat, lng: centerLng }
    : (_ctx?.lastPos ?? _ctx?.gpsPos);
  if (!pos) return;
  try {
    const fn = httpsCallable(_fns, 'getNearbyGoldMines');
    const { data } = await fn({ lat: pos.lat, lng: pos.lng, radiusKm: 25 });
    _renderMarkers(data.mines ?? []);
  } catch (_) { /* non-critical */ }
}

function _renderMarkers(mines) {
  const incoming = new Set(mines.map(m => m.id));
  for (const [id, marker] of Object.entries(_markers)) {
    if (!incoming.has(id)) { marker.setMap(null); delete _markers[id]; delete _mines[id]; }
  }
  for (const mine of mines) {
    _mines[mine.id] = mine;
    if (_markers[mine.id]) {
      _markers[mine.id].setPosition({ lat: mine.lat, lng: mine.lng });
      continue;
    }
    const marker = new google.maps.Marker({
      position: { lat: mine.lat, lng: mine.lng },
      map: _map,
      icon: {
        url: ICON_URL,
        scaledSize: new google.maps.Size(36, 36),
        anchor: new google.maps.Point(18, 18),
      },
      title: mine.deposit_revealed
        ? `⛏ Gold Mine | ${mine.remain_gold?.toLocaleString()} left`
        : '⛏ Gold Mine | ???',
      zIndex: 50,
    });
    marker.addListener('click', () => openGoldMineModal(mine.id));
    _markers[mine.id] = marker;
  }
  updateMiners(mines);
}

// ── Gold Mine modal ───────────────────────────────────────────────────────────
export function openGoldMineModal(mineId) {
  const mine = _mines[mineId];
  if (!mine) return;
  if ((mine.miners_count ?? 0) > 0) _playPickaxeSound();
  _fillModal(mine);
  document.getElementById('goldMineModal')?.classList.add('open');
}

function _fillModal(mine) {
  const body = document.getElementById('goldMineModalBody');
  if (!body) return;

  const isOwner   = mine.owner_id === _uid;
  const distLabel = mine.shopDistM != null ? _fmtDist(mine.shopDistM) : '';
  const effPct    = mine.shopDistM != null
    ? Math.round((1 + Math.max(0, (5000 - mine.shopDistM) / 5000)) * 100)
    : 100;
  const rate = mine.miners_count > 0
    ? (mine.miners_count * 0.1 * (effPct / 100)).toFixed(2)
    : '0.00';
  const depositTxt = mine.deposit_revealed ? mine.remain_gold?.toLocaleString() : '???';
  const totalTxt   = mine.deposit_revealed ? mine.total_gold?.toLocaleString()  : '???';
  const pct = (mine.deposit_revealed && mine.total_gold > 0)
    ? Math.round((mine.remain_gold / mine.total_gold) * 100) : null;
  const slots = 100 - (mine.miners_count ?? 0);

  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <img src="${ICON_URL}" style="width:48px;height:48px;border-radius:8px;object-fit:contain">
      <div>
        <div style="font-size:16px;font-weight:700;color:#fbbf24">⛏ Gold Mine</div>
        ${distLabel ? `<div style="font-size:12px;color:#9ca3af;margin-top:2px">${distLabel} from shop · ${effPct}% efficiency</div>` : ''}
      </div>
    </div>

    <div style="background:#1f2937;border-radius:10px;padding:12px;margin-bottom:10px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;text-align:center">
        <div>
          <div style="color:#6b7280;font-size:11px;margin-bottom:2px">Deposit</div>
          <div style="color:#fbbf24;font-size:18px;font-weight:700">${depositTxt}</div>
          ${totalTxt !== '???' ? `<div style="color:#6b7280;font-size:10px">/ ${totalTxt} total</div>` : ''}
        </div>
        <div>
          <div style="color:#6b7280;font-size:11px;margin-bottom:2px">Miners</div>
          <div style="color:#f3f4f6;font-size:18px;font-weight:700">${mine.miners_count}/100</div>
        </div>
      </div>

      ${pct != null ? `
        <div style="margin-top:10px">
          <div style="display:flex;justify-content:space-between;font-size:11px;color:#6b7280;margin-bottom:4px">
            <span>Remaining</span><span>${pct}%</span>
          </div>
          <div style="background:#374151;border-radius:4px;height:6px;overflow:hidden">
            <div style="background:${pct > 50 ? '#f59e0b' : pct > 20 ? '#f97316' : '#ef4444'};
                        width:${pct}%;height:100%;border-radius:4px"></div>
          </div>
        </div>` : ''}

      ${mine.miners_count > 0 ? `
        <div style="margin-top:10px;text-align:center;background:#111827;border-radius:8px;padding:8px">
          <div style="color:#6b7280;font-size:11px">Production rate</div>
          <div style="color:#10b981;font-size:16px;font-weight:700">${rate} Gold/min</div>
        </div>` : ''}
    </div>

    ${mine.status === 'depleted' ? `
      <div style="text-align:center;padding:10px;background:rgba(239,68,68,.1);
                  border:1px solid #ef4444;border-radius:8px;color:#ef4444;font-size:13px;margin-bottom:10px">
        ⚠️ This mine has been depleted
      </div>` : ''}

    ${isOwner && mine.status === 'active' && slots > 0 ? `
      <div style="background:rgba(251,191,36,.05);border:1px solid rgba(251,191,36,.2);
                  border-radius:10px;padding:12px">
        <div style="font-size:13px;font-weight:600;color:#fbbf24;margin-bottom:8px">⛏ Deploy Miners</div>
        <div style="font-size:12px;color:#9ca3af;margin-bottom:8px">
          10,000 GP / miner · <strong style="color:#f3f4f6">${slots}</strong> slots available
        </div>
        <div style="display:flex;gap:8px">
          <input id="gmMinerCount" type="number" min="1" max="${slots}" value="1"
            style="flex:1;background:#111827;color:#f3f4f6;border:1px solid #374151;
                   border-radius:6px;padding:8px 10px;font-size:14px">
          <button id="gmDeployBtn"
            style="background:linear-gradient(135deg,#d97706,#b45309);color:#fff;
                   border:none;border-radius:6px;padding:8px 14px;font-size:13px;
                   font-weight:700;cursor:pointer">Deploy</button>
        </div>
        <div id="gmCostPreview" style="font-size:11px;color:#9ca3af;margin-top:6px;text-align:right">
          Total: 10,000 GP
        </div>
      </div>` : ''}

    ${isOwner && mine.status === 'active' && slots === 0 ? `
      <div style="text-align:center;color:#6b7280;font-size:12px;padding:8px">
        Mine is at full capacity (100 miners)
      </div>` : ''}
  `;

  const inp = document.getElementById('gmMinerCount');
  const preview = document.getElementById('gmCostPreview');
  inp?.addEventListener('input', () => {
    const n = Math.max(1, Math.min(parseInt(inp.value, 10) || 1, slots));
    if (preview) preview.textContent = `Total: ${(n * 10000).toLocaleString()} GP`;
  });

  document.getElementById('gmDeployBtn')?.addEventListener('click', async () => {
    const n = Math.max(1, Math.min(parseInt(inp?.value, 10) || 1, slots));
    await _deployMiners(mine.id, n);
  });
}

async function _deployMiners(mineId, count) {
  const btn = document.getElementById('gmDeployBtn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const fn = httpsCallable(_fns, 'addGoldMiners');
    const { data } = await fn({ mineId, count });
    _mines[mineId] = {
      ..._mines[mineId],
      miners_count:     data.miners_count,
      deposit_revealed: true,
      total_gold:       data.deposit,
    };
    _showToast(`Deployed ${data.added} miner${data.added > 1 ? 's' : ''}! Cost: ${data.totalCost.toLocaleString()} GP`);
    _fillModal(_mines[mineId]);
    if (_markers[mineId]) {
      _markers[mineId].set('title',
        `⛏ Gold Mine | ${_mines[mineId].remain_gold?.toLocaleString() ?? '?'} left`);
    }
  } catch (e) {
    _showToast(e.message ?? 'Failed to deploy miners', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Deploy'; }
  }
}

// ── Install mine (called from shop modal "Install Gold Mine" button) ───────────
// Only storeId needed — server reads shop lat/lng from Firestore directly
export function promptInstallMine(storeId, shopLat, shopLng) {
  document.getElementById('shopModal')?.classList.remove('open');
  _doInstall(storeId, shopLat, shopLng);
}

function _showInstallSuccess(cost) {
  const el = document.getElementById('gmInstallConfirm');
  if (!el) return;
  el.innerHTML = `
    <div style="background:#111827;border:1px solid #16a34a;border-radius:16px;
                width:min(320px,90vw);padding:24px;text-align:center">
      <div style="font-size:40px;margin-bottom:12px">⛏</div>
      <div style="font-size:16px;font-weight:700;color:#4ade80;margin-bottom:8px">Gold Mine Installed!</div>
      <div style="font-size:13px;color:#9ca3af;margin-bottom:20px">
        Cost: <strong style="color:#fbbf24">${cost.toLocaleString()} GP</strong>
      </div>
      <button id="gmSuccessOkBtn"
        style="background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;
               border:none;border-radius:8px;padding:11px 32px;font-size:14px;
               font-weight:700;cursor:pointer">OK</button>
    </div>`;
  el.classList.add('open');
  el.querySelector('#gmSuccessOkBtn').onclick = () => el.classList.remove('open');
}

async function _doInstall(storeId, shopLat, shopLng) {
  if (!_fns) { _showToast('System not ready — refresh the page.', 'error'); return; }
  _showToast('Installing…', 'info');
  try {
    const fn = httpsCallable(_fns, 'createGoldMine');
    const pos = _ctx?.gpsPos
      ?? (isVirtualMode() ? getVirtualPos() : null)
      ?? _ctx?.lastPos;
    const lat = pos?.lat ?? shopLat ?? null;
    const lng = pos?.lng ?? shopLng ?? null;
    const { data } = await fn({ storeId, lat, lng });
    // CF returns lat/lng from shop's Firestore record — use for marker refresh
    const refLat = data.lat ?? shopLat ?? _ctx?.lastPos?.lat ?? _ctx?.gpsPos?.lat;
    const refLng = data.lng ?? shopLng ?? _ctx?.lastPos?.lng ?? _ctx?.gpsPos?.lng;
    await loadGoldMineMarkers(refLat, refLng);
    _showInstallSuccess(data.installCost);
  } catch (e) {
    _showToast(e.message ?? 'Installation failed', 'error');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function _playPickaxeSound() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const now  = ctx.currentTime;

    // Metallic impact burst
    const osc1  = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(900, now);
    osc1.frequency.exponentialRampToValueAtTime(180, now + 0.08);
    gain1.gain.setValueAtTime(0.35, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.18);

    // Ringing overtone
    const osc2  = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1400, now);
    gain2.gain.setValueAtTime(0.15, now);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now);
    osc2.stop(now + 0.4);
  } catch (_) { /* audio not supported */ }
}

function _fmtDist(m) {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

function _showToast(msg, type = 'success') {
  if (typeof window.showToast === 'function') { window.showToast(msg, type); return; }
  // fallback: reuse collectToast element (same pattern as moneytree module)
  const COLORS = { success: '#15803d', error: '#b91c1c', warn: '#b45309', info: '#1d4ed8' };
  const toast = document.getElementById('collectToast');
  if (!toast) return;
  toast.textContent = msg;
  toast.style.cssText = `display:block;position:fixed;bottom:120px;left:50%;transform:translateX(-50%);
    z-index:9999;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:600;
    color:#fff;background:${COLORS[type] ?? COLORS.info};
    box-shadow:0 4px 12px rgba(0,0,0,.4);white-space:nowrap;pointer-events:none;`;
  clearTimeout(toast._gmTimer);
  toast._gmTimer = setTimeout(() => { toast.style.display = 'none'; }, 3000);
}
