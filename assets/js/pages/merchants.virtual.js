// merchants.virtual.js — Virtual Explore Mode
// GPS OFF 상태에서 상점 워프 → 실제 플레이어 마커를 목표 위치로 이동
// 이후 ▶(플레이) 버튼으로 게임 서버 연결 → 워프 위치 기준 탐험·몬스터 사냥

import { db } from '/assets/js/firebase-init.js';
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const WARP_RADIUS_M  = 5000;
const SPAWN_OFFSET_M = 550;   // 상점 방어 구조물 밖 스폰
const BASE_MP_COST   = 100;

const GPS_ONLY_RARITIES = ['rare', 'legendary'];
function _isGpsOnly(box) {
  if (!box) return false;
  if (GPS_ONLY_RARITIES.includes(box.rarity)) return true;
  if (box.isQR || box.isNFC) return true;
  if (box.hiddenBox && box.rarity !== 'common') return true;
  return false;
}

// ── 상태 ─────────────────────────────────────────────────────────────────
let _active       = false;
let _ctx          = null;
let _map          = null;
let _onModeChange = null;
let _cbs          = null;   // { spendMp, getMp, getMaxMp, moveMarker, hideMarker }
let _virtualPos   = null;   // { lat, lng } — 현재 가상 위치
let _warpShop     = null;
let _radiusCircle = null;
let _mapClickLsn  = null;
let _walkRafId    = null;   // 걷기 requestAnimationFrame ID
let _shops        = [];
let _modalEl      = null;

// ── 초기화 ───────────────────────────────────────────────────────────────
export function initVirtualMode(ctx, map, infoWindow, onModeChange, cbs = null) {
  _ctx = ctx; _map = map;
  _onModeChange = onModeChange;
  _cbs = cbs;
  _buildModal();
  _loadShops();
}

export function isVirtualMode() { return _active; }
export function getVirtualPos() { return _virtualPos; }
export function getWarpShop()   { return _warpShop; }
export function canCollectInVirtual(box) {
  if (!_active) return true;
  return !_isGpsOnly(box);
}

// ── 모드 토글 ────────────────────────────────────────────────────────────
export function toggleVirtualMode() {
  if (_active) {
    _deactivate();
    return;
  }
  // 항상 최신 상점 목록을 Firestore에서 재로드 후 모달 표시
  _showToast('Loading shops…');
  _loadShops().then(() => {
    if (_shops.length === 0) {
      _showToast('No shops available. Ask admin to place a shop first.');
      return;
    }
    _showShopSelector();
  });
}

// ── MP 비용 ──────────────────────────────────────────────────────────────
function _calcMpCost(shop) {
  const pos = _ctx.lastPos;
  if (!pos) return Math.round(BASE_MP_COST / 10);
  const distKm = _haversine(pos.lat, pos.lng, shop.lat, shop.lng) / 1000;
  return Math.round((BASE_MP_COST + distKm) / 10);
}

// ── 워프 활성화 ──────────────────────────────────────────────────────────
function _activate(shop) {
  // MP 차감
  const mpCost = _calcMpCost(shop);
  if (_cbs) {
    const cur = _cbs.getMp();
    if (cur < mpCost) { _showToast(`💙 MP 부족 (필요 ${mpCost} / 현재 ${cur})`); return; }
    _cbs.spendMp(mpCost);
  }

  // 상점 500m 외곽 랜덤 방향 스폰
  const spawnPos = _offsetPos(shop.lat, shop.lng, SPAWN_OFFSET_M, Math.random() * 360);

  _active = true;
  _warpShop = shop;
  _virtualPos = spawnPos;

  // _ctx.lastPos를 가상 위치로 설정 → 게임 서버·보물·몬스터 모두 이 위치 기준
  _cbs?.moveMarker(spawnPos.lat, spawnPos.lng);

  _map.panTo({ lat: shop.lat, lng: shop.lng });
  _map.setZoom(15);

  // 5km 탐험 반경 원
  _radiusCircle?.setMap(null);
  _radiusCircle = new google.maps.Circle({
    map: _map, center: { lat: shop.lat, lng: shop.lng }, radius: WARP_RADIUS_M,
    fillColor: '#7c3aed', fillOpacity: 0.04,
    strokeColor: '#7c3aed', strokeWeight: 1.5, strokeOpacity: 0.45,
    clickable: false, zIndex: 1,
  });

  // 워프 도착 링 효과
  _warpRingEffect(spawnPos);

  // 지도 탭 → 캐릭터 걷기 이동
  if (_mapClickLsn) google.maps.event.removeListener(_mapClickLsn);
  _mapClickLsn = _map.addListener('click', e => _onMapTap(e.latLng.lat(), e.latLng.lng()));

  _onModeChange?.(true, shop);
  _updateBtn(true);
  _showToast(`🌍 ${shop.name} 워프 완료!${_cbs ? ` 💙-${mpCost}` : ''} · 지도 탭으로 이동`);
}

