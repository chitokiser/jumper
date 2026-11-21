// assets/js/pages/merchants.player-sprite.js
// Female Valkyrie player character sprite on Google Maps / Leaflet

const CW = 80;     // canvas width  px
const CH = 80;     // canvas height px
const OX = 40;     // canvas origin X (horizontal center)
const OY = 66;     // canvas origin Y (world y=0 / feet level)
const DW = 68;     // display width px
const DH = 68;     // display height px

const VALKYRIE_BASE = '/assets/images/characters/valkyrie/';
const VALKYRIE_ANIMS = {
  idle:   { prefix: 'valkyrie_idle_',   frames: 6, fps: 7,  loop: true  },
  walk:   { prefix: 'valkyrie_walk_',   frames: 6, fps: 9,  loop: true  },
  run:    { prefix: 'valkyrie_run_',    frames: 6, fps: 11, loop: true  },
  attack: { prefix: 'valkyrie_attack_', frames: 6, fps: 12, loop: false },
  hurt:   { prefix: 'valkyrie_hurt_',   frames: 4, fps: 12, loop: false },
  die:    { prefix: 'valkyrie_die_',    frames: 6, fps: 6,  loop: false },
};

const ONE_SHOT = new Set(['attack', 'hurt', 'die']);

// ── Valkyrie Image Cache & Preloader ─────────────────────────────────────────
const _images   = {};
let _loadProm   = null;

function _loadImg(url) {
  if (_images[url]) return Promise.resolve(_images[url]);
  return new Promise((resolve) => {
    const img   = new Image();
    img.onload  = () => { _images[url] = img; resolve(img); };
    img.onerror = () => { _images[url] = img; resolve(img); };
    img.src     = url;
  });
}

function _ensureLoad() {
  if (_loadProm) return _loadProm;
  const urls = [`${VALKYRIE_BASE}valkyrie.png`];
  for (const anim of Object.values(VALKYRIE_ANIMS)) {
    for (let i = 0; i < anim.frames; i++) {
      urls.push(`${VALKYRIE_BASE}${anim.prefix}${String(i).padStart(3, '0')}.png`);
    }
  }
  _loadProm = Promise.all(urls.map(_loadImg));
  return _loadProm;
}

// ── Overlay Factory ───────────────────────────────────────────────────────────
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

    setIcon(_icon) {}

    // ── OverlayView lifecycle ──────────────────────────────────────────────
    onAdd() {
      const canvas         = document.createElement('canvas');
      canvas.width         = CW;
      canvas.height        = CH;
      canvas.style.cssText = 'position:absolute;pointer-events:none;';
      this._canvas         = canvas;
      this.getPanes().overlayMouseTarget.appendChild(canvas);

      _ensureLoad().then(() => {
        this._ready = true;
        this._startLoop();
      });
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
      this._canvas.style.left = '0px';
      this._canvas.style.top  = '0px';
      this._canvas.style.transform = `translate3d(${(pt.x - OX).toFixed(2)}px, ${(pt.y - OY).toFixed(2)}px, 0)`;
    }

    // ── Public state API ───────────────────────────────────────────────────
    setState(state) {
      if (this._state === 'die') return;
      const now = performance.now();
      if (this._state === state) {
        if ((state === 'attack' || state === 'hurt') && now - this._animStart > 120) this._animStart = now;
        return;
      }
      const loopPair = (a) => a === 'walk' || a === 'run';
      if (loopPair(this._state) && loopPair(state)) {
        const a = VALKYRIE_ANIMS[this._state];
        const b = VALKYRIE_ANIMS[state];
        const aDur = (a.frames / a.fps) * 1000;
        const bDur = (b.frames / b.fps) * 1000;
        const phase = (((now - this._animStart) % aDur) + aDur) % aDur / aDur;
        this._state     = state;
        this._animStart = now - phase * bDur;
        return;
      }
      this._state     = state;
      this._animStart = now;
    }

    revive() {
      this._state     = 'idle';
      this._animStart = performance.now();
    }

    setFacing(heading) {
      if (heading == null || isNaN(heading)) return;
      const h = ((heading % 360) + 360) % 360;
      this._facing = (h <= 90 || h >= 270) ? 1 : -1;
    }

    getBowPixel() {
      if (!this._canvas) return null;
      const overlayEl = document.getElementById('battleOverlay');
      if (!overlayEl) return null;
      const cr = this._canvas.getBoundingClientRect();
      const or = overlayEl.getBoundingClientRect();
      return {
        x: Math.round(cr.left - or.left + OX + this._facing * 12),
        y: Math.round(cr.top  - or.top  + OY - 26),
      };
    }

    // ── Render loop ────────────────────────────────────────────────────────
    _startLoop() {
      let last = 0;
      const tick = (now) => {
        if (!this._canvas) return;
        const busy = !!this._glide || this._state !== 'idle' || this._facingVis !== this._facing;
        if (now - last >= (busy ? 15 : 32)) {
          const dt = last ? now - last : 16;
          last = now;
          if (this._updateGlide(now)) this.draw();
          if ((this._state === 'walk' || this._state === 'run') && !this._glide && now - this._lastPosAt > 2200) this.setState('idle');
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
      const cx = 0, cy = 4;

      // 1. Circular shadow
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, 0.32);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 15);
      g.addColorStop(0,   'rgba(0,0,0,0.28)');
      g.addColorStop(0.6, 'rgba(0,0,0,0.12)');
      g.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.arc(0, 0, 15, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();

      // 2. Ground contact shadow
      ctx.beginPath();
      ctx.ellipse(cx, cy, 9, 3.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.fill();

      // 3. Floor ring / sacred Valkyrie crest ring
      ctx.beginPath();
      ctx.ellipse(cx, cy, 11, 3.8, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(251,191,36,0.50)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.restore();
    }

    _render() {
      if (!this._canvas || !this._ready) return;

      const anim = VALKYRIE_ANIMS[this._state] || VALKYRIE_ANIMS.idle;
      const animDuration = (anim.frames / anim.fps) * 1000;
      const elapsed = performance.now() - this._animStart;

      if (ONE_SHOT.has(this._state) && elapsed >= animDuration) {
        if (this._state !== 'die') {
          this._state     = 'idle';
          this._animStart = performance.now();
        }
      }

      const activeAnim = VALKYRIE_ANIMS[this._state] || VALKYRIE_ANIMS.idle;
      const curDur = (activeAnim.frames / activeAnim.fps) * 1000;
      const curElapsed = performance.now() - this._animStart;
      
      let frameIdx = 0;
      if (activeAnim.loop) {
        frameIdx = Math.floor((curElapsed / 1000) * activeAnim.fps) % activeAnim.frames;
      } else {
        frameIdx = Math.min(activeAnim.frames - 1, Math.floor((curElapsed / 1000) * activeAnim.fps));
      }

      const imgKey = `${VALKYRIE_BASE}${activeAnim.prefix}${String(frameIdx).padStart(3, '0')}.png`;
      const img = _images[imgKey] || _images[`${VALKYRIE_BASE}valkyrie.png`];

      const ctx = this._canvas.getContext('2d');
      ctx.clearRect(0, 0, CW, CH);

      this._drawShadows(ctx);

      if (img && img.complete) {
        ctx.save();
        ctx.translate(OX, OY);
        const fv = this._facingVis;
        if (fv !== 1) ctx.scale(Math.sign(fv || 1) * Math.max(0.15, Math.abs(fv)), 1);

        ctx.drawImage(img, -DW * 0.5, -DH * 0.81, DW, DH);
        ctx.restore();
      }
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
