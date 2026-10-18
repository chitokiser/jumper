/**
 * gmaps-leaflet-compat.js
 * Drop-in Google Maps JavaScript API shim powered by Leaflet & OpenStreetMap (CartoDB Voyager)
 * 100% Free, No API key, No billing, No regional restrictions (Works in Vietnam, worldwide)
 */
(function() {
  'use strict';

  // 0. Immediately inject CSS for control overlay, animations & Leaflet styling
  function injectShimStyles() {
    if (document.getElementById('gmaps-leaflet-style')) return;
    const style = document.createElement('style');
    style.id = 'gmaps-leaflet-style';
    style.textContent = `
      @keyframes gmapsLeafletBounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-16px); }
      }
      .gmaps-leaflet-bounce {
        animation: gmapsLeafletBounce 0.7s infinite ease-in-out !important;
      }
      .gmaps-ctrl-container {
        position: absolute;
        z-index: 1100;
        pointer-events: none;
      }
      .gmaps-ctrl-container > * {
        pointer-events: auto;
      }
      .gmaps-ctrl-left-top {
        top: 8px;
        left: 8px;
        max-height: calc(100% - 16px);
        z-index: 1101;
      }
      .gmaps-ctrl-right-top {
        top: 8px;
        right: 8px;
        max-height: calc(100% - 16px);
        z-index: 1101;
      }
      .gmaps-ctrl-top-center {
        top: 8px;
        left: 50%;
        transform: translateX(-50%);
        max-width: calc(100% - 16px);
        z-index: 1101;
      }
      .gmaps-ctrl-left-center {
        top: 50%;
        left: 8px;
        transform: translateY(-50%);
        z-index: 1101;
      }
      .gmaps-ctrl-right-center {
        top: 50%;
        right: 8px;
        transform: translateY(-50%);
        z-index: 1101;
      }
      .gmaps-ctrl-left-bottom {
        bottom: 8px;
        left: 8px;
        max-height: calc(100% - 155px);
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        z-index: 1101;
      }
      .gmaps-ctrl-left-bottom > * {
        max-height: 100% !important;
      }
      .gmaps-ctrl-right-bottom {
        bottom: 8px;
        right: 8px;
        max-height: calc(100% - 16px);
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        z-index: 1101;
      }
      .gmaps-ctrl-right-bottom > * {
        max-height: 100% !important;
      }
      .gmaps-ctrl-bottom-center {
        bottom: 8px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        justify-content: center;
        max-width: calc(100% - 16px);
        z-index: 1101;
      }
      .leaflet-popup-content-wrapper {
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.25);
      }
      .leaflet-popup-content {
        margin: 14px 18px;
        line-height: 1.4;
      }
      /* 지면 접지 중력감 표현: 본체 마커의 입체 접지 그림자 */
      .leaflet-marker-icon:not([src*="svg"]) {
        filter: drop-shadow(0 3px 4px rgba(0, 0, 0, 0.45));
      }
      /* 그림자 SVG 마커에는 중복 필터 제외 및 마우스 클릭 투과 */
      img.leaflet-marker-icon[src*="svg"],
      .gmaps-symbol-marker {
        filter: none !important;
        pointer-events: none !important;
      }
    `;
    const target = document.head || document.documentElement;
    if (target) {
      target.appendChild(style);
    } else {
      document.addEventListener('DOMContentLoaded', () => (document.head || document.documentElement).appendChild(style));
    }
  }
  injectShimStyles();

  // 1. Ensure Leaflet CSS & JS are present
  function ensureLeaflet() {
    injectShimStyles();
    if (window.L) return Promise.resolve(window.L);

    return new Promise((resolve, reject) => {
      // CSS
      if (!document.querySelector('link[href*="leaflet"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';
        (document.head || document.documentElement).appendChild(link);
      }

      // JS
      if (window.L) return resolve(window.L);
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
      script.async = false;
      script.onload = () => resolve(window.L);
      script.onerror = () => reject(new Error('Failed to load Leaflet'));
      (document.head || document.documentElement).appendChild(script);
    });
  }

  // Helper: extract raw lat/lng
  function toLatLngObj(raw) {
    if (!raw) return { lat: 0, lng: 0 };
    if (typeof raw.lat === 'function') {
      return { lat: raw.lat(), lng: raw.lng() };
    }
    if (typeof raw.lat === 'number' && typeof raw.lng === 'number') {
      return { lat: raw.lat, lng: raw.lng };
    }
    if (Array.isArray(raw) && raw.length >= 2) {
      return { lat: Number(raw[0]), lng: Number(raw[1]) };
    }
    return { lat: Number(raw.lat || 0), lng: Number(raw.lng || 0) };
  }

  // ── google.maps Core API ──────────────────────────────────────────────────
  window.google = window.google || {};
  const maps = (window.google.maps = window.google.maps || {});

  // LatLng
  maps.LatLng = class {
    constructor(lat, lng) {
      this._lat = Number(lat) || 0;
      this._lng = Number(lng) || 0;
    }
    lat() { return this._lat; }
    lng() { return this._lng; }
    get latVal() { return this._lat; }
    get lngVal() { return this._lng; }
  };

  // LatLngBounds
  maps.LatLngBounds = class {
    constructor(sw, ne) {
      this._bounds = null;
      if (sw && ne) {
        const swObj = toLatLngObj(sw);
        const neObj = toLatLngObj(ne);
        if (window.L) {
          this._bounds = L.latLngBounds([swObj.lat, swObj.lng], [neObj.lat, neObj.lng]);
        }
      }
    }
    extend(point) {
      const p = toLatLngObj(point);
      if (!window.L) return this;
      if (!this._bounds) {
        this._bounds = L.latLngBounds([p.lat, p.lng], [p.lat, p.lng]);
      } else {
        this._bounds.extend([p.lat, p.lng]);
      }
      return this;
    }
    getCenter() {
      if (!this._bounds || !this._bounds.isValid()) return new maps.LatLng(0, 0);
      const c = this._bounds.getCenter();
      return new maps.LatLng(c.lat, c.lng);
    }
    getNorthEast() {
      if (!this._bounds || !this._bounds.isValid()) return new maps.LatLng(0, 0);
      const ne = this._bounds.getNorthEast();
      return new maps.LatLng(ne.lat, ne.lng);
    }
    getSouthWest() {
      if (!this._bounds || !this._bounds.isValid()) return new maps.LatLng(0, 0);
      const sw = this._bounds.getSouthWest();
      return new maps.LatLng(sw.lat, sw.lng);
    }
    isEmpty() {
      return !this._bounds || !this._bounds.isValid();
    }
    getLBounds() {
      return this._bounds;
    }
  };

  // Point & Size
  maps.Point = class {
    constructor(x, y) {
      this.x = Number(x) || 0;
      this.y = Number(y) || 0;
    }
  };

  maps.Size = class {
    constructor(width, height) {
      this.width = Number(width) || 0;
      this.height = Number(height) || 0;
    }
  };

  // Enums & Constants
  maps.ControlPosition = {
    TOP_LEFT: 1,
    TOP_CENTER: 2,
    TOP_RIGHT: 3,
    LEFT_CENTER: 4,
    LEFT_TOP: 5,
    LEFT_BOTTOM: 6,
    RIGHT_TOP: 7,
    RIGHT_CENTER: 8,
    RIGHT_BOTTOM: 9,
    BOTTOM_LEFT: 10,
    BOTTOM_CENTER: 11,
    BOTTOM_RIGHT: 12,
  };

  maps.Animation = {
    BOUNCE: 1,
    DROP: 2,
  };

  maps.SymbolPath = {
    CIRCLE: 0,
  };

  maps.RenderingType = {
    RASTER: 'RASTER',
    VECTOR: 'VECTOR',
  };

  // Event System
  maps.event = {
    addListener(instance, eventName, handler) {
      if (!instance) return null;
      if (typeof instance.addListener === 'function') {
        return instance.addListener(eventName, handler);
      }
      return null;
    },
    removeListener(handle) {
      if (!handle) return;
      if (typeof handle.remove === 'function') {
        handle.remove();
      } else if (typeof handle === 'function') {
        handle();
      }
    },
    trigger(instance, eventName, ...args) {
      if (!instance) return;
      if (typeof instance._trigger === 'function') {
        instance._trigger(eventName, ...args);
      }
    }
  };

  // Projection helper (Mercator projection for pixel math)
  class CompatProjection {
    constructor(map) {
      this._map = map;
    }
    fromLatLngToPoint(latLng) {
      const p = toLatLngObj(latLng);
      // World coordinate in 256x256 space (standard Google Mercator)
      const siny = Math.sin((p.lat * Math.PI) / 180);
      const clampedSiny = Math.min(Math.max(siny, -0.9999), 0.9999);
      return new maps.Point(
        256 * (0.5 + p.lng / 360),
        256 * (0.5 - Math.log((1 + clampedSiny) / (1 - clampedSiny)) / (4 * Math.PI))
      );
    }
    fromLatLngToDivPixel(latLng) {
      const p = toLatLngObj(latLng);
      if (this._map && this._map._lmap) {
        const pt = this._map._lmap.latLngToLayerPoint([p.lat, p.lng]);
        return new maps.Point(pt.x, pt.y);
      }
      return new maps.Point(0, 0);
    }
  }

  // ── google.maps.Map ───────────────────────────────────────────────────────
  maps.Map = class {
    constructor(el, opts = {}) {
      this._el = typeof el === 'string' ? document.getElementById(el) : el;
      this._opts = opts;
      this._listeners = {};

      const initialCenter = toLatLngObj(opts.center || { lat: 21.0285, lng: 105.8542 });
      const initialZoom = opts.zoom || 13;

      if (!window.L) {
        console.error('[gmaps-leaflet] Leaflet is not loaded yet!');
        return;
      }

      // Initialize Leaflet Map
      this._lmap = L.map(this._el, {
        center: [initialCenter.lat, initialCenter.lng],
        zoom: initialZoom,
        zoomControl: false,
        attributionControl: false,
      });

      // High-quality Google Maps Roadmap tiles (Zero billing errors, crisp native Google styling)
      const lang = window.LANG || 'ko';
      const gl = lang === 'vi' ? 'VN' : (lang === 'en' ? 'US' : 'KR');
      L.tileLayer(`https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=${lang}&gl=${gl}`, {
        maxZoom: 20,
        subdomains: '0123',
        attribution: '&copy; Google'
      }).addTo(this._lmap);

      this._projection = new CompatProjection(this);

      // Controls Container setup for Google Maps ControlPositions
      this._initControlContainers();

      // Forward Leaflet events to Google Maps format
      this._lmap.on('click', e => {
        const latLng = new maps.LatLng(e.latlng.lat, e.latlng.lng);
        this._trigger('click', { latLng, pixel: e.layerPoint });
      });
      this._lmap.on('moveend', () => this._trigger('idle'));
      this._lmap.on('zoomend', () => this._trigger('zoom_changed'));
      this._lmap.on('move', () => this._trigger('bounds_changed'));

      // In case element is resized
      setTimeout(() => {
        this._lmap.invalidateSize();
      }, 200);
    }

    _initControlContainers() {
      this.controls = {};
      const positions = maps.ControlPosition;
      const posMap = {
        [positions.TOP_LEFT]: 'gmaps-ctrl-left-top',
        [positions.LEFT_TOP]: 'gmaps-ctrl-left-top',
        [positions.TOP_CENTER]: 'gmaps-ctrl-top-center',
        [positions.TOP_RIGHT]: 'gmaps-ctrl-right-top',
        [positions.RIGHT_TOP]: 'gmaps-ctrl-right-top',
        [positions.LEFT_CENTER]: 'gmaps-ctrl-left-center',
        [positions.RIGHT_CENTER]: 'gmaps-ctrl-right-center',
        [positions.LEFT_BOTTOM]: 'gmaps-ctrl-left-bottom',
        [positions.BOTTOM_LEFT]: 'gmaps-ctrl-left-bottom',
        [positions.RIGHT_BOTTOM]: 'gmaps-ctrl-right-bottom',
        [positions.BOTTOM_RIGHT]: 'gmaps-ctrl-right-bottom',
        [positions.BOTTOM_CENTER]: 'gmaps-ctrl-bottom-center',
      };

      Object.values(positions).forEach(posId => {
        const list = [];
        list.push = (domEl) => {
          if (!domEl) return 0;
          let containerClass = posMap[posId] || 'gmaps-ctrl-right-bottom';
          let container = this._el.querySelector(`.${containerClass}`);
          if (!container) {
            container = document.createElement('div');
            container.className = `gmaps-ctrl-container ${containerClass}`;
            if (window.L?.DomEvent) {
              L.DomEvent.disableClickPropagation(container);
              L.DomEvent.disableScrollPropagation(container);
            }
            this._el.appendChild(container);
          }
          if (window.L?.DomEvent && domEl) {
            L.DomEvent.disableClickPropagation(domEl);
            L.DomEvent.disableScrollPropagation(domEl);
          }
          container.appendChild(domEl);
          return Array.prototype.push.call(list, domEl);
        };
        list.getAt = (i) => list[i];
        list.setAt = (i, val) => { list[i] = val; };
        list.insertAt = (i, val) => list.push(val);
        list.removeAt = (i) => {
          const removed = list.splice(i, 1)[0];
          if (removed && removed.parentNode) removed.parentNode.removeChild(removed);
          return removed;
        };
        list.clear = () => {
          while (list.length > 0) {
            const el = list.pop();
            if (el && el.parentNode) el.parentNode.removeChild(el);
          }
        };
        this.controls[posId] = list;
      });
    }

    getDiv() { return this._el; }
    getProjection() { return this._projection; }

    setCenter(pos) {
      const p = toLatLngObj(pos);
      this._lmap.setView([p.lat, p.lng], this._lmap.getZoom());
    }

    getCenter() {
      const c = this._lmap.getCenter();
      return new maps.LatLng(c.lat, c.lng);
    }

    setZoom(z) {
      this._lmap.setZoom(z);
    }

    getZoom() {
      return this._lmap.getZoom();
    }

    panTo(pos) {
      const p = toLatLngObj(pos);
      this._lmap.panTo([p.lat, p.lng]);
    }

    fitBounds(bounds) {
      if (!bounds) return;
      const lb = bounds.getLBounds ? bounds.getLBounds() : null;
      if (lb && lb.isValid()) {
        this._lmap.fitBounds(lb, { padding: [30, 30] });
      }
    }

    getBounds() {
      const b = this._lmap.getBounds();
      return new maps.LatLngBounds(
        new maps.LatLng(b.getSouth(), b.getWest()),
        new maps.LatLng(b.getNorth(), b.getEast())
      );
    }

    setTilt(tilt) {}
    getTilt() { return 0; }

    addListener(event, cb) {
      this._listeners[event] = this._listeners[event] || [];
      this._listeners[event].push(cb);
      return {
        remove: () => {
          const arr = this._listeners[event];
          if (arr) {
            const idx = arr.indexOf(cb);
            if (idx >= 0) arr.splice(idx, 1);
          }
        }
      };
    }

    _trigger(event, ...args) {
      const arr = this._listeners[event];
      if (arr) {
        arr.forEach(cb => {
          try { cb(...args); } catch (e) { console.error(e); }
        });
      }
    }
  };

  // ── google.maps.Marker ────────────────────────────────────────────────────
  maps.Marker = class {
    constructor(opts = {}) {
      this._opts = opts;
      this._pos = toLatLngObj(opts.position);
      this._map = null;
      this._listeners = {};
      this._lmarker = null;

      this._buildLeafletMarker();

      if (opts.map) {
        this.setMap(opts.map);
      }
    }

    _createIcon(iconOpt) {
      if (!iconOpt) {
        return new L.Icon.Default();
      }

      // 1. Direct URL string
      if (typeof iconOpt === 'string') {
        return L.icon({
          iconUrl: iconOpt,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
          popupAnchor: [0, -32],
        });
      }

      // 2. Google Symbol Path (Circle, etc)
      if (iconOpt.path === maps.SymbolPath.CIRCLE) {
        const radius = (iconOpt.scale || 10);
        const fill = iconOpt.fillColor || '#2563eb';
        const stroke = iconOpt.strokeColor || '#fff';
        const sw = iconOpt.strokeWeight || 2;
        const fillOp = iconOpt.fillOpacity ?? 0.9;
        const size = (radius + sw) * 2;
        const html = `
          <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
            <circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="${fill}" fill-opacity="${fillOp}" stroke="${stroke}" stroke-width="${sw}" />
          </svg>`;
        return L.divIcon({
          html,
          className: 'gmaps-symbol-marker',
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
      }

      // 3. Object with url, scaledSize, anchor
      if (iconOpt.url) {
        const w = iconOpt.scaledSize?.width || 32;
        const h = iconOpt.scaledSize?.height || 32;
        const ax = iconOpt.anchor?.x !== undefined ? iconOpt.anchor.x : w / 2;
        const ay = iconOpt.anchor?.y !== undefined ? iconOpt.anchor.y : h;

        return L.icon({
          iconUrl: iconOpt.url,
          iconSize: [w, h],
          iconAnchor: [ax, ay],
          popupAnchor: [0, -ay],
        });
      }

      return new L.Icon.Default();
    }

    _buildLeafletMarker() {
      if (!window.L) return;
      const icon = this._createIcon(this._opts.icon);
      const lOpts = {
        icon,
        title: this._opts.title || '',
        zIndexOffset: this._opts.zIndex || 0,
        opacity: this._opts.opacity ?? 1,
      };

      this._lmarker = L.marker([this._pos.lat, this._pos.lng], lOpts);

      this._lmarker.on('click', e => {
        const latLng = new maps.LatLng(e.latlng.lat, e.latlng.lng);
        this._trigger('click', { latLng });
      });

      if (this._opts.animation === maps.Animation.BOUNCE) {
        this.setAnimation(maps.Animation.BOUNCE);
      }
    }

    setMap(map) {
      if (!this._lmarker) return;
      if (map && map._lmap) {
        this._map = map;
        this._lmarker.addTo(map._lmap);
      } else {
        if (this._lmarker) {
          this._lmarker.remove();
        }
        this._map = null;
      }
    }

    getMap() {
      return this._map;
    }

    setPosition(pos) {
      this._pos = toLatLngObj(pos);
      if (this._lmarker) {
        this._lmarker.setLatLng([this._pos.lat, this._pos.lng]);
      }
    }

    getPosition() {
      return new maps.LatLng(this._pos.lat, this._pos.lng);
    }

    setIcon(iconOpt) {
      this._opts.icon = iconOpt;
      if (this._lmarker) {
        this._lmarker.setIcon(this._createIcon(iconOpt));
      }
    }

    setTitle(t) {
      this._opts.title = t;
      if (this._lmarker && this._lmarker.getElement()) {
        this._lmarker.getElement().title = t || '';
      }
    }

    setZIndex(z) {
      if (this._lmarker) {
        this._lmarker.setZIndexOffset(Number(z) || 0);
      }
    }

    setOpacity(op) {
      if (this._lmarker) {
        this._lmarker.setOpacity(op);
      }
    }

    setAnimation(anim) {
      this._anim = anim;
      const el = this._lmarker?.getElement();
      if (!el) return;
      if (anim === maps.Animation.BOUNCE) {
        el.classList.add('gmaps-leaflet-bounce');
      } else {
        el.classList.remove('gmaps-leaflet-bounce');
      }
    }

    addListener(event, cb) {
      this._listeners[event] = this._listeners[event] || [];
      this._listeners[event].push(cb);
      return {
        remove: () => {
          const arr = this._listeners[event];
          if (arr) {
            const idx = arr.indexOf(cb);
            if (idx >= 0) arr.splice(idx, 1);
          }
        }
      };
    }

    _trigger(event, ...args) {
      const arr = this._listeners[event];
      if (arr) {
        arr.forEach(cb => {
          try { cb(...args); } catch (e) { console.error(e); }
        });
      }
    }
  };

  // ── google.maps.Circle ────────────────────────────────────────────────────
  maps.Circle = class {
    constructor(opts = {}) {
      this._opts = opts;
      this._center = toLatLngObj(opts.center);
      this._radius = opts.radius || 100;
      this._lcircle = null;

      if (window.L) {
        this._lcircle = L.circle([this._center.lat, this._center.lng], {
          radius: this._radius,
          color: opts.strokeColor || '#2563eb',
          weight: opts.strokeWeight || 2,
          opacity: opts.strokeOpacity ?? 0.8,
          fillColor: opts.fillColor || '#3b82f6',
          fillOpacity: opts.fillOpacity ?? 0.2,
        });
      }

      if (opts.map) {
        this.setMap(opts.map);
      }
    }

    setCenter(pos) {
      this._center = toLatLngObj(pos);
      if (this._lcircle) {
        this._lcircle.setLatLng([this._center.lat, this._center.lng]);
      }
    }

    getCenter() {
      return new maps.LatLng(this._center.lat, this._center.lng);
    }

    setRadius(r) {
      this._radius = Number(r) || 0;
      if (this._lcircle) {
        this._lcircle.setRadius(this._radius);
      }
    }

    setMap(map) {
      if (!this._lcircle) return;
      if (map && map._lmap) {
        this._lcircle.addTo(map._lmap);
      } else {
        this._lcircle.remove();
      }
    }
  };

  // ── google.maps.Polyline ──────────────────────────────────────────────────
  maps.Polyline = class {
    constructor(opts = {}) {
      this._opts = opts;
      const pts = (opts.path || []).map(p => {
        const obj = toLatLngObj(p);
        return [obj.lat, obj.lng];
      });

      this._lpoly = L.polyline(pts, {
        color: opts.strokeColor || '#2563eb',
        weight: opts.strokeWeight || 3,
        opacity: opts.strokeOpacity ?? 0.8,
      });

      if (opts.map) {
        this.setMap(opts.map);
      }
    }

    setMap(map) {
      if (!this._lpoly) return;
      if (map && map._lmap) {
        this._lpoly.addTo(map._lmap);
      } else {
        this._lpoly.remove();
      }
    }

    setPath(path) {
      const pts = (path || []).map(p => {
        const obj = toLatLngObj(p);
        return [obj.lat, obj.lng];
      });
      this._lpoly.setLatLngs(pts);
    }
  };

  // ── google.maps.InfoWindow ────────────────────────────────────────────────
  maps.InfoWindow = class {
    constructor(opts = {}) {
      this._content = opts.content || '';
      this._pos = opts.position ? toLatLngObj(opts.position) : null;
      this._lpopup = L.popup({
        autoClose: false,
        closeOnClick: false,
      });
      if (this._content) {
        this._lpopup.setContent(this._content);
      }
    }

    setContent(content) {
      this._content = content;
      if (this._lpopup) {
        this._lpopup.setContent(content);
      }
    }

    setPosition(pos) {
      this._pos = toLatLngObj(pos);
      if (this._lpopup) {
        this._lpopup.setLatLng([this._pos.lat, this._pos.lng]);
      }
    }

    open(mapOrOpts, anchorMarker) {
      let map = mapOrOpts;
      if (mapOrOpts && mapOrOpts.map) {
        anchorMarker = mapOrOpts.anchor;
        map = mapOrOpts.map;
      }
      if (!map && anchorMarker && anchorMarker.getMap()) {
        map = anchorMarker.getMap();
      }
      if (!map || !map._lmap) return;

      if (anchorMarker && anchorMarker._lmarker) {
        anchorMarker._lmarker.bindPopup(this._lpopup).openPopup();
      } else if (this._pos) {
        this._lpopup.setLatLng([this._pos.lat, this._pos.lng]).openOn(map._lmap);
      }
    }

    close() {
      if (this._lpopup) {
        this._lpopup.remove();
      }
    }
  };

  // ── google.maps.OverlayView ───────────────────────────────────────────────
  maps.OverlayView = class {
    constructor() {
      this._map = null;
      this._onMoveHandler = null;
    }

    setMap(map) {
      if (this._map === map) return;

      if (this._map && this._onMoveHandler) {
        this._map._lmap.off('move zoom', this._onMoveHandler);
        this._onMoveHandler = null;
        if (typeof this.onRemove === 'function') {
          this.onRemove();
        }
      }

      this._map = map;

      if (map && map._lmap) {
        if (typeof this.onAdd === 'function') {
          this.onAdd();
        }
        this._onMoveHandler = () => {
          if (typeof this.draw === 'function') this.draw();
        };
        map._lmap.on('move zoom', this._onMoveHandler);
        if (typeof this.draw === 'function') {
          this.draw();
        }
      }
    }

    getPanes() {
      if (!this._map || !this._map._lmap) {
        return { overlayMouseTarget: document.body, overlayLayer: document.body };
      }
      const p = this._map._lmap.getPanes();
      return {
        overlayMouseTarget: p.overlayPane,
        overlayLayer: p.overlayPane,
        markerLayer: p.markerPane,
        floatPane: p.popupPane,
      };
    }

    getProjection() {
      return this._map ? this._map.getProjection() : null;
    }
  };

  // Auto-init Leaflet immediately
  ensureLeaflet().then(() => {
    console.info('[gmaps-leaflet-compat] ✅ Google Maps API shim ready via Leaflet & OpenStreetMap.');
    // Trigger any waiting callbacks if any
    if (typeof window.__merchantMapCb === 'function') {
      window.__merchantMapCb();
    }
    if (typeof window.__findMerchantMapCb === 'function') {
      window.__findMerchantMapCb();
    }
    if (typeof window.__gmapsCb === 'function') {
      window.__gmapsCb();
    }
  }).catch(err => {
    console.error('[gmaps-leaflet-compat] Error loading Leaflet:', err);
  });

})();
