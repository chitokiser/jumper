// assets/js/pages/merchants.player-sprite.js
// Spriter SCML skeletal animation for the player character on Google Maps

const SCML_URL = '/assets/images/monsters/1/1.scml';
const IMG_BASE = '/assets/images/monsters/1/';
const SCALE    = 0.038;  // ~39px height — map-appropriate size
const CW       = 55;     // canvas width  px
const CH       = 55;     // canvas height px
const OX       = 27;     // canvas origin X (horizontal center)
const OY       = 46;     // canvas origin Y (world y=0 / feet level)

const STATE_ANIM = {
  idle:   '_IDLE',
  walk:   '_WALK',
  run:    '_RUN',
  attack: '_ATTACK',
  hurt:   '_HURT',
  die:    '_DIE',
};

const ONE_SHOT = new Set(['attack', 'hurt', 'die']);

// ── SCML data & image cache ───────────────────────────────────────────────────
let _scmlData  = null;
let _images    = {};
let _loadProm  = null;

function _ensureLoad() {
  if (_loadProm) return _loadProm;
  _loadProm = fetch(SCML_URL)
    .then(r => r.text())
    .then(xml => {
      const doc  = new DOMParser().parseFromString(xml, 'text/xml');
      _scmlData  = _parseScml(doc);
      return Promise.all(
        Object.values(_scmlData.files).map(f => _loadImg(IMG_BASE + f.name))
      );
    });
  return _loadProm;
}

function _loadImg(url) {
  if (_images[url]) return Promise.resolve(_images[url]);
  return new Promise((resolve, reject) => {
    const img   = new Image();
    img.onload  = () => { _images[url] = img; resolve(img); };
    img.onerror = reject;
    img.src     = url;
  });
}

// ── SCML Parser ───────────────────────────────────────────────────────────────
function _parseScml(doc) {
  const data = { files: {}, animations: {} };

  doc.querySelectorAll('folder > file').forEach(el => {
    const fid = parseInt(el.parentElement.getAttribute('id') || '0');
    const id  = parseInt(el.getAttribute('id'));
    data.files[`${fid}_${id}`] = {
      name:    el.getAttribute('name'),
      width:   parseFloat(el.getAttribute('width')   || '0'),
      height:  parseFloat(el.getAttribute('height')  || '0'),
      pivot_x: parseFloat(el.getAttribute('pivot_x') || '0'),
      pivot_y: parseFloat(el.getAttribute('pivot_y') || '1'),
    };
  });

  doc.querySelectorAll('entity > animation').forEach(animEl => {
    const anim = {
      name:      animEl.getAttribute('name'),
      length:    parseInt(animEl.getAttribute('length')),
      looping:   animEl.getAttribute('looping') !== 'false',
      mainline:  [],
      timelines: {},
    };

    animEl.querySelectorAll('mainline > key').forEach(mk => {
      const mkey = {
        time:     parseInt(mk.getAttribute('time') || '0'),
        boneRefs: [],
        objRefs:  [],
      };
      mk.querySelectorAll('bone_ref').forEach(el => {
        mkey.boneRefs.push({
          id:       parseInt(el.getAttribute('id')),
          parent:   el.hasAttribute('parent') ? parseInt(el.getAttribute('parent')) : -1,
          timeline: parseInt(el.getAttribute('timeline')),
          key:      parseInt(el.getAttribute('key')),
        });
      });
      mk.querySelectorAll('object_ref').forEach(el => {
        mkey.objRefs.push({
          id:       parseInt(el.getAttribute('id')),
          parent:   el.hasAttribute('parent') ? parseInt(el.getAttribute('parent')) : -1,
          timeline: parseInt(el.getAttribute('timeline')),
          key:      parseInt(el.getAttribute('key')),
          z_index:  parseInt(el.getAttribute('z_index') || '0'),
        });
      });
      anim.mainline.push(mkey);
    });

    animEl.querySelectorAll('timeline').forEach(tlEl => {
      const tlId   = parseInt(tlEl.getAttribute('id'));
      const tlType = tlEl.getAttribute('object_type') || 'object';
      const keys   = [];

      tlEl.querySelectorAll('key').forEach(keyEl => {
        const base = {
          time:  parseInt(keyEl.getAttribute('time') || '0'),
          spin:  parseInt(keyEl.getAttribute('spin') || '1'),
        };
        if (tlType === 'bone') {
          const b = keyEl.querySelector('bone');
          keys.push({
            ...base,
            x:       parseFloat(b.getAttribute('x')       || '0'),
            y:       parseFloat(b.getAttribute('y')       || '0'),
            angle:   parseFloat(b.getAttribute('angle')   || '0'),
            scale_x: parseFloat(b.getAttribute('scale_x') || '1'),
            scale_y: parseFloat(b.getAttribute('scale_y') || '1'),
          });
        } else {
          const o = keyEl.querySelector('object');
          keys.push({
            ...base,
            folder:  parseInt(o.getAttribute('folder')),
            file:    parseInt(o.getAttribute('file')),
            x:       parseFloat(o.getAttribute('x')       || '0'),
            y:       parseFloat(o.getAttribute('y')       || '0'),
            angle:   parseFloat(o.getAttribute('angle')   || '0'),
            scale_x: parseFloat(o.getAttribute('scale_x') || '1'),
            scale_y: parseFloat(o.getAttribute('scale_y') || '1'),
            pivot_x: o.hasAttribute('pivot_x') ? parseFloat(o.getAttribute('pivot_x')) : null,
            pivot_y: o.hasAttribute('pivot_y') ? parseFloat(o.getAttribute('pivot_y')) : null,
            alpha:   parseFloat(o.getAttribute('a') || '1'),
          });
        }
      });

      anim.timelines[tlId] = { type: tlType, keys };
    });

    data.animations[anim.name] = anim;
  });

  return data;
}

