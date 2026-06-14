// assets/js/pages/merchants.harbor.js
// Harbor + Trade Ship system — map markers, modals, CF calls

import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { setMovementEnabled } from './merchants.virtual.js';

const HARBOR_ICON   = '/assets/images/shops/dock.png';
const SHIP_ICON     = '/assets/images/shops/ship2.png'; // side-view for UI
const SHIP_ICON_MAP = '/assets/images/shops/ship.png';  // top-down fallback
const SHIP_SPRITES  = [
  '/assets/images/shops/ship/1.png',
  '/assets/images/shops/ship/2.png',
  '/assets/images/shops/ship/3.png',
  '/assets/images/shops/ship/4.png',
];
const HARBOR_COST   = 100000;
const SHIP_COST     = 10000;
const MAX_SHIPS     = 10;
const RADIUS_M      = 5000;
const CLAIM_ITVL_MS = 24 * 60 * 60 * 1000;
const GRADE_COEFF   = [0, 10000, 50000, 100000, 200000, 400000, 800000, 1600000, 3200000, 6400000, 12800000];

// Nominatim keywords — sea AND coastal features (harbors sit at water's edge)
const SEA_KEYWORDS  = [
  'sea', 'ocean', 'bay', 'gulf', 'strait', 'channel', 'sound', 'bight',
  'pacific', 'atlantic', 'indian', 'arctic', 'mediterranean', 'caribbean', 'aegean',
  'south china', 'east sea', 'yellow sea', 'java sea', 'banda', 'celebes',
  'sulu', 'coral', 'timor', 'arafura', 'flores', 'makassar', 'malacca',
  'andaman', 'tonkin', 'bismarck', 'solomon', 'philippine', 'sibuyan',
  'vinh', 'vịnh', 'halong', 'ha long', 'laut', 'mer ', 'meer', 'mar ', 'mare',
  'bahia', 'baie', 'bucht', 'fjord', 'firth', 'manche', 'kanal',
  // coastal landmarks
  'coast', 'harbor', 'harbour', 'port', 'pier', 'marina', 'wharf', 'dock',
  'jetty', 'waterfront', 'beach', 'shoreline', 'littoral', 'quay', 'cove',
];
const SEA_NATURAL_TYPES = new Set([
  'water', 'sea', 'bay', 'strait', 'gulf', 'ocean', 'channel', 'sound',
  'inlet', 'fjord', 'lagoon', 'reef', 'coastline', 'beach',  // beach = valid harbor edge
]);
// OSM address keys that indicate a water body or coastal feature
const SEA_ADDR_KEYS = new Set(['sea', 'ocean', 'bay', 'body_of_water', 'gulf', 'strait', 'harbour', 'marina', 'beach']);
// Coastal man_made / amenity / leisure / landuse subtypes (valid harbor locations)
const COASTAL_MAN_MADE = new Set(['pier', 'jetty', 'breakwater', 'groyne', 'harbour', 'dock', 'wharf', 'quay', 'seawall']);
const COASTAL_AMENITY  = new Set(['ferry_terminal', 'boat_rental']);
const COASTAL_LEISURE  = new Set(['marina', 'slipway', 'boat_storage']);
const COASTAL_LANDUSE  = new Set(['port', 'harbour', 'dock']);

let _fns     = null;
let _map     = null;
let _ctx     = null;
let _uid     = null;
let _markers    = {};   // harborId → google.maps.Marker
let _harbors    = {};   // harborId → harbor data
let _animations = {};   // harborId → { active: bool, marker: Marker|null }
let _activeInstall = null; // { clickHandler, circle, cleanup }
const _harborBearings = {}; // harborId → sea-facing bearing (radians)

// ── Zoom-responsive sizing ────────────────────────────────────────────────────
function _harborSize(zoom) {
  if (zoom >= 16) return 54;
  if (zoom >= 14) return 44;
  if (zoom >= 12) return 34;
  if (zoom >= 10) return 24;
  if (zoom >= 8)  return 16;
  return 10;
}
function _shipAnimSize(zoom) {
  if (zoom >= 16) return 52;
  if (zoom >= 14) return 40;
  if (zoom >= 12) return 30;
  if (zoom >= 10) return 20;
  if (zoom >= 8)  return 13;
  return 8;
}
function _onZoomChanged() {
  if (!_map) return;
  const sz      = _harborSize(_map.getZoom());
  const dockImg = _imgCache[HARBOR_ICON];
  for (const [id, marker] of Object.entries(_markers)) {
    if (dockImg) {
      marker.setIcon({
        url:        _rotatedDockUrl(dockImg, sz * 2, _harborBearings[id] ?? 0),
        scaledSize: new google.maps.Size(sz, sz),
        anchor:     new google.maps.Point(sz / 2, sz / 2),
      });
    } else {
      marker.setIcon({
        url:        HARBOR_ICON,
        scaledSize: new google.maps.Size(sz, sz),
        anchor:     new google.maps.Point(sz / 2, sz / 2),
      });
    }
  }
}

