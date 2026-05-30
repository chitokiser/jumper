// /assets/js/pages/starter-pack.js
// 초보자 체험 패키지 — 완전 로컬 생성, 획득 결과만 서버 저장
//
// 설계 원칙:
//  - 시드 = uid + UTC일자 → 서버 호출 없이 결정론적 재생성 가능
//  - 클레임 추적 → localStorage (서버 읽기 0회)
//  - 보상 지급 → recordStarterClaim Cloud Function (쓰기만, 읽기 최소)

import { functions } from '/assets/js/firebase-init.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';

const cfRecordClaim = httpsCallable(functions, 'recordStarterClaim');

// ── 몬스터 정의 ──────────────────────────────────────────────────────────────
const MONSTER_TYPES = [
  { type: 'orc',    img: '/assets/images/monsters/orc/ORK_01_IDLE_000.png',    name: '오크',   hp: 3 },
  { type: 'orc2',   img: '/assets/images/monsters/orc2/ORK_02_IDLE_000.png',   name: '오크2',  hp: 4 },
  { type: 'orc3',   img: '/assets/images/monsters/orc3/ORK_03_IDLE_000.png',   name: '오크3',  hp: 5 },
  { type: 'pirate', img: '/assets/images/monsters/pirate/1_entity_000_ATTACK_000.png', name: '해적', hp: 3 },
  { type: 'simple', img: '/assets/images/monsters/22.png',                      name: '슬라임', hp: 2 },
  { type: 'simple2',img: '/assets/images/monsters/23.png',                      name: '고블린', hp: 2 },
];

// ── Mulberry32 PRNG ──────────────────────────────────────────────────────────
function _hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h;
}