// ── Math helpers ──────────────────────────────────────────────────────────────
function _lerp(a, b, t) { return a + (b - a) * t; }

function _lerpAngle(a, b, spin, t) {
  if (spin === 0 || t === 0) return a;
  let d = b - a;
  if (spin > 0 && d < 0) d += 360;
  if (spin < 0 && d > 0) d -= 360;
  return a + d * t;
}

function _interp(keys, t, length, looping) {
  if (!keys.length) return null;
  if (keys.length === 1) return { k: keys[0], t: 0 };

  let i = keys.length - 2;
  while (i > 0 && keys[i].time > t) i--;

  const k0  = keys[i];
  const k1  = (i + 1 < keys.length) ? keys[i + 1] : (looping ? keys[0] : null);
  if (!k1) return { k: k0, t: 0 };

  const end = k1.time > k0.time ? k1.time : length;
  const dt  = end - k0.time;
  const tf  = dt > 0 ? (t - k0.time) / dt : 0;
  return { k: k0, k1, spin: k0.spin, t: tf };
}

function _getBone(keys, t, length, looping) {
  const r = _interp(keys, t, length, looping);
  if (!r) return { x: 0, y: 0, angle: 0, scale_x: 1, scale_y: 1 };
  if (!r.k1 || r.t === 0) return { ...r.k };
  return {
    x:       _lerp(r.k.x,       r.k1.x,       r.t),
    y:       _lerp(r.k.y,       r.k1.y,       r.t),
    angle:   _lerpAngle(r.k.angle, r.k1.angle, r.spin, r.t),
    scale_x: _lerp(r.k.scale_x, r.k1.scale_x, r.t),
    scale_y: _lerp(r.k.scale_y, r.k1.scale_y, r.t),
  };
}

function _getObj(keys, t, length, looping) {
  const r = _interp(keys, t, length, looping);
  if (!r) return null;
  if (!r.k1 || r.t === 0) return { ...r.k };
  return {
    ...r.k,
    x:       _lerp(r.k.x,       r.k1.x,       r.t),
    y:       _lerp(r.k.y,       r.k1.y,       r.t),
    angle:   _lerpAngle(r.k.angle, r.k1.angle, r.spin, r.t),
    scale_x: _lerp(r.k.scale_x, r.k1.scale_x, r.t),
    scale_y: _lerp(r.k.scale_y, r.k1.scale_y, r.t),
    alpha:   _lerp(r.k.alpha ?? 1, r.k1.alpha ?? 1, r.t),
  };
}