export function initHarbor(ctx, map, functions, uid) {
  _ctx = ctx;
  _map = map;
  _fns = functions;
  _uid = uid;
  map.addListener('zoom_changed', _onZoomChanged);
  // Preload all ship/dock images so rotated icons are ready immediately
  _loadImg(HARBOR_ICON);
  SHIP_SPRITES.forEach(url => _loadImg(url));
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
    if (!incoming.has(id)) {
      marker.setMap(null);
      delete _markers[id];
      delete _harbors[id];
      _stopHarborAnim(id);
    }
  }
  for (const harbor of harbors) {
    _harbors[harbor.id] = harbor;
    // Compute bearing from shop → harbor = direction toward sea
    _harborBearings[harbor.id] = (harbor.shop_lat != null && harbor.shop_lng != null)
      ? _bearing(harbor.shop_lat, harbor.shop_lng, harbor.lat, harbor.lng)
      : 0;
    if (_markers[harbor.id]) {
      _markers[harbor.id].setPosition({ lat: harbor.lat, lng: harbor.lng });
      continue;
    }
    const _sz     = _harborSize(_map.getZoom());
    const dockImg = _imgCache[HARBOR_ICON];
    const bearing = _harborBearings[harbor.id];
    const marker  = new google.maps.Marker({
      position: { lat: harbor.lat, lng: harbor.lng },
      map:      _map,
      icon: dockImg
        ? { url: _rotatedDockUrl(dockImg, _sz * 2, bearing), scaledSize: new google.maps.Size(_sz, _sz), anchor: new google.maps.Point(_sz / 2, _sz / 2) }
        : { url: HARBOR_ICON, scaledSize: new google.maps.Size(_sz, _sz), anchor: new google.maps.Point(_sz / 2, _sz / 2) },
      title:  `⚓ Harbor | ${harbor.ship_count}/${MAX_SHIPS} ships`,
      zIndex: 55,
    });
    marker.addListener('click', () => openHarborModal(harbor.id));
    _markers[harbor.id] = marker;
    // If dock image was still loading, apply rotated icon once it finishes
    if (!dockImg) {
      _loadImg(HARBOR_ICON).then(img => {
        const m  = _markers[harbor.id];
        if (!img || !m) return;
        const sz = _harborSize(_map?.getZoom() ?? 14);
        const br = _harborBearings[harbor.id] ?? 0;
        m.setIcon({ url: _rotatedDockUrl(img, sz * 2, br), scaledSize: new google.maps.Size(sz, sz), anchor: new google.maps.Point(sz / 2, sz / 2) });
      });
    }
    _startHarborAnim(harbor);
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

    ${isOwn ? `<button id="harborDeleteBtn"
        style="width:100%;margin-top:10px;padding:10px;border-radius:8px;border:1px solid rgba(239,68,68,.4);
               background:rgba(239,68,68,.08);color:#f87171;font-size:13px;font-weight:600;cursor:pointer">
        🗑 Delete Harbor
      </button>` : ''}
  `;

  document.getElementById('harborBuildShipBtn')?.addEventListener('click', async () => {
    await _doBuildShip(harbor.id);
  });
  document.getElementById('harborDeleteBtn')?.addEventListener('click', () => {
    _doDeleteHarbor(harbor.id);
  });
}

async function _doBuildShip(harborId) {
  const btn = document.getElementById('harborBuildShipBtn');
  await _withBtn(btn, async () => {
    const fn = httpsCallable(_fns, 'buildTradeShip');
    const { data } = await fn({ harborId });
    if (_harbors[harborId]) {
      _harbors[harborId] = { ..._harbors[harborId], ship_count: (_harbors[harborId].ship_count ?? 0) + 1 };
      if (_markers[harborId]) _markers[harborId].setTitle(`⚓ Harbor | ${_harbors[harborId].ship_count}/${MAX_SHIPS} ships`);
    }
    _showToast(`Trade Ship built! Grade ${data.grade} — Cost: ${data.cost.toLocaleString()} GP`);
    if (_harbors[harborId]) _animateShipDeparture(_harbors[harborId]);
    document.getElementById('harborModal')?.classList.remove('open');
    _fillHarborModal(_harbors[harborId]);
    document.getElementById('harborModal')?.classList.add('open');
  }).catch(e => _showToast(e.message ?? 'Failed to build ship', 'error'));
}

// ── Canvas image cache + rotation ─────────────────────────────────────────────
const _imgCache = {};
function _loadImg(url) {
  return new Promise(r => {
    if (_imgCache[url]) { r(_imgCache[url]); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { _imgCache[url] = img; r(img); };
    img.onerror = () => r(null);
    img.src = url;
  });
}
function _rotatedIconUrl(img, size, bearingRad, flipH = false) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(bearingRad - Math.PI / 2); // ship.png faces East (right)
  if (flipH) ctx.scale(-1, 1);          // mirror bow direction without flipping upside-down
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
  return c.toDataURL('image/png');
}
function _rotatedDockUrl(img, size, bearingRad) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(bearingRad - Math.PI / 2); // dock.png faces East by default
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
  return c.toDataURL('image/png');
}

// ── Ship departure animation (one-shot on new ship built) ─────────────────────
async function _animateShipDeparture(harbor) {
  if (!_map) return;
  const zoom     = _map.getZoom() ?? 14;
  const SZ_BIG   = _shipAnimSize(zoom);
  const SZ_SMALL = Math.max(4, Math.floor(SZ_BIG * 0.15));
  const STEPS    = 100;
  const STEP_MS  = 100;
  const STEP_M   = 20;

  const bearing = (harbor.shop_lat != null && harbor.shop_lng != null)
    ? _bearing(harbor.shop_lat, harbor.shop_lng, harbor.lat, harbor.lng)
    : Math.PI;

  // Single frame: load first sprite or fallback; rotate bow toward sea
  const img = (await _loadImg(SHIP_SPRITES[0])) ?? (await _loadImg(SHIP_ICON_MAP));
  const iconUrl = img ? _rotatedIconUrl(img, 128, bearing) : SHIP_ICON_MAP;

  const mkIcon = (url, sz) => ({
    url, scaledSize: new google.maps.Size(sz, sz),
    anchor: new google.maps.Point(sz / 2, sz / 2),
  });

  let pos  = { lat: harbor.lat, lng: harbor.lng };
  let step = 0;
  const m  = new google.maps.Marker({
    position: pos, map: _map, icon: mkIcon(iconUrl, SZ_BIG),
    clickable: false, zIndex: 60,
  });
  const ease = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  const tick = () => {
    step++;
    if (step > STEPS) { m.setMap(null); return; }
    const t  = ease(step / STEPS);
    const sz = Math.round(SZ_BIG + (SZ_SMALL - SZ_BIG) * t);
    pos = _destPoint(pos.lat, pos.lng, bearing, STEP_M);
    m.setPosition(pos);
    m.setOpacity(1 - t);
    m.setIcon(mkIcon(iconUrl, sz));
    setTimeout(tick, STEP_MS);
  };
  setTimeout(tick, STEP_MS);
}

// ── Harbor ship loop animation (departure + arrival simultaneously) ────────────
async function _startHarborAnim(harbor) {
  if (_animations[harbor.id]?.active) return;
  const anim = { active: true, markers: [] };
  _animations[harbor.id] = anim;

  const STEPS    = 100; // 100 × 20m × 100ms = 2km, 10s per leg
  const STEP_MS  = 100;
  const STEP_M   = 20;
  const SEA_DIST = STEPS * STEP_M;

  const bearing = (harbor.shop_lat != null && harbor.shop_lng != null)
    ? _bearing(harbor.shop_lat, harbor.shop_lng, harbor.lat, harbor.lng)
    : Math.PI;

  // Single image: first sprite or fallback
  const img = (await _loadImg(SHIP_SPRITES[0])) ?? (await _loadImg(SHIP_ICON_MAP));
  if (!anim.active) return;

  // Two pre-baked icons: bow toward sea (depart) and bow toward harbor (arrive via horizontal mirror)
  const departIcon = img ? _rotatedIconUrl(img, 128, bearing)        : SHIP_ICON_MAP;
  const arriveIcon = img ? _rotatedIconUrl(img, 128, bearing, true)  : SHIP_ICON_MAP;

  function _ease(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }
  function mkIcon(url, sz) {
    return { url, scaledSize: new google.maps.Size(sz, sz), anchor: new google.maps.Point(sz / 2, sz / 2) };
  }

  function runLeg(isDepart, done) {
    if (!anim.active || !_map) { done(); return; }
    const zoom     = _map.getZoom() ?? 14;
    const SZ_BIG   = _shipAnimSize(zoom);
    const SZ_SMALL = Math.max(4, Math.floor(SZ_BIG * 0.13));
    const moveBr   = isDepart ? bearing : bearing + Math.PI;
    const iconUrl  = isDepart ? departIcon : arriveIcon;

    let pos = isDepart
      ? { lat: harbor.lat, lng: harbor.lng }
      : _destPoint(harbor.lat, harbor.lng, bearing, SEA_DIST);

    const m = new google.maps.Marker({
      position: pos, map: _map,
      icon: mkIcon(iconUrl, isDepart ? SZ_BIG : SZ_SMALL),
      clickable: false, zIndex: 58,
    });
    m.setOpacity(isDepart ? 1 : 0.18);
    anim.markers.push(m);

    let step = 0;
    const tick = () => {
      if (!anim.active) { m.setMap(null); anim.markers = anim.markers.filter(x => x !== m); return; }
      step++;
      if (step > STEPS) {
        m.setMap(null); anim.markers = anim.markers.filter(x => x !== m); done(); return;
      }
      const t  = _ease(step / STEPS);
      const sz = isDepart
        ? Math.round(SZ_BIG   + (SZ_SMALL - SZ_BIG)  * t)
        : Math.round(SZ_SMALL + (SZ_BIG   - SZ_SMALL) * t);
      pos = _destPoint(pos.lat, pos.lng, moveBr, STEP_M);
      m.setPosition(pos);
      m.setOpacity(isDepart ? (1 - t * 0.82) : (0.18 + t * 0.82));
      m.setIcon(mkIcon(iconUrl, sz));
      setTimeout(tick, STEP_MS);
    };
    setTimeout(tick, STEP_MS);
  }

  function loop() {
    if (!anim.active) return;
    let d = false, a = false;
    const check = () => { if (d && a && anim.active) setTimeout(loop, 3000); };
    runLeg(true,  () => { d = true; check(); });
    runLeg(false, () => { a = true; check(); });
  }

  loop();
}

function _stopHarborAnim(harborId) {
  const anim = _animations[harborId];
  if (!anim) return;
  anim.active = false;
  (anim.markers || []).forEach(m => m?.setMap(null));
  anim.shipMarker?.setMap(null);
  delete _animations[harborId];
}

function _bearing(lat1, lng1, lat2, lng2) {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const y    = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
  const x    = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180)
              - Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
  return Math.atan2(y, x);
}

function _destPoint(lat, lng, bearingRad, distM) {
  const R   = 6371000;
  const d   = distM / R;
  const lat1 = lat * Math.PI / 180;
  const lng1 = lng * Math.PI / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearingRad)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearingRad) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
  );
  return { lat: lat2 * 180 / Math.PI, lng: lng2 * 180 / Math.PI };
}

async function _doDeleteHarbor(harborId) {
  if (!confirm('Delete this harbor? This cannot be undone. (Ships must have all expired first.)')) return;
  try {
    const fn = httpsCallable(_fns, 'deleteHarbor');
    await fn({ harborId });
    _showToast('Harbor deleted.');
    _stopHarborAnim(harborId);
    if (_markers[harborId]) { _markers[harborId].setMap(null); delete _markers[harborId]; }
    delete _harbors[harborId];
    document.getElementById('harborModal')?.classList.remove('open');
  } catch (e) {
    _showToast(e.message ?? 'Failed to delete harbor', 'error');
  }
}

// ── Install harbor (placement flow) ──────────────────────────────────────────
export function promptInstallHarbor(shopId, shopLat, shopLng) {
  _cleanupInstall();
  setMovementEnabled(false);

  const circle = new google.maps.Circle({
    map:           _map,
    center:        { lat: shopLat, lng: shopLng },
    radius:        RADIUS_M,
    fillColor:     '#0ea5e9',
    fillOpacity:   0.06,
    strokeColor:   '#0ea5e9',
    strokeOpacity: 0.5,
    strokeWeight:  1.5,
    clickable:     false,
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.id = 'harborInstallCancelBtn';
  cancelBtn.textContent = '✕ Cancel';
  cancelBtn.setAttribute('data-fs-modal', '');
  cancelBtn.style.cssText = `position:fixed;bottom:140px;left:50%;transform:translateX(-50%);
    z-index:9990;padding:10px 22px;border-radius:20px;border:none;
    background:rgba(239,68,68,.9);color:#fff;font-size:13px;font-weight:700;
    cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.5);white-space:nowrap;`;
  cancelBtn.onclick = () => { _cleanupInstall(); _showToast('Harbor installation cancelled.', 'warn'); };
  (document.fullscreenElement || document.webkitFullscreenElement || document.body).appendChild(cancelBtn);

  _showToast('Tap a sea location inside the blue circle to place harbor.', 'info');

  const clickHandler = _map.addListener('click', async (e) => {
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    const dist = _distM(lat, lng, shopLat, shopLng);
    if (dist > RADIUS_M) {
      _cleanupInstall();
      _showToast('Too far from shop — cancelled. Re-open the shop to try again.', 'warn');
      return;
    }
    _showToast('Checking location…', 'info');
    const isSea = await _checkSeaZone(lat, lng);
    if (!isSea) {
      _showToast("⛔ Harbor must be placed on the coast or at sea. Tap near the water's edge.", 'warn');
      return;
    }
    _cleanupInstall();
    _showInstallConfirm(shopId, lat, lng);
  });

  _activeInstall = { clickHandler, circle, cancelBtn };
}

function _cleanupInstall() {
  if (!_activeInstall) return;
  google.maps.event.removeListener(_activeInstall.clickHandler);
  _activeInstall.circle?.setMap(null);
  _activeInstall.cancelBtn?.remove();
  _activeInstall = null;
  setMovementEnabled(true);
}

function _showInstallConfirm(shopId, lat, lng) {
  const el = document.getElementById('harborInstallConfirm');
  if (!el) return;
  const fsRoot = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsRoot && el.parentElement !== fsRoot) fsRoot.appendChild(el);
  el.innerHTML = `
    <div style="background:#111827;border:1px solid #0ea5e9;border-radius:16px;
                width:min(340px,92vw);padding:24px;text-align:center">
      <div style="font-size:40px;margin-bottom:12px">⚓</div>
      <div style="font-size:16px;font-weight:700;color:#38bdf8;margin-bottom:8px">Install Harbor?</div>
      <div style="font-size:13px;color:#9ca3af;margin-bottom:20px;line-height:1.5">
        Cost: <strong style="color:#fbbf24">${HARBOR_COST.toLocaleString()} GP</strong><br>
        <span style="font-size:11px">⚠️ Confirm this point is on the coast or at sea</span>
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
    await _withBtn(btn, async () => {
      const fn = httpsCallable(_fns, 'installHarbor');
      const { data } = await fn({ shopId, lat, lng, seaZone: true });
      el.classList.remove('open');
      if (data.harborId && _map) {
        const harborId = data.harborId;
        _harbors[harborId] = { id: harborId, owner_id: _uid, lat, lng, ship_count: 0, status: 'active' };
        _harborBearings[harborId] = 0;
        const _isz    = _harborSize(_map?.getZoom() ?? 14);
        const dockImg = _imgCache[HARBOR_ICON];
        const marker  = new google.maps.Marker({
          position: { lat, lng },
          map: _map,
          icon: dockImg
            ? { url: _rotatedDockUrl(dockImg, _isz * 2, 0), scaledSize: new google.maps.Size(_isz, _isz), anchor: new google.maps.Point(_isz / 2, _isz / 2) }
            : { url: HARBOR_ICON, scaledSize: new google.maps.Size(_isz, _isz), anchor: new google.maps.Point(_isz / 2, _isz / 2) },
          title: `⚓ Harbor | 0/${MAX_SHIPS} ships`,
          zIndex: 55,
        });
        marker.addListener('click', () => openHarborModal(harborId));
        _markers[harborId] = marker;
      }
      loadHarborMarkers(lat, lng);
      _showToast(`Harbor installed! Cost: ${data.cost.toLocaleString()} GP | Jackpot: ${data.newJackpot.toLocaleString()} GP`);
    }).catch(e => _showToast(e.message ?? 'Installation failed', 'error'));
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
    await _withBtn(btn, async () => {
      const fn = httpsCallable(_fns, 'claimShipDividend');
      const { data: res } = await fn({});
      if (res.claimed > 0) {
        _showToast(`Claimed ${res.claimed.toLocaleString()} GP from ${res.shipCount} ship${res.shipCount > 1 ? 's' : ''}!`);
      } else {
        _showToast(res.message ?? 'Nothing claimed', 'warn');
      }
      await _fillSvModal();
    }).catch(e => _showToast(e.message ?? 'Claim failed', 'error'));
  });
}

