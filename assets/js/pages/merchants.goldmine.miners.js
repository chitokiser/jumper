// assets/js/pages/merchants.goldmine.miners.js
// Zombie Villager miner sprites walking on Google Maps OverlayView

const WALK_FRAMES = 24;
const FRAME_MS    = 80;    // ms per sprite frame
const WALK_DIST_M = 20;    // meters each way from mine center
const WALK_DUR_S  = 9;     // seconds to traverse WALK_DIST_M
const SPRITE_PX   = 36;    // display size px

const SPRITE_BASE =
  '/assets/images/villager/Zombie_Villager_1/PNG/PNG%20Sequences/Walking/0_Zombie_Villager_Walking_';

function _url(i) {
  return `${SPRITE_BASE}${String(i).padStart(3, '0')}.png`;
}

// Preload all frames once at module load
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

let _map        = null;
let _MinerClass = null;
let _overlays   = {};   // mineId → MinerOverlay[]

export function initMiners(map) {
  _map = map;

  // Class defined here so google.maps.OverlayView is guaranteed loaded
  _MinerClass = class extends google.maps.OverlayView {
    constructor(mine, index) {
      super();
      this._mine  = mine;
      this._index = index;

      // Unique walk direction per mine + miner index (prime-step spread)
      const h = _hashId(mine.id);
      this._angle   = ((h + index * 137) % 360) * Math.PI / 180;
      this._t       = (index * 0.35) % 1;   // stagger start position
      this._dir     = 1;
      this._frame   = (index * 7) % WALK_FRAMES;
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
      this._rafId = null;
      this._el?.remove();
      this._el   = null;
      this._imgEl = null;
    }

    _tick(ts) {
      if (!this._el) return;
      const dt = this._lastTs != null ? (ts - this._lastTs) / 1000 : 0;
      this._lastTs = ts;

      // Advance walk position (0 → 1 → 0 loop)
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

      // Flip horizontally when walking in reverse
      this._el.style.transform = `scaleX(${this._dir > 0 ? 1 : -1})`;

      this._reposition();
      this._rafId = requestAnimationFrame(t => this._tick(t));
    }

    _reposition() {
      const proj = this.getProjection?.();
      if (!proj || !this._el) return;
      const m = this._mine;

      // Offset -WALK_DIST_M .. +WALK_DIST_M from mine center along unique angle
      const offsetM = (this._t - 0.5) * 2 * WALK_DIST_M;
      const cosLat  = Math.cos(m.lat * Math.PI / 180);
      const dLat    = (offsetM * Math.cos(this._angle)) / 111320;
      const dLng    = (offsetM * Math.sin(this._angle)) / (111320 * cosLat);

      const pt = proj.fromLatLngToDivPixel(
        new google.maps.LatLng(m.lat + dLat, m.lng + dLng)
      );
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

  // Remove overlays for depleted / gone mines
  for (const id of Object.keys(_overlays)) {
    if (!activeIds.has(id)) {
      _overlays[id].forEach(o => o.setMap(null));
      delete _overlays[id];
    }
  }

  // Create / adjust overlay count per active mine
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
