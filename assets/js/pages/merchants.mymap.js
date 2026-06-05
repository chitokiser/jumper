// /assets/js/pages/merchants.mymap.js
// 체험용 개인 맵 — users/{uid}/myMap 서브컬렉션 저장, 본인만 표시
// 설계: Cloud Function 불필요, 직접 Firestore 읽기/쓰기, 최대 50개 제한

import { db } from '/assets/js/firebase-init.js';
import {
  collection, doc, addDoc, deleteDoc, getDocs, updateDoc,
  serverTimestamp, increment,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const MAX_ITEMS    = 50;
const COLLECT_DIST = 20; // meters

// 아이템 타입별 GP 보상
const TRIAL_GP = {
  treasure1:      50,
  monster_orc:   100,
  monster_orc2:  100,
  monster_orc3:  120,
  monster_pirate: 150,
  monster_slime:   50,
  monster_goblin:  75,
};

// ── 아이템 타입 정의 ──────────────────────────────────────────────────────────
export const MYMAP_DEFS = {
  treasure1: { cat: 'treasure', icon: '/assets/images/item/box.png',                                    label: '🎁 보물박스',  size: 28 },
  monster_orc:    { cat: 'monster',  icon: '/assets/images/monsters/orc/ORK_01_IDLE_000.png',           label: '👹 오크',     size: 36 },
  monster_orc2:   { cat: 'monster',  icon: '/assets/images/monsters/orc2/ORK_02_IDLE_000.png',         label: '👺 오크2',    size: 36 },
  monster_orc3:   { cat: 'monster',  icon: '/assets/images/monsters/orc3/ORK_03_IDLE_000.png',         label: '🐗 오크3',    size: 36 },
  monster_pirate: { cat: 'monster',  icon: '/assets/images/monsters/pirate/1_entity_000_ATTACK_000.png',label: '🏴‍☠️ 해적',   size: 36 },
  monster_slime:  { cat: 'monster',  icon: '/assets/images/monsters/22.png',                            label: '🟢 슬라임',   size: 36 },
  monster_goblin: { cat: 'monster',  icon: '/assets/images/monsters/23.png',                            label: '🗡️ 고블린',   size: 36 },
};

// ── 상태 ─────────────────────────────────────────────────────────────────────
let _uid       = null;
let _map       = null;
let _infoWin   = null;
let _items     = [];      // { docId, typeKey, lat, lng, label }[]
let _markers   = [];      // google.maps.Marker[]
let _active    = false;
let _placeKey  = null;
let _clickLsn  = null;
let _alerted   = new Set(); // 근접 알림 발송된 docId

// ── 초기화 ───────────────────────────────────────────────────────────────────
export function initMyMap(uid, map, infoWindow) {
  _uid     = uid;
  _map     = map;
  _infoWin = infoWindow;
}

// ── 탭 활성화 ────────────────────────────────────────────────────────────────
export async function activateMyMap() {
  if (_active) return;
  _active = true;
  await _loadItems();
  _renderMarkers();
}

// ── 탭 비활성화 ──────────────────────────────────────────────────────────────
export function deactivateMyMap() {
  _active   = false;
  _placeKey = null;
  _clearClickListener();
  _clearMarkers();
}

// ── Firestore 로드 ───────────────────────────────────────────────────────────
async function _loadItems() {
  if (!_uid) return;
  const snap = await getDocs(collection(db, 'users', _uid, 'myMap'));
  _items = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
}

// ── 마커 전체 렌더 ───────────────────────────────────────────────────────────
function _renderMarkers() {
  _clearMarkers();
  for (const item of _items) _addMarkerForItem(item);
}

function _addMarkerForItem(item) {
  const def  = MYMAP_DEFS[item.typeKey] || MYMAP_DEFS.treasure1;
  const half = Math.round(def.size / 2);
  const marker = new google.maps.Marker({
    position: { lat: item.lat, lng: item.lng },
    map:      _map,
    icon: {
      url:        def.icon,
      scaledSize: new google.maps.Size(def.size, def.size),
      anchor:     new google.maps.Point(half, half),
    },
    title:  item.label || def.label,
    zIndex: 4,
  });
  marker.addListener('click', () => _onMarkerClick(item, marker));
  marker._myMapDocId = item.docId;
  _markers.push(marker);
}

function _clearMarkers() {
  _markers.forEach(m => m.setMap(null));
  _markers = [];
}

// ── 마커 클릭 — 거리 확인 후 수집/전투 버튼 ────────────────────────────────
function _onMarkerClick(item, marker) {
  if (!_infoWin) return;
  const def  = MYMAP_DEFS[item.typeKey] || MYMAP_DEFS.treasure1;
  const gp   = TRIAL_GP[item.typeKey] || 50;
  const isTreasure = def.cat === 'treasure';
  const actionLabel = isTreasure ? '🎁 수집하기' : '⚔️ 전투';

  // 현재 GPS 위치 확인
  const pos = window._myMapGetPos?.();
  const dist = pos ? _haversine(pos.lat, pos.lng, item.lat, item.lng) : null;
  const inRange = dist !== null && dist <= COLLECT_DIST;

  const distText = dist !== null
    ? (inRange ? `📍 ${Math.round(dist)}m 이내 — 수집 가능!` : `📍 ${Math.round(dist)}m — ${Math.round(dist - COLLECT_DIST)}m 더 가까이`)
    : '📍 GPS 위치 확인 중...';

  _infoWin.setContent(`
    <div style="padding:8px 10px;min-width:160px;font-family:sans-serif;">
      <div style="font-weight:700;margin-bottom:4px;">${item.label || def.label}</div>
      <div style="font-size:11px;color:#6b7280;margin-bottom:6px;">🧪 체험 · +${gp} GP</div>
      <div style="font-size:11px;color:${inRange ? '#16a34a' : '#d97706'};margin-bottom:8px;">${distText}</div>
      ${inRange
        ? `<button onclick="window.__myMapCollect('${item.docId}')"
             style="width:100%;padding:7px 0;background:#2563eb;color:#fff;border:none;
                    border-radius:6px;cursor:pointer;font-size:13px;font-weight:700;">
             ${actionLabel} (+${gp} GP)
           </button>`
        : ''}
      <button onclick="window.__myMapDelete('${item.docId}')"
        style="width:100%;margin-top:6px;padding:6px 0;background:#dc2626;color:#fff;border:none;
               border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">
        🗑 삭제
      </button>
    </div>`);
  _infoWin.open(_map, marker);
}

// ── GPS 근접 감지 (merchants.js GPS 업데이트에서 호출) ───────────────────────
export function checkMyMapProximity(lat, lng) {
  if (!_active || !_items.length) return;
  for (const item of _items) {
    if (!item.lat || !item.lng) continue;
    const dist = _haversine(lat, lng, item.lat, item.lng);
    if (dist <= COLLECT_DIST && !_alerted.has(item.docId)) {
      _alerted.add(item.docId);
      const def = MYMAP_DEFS[item.typeKey] || MYMAP_DEFS.treasure1;
      const gp  = TRIAL_GP[item.typeKey] || 50;
      _showToast(`${def.label} 근처! 탭해서 +${gp} GP`, false);
      if (navigator.vibrate) navigator.vibrate([60, 30, 60]);
      // 마커 크기 강조
      _highlightMarker(item.docId, true);
    } else if (dist > COLLECT_DIST + 5 && _alerted.has(item.docId)) {
      _alerted.delete(item.docId);
      _highlightMarker(item.docId, false);
    }
  }
}

function _highlightMarker(docId, on) {
  const m = _markers.find(m => m._myMapDocId === docId);
  if (!m) return;
  const item = _items.find(i => i.docId === docId);
  if (!item) return;
  const def  = MYMAP_DEFS[item.typeKey] || MYMAP_DEFS.treasure1;
  const size = on ? def.size * 1.5 : def.size;
  const half = Math.round(size / 2);
  m.setIcon({
    url:        def.icon,
    scaledSize: new google.maps.Size(size, size),
    anchor:     new google.maps.Point(half, half),
  });
  m.setZIndex(on ? 10 : 4);
}

// ── 수집/전투 실행 ───────────────────────────────────────────────────────────
window.__myMapCollect = async (docId) => {
  if (!_uid) return;
  const item = _items.find(i => i.docId === docId);
  if (!item) return;
  if (_infoWin) _infoWin.close();

  const gp = TRIAL_GP[item.typeKey] || 50;
  try {
    await Promise.all([
      deleteDoc(doc(db, 'users', _uid, 'myMap', docId)),
      updateDoc(doc(db, 'battle_players', _uid), { gold: increment(gp) }),
    ]);
  } catch {
    // battle_players 문서 없으면 set으로 재시도
    try {
      const { setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
      await setDoc(doc(db, 'battle_players', _uid), { gold: gp }, { merge: true });
      await deleteDoc(doc(db, 'users', _uid, 'myMap', docId));
    } catch { /* silent */ }
  }

  _items = _items.filter(i => i.docId !== docId);
  const idx = _markers.findIndex(m => m._myMapDocId === docId);
  if (idx !== -1) { _markers[idx].setMap(null); _markers.splice(idx, 1); }
  _alerted.delete(docId);
  _updateCountUI();

  const def = MYMAP_DEFS[item.typeKey] || MYMAP_DEFS.treasure1;
  const isTreasure = def.cat === 'treasure';
  _showToast(isTreasure ? `🎁 보물 수집! +${gp} GP` : `⚔️ 전투 승리! +${gp} GP`, false);
};

// ── 삭제 (InfoWindow 버튼) ───────────────────────────────────────────────────
window.__myMapDelete = async (docId) => {
  if (!_uid) return;
  await deleteDoc(doc(db, 'users', _uid, 'myMap', docId));
  _items = _items.filter(i => i.docId !== docId);
  const idx = _markers.findIndex(m => m._myMapDocId === docId);
  if (idx !== -1) { _markers[idx].setMap(null); _markers.splice(idx, 1); }
  if (_infoWin) _infoWin.close();
  _alerted.delete(docId);
  _showToast('삭제됐습니다');
  _updateCountUI();
};

// ── 배치 모드 ────────────────────────────────────────────────────────────────
export function setMyMapPlaceMode(typeKey) {
  _placeKey = typeKey;
  _clearClickListener();
  if (!typeKey) { _map.setOptions({ draggableCursor: '' }); return; }
  _map.setOptions({ draggableCursor: 'crosshair' });
  _clickLsn = _map.addListener('click', async e => {
    if (!_placeKey || !_active) return;
    await _placeItem(_placeKey, e.latLng.lat(), e.latLng.lng());
    _updateCountUI();
  });
}

async function _placeItem(typeKey, lat, lng) {
  if (!_uid) return;
  if (_items.length >= MAX_ITEMS) { _showToast(`최대 ${MAX_ITEMS}개까지 배치할 수 있어요`, true); return; }
  const def  = MYMAP_DEFS[typeKey] || MYMAP_DEFS.treasure1;
  const data = { typeKey, cat: def.cat, lat, lng, label: def.label, createdAt: serverTimestamp() };
  const ref  = await addDoc(collection(db, 'users', _uid, 'myMap'), data);
  const item = { docId: ref.id, ...data };
  _items.push(item);
  _addMarkerForItem(item);
}

// ── UI 카운트 갱신 ───────────────────────────────────────────────────────────
function _updateCountUI() {
  const el = document.getElementById('myMapCount');
  if (el) el.textContent = `${_items.length} / ${MAX_ITEMS}`;
}

export function getMyMapCount() { return _items.length; }
export function isMyMapActive()  { return _active; }

// ── 유틸 ─────────────────────────────────────────────────────────────────────
function _haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _clearClickListener() {
  if (_clickLsn) { google.maps.event.removeListener(_clickLsn); _clickLsn = null; }
}

function _showToast(msg, isError = false) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    padding:8px 18px;border-radius:20px;font-size:13px;font-weight:600;z-index:9900;
    background:${isError ? '#ef4444' : '#1d4ed8'};color:#fff;pointer-events:none;`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}
