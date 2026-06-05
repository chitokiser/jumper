// merchants.daily.js — 일일 구역 (보물박스 15 + 몬스터 15 / 24h 리셋)
// 실제 게임과 동일: 20m 근접 → 클릭 공격 → HP 0 → GP 수령
import { db, functions } from '/assets/js/firebase-init.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

const ATTACK_RANGE = 20;  // m
const PLAYER_ATK   = 30;  // 공격당 데미지 (실제와 동일)
const ATTACK_CD_MS = 600; // 연속 공격 쿨다운

const MON_ICONS = {
  zombie:   '/assets/images/monsters/zombie1/animation/Run1.png',
  goblin:   '/assets/images/monsters/23.png',
  orc:      '/assets/images/monsters/orc/ORK_01_IDLE_000.png',
  skeleton: '/assets/images/monsters/orc2/ORK_02_IDLE_000.png',
  elite:    '/assets/images/monsters/orc3/ORK_03_IDLE_000.png',
};
const BOX_ICON = '/assets/images/item/box.png';
const BOX_RARITY_COLOR = { common:'#fbbf24', rare:'#60a5fa', epic:'#a78bfa' };

// ── 상태 ─────────────────────────────────────────────────────────────────
let _uid = null, _map = null, _infoWin = null;
let _items = [];          // { docId, type, species|boxType, lat, lng, hp, maxHp, gp, active }
let _hpState = {};        // { [docId]: currentHp } — 클라이언트 전용
let _markers = [];
let _lastAttack = {};     // { [docId]: timestamp }
let _alerted = new Set();

// ── 초기화 ───────────────────────────────────────────────────────────────
export async function initDailyArea(uid, lat, lng, map, infoWindow) {
  _uid = uid; _map = map; _infoWin = infoWindow;

  // Cloud Function 호출 — 오늘 이미 생성된 경우 스킵
  try {
    await httpsCallable(functions, 'createDailyArea')({ lat, lng });
  } catch { /* 네트워크 오류 무시 — 기존 항목 로드 시도 */ }

  await _loadItems();
  _renderMarkers();
}

// ── Firestore 로드 ───────────────────────────────────────────────────────
async function _loadItems() {
  if (!_uid) return;
  const today = new Date(Date.now() + 7*3600*1000).toISOString().slice(0,10);
  const snap = await getDocs(collection(db, 'users', _uid, 'dailyArea'));
  _items = snap.docs
    .map(d => ({ docId: d.id, ...d.data() }))
    .filter(i => i.active && i.resetDate === today);
  // HP 상태 초기화 (이미 있으면 유지)
  for (const item of _items) {
    if (_hpState[item.docId] === undefined) _hpState[item.docId] = item.hp;
  }
}

// ── 마커 렌더링 ──────────────────────────────────────────────────────────
function _renderMarkers() {
  _clearMarkers();
  for (const item of _items) _addMarker(item);
}

function _addMarker(item) {
  const isBox = item.type === 'box';
  const icon  = isBox ? BOX_ICON : (MON_ICONS[item.species] || MON_ICONS.orc);
  const size  = isBox ? 28 : 36;
  const half  = size / 2;

  const marker = new google.maps.Marker({
    position: { lat: item.lat, lng: item.lng },
    map:      _map,
    icon: { url: icon, scaledSize: new google.maps.Size(size, size), anchor: new google.maps.Point(half, half) },
    title:    isBox ? `📦 Daily ${item.boxType} box (+${item.gp} GP)` : `👹 Daily ${item.species} (+${item.gp} GP)`,
    zIndex:   5,
  });
  marker.addListener('click', () => _onItemClick(item, marker));
  marker._dailyDocId = item.docId;
  _markers.push(marker);
}

function _clearMarkers() {
  _markers.forEach(m => m.setMap(null));
  _markers = [];
}