// ── 비활성화 ─────────────────────────────────────────────────────────────
function _deactivate() {
  if (_walkRafId) { cancelAnimationFrame(_walkRafId); _walkRafId = null; }
  _active = false; _warpShop = null; _virtualPos = null;
  _radiusCircle?.setMap(null); _radiusCircle = null;
  if (_mapClickLsn) { google.maps.event.removeListener(_mapClickLsn); _mapClickLsn = null; }
  _onModeChange?.(false, null);
  _updateBtn(false);
  _showToast('📍 GPS 모드로 전환됐습니다');
}

// ── 지도 탭 → 실제 캐릭터 걷기 이동 ──────────────────────────────────────
function _onMapTap(lat, lng) {
  if (!_active || !_warpShop) return;
  if (_haversine(lat, lng, _warpShop.lat, _warpShop.lng) > WARP_RADIUS_M) {
    _showToast('⛔ You cannot move outside the 5km exploration radius around this shop.');
    return;
  }

  const from    = { ..._virtualPos };
  const moveDist = _haversine(from.lat, from.lng, lat, lng);
  // 거리 비례 이동 시간 500ms ~ 2000ms
  const duration = Math.max(500, Math.min(moveDist / 25 * 1000, 2000));

  _walkTo(from, { lat, lng }, duration, () => {
    _virtualPos = { lat, lng };
    _ctx._onVirtualMove?.(lat, lng);
  });
}

// ── 걷기 이동 (실제 플레이어 마커 부드럽게 이동) ────────────────────────
function _walkTo(from, target, duration, onDone) {
  if (_walkRafId) cancelAnimationFrame(_walkRafId);
  const start = performance.now();

  const tick = (now) => {
    const raw = (now - start) / duration;
    const t   = Math.min(raw, 1);
    // ease-in-out quad
    const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    const pos = {
      lat: from.lat + (target.lat - from.lat) * e,
      lng: from.lng + (target.lng - from.lng) * e,
    };
    _cbs?.moveMarker(pos.lat, pos.lng);
    if (t < 1) {
      _walkRafId = requestAnimationFrame(tick);
    } else {
      _virtualPos = { ...target };
      _cbs?.moveMarker(target.lat, target.lng);
      _walkRafId = null;
      onDone?.();
    }
  };
  _walkRafId = requestAnimationFrame(tick);
}

// ── 워프 도착 링 효과 (Google Maps Circle 확장) ───────────────────────────
function _warpRingEffect(pos) {
  const ring = new google.maps.Circle({
    map: _map, center: pos, radius: 1,
    fillColor: '#7c3aed', fillOpacity: 0.55,
    strokeColor: '#a78bfa', strokeWeight: 2.5,
    clickable: false, zIndex: 500,
  });
  let r = 0;
  const grow = () => {
    r += 18;
    if (!ring.getMap()) return;
    ring.setRadius(r);
    ring.setOptions({ fillOpacity: Math.max(0, 0.55 - r / 160) });
    if (r < 160) requestAnimationFrame(grow);
    else ring.setMap(null);
  };
  requestAnimationFrame(grow);
}

// ── 상점 목록 로드 ───────────────────────────────────────────────────────
async function _loadShops() {
  try {
    const snap = await getDocs(query(collection(db, 'game_shops'), where('active', '==', true)));
    _shops = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(s => s.lat && s.lng)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } catch { /* silent */ }
}

