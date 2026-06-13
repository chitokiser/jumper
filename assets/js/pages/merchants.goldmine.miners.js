// assets/js/pages/merchants.goldmine.miners.js
// Zombie Villager miners: walk shop→mine, slash at mine, walk back — repeat

const WALK_FRAMES  = 24;
const SLASH_FRAMES = 12;
const FRAME_MS     = 80;    // ms per sprite frame
const SPRITE_PX    = 36;
const WALK_DUR_S   = 7;     // seconds to traverse the path each way
const MINE_DUR_S   = 3;     // seconds spent slashing at the mine
const MIN_DIST_M   = 15;    // fallback path length if mine == shop

const WALK_BASE  =
  '/assets/images/villager/Zombie_Villager_1/PNG/PNG%20Sequences/Walking/0_Zombie_Villager_Walking_';
const SLASH_BASE =
  '/assets/images/villager/Zombie_Villager_1/PNG/PNG%20Sequences/Slashing/0_Zombie_Villager_Slashing_';

function _url(base, i, total) {
  return `${base}${String(i).padStart(3, '0')}.png`;
}

// Preload both animation strips
const _walkImgs  = Array.from({ length: WALK_FRAMES },  (_, i) => { const g = new Image(); g.src = `${WALK_BASE}${String(i).padStart(3,'0')}.png`;  return g; });
const _slashImgs = Array.from({ length: SLASH_FRAMES }, (_, i) => { const g = new Image(); g.src = `${SLASH_BASE}${String(i).padStart(3,'0')}.png`; return g; });

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
let _overlays   = {};

export function initMiners(map) {
  _map = map;

  _MinerClass = class extends google.maps.OverlayView {
    constructor(mine, index) {
      super();
      this._mine  = mine;

      // Build the shop→mine path (or fallback if same coordinates)
      const sLat = mine.store_lat ?? mine.lat;
      const sLng = mine.store_lng ?? mine.lng;
      const dist = _distM(mine.lat, mine.lng, sLat, sLng);

      if (dist >= MIN_DIST_M) {
        this._shopLat = sLat;
        this._shopLng = sLng;
        this._mineLat = mine.lat;
        this._mineLng = mine.lng;
      } else {
        // Mine == shop: make a short path in a deterministic direction
        const h      = _hashId(mine.id);
        const angle  = ((h + index * 137) % 360) * Math.PI / 180;
        const cosLat = Math.cos(mine.lat * Math.PI / 180);
        const dLat   = (MIN_DIST_M * Math.cos(angle)) / 111320;
        const dLng   = (MIN_DIST_M * Math.sin(angle)) / (111320 * cosLat);
        this._shopLat = mine.lat;
        this._shopLng = mine.lng;
        this._mineLat = mine.lat + dLat;
        this._mineLng = mine.lng + dLng;
      }

      // State machine: 'going' | 'mining' | 'returning'
      // Stagger start so multiple miners aren't in lock-step
      const stagger = (index * 0.35) % 1;  // 0..1 fraction of total cycle
      this._initState(stagger);

      this._frame   = (index * 8) % WALK_FRAMES;
      this._frameMs = 0;
      this._lastTs  = null;
      this._rafId   = null;
      this._el      = null;
      this._imgEl   = null;
    }

    // Set initial state/progress from stagger fraction of the full cycle
    _initState(frac) {
      const walkFrac = WALK_DUR_S / (2 * WALK_DUR_S + MINE_DUR_S);
      const mineFrac = MINE_DUR_S / (2 * WALK_DUR_S + MINE_DUR_S);
      if (frac < walkFrac) {
        this._state = 'going';
        this._t     = frac / walkFrac;
      } else if (frac < walkFrac + mineFrac) {
        this._state    = 'mining';
        this._mineTime = ((frac - walkFrac) / mineFrac) * MINE_DUR_S;
        this._t        = 1;
      } else {
        this._state = 'returning';
        this._t     = 1 - (frac - walkFrac - mineFrac) / walkFrac;
      }
    }

    onAdd() {
      this._el = document.createElement('div');
      this._el.style.cssText =
        `position:absolute;width:${SPRITE_PX}px;height:${SPRITE_PX}px;` +
        `pointer-events:none;transform-origin:center bottom;`;
      this._imgEl = document.createElement('img');
      this._imgEl.style.cssText = `width:100%;height:100%;image-rendering:pixelated;`;
      const frames = this._state === 'mining' ? _slashImgs : _walkImgs;
      this._imgEl.src = frames[this._frame % frames.length].src;
      this._el.appendChild(this._imgEl);
      this.getPanes().overlayLayer.appendChild(this._el);
      this._rafId = requestAnimationFrame(ts => this._tick(ts));
    }

    draw() { this._reposition(); }

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

      const prevState = this._state;

      if (this._state === 'going') {
        this._t += dt / WALK_DUR_S;
        if (this._t >= 1) {
          this._t        = 1;
          this._state    = 'mining';
          this._mineTime = 0;
          this._frame    = 0;
          this._frameMs  = 0;
        }
      } else if (this._state === 'mining') {
        this._mineTime += dt;
        if (this._mineTime >= MINE_DUR_S) {
          this._state   = 'returning';
          this._frame   = 0;
          this._frameMs = 0;
        }
      } else {
        this._t -= dt / WALK_DUR_S;
        if (this._t <= 0) {
          this._t       = 0;
          this._state   = 'going';
          this._frame   = 0;
          this._frameMs = 0;
        }
      }

      // Switch sprite strip when state changes
      const isMining = this._state === 'mining';
      const imgs = isMining ? _slashImgs : _walkImgs;
      const maxF = isMining ? SLASH_FRAMES : WALK_FRAMES;

      // Advance frame
      this._frameMs += dt * 1000;
      if (this._frameMs >= FRAME_MS) {
        this._frameMs -= FRAME_MS;
        this._frame = (this._frame + 1) % maxF;
      }
      if (this._imgEl) this._imgEl.src = imgs[this._frame].src;

      // Facing direction
      if (this._state === 'mining') {
        // Face toward shop while mining (turning back to dig into the mine)
        const shopIsEast = this._shopLng > this._mineLng;
        this._el.style.transform = `scaleX(${shopIsEast ? -1 : 1})`;
      } else {
        const goingToMine = this._state === 'going';
        const mineIsEast  = this._mineLng > this._shopLng;
        const facingRight = goingToMine ? mineIsEast : !mineIsEast;
        this._el.style.transform = `scaleX(${facingRight ? 1 : -1})`;
      }

      this._reposition();
      this._rafId = requestAnimationFrame(t => this._tick(t));
    }

    _reposition() {
      const proj = this.getProjection?.();
      if (!proj || !this._el) return;

      let lat, lng;
      if (this._state === 'mining') {
        lat = this._mineLat;
        lng = this._mineLng;
      } else {
        lat = this._shopLat + (this._mineLat - this._shopLat) * this._t;
        lng = this._shopLng + (this._mineLng - this._shopLng) * this._t;
      }

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