// Compose child local transform into parent world transform (Spriter 2D)
function _compose(parent, local) {
  const rad = parent.angle * Math.PI / 180;
  const c   = Math.cos(rad), s = Math.sin(rad);
  const sx  = parent.scale_x || 1, sy = parent.scale_y || 1;
  return {
    x:       parent.x + sx * (local.x * c - local.y * s),
    y:       parent.y + sy * (local.x * s + local.y * c),
    angle:   parent.angle   + local.angle,
    scale_x: sx * (local.scale_x || 1),
    scale_y: sy * (local.scale_y || 1),
  };
}

// ── Frame computation ─────────────────────────────────────────────────────────
function _frame(animName, timeMs) {
  const anim = _scmlData?.animations[animName];
  if (!anim) return [];

  const t = anim.looping
    ? ((timeMs % anim.length) + anim.length) % anim.length
    : Math.min(timeMs, anim.length - 1);

  // Find active mainline key
  let mIdx = 0;
  for (let i = anim.mainline.length - 1; i >= 0; i--) {
    if (anim.mainline[i].time <= t) { mIdx = i; break; }
  }
  const mk = anim.mainline[mIdx];

  // Build bone world transforms (bone_refs are already parent-before-child)
  const boneWorld = {};
  for (const bref of mk.boneRefs) {
    const tl    = anim.timelines[bref.timeline];
    const local = _getBone(tl.keys, t, anim.length, anim.looping);
    boneWorld[bref.id] = bref.parent < 0
      ? { ...local }
      : _compose(boneWorld[bref.parent] || { x: 0, y: 0, angle: 0, scale_x: 1, scale_y: 1 }, local);
  }

  // Build drawable objects
  const objs = [];
  for (const oref of mk.objRefs) {
    const tl   = anim.timelines[oref.timeline];
    const loc  = _getObj(tl.keys, t, anim.length, anim.looping);
    if (!loc) continue;

    const world = oref.parent < 0
      ? { x: loc.x, y: loc.y, angle: loc.angle, scale_x: loc.scale_x, scale_y: loc.scale_y }
      : _compose(boneWorld[oref.parent] || { x: 0, y: 0, angle: 0, scale_x: 1, scale_y: 1 }, loc);

    const fileKey  = `${loc.folder}_${loc.file}`;
    const fi       = _scmlData.files[fileKey];
    if (!fi) continue;

    objs.push({
      img:     _images[IMG_BASE + fi.name],
      w:       fi.width,
      h:       fi.height,
      pivot_x: loc.pivot_x != null ? loc.pivot_x : fi.pivot_x,
      pivot_y: loc.pivot_y != null ? loc.pivot_y : fi.pivot_y,
      wx:      world.x,
      wy:      world.y,
      wangle:  world.angle,
      scale_x: world.scale_x,
      scale_y: world.scale_y,
      alpha:   loc.alpha ?? 1,
      z_index: oref.z_index,
    });
  }

  objs.sort((a, b) => a.z_index - b.z_index);
  return objs;
}

// ── Overlay factory ───────────────────────────────────────────────────────────
let _OverlayCls = null;