// ── 상점 선택 모달 ───────────────────────────────────────────────────────
function _showShopSelector() {
  if (!_modalEl) return;
  const myPos = _ctx.lastPos;
  const curMp = _cbs ? _cbs.getMp()    : Infinity;
  const maxMp = _cbs ? _cbs.getMaxMp() : Infinity;

  const rows = _shops.map(s => {
    const dist    = myPos ? _haversine(myPos.lat, myPos.lng, s.lat, s.lng) : null;
    const distTxt = dist !== null
      ? (dist < 1000 ? `${Math.round(dist)}m` : `${(dist / 1000).toFixed(1)}km`)
      : '거리 불명';
    const mpCost    = myPos
      ? Math.round((BASE_MP_COST + _haversine(myPos.lat, myPos.lng, s.lat, s.lng) / 1000) / 10)
      : Math.round(BASE_MP_COST / 10);
    const canAfford = curMp >= mpCost;
    const typeLabel = s.type === 'weapon_armor' ? '⚔️' : s.type === 'potion' ? '🧪' : '🛒';
    const rivals    = _shops.filter(o =>
      o.id !== s.id && o.type === s.type && _haversine(s.lat, s.lng, o.lat, o.lng) <= 5000
    ).length;
    const badge = rivals > 0
      ? `<span class="vm-rival">⚔️×${rivals}</span>`
      : `<span class="vm-excl">독점</span>`;

    return `<div class="vm-shop-row${canAfford ? '' : ' vm-shop-disabled'}"
                 onclick="${canAfford ? `window.__vmWarp('${s.id}')` : 'void 0'}">
      <span class="vm-shop-icon">${typeLabel}</span>
      <div class="vm-shop-info">
        <div class="vm-shop-name">${s.name || '상점'}&nbsp;${badge}</div>
        <div class="vm-shop-dist">${distTxt}</div>
      </div>
      <span class="vm-shop-mp${canAfford ? '' : ' vm-shop-mp-low'}">💙${mpCost}</span>
    </div>`;
  }).join('') || '<div style="color:#6b7280;padding:20px;text-align:center;">등록된 상점이 없습니다</div>';

  const mpBar = _cbs
    ? `<div class="vm-mp-bar-wrap">
        <div class="vm-mp-label">💙 ${curMp} / ${maxMp} MP</div>
        <div class="vm-mp-track">
          <div class="vm-mp-fill" style="width:${Math.max(0,Math.min(100,(curMp/maxMp)*100)).toFixed(1)}%"></div>
        </div>
      </div>`
    : '';

  _modalEl.querySelector('#vmShopList').innerHTML = rows;
  _modalEl.querySelector('#vmMpBar').innerHTML    = mpBar;
  _modalEl.classList.remove('hidden');
  _modalEl.classList.add('vm-open');

  window.__vmWarp = (shopId) => {
    const shop = _shops.find(s => s.id === shopId);
    if (!shop) return;
    _closeModal();
    _activate(shop);
  };
}

function _closeModal() {
  _modalEl?.classList.remove('vm-open');
  setTimeout(() => _modalEl?.classList.add('hidden'), 300);
}

