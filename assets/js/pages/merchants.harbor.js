// assets/js/pages/merchants.harbor.js
// Harbor + Trade Ship system — map markers, modals, CF calls

import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

const HARBOR_ICON   = '/assets/images/shops/dock.png';
const SHIP_ICON     = '/assets/images/shops/ship2.png';
const HARBOR_COST   = 100000;
const SHIP_COST     = 10000;
const MAX_SHIPS     = 10;
const RADIUS_M      = 5000;
const CLAIM_ITVL_MS = 24 * 60 * 60 * 1000;
const GRADE_COEFF   = [0, 10000, 50000, 100000, 200000, 400000, 800000, 1600000, 3200000, 6400000, 12800000];

// Nominatim keywords for sea-zone detection (zoom=8)
const SEA_KEYWORDS  = [
  'sea', 'ocean', 'bay', 'gulf', 'strait', 'channel', 'sound', 'bight',
  'pacific', 'atlantic', 'indian', 'arctic', 'mediterranean', 'caribbean', 'aegean',
  'south china', 'east sea', 'yellow sea', 'java sea', 'banda', 'celebes',
  'sulu', 'coral', 'timor', 'arafura', 'flores', 'makassar', 'malacca',
  'andaman', 'tonkin', 'bismarck', 'solomon', 'philippine', 'sibuyan',
];
const SEA_NATURAL_TYPES = new Set([
  'water', 'sea', 'bay', 'strait', 'gulf', 'ocean', 'channel', 'sound',
  'inlet', 'fjord', 'lagoon', 'reef',
]);

let _fns     = null;
let _map     = null;
let _ctx     = null;
let _uid     = null;
let _markers = {};   // harborId → google.maps.Marker
let _harbors = {};   // harborId → harbor data
let _activeInstall = null; // { clickHandler, circle, cleanup }

export function initHarbor(ctx, map, functions, uid) {
  _ctx = ctx;
  _map = map;
  _fns = functions;
  _uid = uid;
}

export function setHarborUid(uid) { _uid = uid; }

// ── Load / refresh map markers ────────────────────────────────────────────────
export async function loadHarborMarkers(centerLat, centerLng) {
  if (!_map || !_fns || !_uid) return;
  const pos = (centerLat != null && centerLng != null)
    ? { lat: centerLat, lng: centerLng }
    : (_ctx?.lastPos ?? _ctx?.gpsPos);
  if (!pos) return;
  try {
    const fn = httpsCallable(_fns, 'getNearbyHarbors');
    const { data } = await fn({ lat: pos.lat, lng: pos.lng, radiusKm: 25 });
    _renderMarkers(data.harbors ?? []);
  } catch (_) { /* non-critical */ }
}

function _renderMarkers(harbors) {
  const incoming = new Set(harbors.map(h => h.id));
  for (const [id, marker] of Object.entries(_markers)) {
    if (!incoming.has(id)) { marker.setMap(null); delete _markers[id]; delete _harbors[id]; }
  }
  for (const harbor of harbors) {
    _harbors[harbor.id] = harbor;
    if (_markers[harbor.id]) {
      _markers[harbor.id].setPosition({ lat: harbor.lat, lng: harbor.lng });
      continue;
    }
    const marker = new google.maps.Marker({
      position: { lat: harbor.lat, lng: harbor.lng },
      map:      _map,
      icon: {
        url:        HARBOR_ICON,
        scaledSize: new google.maps.Size(40, 40),
        anchor:     new google.maps.Point(20, 40),
      },
      title:  `⚓ Harbor | ${harbor.ship_count}/${MAX_SHIPS} ships`,
      zIndex: 55,
    });
    marker.addListener('click', () => openHarborModal(harbor.id));
    _markers[harbor.id] = marker;
  }
}

// ── Harbor modal ──────────────────────────────────────────────────────────────
export function openHarborModal(harborId) {
  const harbor = _harbors[harborId];
  if (!harbor) return;
  _fillHarborModal(harbor);
  document.getElementById('harborModal')?.classList.add('open');
}