function _getOverlayCls() {
  if (_OverlayCls) return _OverlayCls;

  class PlayerSpriteOverlay extends google.maps.OverlayView {
    constructor(latLng, map) {
      super();
      this._latLng    = latLng instanceof google.maps.LatLng
        ? latLng : new google.maps.LatLng(latLng.lat, latLng.lng);
      this._state     = 'idle';
      this._prevState = 'idle';
      this._animStart = performance.now();
      this._facing    = 1;   // 1 = right, -1 = left
      this._canvas    = null;
      this._rafId     = null;
      this._ready     = false;
      this.setMap(map);
    }

    // ── Marker-compatible shim ─────────────────────────────────────────────
    getPosition() { return this._latLng; }

    setPosition(pos) {
      this._latLng = pos instanceof google.maps.LatLng
        ? pos : new google.maps.LatLng(pos.lat, pos.lng);
      this.draw();
    }

    // no-op: we draw on canvas, not icon
    setIcon(_icon) {}

    // ── OverlayView lifecycle ──────────────────────────────────────────────
    onAdd() {
      const canvas         = document.createElement('canvas');
      canvas.width         = CW;
      canvas.height        = CH;
      canvas.style.cssText = 'position:absolute;pointer-events:none;';
      this._canvas         = canvas;
      this.getPanes().overlayMouseTarget.appendChild(canvas);

      if (_scmlData) {
        this._ready = true;
        this._startLoop();
      } else {
        _ensureLoad().then(() => { this._ready = true; this._startLoop(); });
      }
    }

    onRemove() {
      this._stopLoop();
      this._canvas?.remove();
      this._canvas = null;
      this._ready  = false;
    }

    draw() {
      if (!this._canvas) return;
      const proj = this.getProjection();
      if (!proj) return;
      const pt = proj.fromLatLngToDivPixel(this._latLng);
      if (!pt) return;
      this._canvas.style.left = Math.round(pt.x - OX) + 'px';
      this._canvas.style.top  = Math.round(pt.y - OY) + 'px';
    }

    // ── Public state API ───────────────────────────────────────────────────
    setState(state) {
      if (this._state === 'die') return;   // stay dead until revive
      if (this._state === state) return;
      this._state     = state;
      this._animStart = performance.now();
    }

    revive() {
      this._state     = 'idle';
      this._animStart = performance.now();
    }

    setFacing(heading) {
      // heading: 0=N, 90=E, 180=S, 270=W
      // east half → face right, west half → face left
      if (heading == null || isNaN(heading)) return;
      const h = ((heading % 360) + 360) % 360;
      this._facing = (h <= 90 || h >= 270) ? 1 : -1;
    }

    // 활/손 끝 픽셀 위치 반환 (battleOverlay 좌표계와 동일한 기준)
    getBowPixel() {
      const proj = this.getProjection?.();
      if (!proj) return null;
      const pt = proj.fromLatLngToDivPixel(this._latLng);
      if (!pt) return null;
      // 발 기준(pt): 위로 30px(활 높이), facing 방향으로 10px 앞
      return {
        x: Math.round(pt.x + this._facing * 10),
        y: Math.round(pt.y - 30),
      };
    }

    // ── Render loop ────────────────────────────────────────────────────────
    _startLoop() {
      const tick = () => {
        if (!this._canvas) return;
        this._render();
        this._rafId = requestAnimationFrame(tick);
      };
      this._rafId = requestAnimationFrame(tick);
    }

    _stopLoop() {
      if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    }

    _render() {
      if (!this._canvas || !this._ready || !_scmlData) return;

      const animName = STATE_ANIM[this._state] || '_IDLE';
      const anim     = _scmlData.animations[animName];
      if (!anim) return;

      const elapsed = performance.now() - this._animStart;

      // One-shot: revert to idle when done (except die)
      if (ONE_SHOT.has(this._state) && elapsed >= anim.length) {
        if (this._state !== 'die') {
          this._state     = 'idle';
          this._animStart = performance.now();
        }
      }

      const timeMs = ONE_SHOT.has(this._state)
        ? Math.min(elapsed, anim.length - 1)
        : elapsed;

      const objs = _frame(STATE_ANIM[this._state] || '_IDLE', timeMs);
      const ctx  = this._canvas.getContext('2d');
      ctx.clearRect(0, 0, CW, CH);

      ctx.save();
      ctx.translate(OX, OY);
      if (this._facing < 0) ctx.scale(-1, 1);   // flip for left-facing

      for (const obj of objs) {
        if (!obj.img) continue;

        // Convert Spriter world → screen (Y-up → Y-down)
        const sx    = obj.wx    * SCALE;
        const sy    = -obj.wy   * SCALE;
        const angle = -obj.wangle * Math.PI / 180;
        const ws    = obj.w     * SCALE * (obj.scale_x || 1);
        const hs    = obj.h     * SCALE * (obj.scale_y || 1);

        // Pivot offset: pivot_y=1 in Spriter (top) → 0px from top in screen
        const px = obj.pivot_x * ws;
        const py = (1 - obj.pivot_y) * hs;

        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, obj.alpha));
        ctx.translate(sx, sy);
        ctx.rotate(angle);
        ctx.drawImage(obj.img, -px, -py, ws, hs);
        ctx.restore();
      }

      ctx.restore();
    }
  }

  _OverlayCls = PlayerSpriteOverlay;
  return _OverlayCls;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function createPlayerSpriteOverlay(latLng, map) {
  const Cls = _getOverlayCls();
  _ensureLoad();
  return new Cls(latLng, map);
}