// ── DOM 빌드 ─────────────────────────────────────────────────────────────
function _buildModal() {
  if (document.getElementById('vmModal')) { _modalEl = document.getElementById('vmModal'); return; }
  const el = document.createElement('div');
  el.id = 'vmModal';
  el.className = 'hidden';
  el.innerHTML = `
<style>
#vmModal{position:fixed;inset:0;z-index:8500;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;
  opacity:0;transition:opacity .3s;pointer-events:none;}
#vmModal.vm-open{opacity:1;pointer-events:all;}
#vmModal.hidden{display:none!important}
.vm-sheet{width:100%;max-height:72vh;background:#0f172a;border-radius:18px 18px 0 0;
  padding:16px 0 32px;overflow-y:auto;transform:translateY(100%);transition:transform .3s;}
#vmModal.vm-open .vm-sheet{transform:translateY(0);}
.vm-sheet-handle{width:36px;height:4px;background:#334155;border-radius:2px;margin:0 auto 14px;}
.vm-sheet-title{font-size:15px;font-weight:800;color:#e2e8f0;padding:0 18px;margin-bottom:4px;}
.vm-sheet-sub{font-size:11px;color:#64748b;padding:0 18px 10px;border-bottom:1px solid #1e293b;}
.vm-mp-bar-wrap{padding:8px 18px 10px;border-bottom:1px solid #1e293b;}
.vm-mp-label{font-size:11px;color:#a78bfa;font-weight:700;margin-bottom:4px;}
.vm-mp-track{height:5px;background:#1e293b;border-radius:3px;overflow:hidden;}
.vm-mp-fill{height:100%;background:linear-gradient(90deg,#7c3aed,#a78bfa);border-radius:3px;transition:width .3s;}
.vm-shop-row{display:flex;align-items:center;gap:12px;padding:12px 18px;cursor:pointer;transition:background .15s;}
.vm-shop-row:hover:not(.vm-shop-disabled){background:#1e293b;}
.vm-shop-row.vm-shop-disabled{opacity:.4;cursor:not-allowed;}
.vm-shop-icon{font-size:20px;min-width:28px;text-align:center;}
.vm-shop-info{flex:1;min-width:0;}
.vm-shop-name{font-size:13px;font-weight:700;color:#e2e8f0;display:flex;align-items:center;gap:5px;flex-wrap:wrap;}
.vm-shop-dist{font-size:11px;color:#7c3aed;margin-top:2px;}
.vm-shop-mp{color:#a78bfa;font-size:12px;font-weight:700;min-width:44px;text-align:right;flex-shrink:0;}
.vm-shop-mp-low{color:#ef4444;}
.vm-rival{font-size:10px;color:#f59e0b;background:rgba(245,158,11,.15);border-radius:4px;padding:1px 5px;}
.vm-excl{font-size:10px;color:#10b981;background:rgba(16,185,129,.15);border-radius:4px;padding:1px 5px;}
.vm-close-btn{width:calc(100% - 36px);margin:14px 18px 0;padding:11px;background:#1e293b;
  color:#94a3b8;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;}
</style>
<div class="vm-sheet">
  <div class="vm-sheet-handle"></div>
  <div class="vm-sheet-title">🌍 Virtual Explore — 상점 선택</div>
  <div class="vm-sheet-sub">워프 후 ▶ 버튼으로 게임 서버 연결 · 지도 탭으로 캐릭터 이동</div>
  <div id="vmMpBar"></div>
  <div id="vmShopList"></div>
  <button class="vm-close-btn" onclick="window.__vmCloseModal()">✕ 닫기</button>
</div>`;
  document.body.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el) _closeModal(); });
  window.__vmCloseModal = _closeModal;
  _modalEl = el;
}

// ── 버튼 상태 ────────────────────────────────────────────────────────────
function _updateBtn(on) {
  const btn = document.getElementById('btnVirtualMode');
  if (!btn) return;
  btn.textContent      = on ? '🌍' : '🌍';
  btn.title            = on ? 'Virtual Mode ON — GPS 모드로 전환' : 'Virtual Explore — 상점 워프';
  btn.style.background = on ? '#7c3aed' : '';
  btn.style.color      = on ? '#fff' : '';
  btn.style.boxShadow  = on ? '0 0 10px #7c3aed88' : '';
}

// ── 유틸 ─────────────────────────────────────────────────────────────────
function _haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function _offsetPos(lat, lng, distM, bearingDeg) {
  const R = 6371000, d = distM / R, b = bearingDeg * Math.PI / 180;
  const φ1 = lat * Math.PI / 180, λ1 = lng * Math.PI / 180;
  const φ2 = Math.asin(Math.sin(φ1)*Math.cos(d) + Math.cos(φ1)*Math.sin(d)*Math.cos(b));
  const λ2 = λ1 + Math.atan2(Math.sin(b)*Math.sin(d)*Math.cos(φ1), Math.cos(d)-Math.sin(φ1)*Math.sin(φ2));
  return { lat: φ2 * 180 / Math.PI, lng: λ2 * 180 / Math.PI };
}

function _showToast(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `position:fixed;bottom:90px;left:50%;transform:translateX(-50%);
    padding:9px 20px;border-radius:20px;font-size:13px;font-weight:600;z-index:9900;
    background:#7c3aed;color:#fff;pointer-events:none;white-space:nowrap;
    box-shadow:0 4px 16px rgba(124,58,237,.4);`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}
