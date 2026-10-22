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
      this._facingVis = 1;   // 화면에 그리는 방향 (돌아설 때 부드럽게 따라감)
      this._canvas    = null;
      this._rafId     = null;
      this._ready     = false;
      // GPS 점 사이를 미끄러지듯 이동 — 게임 판정은 _latLng(실제 위치), 그리기는 _disp
      this._disp      = { lat: this._latLng.lat(), lng: this._latLng.lng() };
      this._glide     = null;  // { from, to, start, dur }
      this._lastPosAt = 0;
      this.setMap(map);
    }

    // ── Marker-compatible shim ─────────────────────────────────────────────
    getPosition() { return this._latLng; }

    setPosition(pos) {
      this._latLng = pos instanceof google.maps.LatLng
        ? pos : new google.maps.LatLng(pos.lat, pos.lng);
      const now = performance.now();
      const to  = { lat: this._latLng.lat(), lng: this._latLng.lng() };
      const from = { ...this._disp };
      const dLat = to.lat - from.lat, dLng = to.lng - from.lng;
      const meters = Math.hypot(dLat * 111320, dLng * 111320 * Math.cos(to.lat * Math.PI / 180));
      // 다음 GPS 점이 올 때까지 걸리는 시간만큼 이동 (보통 1초), 멀리 순간이동하면 바로 이동
      const gap = this._lastPosAt ? now - this._lastPosAt : 0;
      this._lastPosAt = now;
      if (!gap || meters > 150 || meters < 0.05) {
        this._disp  = to;
        this._glide = null;
      } else {
        this._glide = { from, to, start: now, dur: Math.max(250, Math.min(1200, gap)) };
      }
      // 기기가 방향(heading)을 안 줄 때는 이동 방향으로 바라봄 (공격 중엔 과녁 방향 유지)
      if (this._state !== 'attack' && Math.abs(dLng) > 1e-7 && meters >= 0.3) this._facing = dLng > 0 ? 1 : -1;
      this.draw();
    }

    _updateGlide(now) {
      const g = this._glide;
      if (!g) return false;
      const t = Math.min(1, (now - g.start) / g.dur);
      this._disp = { lat: g.from.lat + (g.to.lat - g.from.lat) * t, lng: g.from.lng + (g.to.lng - g.from.lng) * t };
      if (t >= 1) this._glide = null;
      return true;
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
      // Leaflet 호환 지도는 화면 좌표를 정수로 반올림해 작은 이동이 뚝뚝 끊김 → 반올림 전 좌표 사용
      const lmap = this._map?._lmap;
      let pt;
      if (lmap && typeof lmap.project === 'function' && typeof lmap.getPixelOrigin === 'function') {
        const p = lmap.project([this._disp.lat, this._disp.lng], lmap.getZoom()).subtract(lmap.getPixelOrigin());
        pt = { x: p.x, y: p.y };
      } else {
        pt = proj.fromLatLngToDivPixel(new google.maps.LatLng(this._disp.lat, this._disp.lng));
      }
      if (!pt) return;
      // 소수점 위치 + transform 으로 그려 이동이 끊기지 않게
      this._canvas.style.left = '0px';
      this._canvas.style.top  = '0px';
      this._canvas.style.transform = `translate3d(${(pt.x - OX).toFixed(2)}px, ${(pt.y - OY).toFixed(2)}px, 0)`;
    }

    // ── Public state API ───────────────────────────────────────────────────
    setState(state) {
      if (this._state === 'die') return;   // stay dead until revive
      const now = performance.now();
      if (this._state === state) {
        // 연속 공격·연속 피격은 동작을 처음부터 다시 (반응이 바로 보이게)
        if ((state === 'attack' || state === 'hurt') && now - this._animStart > 120) this._animStart = now;
        return;
      }
      // 걷기 ↔ 달리기 전환 시 발걸음 위치(진행률)를 이어서 — 동작이 툭 끊기지 않게
      const loopPair = (a) => a === 'walk' || a === 'run';
      if (loopPair(this._state) && loopPair(state) && _scmlData) {
        const a = _scmlData.animations[STATE_ANIM[this._state]];
        const b = _scmlData.animations[STATE_ANIM[state]];
        if (a && b && a.length > 0 && b.length > 0) {
          const phase = (((now - this._animStart) % a.length) + a.length) % a.length / a.length;
          this._state     = state;
          this._animStart = now - phase * b.length;
          return;
        }
      }
      this._state     = state;
      this._animStart = now;
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

    // 활/손 끝 픽셀 위치 반환 — #battleOverlay 좌표계 기준
    // getBoundingClientRect 기반으로 canvas 실제 화면 위치를 읽어
    // battleOverlay 좌표로 변환하므로 맵 패닝·줌에 정확히 동기화됨
    getBowPixel() {
      if (!this._canvas) return null;
      const overlayEl = document.getElementById('battleOverlay');
      if (!overlayEl) return null;
      const cr = this._canvas.getBoundingClientRect();
      const or = overlayEl.getBoundingClientRect();
      // 캔버스 내 활(손 끝) 위치: 발(OX, OY) 기준으로 위로 25px, 정면 방향으로 5px
      return {
        x: Math.round(cr.left - or.left + OX + this._facing * 5),
        y: Math.round(cr.top  - or.top  + OY - 25),
      };
    }

    // ── Render loop ────────────────────────────────────────────────────────
    _startLoop() {
      // 움직이거나 공격·피격 중에는 초당 60장, 서 있을 때는 30장 (발열·배터리 절약)
      let last = 0;
      const tick = (now) => {
        if (!this._canvas) return;
        const busy = !!this._glide || this._state !== 'idle' || this._facingVis !== this._facing;
        if (now - last >= (busy ? 15 : 32)) {
          const dt = last ? now - last : 16;
          last = now;
          if (this._updateGlide(now)) this.draw();
          // 멈췄는데 GPS 가 더 안 오면 곧 서기 동작으로 (예전엔 계속 걷는 채로 남음)
          if ((this._state === 'walk' || this._state === 'run') && !this._glide && now - this._lastPosAt > 2200) this.setState('idle');
          // 돌아설 때 0.1초 동안 좌우가 부드럽게 뒤집힘
          if (this._facingVis !== this._facing) {
            const step = dt / 100 * 2;
            this._facingVis = this._facing > this._facingVis
              ? Math.min(this._facing, this._facingVis + step)
              : Math.max(this._facing, this._facingVis - step);
          }
          this._render();
        }
        this._rafId = requestAnimationFrame(tick);
      };
      this._rafId = requestAnimationFrame(tick);
    }

    _stopLoop() {
      if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    }

    _drawShadows(ctx) {
      ctx.save();
      ctx.translate(OX, OY);
      const cx = 0, cy = 4;   // shadow center: slightly below feet (OY)

      // 1. Circular shadow — soft radial gradient blob (squashed ellipse)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, 0.32);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 13);
      g.addColorStop(0,   'rgba(0,0,0,0.25)');
      g.addColorStop(0.6, 'rgba(0,0,0,0.10)');
      g.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();

      // 2. Ground contact shadow — tight ellipse
      ctx.beginPath();
      ctx.ellipse(cx, cy, 8, 3, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.fill();

      // 3. Floor ring — position indicator ring
      ctx.beginPath();
      ctx.ellipse(cx, cy, 10, 3.5, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.38)';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      ctx.restore();
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

      this._drawShadows(ctx);

      ctx.save();
      ctx.translate(OX, OY);
      // 좌우 방향 (돌아서는 중엔 가로 폭이 줄었다 늘며 뒤집힘, 0 근처는 최소 폭 유지)
      const fv = this._facingVis;
      if (fv !== 1) ctx.scale(Math.sign(fv || 1) * Math.max(0.15, Math.abs(fv)), 1);

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