// ── GPS 근접 감지 ────────────────────────────────────────────────────────
export function checkDailyProximity(lat, lng) {
  if (!_items.length) return;
  for (const item of _items) {
    const dist = _haversine(lat, lng, item.lat, item.lng);
    if (dist <= ATTACK_RANGE && !_alerted.has(item.docId)) {
      _alerted.add(item.docId);
      const label = item.type === 'box'
        ? `📦 Daily ${item.boxType} box nearby! (+${item.gp} GP)`
        : `👹 Daily ${item.species} nearby! (+${item.gp} GP)`;
      _showToast(label);
      if (navigator.vibrate) navigator.vibrate([50, 30, 50]);
      _highlightMarker(item.docId, true);
    } else if (dist > ATTACK_RANGE + 5 && _alerted.has(item.docId)) {
      _alerted.delete(item.docId);
      _highlightMarker(item.docId, false);
    }
  }
}

function _highlightMarker(docId, on) {
  const m = _markers.find(m => m._dailyDocId === docId);
  if (!m) return;
  const item = _items.find(i => i.docId === docId);
  if (!item) return;
  const isBox = item.type === 'box';
  const size  = on ? (isBox ? 42 : 52) : (isBox ? 28 : 36);
  const half  = size / 2;
  const icon  = isBox ? BOX_ICON : (MON_ICONS[item.species] || MON_ICONS.orc);
  m.setIcon({ url: icon, scaledSize: new google.maps.Size(size, size), anchor: new google.maps.Point(half, half) });
  m.setZIndex(on ? 20 : 5);
}

// ── 클릭 → 공격 ─────────────────────────────────────────────────────────
function _onItemClick(item, marker) {
  if (!_infoWin) return;
  const curHp = _hpState[item.docId] ?? item.hp;
  const pos   = window._myMapGetPos?.();
  const dist  = pos ? _haversine(pos.lat, pos.lng, item.lat, item.lng) : null;
  const inRange = dist !== null && dist <= ATTACK_RANGE;
  const isBox   = item.type === 'box';

  const hpPct   = Math.max(0, curHp / item.maxHp * 100);
  const hpBar   = `<div style="height:6px;background:#1f2937;border-radius:3px;margin:6px 0;">
    <div style="height:100%;width:${hpPct}%;background:${isBox?'#fbbf24':'#ef4444'};border-radius:3px;transition:width .2s"></div></div>`;
  const distTxt = dist !== null
    ? (inRange ? `📍 ${Math.round(dist)}m — In range!` : `📍 ${Math.round(dist)}m — ${Math.round(dist - ATTACK_RANGE)}m more`)
    : '📍 Getting GPS...';

  _infoWin.setContent(`
    <div style="padding:8px 10px;min-width:170px;font-family:sans-serif;">
      <b style="font-size:13px;">${isBox ? `📦 Daily ${item.boxType} box` : `👹 Daily ${item.species}`}</b>
      <div style="font-size:11px;color:#f59e0b;">+${item.gp} GP on defeat</div>
      ${hpBar}
      <div style="font-size:10px;color:#6b7280;">HP: ${curHp} / ${item.maxHp}</div>
      <div style="font-size:11px;color:${inRange?'#16a34a':'#d97706'};margin:4px 0;">${distTxt}</div>
      ${inRange ? `<button onclick="window.__dailyAttack('${item.docId}')"
        style="width:100%;padding:7px;background:${isBox?'#d97706':'#dc2626'};color:#fff;
               border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:700;margin-top:4px;">
        ${isBox ? '⚔️ Attack Box' : '⚔️ Fight Monster'}
      </button>` : ''}
    </div>`);
  _infoWin.open(_map, marker);
}