function makePrng(seed) {
  let s = _hashStr(seed);
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 위도/경도 오프셋 생성 ────────────────────────────────────────────────────
function _offsetPos(rand, centerLat, centerLng, minM, maxM) {
  const angle = rand() * Math.PI * 2;
  const dist  = minM + rand() * (maxM - minM);
  const dLat  = dist / 111320;
  const dLng  = dist / (111320 * Math.cos(centerLat * Math.PI / 180));
  return {
    lat: centerLat + dLat * Math.cos(angle),
    lng: centerLng + dLng * Math.sin(angle),
  };
}

// ── 씨드 기반 오브젝트 생성 (보물 15개 + 몬스터 15개) ────────────────────────
export function generateStarterObjects(seed, centerLat, centerLng) {
  const rand      = makePrng(seed);
  const treasures = [];
  const monsters  = [];

  for (let i = 0; i < 15; i++) {
    const pos   = _offsetPos(rand, centerLat, centerLng, 25, 85);
    const boxId = Math.floor(rand() * 5) + 1;
    treasures.push({
      id:    `starter_t_${i}`,
      ...pos,
      boxId,
      icon:  '/assets/images/item/box.png',
      label: `🎁 체험 보물박스 ${boxId}`,
    });
  }

  for (let i = 0; i < 15; i++) {
    const pos  = _offsetPos(rand, centerLat, centerLng, 20, 80);
    const mIdx = Math.floor(rand() * MONSTER_TYPES.length);
    const gold = Math.floor(rand() * 5) + 1;
    const mDef = MONSTER_TYPES[mIdx];
    monsters.push({
      id:    `starter_m_${i}`,
      ...pos,
      ...mDef,
      gold,
      label: `👾 ${mDef.name} (체험)`,
    });
  }

  return { treasures, monsters };
}

// ── 로컬 시드 생성 (UTC 일자 기반 — 매일 자동 리셋, 서버 불필요) ─────────────
function _makeDailySeed(uid) {
  const dayIndex = Math.floor(Date.now() / 86400000);
  return `${uid}:${dayIndex}`;
}

// ── localStorage 클레임 추적 ──────────────────────────────────────────────────
function _lsKey(seed) { return `starter_v2_${seed}`; }

function _loadClaimed(seed) {
  try {
    const raw = localStorage.getItem(_lsKey(seed));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function _saveClaimed(seed, claimedSet) {
  try {
    localStorage.setItem(_lsKey(seed), JSON.stringify([...claimedSet]));
  } catch {}
}

// 이전 날짜 키 정리 (스토리지 낭비 방지)
function _cleanupOldLsKeys(currentSeed) {
  try {
    const currentKey = _lsKey(currentSeed);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith('starter_v2_') && k !== currentKey) {
        localStorage.removeItem(k);
      }
    }
  } catch {}
}

// ── 상태 ─────────────────────────────────────────────────────────────────────
let _seed    = null;
let _claimed = null;  // Set<string>
let _objects = null;  // { treasures, monsters }
let _markers = [];
let _map     = null;
let _uid     = null;
let _infoWin = null;
let _active  = false;

// ── 초기화 (서버 호출 없음) ───────────────────────────────────────────────────
export function initStarterPack(uid, lat, lng, map, infoWindow) {
  _uid     = uid;
  _map     = map;
  _infoWin = infoWindow;

  _seed    = _makeDailySeed(uid);
  _claimed = _loadClaimed(_seed);
  _cleanupOldLsKeys(_seed);

  _objects = generateStarterObjects(_seed, lat, lng);
  _active  = true;
  _renderMarkers();
}

// ── 마커 렌더링 ──────────────────────────────────────────────────────────────
function _renderMarkers() {
  _clearMarkers();

  for (const t of _objects.treasures) {
    if (_claimed.has(t.id)) continue;
    const marker = new google.maps.Marker({
      position: { lat: t.lat, lng: t.lng },
      map:      _map,
      icon: {
        url:        t.icon,
        scaledSize: new google.maps.Size(28, 28),
        anchor:     new google.maps.Point(14, 14),
      },
      title:  t.label,
      zIndex: 5,
    });
    marker.addListener('click', () => _onTreasureClick(t, marker));
    marker._starterId = t.id;
    _markers.push(marker);
  }

  for (const m of _objects.monsters) {
    if (_claimed.has(m.id)) continue;
    const marker = new google.maps.Marker({
      position: { lat: m.lat, lng: m.lng },
      map:      _map,
      icon: {
        url:        m.img,
        scaledSize: new google.maps.Size(36, 36),
        anchor:     new google.maps.Point(18, 18),
      },
      title:  m.label,
      zIndex: 6,
    });
    marker.addListener('click', () => _onMonsterClick(m, marker));
    marker._starterId = m.id;
    _markers.push(marker);
  }
}

function _clearMarkers() {
  _markers.forEach(m => m.setMap(null));
  _markers = [];
}

// ── 거리 계산 ─────────────────────────────────────────────────────────────────
function _haversine(lat1, lng1, lat2, lng2) {
  const R  = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function _getPlayerDist(lat, lng) {
  const pos = window._starterPlayerPos;
  if (!pos) return 9999;
  return _haversine(pos.lat, pos.lng, lat, lng);
}

// ── 보물 클릭 ─────────────────────────────────────────────────────────────────
function _onTreasureClick(t, marker) {
  if (!_infoWin) return;
  const dist = _getPlayerDist(t.lat, t.lng);
  const near = dist <= 20;
  _infoWin.setContent(`
    <div style="padding:8px;min-width:160px;">
      <div style="font-weight:700;margin-bottom:4px;">🎁 체험 보물박스 ${t.boxId}</div>
      <div style="font-size:0.8rem;color:#6b7280;margin-bottom:8px;">${Math.round(dist)}m 거리</div>
      ${near
        ? `<button onclick="window.__starterClaimTreasure('${t.id}',${t.boxId})"
             style="width:100%;padding:6px;background:#1d4ed8;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.85rem;">
             획득하기
           </button>`
        : `<div style="font-size:0.8rem;color:#ef4444;">20m 이내로 이동하세요</div>`
      }
    </div>`);
  _infoWin.open(_map, marker);
}

// ── 몬스터 클릭 ──────────────────────────────────────────────────────────────
function _onMonsterClick(m, marker) {
  if (!_infoWin) return;
  const dist = _getPlayerDist(m.lat, m.lng);
  const near = dist <= 20;
  _infoWin.setContent(`
    <div style="padding:8px;min-width:160px;">
      <img src="${m.img}" style="width:48px;height:48px;object-fit:contain;display:block;margin:0 auto 6px;">
      <div style="font-weight:700;text-align:center;">${m.name} (체험)</div>
      <div style="font-size:0.8rem;color:#6b7280;text-align:center;margin-bottom:8px;">보상: 🪙 ${m.gold} gold · ${Math.round(dist)}m</div>
      ${near
        ? `<button onclick="window.__starterKillMonster('${m.id}',${m.gold})"
             style="width:100%;padding:6px;background:#dc2626;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.85rem;">
             처치하기
           </button>`
        : `<div style="font-size:0.8rem;color:#ef4444;">20m 이내로 이동하세요</div>`
      }
    </div>`);
  _infoWin.open(_map, marker);
}

// ── 전역 콜백 (InfoWindow 버튼에서 호출) ─────────────────────────────────────
window.__starterClaimTreasure = async (id, boxId) => {
  await _claimItem(id, 'treasure', { kind: 'box', boxId });
};

window.__starterKillMonster = async (id, gold) => {
  await _claimItem(id, 'monster', { kind: 'gold', amount: gold });
};

// ── 클레임 처리 (획득 결과만 서버 저장) ──────────────────────────────────────
async function _claimItem(itemId, type, drop) {
  if (!_uid || !_seed) return;
  if (_claimed.has(itemId)) return;

  try {
    await cfRecordClaim({ itemId, type, drop });

    // 서버 성공 후 로컬 상태 갱신
    _claimed.add(itemId);
    _saveClaimed(_seed, _claimed);

    const idx = _markers.findIndex(m => m._starterId === itemId);
    if (idx !== -1) { _markers[idx].setMap(null); _markers.splice(idx, 1); }
    if (_infoWin) _infoWin.close();

    const msg = type === 'treasure'
      ? `🎁 보물박스 ${drop.boxId} 획득!`
      : `⚔️ 처치! 🪙 ${drop.amount} gold 획득`;
    _showToast(msg);
  } catch (e) {
    _showToast('오류: ' + (e.message || '잠시 후 다시 시도'), true);
  }
}

function _showToast(msg, isError = false) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    padding:8px 18px;border-radius:20px;font-size:0.85rem;font-weight:600;z-index:9900;
    background:${isError ? '#ef4444' : '#1d4ed8'};color:#fff;pointer-events:none;`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ── GPS 위치 갱신 시 호출 (100m 내 표시) ─────────────────────────────────────
export function updateStarterPlayerPos(lat, lng) {
  window._starterPlayerPos = { lat, lng };
  if (!_active || !_markers.length) return;
  for (const marker of _markers) {
    const pos  = marker.getPosition();
    const dist = _haversine(lat, lng, pos.lat(), pos.lng());
    marker.setMap(dist <= 100 ? _map : null);
  }
}

export function isStarterActive()  { return _active; }

export function destroyStarterPack() {
  _clearMarkers();
  _active  = false;
  _seed    = null;
  _claimed = null;
  _objects = null;
}
