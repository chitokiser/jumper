// assets/js/pages/merchants.goldmine.miners.js
// Zombie Villager miner sprites — walk between mine and shop on Google Maps OverlayView

const WALK_FRAMES = 24;
const FRAME_MS    = 80;    // ms per sprite frame
const SPRITE_PX   = 36;   // display size px
const WALK_DUR_S  = 8;    // seconds to traverse the full path each way
const MIN_DIST_M  = 15;   // minimum walk distance if mine == shop (same coords)

const SPRITE_BASE =
  '/assets/images/villager/Zombie_Villager_1/PNG/PNG%20Sequences/Walking/0_Zombie_Villager_Walking_';

function _url(i) {
  return `${SPRITE_BASE}${String(i).padStart(3, '0')}.png`;
}

// Preload all frames at module load
const _imgs = Array.from({ length: WALK_FRAMES }, (_, i) => {
  const img = new Image();
  img.src = _url(i);
  return img;
});

function _hashId(id) {
  let h = 0;
  for (const c of id) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function _visibleCount(n) {
  if (n >= 30) return 3;
  if (n >= 10) return 2;
  return 1;
}

// Haversine distance in meters
function _distM(lat1, lng1, lat2, lng2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

let _map        = null;
let _MinerClass = null;
let _overlays   = {};  // mineId → MinerOverlay[]

export function initMiners(map) {
  _map = map;

  _MinerClass = class extends google.maps.OverlayView {
    constructor(mine, index) {
      super();
      this._mine  = mine;
      this._index = index;

      // Walk path: mine position → shop position
      // If they're the same (< MIN_DIST_M apart), use a fallback direction offset
      const dist = _distM(mine.lat, mine.lng,
        mine.store_lat ?? mine.lat, mine.store_lng ?? mine.lng);

      if (dist >= MIN_DIST_M) {
        // Real shop at different location — walk that path
        this._fromLat = mine.lat;
        this._fromLng = mine.lng;
        this._toLat   = mine.store_lat;
        this._toLng   = mine.store_lng;
      } else {
        // Mine == shop: fabricate a short path in a deterministic direction
        const h     = _hashId(mine.id);
        const angle = ((h + index * 137) % 360) * Math.PI / 180;
        const cosLat = Math.cos(mine.lat * Math.PI / 180);
        const dLat   = (MIN_DIST_M * Math.cos(angle)) / 111320;
        const dLng   = (MIN_DIST_M * Math.sin(angle)) / (111320 * cosLat);
        this._fromLat = mine.lat;
        this._fromLng = mine.lng;
        this._toLat   = mine.lat + dLat;
        this._toLng   = mine.lng + dLng;
      }

      // Stagger starting position along path so miners aren't all at the same spot
      this._t   = (index * 0.4) % 1;
      this._dir = index % 2 === 0 ? 1 : -1;

      this._frame   = (index * 8) % WALK_FRAMES;
      this._frameMs = 0;
      this._lastTs  = null;
      this._rafId   = null;
      this._el      = null;
      this._imgEl   = null;
    }

    onAdd() {
      this._el = document.createElement('div');
      this._el.style.cssText =
        `position:absolute;width:${SPRITE_PX}px;height:${SPRITE_PX}px;` +
        `pointer-events:none;transform-origin:center bottom;`;
      this._imgEl = document.createElement('img');
      this._imgEl.style.cssText = `width:100%;height:100%;image-rendering:pixelated;`;
      this._imgEl.src = _url(this._frame);
      this._el.appendChild(this._imgEl);
      this.getPanes().overlayLayer.appendChild(this._el);
      this._rafId = requestAnimationFrame(ts => this._tick(ts));
    }

    draw() {
      this._reposition();
    }

    onRemove() {
      cancelAnimationFrame(this._rafId);
      this._rafId  = null;
      this._el?.remove();
      this._el     = null;
      this._imgEl  = null;
    }

    _tick(ts) {
      if (!this._el) return;
      const dt = this._lastTs != null ? (ts - this._lastTs) / 1000 : 0;
      this._lastTs = ts;

      // Advance along path
      this._t += this._dir * (dt / WALK_DUR_S);
      if (this._t >= 1) { this._t = 1; this._dir = -1; }
      if (this._t <= 0) { this._t = 0; this._dir = 1; }

      // Advance sprite frame
      this._frameMs += dt * 1000;
      if (this._frameMs >= FRAME_MS) {
        this._frameMs = 0;
        this._frame = (this._frame + 1) % WALK_FRAMES;
        if (this._imgEl) this._imgEl.src = _imgs[this._frame].src;
      }

      // Flip sprite depending on walking direction along path
      // dir=1 means mine→shop; flip based on whether shop is east or west of mine
      const goingToShop = this._dir === 1;
      const shopIsEast  = this._toLng > this._fromLng;
      const facingRight = goingToShop ? shopIsEast : !shopIsEast;
      this._el.style.transform = `scaleX(${facingRight ? 1 : -1})`;

      this._reposition();
      this._rafId = requestAnimationFrame(t => this._tick(t));
    }

    _reposition() {
      const proj = this.getProjection?.();
      if (!proj || !this._el) return;

      // Lerp between from and to positions
      const lat = this._fromLat + (this._toLat - this._fromLat) * this._t;
      const lng = this._fromLng + (this._toLng - this._fromLng) * this._t;

      const pt = proj.fromLatLngToDivPixel(new google.maps.LatLng(lat, lng));
      if (pt) {
        this._el.style.left = `${Math.round(pt.x - SPRITE_PX / 2)}px`;
        this._el.style.top  = `${Math.round(pt.y - SPRITE_PX)}px`;
      }
    }
  };
}

export function updateMiners(mines) {
  if (!_map || !_MinerClass) return;
  const activeIds = new Set(
    mines.filter(m => m.status === 'active' && m.miners_count > 0).map(m => m.id)
  );

  for (const id of Object.keys(_overlays)) {
    if (!activeIds.has(id)) {
      _overlays[id].forEach(o => o.setMap(null));
      delete _overlays[id];
    }
  }

  for (const mine of mines) {
    if (!activeIds.has(mine.id)) continue;
    const desired = _visibleCount(mine.miners_count);
    const cur = _overlays[mine.id] ?? [];

    while (cur.length > desired) cur.pop().setMap(null);
    while (cur.length < desired) {
      const o = new _MinerClass(mine, cur.length);
      o.setMap(_map);
      cur.push(o);
    }
    _overlays[mine.id] = cur;
  }
}

export function clearMiners() {
  for (const arr of Object.values(_overlays)) arr.forEach(o => o.setMap(null));
  _overlays = {};
}