// ── Coastal / sea zone detection via Nominatim ───────────────────────────────
// Harbors sit at water's edge — accept pure sea AND coastal land features.
// Only truly-inland OSM classes trigger an immediate rejection.
const LAND_CLASSES = new Set(['highway', 'building', 'shop', 'railway']);

async function _checkSeaZone(lat, lng) {
  // Try 3 zoom levels: 10 (local) → 8 (regional) → 6 (continental)
  for (const zoom of [10, 8, 6]) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=${zoom}&accept-language=en`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'JumperDAO/1.0', 'Accept-Language': 'en' },
      });
      if (!res.ok) return true; // rate-limited → allow
      const d = await res.json();
      if (d.error) return true; // open ocean / no feature

      // ── Positive: sea / water body ──────────────────────────────────────────
      if (d.class === 'natural' && SEA_NATURAL_TYPES.has(d.type)) return true;
      if (d.class === 'place'   && (d.type === 'sea' || d.type === 'ocean')) return true;
      if (d.class === 'waterway') return true;
      // ── Positive: coastal infrastructure (piers, marinas, ports…) ───────────
      if (d.class === 'man_made' && COASTAL_MAN_MADE.has(d.type)) return true;
      if (d.class === 'amenity'  && COASTAL_AMENITY.has(d.type))  return true;
      if (d.class === 'leisure'  && COASTAL_LEISURE.has(d.type))  return true;
      if (d.class === 'landuse'  && COASTAL_LANDUSE.has(d.type))  return true;
      // ── Positive: address contains a sea/harbour key ─────────────────────────
      if (Object.keys(d.address ?? {}).some(k => SEA_ADDR_KEYS.has(k))) return true;
      const text = [
        d.display_name ?? '', d.type ?? '', d.class ?? '', d.name ?? '',
        JSON.stringify(d.address ?? {}),
      ].join(' ').toLowerCase();
      if (SEA_KEYWORDS.some(k => text.includes(k))) return true;

      // ── Definitive inland-only → reject immediately ──────────────────────────
      // (highway, building, shop, railway — never coastal)
      if (LAND_CLASSES.has(d.class)) return false;

      // ── Ambiguous (amenity/man_made/landuse/place/boundary/…) → next zoom ───
    } catch (_) {
      return true; // network error → allow
    }
  }

  // All 3 Nominatim zooms were ambiguous.
  // Final check: is there a sea coastline within 500m? (handles unmapped open ocean)
  // "natural=coastline" in OSM is exclusively for ocean/sea shores — not river banks.
  try {
    const q = `[out:json][timeout:8];way["natural"="coastline"](around:500,${lat},${lng});out count;`;
    const res = await fetch(
      `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`,
      { headers: { 'User-Agent': 'JumperDAO/1.0' } },
    );
    if (res.ok) {
      const data = await res.json();
      if (parseInt(data.elements?.[0]?.tags?.total ?? '0', 10) > 0) return true;
    }
  } catch (_) { /* API failure → reject */ }

  return false; // definitively not coastal
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

// ── _withBtn — disable + spinner for a button during an async op ──────────────
function _withBtn(btn, asyncFn) {
  if (typeof window.withBtn === 'function') return window.withBtn(btn, asyncFn);
  if (!btn || btn.dataset.pending) return Promise.resolve();
  btn.dataset.pending = '1';
  const orig = btn.innerHTML; const origD = btn.disabled;
  btn.disabled = true;
  btn.innerHTML = '<span style="display:inline-block;width:13px;height:13px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:_spin .55s linear infinite;vertical-align:middle"></span>';
  return Promise.resolve().then(asyncFn).finally(() => {
    delete btn.dataset.pending; btn.disabled = origD; btn.innerHTML = orig;
  });
}
