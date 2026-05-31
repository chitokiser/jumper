// /assets/js/pages/merchants.mymap.js
// 체험용 개인 맵 — users/{uid}/myMap 서브컬렉션 저장, 본인만 표시
// 설계: Cloud Function 불필요, 직접 Firestore 읽기/쓰기, 최대 50개 제한

import { db } from '/assets/js/firebase-init.js';
import {
  collection, doc, addDoc, deleteDoc, getDocs, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const MAX_ITEMS = 50;

// ── 아이템 타입 정의 ──────────────────────────────────────────────────────────
export const MYMAP_DEFS = {
  treasure1: { cat: 'treasure', icon: '/assets/images/item/box.png',                                    label: '🎁 보물박스',  size: 28 },
  monster_orc:    { cat: 'monster',  icon: '/assets/images/monsters/orc/ORK_01_IDLE_000.png',           label: '👹 오크',     size: 36 },
  monster_orc2:   { cat: 'monster',  icon: '/assets/images/monsters/orc2/ORK_02_IDLE_000.png',          label: '👺 오크2',    size: 36 },
  monster_orc3:   { cat: 'monster',  icon: '/assets/images/monsters/orc3/ORK_03_IDLE_000.png',          label: '🐗 오크3',    size: 36 },
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
let _active    = false;   // 탭이 열려 있는가
let _placeKey  = null;    // 현재 배치 중인 typeKey
let _clickLsn  = null;    // map click listener

// ── 초기화 ───────────────────────────────────────────────────────────────────
export function initMyMap(uid, map, infoWindow) {
  _uid    = uid;
  _map    = map;
  _infoWin = infoWindow;
}

// ── 탭 활성화 (첫 open 시 Firestore 로드) ────────────────────────────────────
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
  const def = MYMAP_DEFS[item.typeKey] || MYMAP_DEFS.treasure1;
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

// ── 마커 클릭 (삭제 버튼 포함 InfoWindow) ────────────────────────────────────
function _onMarkerClick(item, marker) {
  if (!_infoWin) return;
  const def = MYMAP_DEFS[item.typeKey] || MYMAP_DEFS.treasure1;
  _infoWin.setContent(`
    <div style="padding:8px 10px;min-width:140px;font-family:sans-serif;">
      <div style="font-weight:700;margin-bottom:6px;">${item.label || def.label}</div>
      <div style="font-size:11px;color:#6b7280;margin-bottom:8px;">체험용 — 나만 볼 수 있어요</div>
      <button onclick="window.__myMapDelete('${item.docId}')"
        style="width:100%;padding:6px 0;background:#dc2626;color:#fff;border:none;
               border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">
        🗑 삭제
      </button>
    </div>`);
  _infoWin.open(_map, marker);
}

// ── 배치 모드 설정 ───────────────────────────────────────────────────────────
export function setMyMapPlaceMode(typeKey) {
  _placeKey = typeKey;
  _clearClickListener();
  if (!typeKey) {
    _map.setOptions({ draggableCursor: '' });
    return;
  }
  _map.setOptions({ draggableCursor: 'crosshair' });
  _clickLsn = _map.addListener('click', async e => {
    if (!_placeKey || !_active) return;
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    await _placeItem(_placeKey, lat, lng);
    _updateCountUI();
  });
}

// ── 아이템 배치 (Firestore write) ────────────────────────────────────────────
async function _placeItem(typeKey, lat, lng) {
  if (!_uid) return;
  if (_items.length >= MAX_ITEMS) {
    _showToast(`최대 ${MAX_ITEMS}개까지 배치할 수 있어요`, true);
    return;
  }
  const def  = MYMAP_DEFS[typeKey] || MYMAP_DEFS.treasure1;
  const data = {
    typeKey,
    cat:       def.cat,
    lat, lng,
    label:     def.label,
    createdAt: serverTimestamp(),
  };
  const ref  = await addDoc(collection(db, 'users', _uid, 'myMap'), data);
  const item = { docId: ref.id, ...data };
  _items.push(item);
  _addMarkerForItem(item);
}

// ── 삭제 (전역 콜백 — InfoWindow 버튼에서 호출) ──────────────────────────────
window.__myMapDelete = async (docId) => {
  if (!_uid) return;
  await deleteDoc(doc(db, 'users', _uid, 'myMap', docId));
  _items = _items.filter(i => i.docId !== docId);
  const idx = _markers.findIndex(m => m._myMapDocId === docId);
  if (idx !== -1) { _markers[idx].setMap(null); _markers.splice(idx, 1); }
  if (_infoWin) _infoWin.close();
  _showToast('삭제됐습니다');
  _updateCountUI();
};

// ── UI 카운트 갱신 ───────────────────────────────────────────────────────────
function _updateCountUI() {
  const el = document.getElementById('myMapCount');
  if (el) el.textContent = `${_items.length} / ${MAX_ITEMS}`;
}

export function getMyMapCount() { return _items.length; }
export function isMyMapActive() { return _active; }

// ── 토스트 ───────────────────────────────────────────────────────────────────
function _showToast(msg, isError = false) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    padding:8px 18px;border-radius:20px;font-size:13px;font-weight:600;z-index:9900;
    background:${isError ? '#ef4444' : '#1d4ed8'};color:#fff;pointer-events:none;`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ── 내부 유틸 ────────────────────────────────────────────────────────────────
function _clearClickListener() {
  if (_clickLsn) { google.maps.event.removeListener(_clickLsn); _clickLsn = null; }
}