// ── 공격 실행 ────────────────────────────────────────────────────────────
window.__dailyAttack = async (docId) => {
  const now = Date.now();
  if (now - (_lastAttack[docId] || 0) < ATTACK_CD_MS) return;
  _lastAttack[docId] = now;

  const item = _items.find(i => i.docId === docId);
  if (!item) return;

  // 거리 재확인
  const pos = window._myMapGetPos?.();
  if (pos) {
    const dist = _haversine(pos.lat, pos.lng, item.lat, item.lng);
    if (dist > ATTACK_RANGE) { _showToast('Get closer! (within 20m)'); return; }
  }

  const curHp = Math.max(0, (_hpState[docId] ?? item.hp) - PLAYER_ATK);
  _hpState[docId] = curHp;

  // InfoWindow HP 바 업데이트
  if (_infoWin) {
    const hpPct = curHp / item.maxHp * 100;
    const barEl = document.querySelector('.gm-style-iw .dg-daily-bar');
    if (barEl) barEl.style.width = hpPct + '%';
  }

  // 플로팅 데미지 텍스트 (기존 _addFloat 패턴)
  _showDmgFloat(item.lat, item.lng, `-${PLAYER_ATK}`);

  if (curHp <= 0) {
    // 처치 완료 → Cloud Function으로 GP 수령
    if (_infoWin) _infoWin.close();
    _removeItem(docId);
    try {
      const res = await httpsCallable(functions, 'claimDailyItem')({ itemId: docId });
      const gp  = res.data?.gp || item.gp;
      _showToast(`${item.type === 'box' ? '📦 Box opened' : '💀 Monster defeated'}! +${gp} GP`);
      // HUD GP 갱신 (merchants.js의 전역 함수)
      window._dailyOnGpGain?.(gp);
    } catch { _showToast(`+${item.gp} GP!`); }
  } else {
    // 아직 살아있음 — 마커 흔들기
    _shakeMarker(docId);
  }
};

function _removeItem(docId) {
  _items = _items.filter(i => i.docId !== docId);
  delete _hpState[docId];
  delete _lastAttack[docId];
  _alerted.delete(docId);
  const idx = _markers.findIndex(m => m._dailyDocId === docId);
  if (idx !== -1) { _markers[idx].setMap(null); _markers.splice(idx, 1); }
}

function _shakeMarker(docId) {
  const m = _markers.find(m => m._dailyDocId === docId);
  if (!m) return;
  const base = m.getPosition();
  let t = 0;
  const iv = setInterval(() => {
    m.setPosition({ lat: base.lat() + (Math.random()-.5)*0.00004, lng: base.lng() + (Math.random()-.5)*0.00004 });
    if (++t > 4) { clearInterval(iv); m.setPosition(base); }
  }, 60);
}

// ── 유틸 ─────────────────────────────────────────────────────────────────
function _haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function _showToast(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    padding:8px 18px;border-radius:20px;font-size:13px;font-weight:600;z-index:9900;
    background:#1d4ed8;color:#fff;pointer-events:none;white-space:nowrap;`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function _showDmgFloat(lat, lng, text) {
  // Google Map LatLng → 화면 좌표로 변환
  if (!_map) return;
  const overlay = new google.maps.OverlayView();
  overlay.onAdd = function() {};
  overlay.draw = function() {};
  overlay.onRemove = function() {};
  overlay.setMap(_map);
  // Simple DOM float
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = `position:fixed;font-size:14px;font-weight:900;color:#ef4444;
    pointer-events:none;z-index:9800;text-shadow:0 1px 3px rgba(0,0,0,.8);`;
  // 위치는 근사값 (맵 중앙 근처)
  const rect = _map.getDiv().getBoundingClientRect();
  el.style.left = (rect.left + rect.width/2 + (Math.random()-.5)*60) + 'px';
  el.style.top  = (rect.top  + rect.height/2 + (Math.random()-.5)*40) + 'px';
  document.body.appendChild(el);
  let y = 0;
  const anim = setInterval(() => { y -= 2; el.style.transform = `translateY(${y}px)`; el.style.opacity = Math.max(0, 1 - Math.abs(y)/40); if (Math.abs(y) > 40) { clearInterval(anim); el.remove(); } }, 30);
  overlay.setMap(null);
}