function _fillHarborModal(harbor) {
  const body = document.getElementById('harborModalBody');
  if (!body) return;

  const isOwn    = harbor.owner_id === _uid;
  const isFull   = (harbor.ship_count ?? 0) >= MAX_SHIPS;

  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <img src="${HARBOR_ICON}" style="width:48px;height:48px;border-radius:8px;object-fit:contain">
      <div>
        <div style="font-size:16px;font-weight:700;color:#38bdf8">⚓ Harbor</div>
        <div style="font-size:12px;color:#9ca3af;margin-top:2px">
          Ships: <strong style="color:#f3f4f6">${harbor.ship_count}/${MAX_SHIPS}</strong>
          ${isOwn ? ' · <span style="color:#34d399">Your Harbor</span>' : ''}
        </div>
      </div>
    </div>

    <div style="background:#1f2937;border-radius:10px;padding:12px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="color:#6b7280;font-size:12px">Capacity</span>
        <span style="color:#f3f4f6;font-size:13px;font-weight:600">${harbor.ship_count} / ${MAX_SHIPS}</span>
      </div>
      <div style="background:#374151;border-radius:4px;height:6px;overflow:hidden">
        <div style="background:${isFull ? '#ef4444' : '#0ea5e9'};
                    width:${(harbor.ship_count / MAX_SHIPS * 100).toFixed(0)}%;
                    height:100%;border-radius:4px;transition:width .3s"></div>
      </div>
    </div>

    ${isFull
      ? `<div style="text-align:center;padding:10px;background:rgba(239,68,68,.1);
                     border:1px solid rgba(239,68,68,.3);border-radius:8px;
                     color:#f87171;font-size:13px;margin-bottom:10px">
           Harbor is at full capacity (${MAX_SHIPS} ships)
         </div>`
      : `<button id="harborBuildShipBtn"
           style="width:100%;padding:12px;border-radius:10px;border:none;font-weight:700;
                  font-size:14px;cursor:pointer;display:flex;align-items:center;
                  justify-content:center;gap:8px;
                  background:linear-gradient(135deg,#0369a1,#0284c7);color:#fff;
                  box-shadow:0 3px 12px rgba(3,105,161,.35)">
           <img src="${SHIP_ICON}" style="width:22px;height:22px;object-fit:contain">
           Build Trade Ship — ${SHIP_COST.toLocaleString()} GP
         </button>`}

    <div style="margin-top:10px;padding:10px;background:#111827;border-radius:8px">
      <div style="font-size:11px;color:#6b7280;margin-bottom:4px">Grade is revealed after building (random 1–10)</div>
      <div style="font-size:11px;color:#6b7280">Higher grade → larger daily dividend share from Harbor Jackpot</div>
    </div>
  `;

  document.getElementById('harborBuildShipBtn')?.addEventListener('click', async () => {
    await _doBuildShip(harbor.id);
  });
}

async function _doBuildShip(harborId) {
  const btn = document.getElementById('harborBuildShipBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Building…'; }
  try {
    const fn = httpsCallable(_fns, 'buildTradeShip');
    const { data } = await fn({ harborId });
    // Update local cache
    if (_harbors[harborId]) {
      _harbors[harborId] = { ..._harbors[harborId], ship_count: (_harbors[harborId].ship_count ?? 0) + 1 };
      if (_markers[harborId]) _markers[harborId].setTitle(`⚓ Harbor | ${_harbors[harborId].ship_count}/${MAX_SHIPS} ships`);
    }
    _showToast(`Trade Ship built! Grade ${data.grade} — Cost: ${data.cost.toLocaleString()} GP`);
    document.getElementById('harborModal')?.classList.remove('open');
    _fillHarborModal(_harbors[harborId]);
    document.getElementById('harborModal')?.classList.add('open');
  } catch (e) {
    _showToast(e.message ?? 'Failed to build ship', 'error');
    if (btn) { btn.disabled = false; btn.textContent = `⛵ Build Trade Ship — ${SHIP_COST.toLocaleString()} GP`; }
  }
}

// ── Install harbor (placement flow) ──────────────────────────────────────────
export function promptInstallHarbor(shopId, shopLat, shopLng) {
  _cleanupInstall();

  const circle = new google.maps.Circle({
    map:          _map,
    center:       { lat: shopLat, lng: shopLng },
    radius:       RADIUS_M,
    fillColor:    '#0ea5e9',
    fillOpacity:  0.06,
    strokeColor:  '#0ea5e9',
    strokeOpacity: 0.5,
    strokeWeight: 1.5,
  });

  _showToast('Tap a sea location within 5km of the shop to place harbor. Tap elsewhere to cancel.', 'info');

  const clickHandler = _map.addListener('click', async (e) => {
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();

    const dist = _distM(lat, lng, shopLat, shopLng);
    if (dist > RADIUS_M) {
      _showToast(`Too far from shop (${Math.round(dist)}m). Must be within 5km.`, 'error');
      return;
    }

    _showToast('Checking sea zone…', 'info');
    const isSea = await _checkSeaZone(lat, lng);
    if (!isSea) {
      _showToast('Not a sea zone. Try a point further into open water.', 'error');
      return;
    }

    _cleanupInstall();
    _showInstallConfirm(shopId, lat, lng);
  });

  _activeInstall = {
    clickHandler,
    circle,
    cleanup: _cleanupInstall,
  };
}

function _cleanupInstall() {
  if (!_activeInstall) return;
  google.maps.event.removeListener(_activeInstall.clickHandler);
  _activeInstall.circle?.setMap(null);
  _activeInstall = null;
}

function _showInstallConfirm(shopId, lat, lng) {
  const el = document.getElementById('harborInstallConfirm');
  if (!el) return;
  el.innerHTML = `
    <div style="background:#111827;border:1px solid #0ea5e9;border-radius:16px;
                width:min(340px,92vw);padding:24px;text-align:center">
      <div style="font-size:40px;margin-bottom:12px">⚓</div>
      <div style="font-size:16px;font-weight:700;color:#38bdf8;margin-bottom:8px">Install Harbor?</div>
      <div style="font-size:13px;color:#9ca3af;margin-bottom:20px;line-height:1.5">
        Cost: <strong style="color:#fbbf24">${HARBOR_COST.toLocaleString()} GP</strong><br>
        <span style="font-size:11px">Location verified as sea zone</span>
      </div>
      <div style="display:flex;gap:10px">
        <button id="harborConfirmCancelBtn"
          style="flex:1;padding:11px;border-radius:8px;border:1px solid #374151;
                 background:transparent;color:#9ca3af;font-size:14px;cursor:pointer">Cancel</button>
        <button id="harborConfirmOkBtn"
          style="flex:1;padding:11px;border-radius:8px;border:none;
                 background:linear-gradient(135deg,#0369a1,#0284c7);
                 color:#fff;font-size:14px;font-weight:700;cursor:pointer">Install</button>
      </div>
    </div>`;
  el.classList.add('open');

  document.getElementById('harborConfirmCancelBtn').onclick = () => el.classList.remove('open');
  document.getElementById('harborConfirmOkBtn').onclick = async () => {
    const btn = document.getElementById('harborConfirmOkBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Installing…'; }
    try {
      const fn = httpsCallable(_fns, 'installHarbor');
      const { data } = await fn({ shopId, lat, lng, seaZone: true });
      el.classList.remove('open');
      // Immediately place marker — replaced by real data when background refresh completes
      if (data.harborId && _map) {
        const harborId = data.harborId;
        _harbors[harborId] = { id: harborId, owner_id: _uid, lat, lng, ship_count: 0, status: 'active' };
        const marker = new google.maps.Marker({
          position: { lat, lng },
          map: _map,
          icon: { url: HARBOR_ICON, scaledSize: new google.maps.Size(40, 40), anchor: new google.maps.Point(20, 40) },
          title: `⚓ Harbor | 0/${MAX_SHIPS} ships`,
          zIndex: 55,
        });
        marker.addListener('click', () => openHarborModal(harborId));
        _markers[harborId] = marker;
      }
      loadHarborMarkers(lat, lng); // background refresh — no await
      _showToast(`Harbor installed! Cost: ${data.cost.toLocaleString()} GP | Jackpot: ${data.newJackpot.toLocaleString()} GP`);
    } catch (e) {
      _showToast(e.message ?? 'Installation failed', 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Install'; }
    }
  };
}

// ── SV modal — my ships & jackpot ─────────────────────────────────────────────
export async function openSvModal() {
  const el = document.getElementById('harborSvModal');
  if (!el) return;
  el.classList.add('open');
  await _fillSvModal();
}

async function _fillSvModal() {
  const body = document.getElementById('harborSvBody');
  if (!body) return;
  body.innerHTML = `<div style="text-align:center;padding:24px;color:#6b7280">Loading…</div>`;

  try {
    const fn     = httpsCallable(_fns, 'getMyShips');
    const { data } = await fn({});
    _renderSvBody(body, data);
  } catch (e) {
    body.innerHTML = `<div style="text-align:center;padding:24px;color:#ef4444">${e.message ?? 'Failed to load ships'}</div>`;
  }
}

function _renderSvBody(body, data) {
  const { ships = [], jackpot = 0, totalDailyDiv = 0, eligibleCount = 0 } = data;

  const jackpotHtml = `
    <div style="background:linear-gradient(135deg,#0c4a6e,#0369a1);border-radius:12px;
                padding:14px;margin-bottom:14px;text-align:center">
      <div style="font-size:11px;color:#7dd3fc;margin-bottom:4px">Harbor Jackpot</div>
      <div style="font-size:22px;font-weight:800;color:#38bdf8">${jackpot.toLocaleString()} GP</div>
      ${totalDailyDiv > 0
        ? `<div style="font-size:11px;color:#7dd3fc;margin-top:4px">Your daily share: ${totalDailyDiv.toLocaleString()} GP</div>`
        : ''}
    </div>`;

  if (ships.length === 0) {
    body.innerHTML = jackpotHtml + `
      <div style="text-align:center;padding:20px;color:#6b7280">
        <div style="font-size:36px;margin-bottom:8px">⛵</div>
        <div style="font-size:14px;margin-bottom:6px">No trade ships yet</div>
        <div style="font-size:12px">Find a harbor on the map and build a ship for ${SHIP_COST.toLocaleString()} GP</div>
      </div>`;
    return;
  }

  const rows = ships.map(s => {
    const nextLabel = s.canClaim
      ? '<span style="color:#34d399;font-weight:700">Ready!</span>'
      : `<span style="color:#9ca3af">${_fmtCountdown(s.nextClaimMs - Date.now())}</span>`;
    return `
      <div style="background:#1f2937;border-radius:10px;padding:12px;margin-bottom:8px;
                  display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;border-radius:8px;position:relative;
                    background:${_gradeColor(s.grade)};display:flex;align-items:center;
                    justify-content:center;flex-shrink:0">
          <img src="${SHIP_ICON}" style="width:26px;height:26px;object-fit:contain">
          <span style="position:absolute;bottom:-1px;right:-1px;font-size:9px;font-weight:800;
                       background:${_gradeColor(s.grade)};color:#fff;border-radius:3px;
                       padding:0 2px;line-height:1.5">G${s.grade}</span>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:#f3f4f6">Grade ${s.grade}</div>
          <div style="font-size:11px;color:#6b7280">Daily: ${s.dailyDiv.toLocaleString()} GP · ${s.daysLeft}d left</div>
        </div>
        <div style="text-align:right;font-size:12px">${nextLabel}</div>
      </div>`;
  }).join('');

  const claimBtn = eligibleCount > 0
    ? `<button id="svClaimAllBtn"
         style="width:100%;padding:13px;border-radius:10px;border:none;font-weight:700;
                font-size:14px;cursor:pointer;margin-top:4px;
                background:linear-gradient(135deg,#0369a1,#0284c7);color:#fff;
                box-shadow:0 3px 12px rgba(3,105,161,.35)">
         ⛵ Claim Dividends (${eligibleCount} ship${eligibleCount > 1 ? 's' : ''})
       </button>`
    : `<button disabled
         style="width:100%;padding:13px;border-radius:10px;border:none;font-weight:700;
                font-size:14px;background:#1f2937;color:#4b5563;margin-top:4px;cursor:not-allowed">
         Nothing to claim yet
       </button>`;

  body.innerHTML = jackpotHtml + `<div style="max-height:320px;overflow-y:auto">${rows}</div>` + claimBtn;

  document.getElementById('svClaimAllBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('svClaimAllBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Claiming…'; }
    try {
      const fn = httpsCallable(_fns, 'claimShipDividend');
      const { data: res } = await fn({});
      if (res.claimed > 0) {
        _showToast(`Claimed ${res.claimed.toLocaleString()} GP from ${res.shipCount} ship${res.shipCount > 1 ? 's' : ''}!`);
      } else {
        _showToast(res.message ?? 'Nothing claimed', 'warn');
      }
      await _fillSvModal();
    } catch (e) {
      _showToast(e.message ?? 'Claim failed', 'error');
      if (btn) { btn.disabled = false; btn.textContent = `⛵ Claim Dividends`; }
    }
  });
}

// ── Sea zone detection via Nominatim ─────────────────────────────────────────
async function _checkSeaZone(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=8&accept-language=en`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'JumperDAO/1.0', 'Accept-Language': 'en' },
    });
    // Rate-limited or unavailable — let the user proceed (CF doesn't independently verify)
    if (!res.ok) return true;
    const d = await res.json();
    // "Unable to geocode" → open ocean with no land features
    if (d.error) return true;
    // OSM natural water body: class=natural, type=water/sea/bay/...
    if (d.class === 'natural' && SEA_NATURAL_TYPES.has(d.type)) return true;
    // Waterway/coastline
    if (d.class === 'waterway') return true;
    const text = [
      d.display_name ?? '',
      d.type         ?? '',
      d.class        ?? '',
      d.name         ?? '',
      JSON.stringify(d.address ?? {}),
    ].join(' ').toLowerCase();
    return SEA_KEYWORDS.some(k => text.includes(k));
  } catch (_) {
    // Network error — let the user proceed
    return true;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function _distM(lat1, lng1, lat2, lng2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _fmtCountdown(ms) {
  if (ms <= 0) return 'Ready';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function _gradeColor(grade) {
  const colors = ['', '#6b7280', '#16a34a', '#0284c7', '#7c3aed', '#d97706',
                  '#dc2626', '#db2777', '#0e7490', '#b45309', '#92400e'];
  return colors[grade] ?? '#374151';
}

function _showToast(msg, type = 'success') {
  if (typeof window.showToast === 'function') { window.showToast(msg, type); return; }
  const COLORS = { success: '#15803d', error: '#b91c1c', warn: '#b45309', info: '#1d4ed8' };
  const toast  = document.getElementById('collectToast');
  if (!toast) return;
  toast.textContent  = msg;
  toast.style.cssText = `display:block;position:fixed;bottom:120px;left:50%;transform:translateX(-50%);
    z-index:9999;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:600;
    color:#fff;background:${COLORS[type] ?? COLORS.info};
    box-shadow:0 4px 12px rgba(0,0,0,.4);white-space:nowrap;pointer-events:none;`;
  clearTimeout(toast._hrTimer);
  toast._hrTimer = setTimeout(() => { toast.style.display = 'none'; }, 3500);
}
