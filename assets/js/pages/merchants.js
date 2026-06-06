// /assets/js/pages/merchants.js
// 가맹점 지도 + 보물찾기 시스템

import { auth, db, functions, googleProvider } from '/assets/js/firebase-init.js';
import { isTelegramMiniApp, loginWithTelegram } from '/assets/js/telegram-auth.js';
import { esc } from '/assets/js/esc.js';
import { collection, getDocs, doc, getDoc, query, where, orderBy, limit,
         setDoc, deleteDoc, serverTimestamp, onSnapshot }
                          from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { onAuthStateChanged, signInWithPopup, signInAnonymously, signOut, linkWithPopup }
                          from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { httpsCallable }
                          from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { initBattle, loadBattleData, loadDecorations, loadPlayerState,
         startBattleLoop, stopBattleLoop, startWatchPosition, startSharedSync,
         enterAdminPlaceMode, exitAdminPlaceMode, toggleTowerRanges,
         healHp, healMp, playSound, showFloat, animateArrow,
         castLightning, castIceFreeze, castFireStorm, castWhirlwind, castMeteor, castHeal,
         setGsSkillCallback, setGsMobsGetter,
         useReviveTicket, updateSkillBar, useMagicStone, getPlayerGold, getPlayerToken, getPlayerLevel, isPlayerDead,
         syncHpFromServer, syncDeathFromServer, syncReviveFromServer,
         spawnGsDrop, removeGsDrop,
         equipWeapon, equipArmor, equipArmorToSlot, unequipWeapon, unequipArmor, getTotalAtk, getDefense,
         getEquippedWeapon, getEquippedArmor, getEquippedArmorSlots,
         updateMyLocation, showDeathMarkerIfDead, hideMyMarker,
         loadShops, getShops, deleteShop, checkShopProximity, updateShopHpMarker,
         loadTutorialBoxes, clearTutorialBoxes, checkTutorialProximity,
         loadTrialMonsters, clearTrialMonsters,
         onPlayerExp, onPlayerLevelUp,
         addPlayerGold, spendPlayerGold, addPlayerGsExp,
         getPlayerSnapshot, syncPlayerFromDungeon,
         spendPlayerMp, getPlayerMp, getPlayerMaxMp }
  from './merchants.battle.js';
import { initDungeonGame, openDungeonGame } from './merchants.dungeon.js';
import { initGameServer, connectToGameServer, disconnectFromGameServer,
         isGameServerConnected, sendPlayerLocation,
         sendPlayerAttack, sendPlayerRevive, sendPlayerSkill, sendDropCollect,
         gsAdminDeleteSpawn, gsAdminKillMonster }
  from './merchants.gameserver.js';
import { hasSpriteConfig, createMonsterSpriteOverlay, preloadSpriteImages }
  from './merchants.monster-sprite.js';
import { _t } from './merchants.i18n.js';
import { initStarterPack, updateStarterPlayerPos, destroyStarterPack, isStarterActive }
  from './starter-pack.js';
import { initUserPlace } from './user-place.js';
import { initDailyArea, checkDailyProximity } from './merchants.daily.js';
import { initVirtualMode, isVirtualMode, getVirtualPos, canCollectInVirtual, toggleVirtualMode } from './merchants.virtual.js';

// GS 몬스터에 스킬 데미지 전달 — battle.js 스킬 발동 시 호출됨
// _ctx.lastPos 기준으로 범위 계산 (GPS 마커 위치≠GS 존 위치인 PC 환경 대응)
setGsSkillCallback((skillId) => {
  if (!isGameServerConnected()) return;
  for (const [monsterId, m] of Object.entries(_gsMonsters)) {
    if (!m || m.state === 'dead' || m.state === 'respawning') continue;
    sendPlayerSkill(skillId, monsterId);
  }
});

setGsMobsGetter(() => _gsMonsters);

const $ = id => document.getElementById(id);

// ── 상태 ────────────────────────────────────────────────────────────────────
let allMerchants    = [];
let allPlaces       = [];     // places 컬렉션
let map             = null;
let infoWindow      = null;
let markers         = [];
let placeMarkers    = [];
let treasureBoxes   = [];     // [{id, lat, lng, startHour, endHour, itemPool, active, name}]
let boxMarkers      = [];
let _uid            = null;   // 로그인 유저 UID
let _userEmail      = null;   // 로그인 유저 이메일
let _isAdmin        = false;  // 관리자 여부
let _isAnonymous    = false;  // 익명 계정 여부
let _inventory      = {};     // {itemId: count}
let _boxInventory   = [];     // [{boxId, boxName, hiddenBox, keyId}]  미개봉 박스
let _items          = {};     // {itemId: {name, image, description}}
let _keyDefs        = {};     // {keyId: {name, image, dropRate}} — treasure_keys
let _vouchers          = [];
let _purchasedVouchers = new Set(); // 이미 구매 완료된 voucherId
let _collectedBoxes = new Set(); // 이 세션에서 이미 수집한 box ID
let _boxHpState     = {};        // {boxId: {current, max}} 클라이언트 HP 추적
let _boxAtkCd       = {};        // {boxId: true} 공격 쿨다운
let _nearbyMarkers  = {};        // {uid: Marker} 주변 유저 마커
let _nearbyTimer    = null;      // setInterval handle (10초 폴링)
let _detectorActive       = false;  // 보물 탐지기 ON/OFF
let _detectorBeepTimer    = null;   // setTimeout handle
let _detectorNextInterval = 0;      // 다음 beep 간격(ms), 0=범위 밖
let _locWriteTs     = 0;         // 마지막 위치 기록 시각 (ms)
let _gsMonsters     = {};        // {monsterId: MonsterInstance} 게임 서버 몬스터
let _gsMarkers      = {};        // {monsterId: Marker} 게임 서버 몬스터 마커 (비-스프라이트)
let _gsOverlays     = {};        // {monsterId: MonsterSpriteOverlay} 스프라이트 오버레이 (dragon 등)
let _droppedItems   = {};        // {dropId: dropData} 바닥에 버려진 아이템
let _dropMarkers    = {};        // {dropId: google.maps.Marker} 드랍 마커
let _dropsUnsubscribe = null;    // onSnapshot 해제 함수
let _alertedDropIds = new Set(); // 이미 알림을 보낸 dropId (중복 방지)
let _utNpcMarkers    = {};        // {npcId: google.maps.Marker} 사용자 보물 NPC 마커 (map에 등록된 것만)
let _utActualMarkers = {};        // {npcId: {marker, line}} 실제 보물 위치 마커+선 (관리자/소유자 전용)
let _utNpcData       = [];        // 서버에서 받은 전체 NPC 데이터 배열 (위치 기반 proximity 계산용)
let _utCurrentNpc   = null;      // 현재 선택된 사용자 보물 NPC
let _hintUnlocked   = false;     // 현재 NPC 힌트 잠금 해제 여부
let _myVoucherLogs  = [];        // coopGetMyVouchers 결과 (바우쳐 사용 모달용)

// ── 공유 컨텍스트 (battle 모듈과 공유) ───────────────────────────────────────
const _ctx = {
  map:                 null,   // initMap() 후 설정
  infoWindow:          null,   // initMap() 후 설정
  db,
  functions,
  uid:                 null,   // auth 후 설정
  isAdmin:             false,
  myLocationMarker:    null,   // battle이 쓰고 core가 읽음
  myLocationAccCircle: null,
  locationWatchId:     null,
  totalDist:           0,
  lastDistPos:         null,
  lastHeading:         null,
  lastSpeedPos:        null,
  lastPos:             null,
};

// ── 라이트박스 ───────────────────────────────────────────────────────────────
(function initLightbox() {
  const overlay = document.getElementById('lb-overlay');
  const img     = document.getElementById('lb-img');
  const closeBtn = document.getElementById('lb-close');
  if (!overlay) return;

  window.openLightbox = function(src, alt) {
    img.src = src;
    img.alt = alt || '';
    overlay.classList.add('lb-open');
  };

  function closeLb() {
    overlay.classList.remove('lb-open');
    img.src = '';
  }

  overlay.addEventListener('click', closeLb);
  img.addEventListener('click', e => e.stopPropagation());
  closeBtn.addEventListener('click', closeLb);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLb(); });
})();

// ── 유틸 ────────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function parseLatLng(gmapUrl) {
  if (!gmapUrl) return null;
  try {
    const m1 = gmapUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m1) return { lat: parseFloat(m1[1]), lng: parseFloat(m1[2]) };
    const url = new URL(gmapUrl);
    const q   = url.searchParams.get('q');
    if (q) {
      const m2 = q.match(/^(-?\d+\.\d+),(-?\d+\.\d+)$/);
      if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]) };
    }
  } catch { /* ignore */ }
  return null;
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function nowVietnamHour() {
  return (new Date().getUTCHours() + 7) % 24;
}

function isBoxActive(box) {
  if (!box.active) return false;
  const h = nowVietnamHour();
  const s = box.startHour ?? 0, e = box.endHour ?? 24;
  return s <= e ? (h >= s && h < e) : (h >= s || h < e);
}

// ── 회원등급 표시 ─────────────────────────────────────────────────────────────
async function _renderMemberStatus(uid) {
  const el = $('mcMemberStatus');
  if (!el) return;
  if (!uid) { el.style.display = 'none'; return; }
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const until = snap.data()?.coopMemberUntil;
    const isMember = !!until && until.toDate() > new Date();
    if (isMember) {
      el.innerHTML = `<span class="mc-badge-member">${_t('badge_member')}</span>`;
    } else {
      el.innerHTML = `<span class="mc-badge-general">${_t('badge_general')}</span><a href="/coop.html" class="mc-link-join">${_t('badge_join_link')}</a>`;
    }
    el.style.display = 'flex';
  } catch {
    el.style.display = 'none';
  }
}

// ── Google Maps 로드 ─────────────────────────────────────────────────────────
function loadMapsScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) return resolve();
    window.__merchantMapCb = resolve;
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${window.__mapsKey || ''}&callback=__merchantMapCb&language=en`;
    s.async = true;
    s.onerror = () => reject(new Error('Google Maps 로드 실패'));
    document.head.appendChild(s);
  });
}

// ── 전체화면 (네이티브 API + CSS 폴백) ───────────────────────────────────────
let _cssFs = false;

function _isInFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement) || _cssFs;
}

function _requestFullscreen() {
  const el = document.querySelector('.mc-map-wrap') ?? document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req) {
    req.call(el)
      .then(() => setTimeout(_moveModalsToFs, 300))
      .catch(() => _enterCssFs()); // 네이티브 실패 시 CSS 폴백
  } else {
    _enterCssFs(); // iOS Safari 등 API 자체가 없는 경우
  }
}

function _enterCssFs() {
  const el = document.querySelector('.mc-map-wrap');
  if (!el || _cssFs) return;
  _cssFs = true;
  el.classList.add('mc-css-fs');
  document.body.classList.add('mc-css-fs-active');
  const btn = document.getElementById('btnFullscreen');
  if (btn) btn.textContent = '✕';
  // CSS FS는 body 기준 position:fixed 이므로 모달 이동 불필요
}

function _exitCssFs() {
  const el = document.querySelector('.mc-map-wrap');
  if (!el || !_cssFs) return;
  _cssFs = false;
  el.classList.remove('mc-css-fs');
  document.body.classList.remove('mc-css-fs-active');
  const btn = document.getElementById('btnFullscreen');
  if (btn) btn.textContent = '⛶';
}

function _exitFullscreen() {
  if (_cssFs) { _exitCssFs(); return; }
  (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
}

// ── 전체화면 모달 이동 ───────────────────────────────────────────────────────
// 정적 ID 목록 + 자동 감지(z-index 500 이상 직계 body children) 이중 구조
// 새 모달 추가 시: HTML에 data-fs-modal 속성만 붙이면 자동 이동
const FS_MODALS = [
  'invModal', 'shopModal', 'shopAdminModal', 'itemReveal', 'collectToast', 'criticalToast',
  'skillTargetModal', 'slotModal', 'memoryGameModal', 'archeryModal', 'raceModal', 'dungeonModal',
  'utNpcModal', 'utRegModal', 'utMyModal',
  'userPlacePanel', 'userPlaceConfirmModal', 'userPlaceBanner', 'btnUserPlaceCancelMode',
  'soBuyModal', 'soExecuteModal', 'soTransferModal',
  'anonBadge',
  // 누락 보완
  'levelupOverlay', 'voucherOrderModal', 'tutModal', 'lb-overlay', 'monsterStatModal',
];

// 풀스크린 컨테이너 밖에 있는 fixed 요소를 안으로 이동시키지 않으면
// Fullscreen API 환경에서 body에 남은 position:fixed 요소는 화면에서 사라짐.
function _moveModalsToFs() {
  const fs   = document.fullscreenElement || document.webkitFullscreenElement;
  const dest = fs || document.body;

  // 1) 정적 목록
  FS_MODALS.forEach(id => {
    const el = document.getElementById(id);
    if (el && el.parentElement !== dest) dest.appendChild(el);
  });

  // 2) data-fs-modal 속성 요소 (미래 모달 자동 포함)
  document.querySelectorAll('[data-fs-modal]').forEach(el => {
    if (el.parentElement !== dest) dest.appendChild(el);
  });

  // 3) body 직계 자식 중 z-index 500 이상인 position:fixed 요소 자동 이동
  //    (JS로 동적 생성된 모달 포함 — siteHeader/siteFooter 제외)
  if (fs) {
    const skip = new Set(['siteHeader', 'siteFooter', 'merchantMap', 'battleOverlay']);
    Array.from(document.body.children).forEach(el => {
      if (skip.has(el.id)) return;
      const s = window.getComputedStyle(el);
      if (s.position === 'fixed' && parseInt(s.zIndex, 10) >= 500) {
        fs.appendChild(el);
      }
    });
  }

  // battleOverlay는 mc-map-wrap 안에 위치해야 함
  const bo = document.getElementById('battleOverlay');
  if (bo) {
    if (fs) fs.appendChild(bo);
    else document.querySelector('.mc-map-wrap')?.appendChild(bo);
  }
}
document.addEventListener('fullscreenchange',       _moveModalsToFs);
document.addEventListener('webkitfullscreenchange', _moveModalsToFs);

// ── 지도 초기화 ──────────────────────────────────────────────────────────────
function initMap() {
  map = new google.maps.Map($('merchantMap'), {
    center: { lat: 20.9947, lng: 105.9487 },
    zoom: 13,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    zoomControl: false,
    gestureHandling: 'greedy',
    styles: [
      { featureType: 'poi',   elementType: 'all', stylers: [{ visibility: 'off' }] },
      { featureType: 'transit', elementType: 'all', stylers: [{ visibility: 'off' }] },
    ],
  });
  infoWindow = new google.maps.InfoWindow();

  // ctx에도 반영
  _ctx.map = map;
  _ctx.infoWindow = infoWindow;

  // HUD 버튼을 Google Maps Custom Control로 등록 (전체화면·확대 시에도 유지)
  const existingHud = $('mapHud');
  if (existingHud) map.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(existingHud);

  // 전투 HUD (LEFT_TOP)
  const combatHud = $('combatHud');
  if (combatHud) map.controls[google.maps.ControlPosition.LEFT_TOP].push(combatHud);

  // 스킬바 (BOTTOM_CENTER)
  const skillBar = $('skillBar');
  if (skillBar) map.controls[google.maps.ControlPosition.BOTTOM_CENTER].push(skillBar);

  // 관리자 전투 패널 (LEFT_BOTTOM)
  const adminBattlePanel = $('adminBattlePanel');
  if (adminBattlePanel) map.controls[google.maps.ControlPosition.LEFT_BOTTOM].push(adminBattlePanel);

  // 좌표 검색 — 관리자 패널 내 입력 필드
  let _coordMarker = null;
  function _goToCoords(raw) {
    const m = String(raw || '').trim().match(/(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)/);
    if (!m) return false;
    const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (isNaN(lat) || isNaN(lng)) return false;
    map.panTo({ lat, lng });
    map.setZoom(18);
    if (_coordMarker) _coordMarker.setMap(null);
    _coordMarker = new google.maps.Marker({
      position: { lat, lng },
      map,
      title: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 10,
        fillColor: '#2563eb',
        fillOpacity: 0.9,
        strokeColor: '#fff',
        strokeWeight: 2,
      },
      zIndex: 9999,
    });
    infoWindow.setContent(`<div style="font-size:12px;font-weight:600;">📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}</div>`);
    infoWindow.open(map, _coordMarker);
    return true;
  }
  $('abCoordGo')?.addEventListener('click', () => {
    const ok = _goToCoords($('abCoordInput')?.value);
    if (!ok) { const el = $('abCoordInput'); if (el) { el.style.borderColor = '#ef4444'; setTimeout(() => { el.style.borderColor = ''; }, 1200); } }
  });
  $('abCoordInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('abCoordGo')?.click();
  });
  $('abCoordClear')?.addEventListener('click', () => {
    if (_coordMarker) { _coordMarker.setMap(null); _coordMarker = null; }
    infoWindow.close();
    const el = $('abCoordInput'); if (el) el.value = '';
  });

  // 관리자: 지도 클릭 시 근처 숨김 보물박스 표시
  map.addListener('click', e => {
    if (!_isAdmin) return;
    const lat = e.latLng.lat(), lng = e.latLng.lng();
    _adminRevealNearbyHiddenBoxes(lat, lng);
  });
}

// ── 공유 bounds (가맹점 + 보물박스 합산) ─────────────────────────────────────
let _sharedBounds = null;

function fitMapToAllMarkers() {
  if (!map || !_sharedBounds || _sharedBounds.isEmpty()) return;
  const count = markers.length + boxMarkers.length;
  if (count === 1) {
    const pt = _sharedBounds.getCenter();
    map.setCenter(pt); map.setZoom(16);
  } else {
    map.fitBounds(_sharedBounds);
  }
}

// ── 장소 마커 색상 (index.html 동기화) ───────────────────────────────────────
const PLACE_TYPE_COLOR = {
  hospital: '#ef4444', school: '#16a34a', park: '#22c55e',
  shopping: '#ec4899', restaurant: '#f97316', cafe: '#a16207',
};
function placeColor(type) {
  return PLACE_TYPE_COLOR[String(type).toLowerCase()] || '#6b7280';
}

// ── 장소 마커 렌더링 ──────────────────────────────────────────────────────────
function renderPlaceMarkers() {
  placeMarkers.forEach(m => m.setMap(null));
  placeMarkers = [];
  if (!map) return;
  if (!_sharedBounds) _sharedBounds = new google.maps.LatLngBounds();

  allPlaces.forEach(p => {
    let latLng = null;
    if (typeof p.lat === 'number' && typeof p.lng === 'number') latLng = { lat: p.lat, lng: p.lng };
    else latLng = parseLatLng(p.gmap);
    if (!latLng) return;

    const marker = new google.maps.Marker({
      position: latLng, map,
      title: p.name || '',
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: placeColor(p.type),
        fillOpacity: 1,
        strokeColor: '#fff',
        strokeWeight: 2,
        scale: 9,
      },
      zIndex: 1,
    });

    marker.addListener('click', () => {
      const myPos = _ctx.lastPos;
      if (myPos) {
        const dist = haversine(myPos.lat, myPos.lng, latLng.lat, latLng.lng);
        if (dist > 20) {
          infoWindow.setContent(`<div style="font-size:13px;padding:6px;">${_t('npc_too_far', Math.round(dist))}</div>`);
          infoWindow.open(map, marker);
          return;
        }
      }
      infoWindow.setContent(`
        <div style="max-width:240px;font-size:13px;line-height:1.5;">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${escHtml(p.name||'')}</div>
          ${p.type    ? `<div style="color:#7c3aed;margin-bottom:2px;">${escHtml(p.type)}</div>` : ''}
          ${p.area    ? `<div style="color:#6b7280;">${_t('place_area')}: ${escHtml(p.area)}</div>` : ''}
          ${p.address ? `<div style="color:#374151;">${escHtml(p.address)}</div>` : ''}
          ${p.phone   ? `<div style="color:#374151;">📞 ${escHtml(p.phone)}</div>` : ''}
          ${p.note    ? `<div style="color:#6b7280;margin-top:4px;">${escHtml(p.note)}</div>` : ''}
          ${p.gmap    ? `<a href="${escHtml(p.gmap)}" target="_blank" rel="noopener"
             style="display:inline-block;margin-top:6px;color:#2563eb;font-size:12px;">${_t('gmap_link')}</a>` : ''}
        </div>`);
      infoWindow.open(map, marker);
    });

    placeMarkers.push(marker);
    _sharedBounds.extend(latLng);
  });
}

// ── 가맹점 마커 렌더링 ───────────────────────────────────────────────────────
function renderMarkers(list) {
  markers.forEach(m => m.setMap(null));
  markers = [];
  if (!map) return;
  if (!_sharedBounds) _sharedBounds = new google.maps.LatLngBounds();

  list.forEach(m => {
    if (!m._latLng) return;
    const marker = new google.maps.Marker({
      position: m._latLng, map,
      title: m.name || '',
      icon: { url: m.imageUrl || '/assets/images/jump/favicon.png',
        scaledSize: new google.maps.Size(36, 36), anchor: new google.maps.Point(18, 18) },
      zIndex: 10,
    });
    marker.addListener('click', () => {
      infoWindow.setContent(`
        <div style="max-width:240px;font-size:13px;line-height:1.6;">
          ${m.imageUrl ? `<img src="${escHtml(m.imageUrl)}" alt="${escHtml(m.name)}" class="lb-trigger" onclick="openLightbox(this.src,this.alt)" style="width:100%;max-height:120px;object-fit:cover;border-radius:6px;margin-bottom:6px;cursor:zoom-in;">` : ''}
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">🏪 ${escHtml(m.name)}</div>
          ${m.career ? `<div style="color:#f59e0b;font-size:12px;">${escHtml(m.career)}</div>` : ''}
          ${m.region ? `<div style="color:#6b7280;">📍 ${escHtml(m.region)}</div>` : ''}
          ${m.phone  ? `<div style="color:#374151;">📞 ${escHtml(m.phone)}</div>` : ''}
          ${m.description ? `<div style="color:#6b7280;margin-top:4px;">${escHtml(m.description)}</div>` : ''}
          ${m.gmap ? `<a href="${escHtml(m.gmap)}" target="_blank" rel="noopener"
             style="display:inline-block;margin-top:6px;color:#2563eb;font-size:12px;">${_t('gmap_link')}</a>` : ''}
        </div>`);
      infoWindow.open(map, marker);
      document.querySelectorAll('.mc-card').forEach(el => el.style.borderColor = '');
      const card = document.querySelector(`.mc-card[data-id="${m.id}"]`);
      if (card) { card.style.borderColor = '#f59e0b'; card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    });
    markers.push(marker);
    _sharedBounds.extend(m._latLng);
    m._marker = marker;
  });
}

// ── 보물박스 HP 초기화 ────────────────────────────────────────────────────────
function getBoxHpState(box) {
  if (!_boxHpState[box.id]) {
    const max = Math.max(1, box.hp || 300);
    _boxHpState[box.id] = { current: max, max };
  }
  return _boxHpState[box.id];
}

// ── 보물박스 정보 InfoWindow ──────────────────────────────────────────────────
function showBoxInfo(box, marker, dist) {
  const h = `${String(box.startHour ?? 0).padStart(2,'0')}:00~${String(box.endHour ?? 24).padStart(2,'0')}:00`;
  const active = isBoxActive(box);
  const st = getBoxHpState(box);
  const hpPct = Math.max(0, (st.current / st.max) * 100);
  const hpColor = hpPct > 50 ? '#22c55e' : hpPct > 25 ? '#f59e0b' : '#ef4444';
  const isAdminNow = _isAdmin || (_userEmail === 'daguri75@gmail.com');
  const alreadyCollected = _collectedBoxes.has(box.id);

  const adminBtn = isAdminNow && !alreadyCollected
    ? `<button onclick="window.__adminCollect('${box.id}')" style="
        margin-top:8px;background:#5c3a1e;color:#ffd700;border:1px solid #7a5c3a;
        padding:4px 12px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">
        ${_t('box_admin_collect')}
      </button>` : '';

  const memberBadge = box.memberOnly
    ? `<span style="display:inline-block;background:#7c3aed;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;margin-left:5px;">${_t('box_member_only')}</span>`
    : '';

  const distPrefix = dist !== undefined ? _t('box_dist_prefix', Math.round(dist)) : '';
  const rangeM = box.hiddenBox ? '20' : '20';

  infoWindow.setContent(`
    <div style="font-size:13px;line-height:1.7;min-width:190px;">
      <div style="font-weight:700;font-size:14px;margin-bottom:4px;">🎁 ${escHtml(box.name||_t('box_default_name'))}${memberBadge}</div>
      <div style="color:#888;font-size:12px;">${_t('box_appears')}: ${h}</div>
      <div style="color:${active?'#16a34a':'#dc2626'};font-weight:600;">${active?_t('box_active'):_t('box_inactive')}</div>
      ${active && !alreadyCollected ? `
        <div style="margin:6px 0 3px;display:flex;align-items:center;gap:6px;">
          <span style="font-size:11px;color:#888;min-width:20px;">HP</span>
          <div style="flex:1;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden;">
            <div style="height:100%;width:${hpPct}%;background:${hpColor};border-radius:4px;transition:width .3s;"></div>
          </div>
          <span style="font-size:11px;color:#374151;">${st.current}/${st.max}</span>
        </div>
        <div style="font-size:11px;color:#555;">${distPrefix}${_t('box_approach', rangeM)}</div>` : ''}
      ${alreadyCollected ? `<div style="font-size:11px;color:#aaa;margin-top:4px;">${_t('box_already_collected')}</div>` : ''}
      ${adminBtn}
    </div>`);
  infoWindow.open(map, marker);
}

// ── 보물박스 공격 ─────────────────────────────────────────────────────────────
function attackBox(box, marker) {
  if (isPlayerDead()) return; // 사망 시 공격 불가
  if (_boxAtkCd[box.id]) return;
  _boxAtkCd[box.id] = true;
  setTimeout(() => delete _boxAtkCd[box.id], 800);

  const st = getBoxHpState(box);
  if (st.current <= 0) { tryCollect(box); return; }

  const isCrit = Math.random() < 0.1;
  const base = 30 + Math.floor(Math.random() * 21); // 30-50
  const dmg = isCrit ? base * 2 : base;
  st.current = Math.max(0, st.current - dmg);
  playSound(isCrit ? 'critical_hit' : 'box_hit');
  if (_ctx.lastPos) animateArrow(_ctx.lastPos.lat, _ctx.lastPos.lng, box.lat, box.lng, isCrit ? '#f97316' : '#facc15');

  // Firestore 공유 상태 기록 (다른 유저들이 HP 동기화)
  setDoc(doc(db, 'battle_hp', `box_${box.id}`), {
    hp: st.current, maxHp: st.max, type: 'box',
    isDead: st.current <= 0,
    ...(st.current <= 0 ? { deadAt: serverTimestamp() } : {}),
  }, { merge: true }).catch(() => {});

  if (st.current <= 0) {
    // 박스 파괴!
    marker.setIcon({ url:'/assets/images/item/box.png',
      scaledSize: new google.maps.Size(34,34), anchor: new google.maps.Point(17,17) });
    playSound('gold_drop');
    infoWindow.close();
    tryCollect(box);
    return;
  }

  const hpPct = (st.current / st.max) * 100;
  const hpColor = hpPct > 50 ? '#22c55e' : hpPct > 25 ? '#f59e0b' : '#ef4444';
  infoWindow.setContent(`
    <div style="font-size:13px;line-height:1.6;min-width:190px;">
      <div style="font-weight:700;font-size:14px;margin-bottom:6px;">🎁 ${escHtml(box.name || _t('box_default_name'))}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <span style="font-size:11px;color:#888;min-width:20px;">HP</span>
        <div style="flex:1;height:10px;background:#e5e7eb;border-radius:5px;overflow:hidden;">
          <div style="height:100%;width:${hpPct}%;background:${hpColor};border-radius:5px;transition:width .3s;"></div>
        </div>
        <span style="font-size:11px;color:#374151;min-width:60px;text-align:right;">${st.current}/${st.max}</span>
      </div>
      <div style="color:${isCrit?'#f97316':'#ef4444'};font-weight:700;font-size:13px;">${isCrit?'💥 CRITICAL! ':'💥 '}-${dmg}</div>
      <div style="font-size:11px;color:#555;margin-top:4px;">${_t('box_attack_hint')}</div>
    </div>`);
  infoWindow.open(map, marker);
}

// ── 보물박스 마커 렌더링 ──────────────────────────────────────────────────────
function _makeBoxMarker(box, lat, lng, size, animate) {
  const active = isBoxActive(box);
  const marker = new google.maps.Marker({
    position: { lat, lng }, map,
    title: (box.memberOnly ? `[${_t('badge_member')}] ` : '') + (box.name || _t('box_default_name')),
    icon: {
      url: '/assets/images/item/box.png',
      scaledSize: new google.maps.Size(size, size),
      anchor: new google.maps.Point(size / 2, size / 2),
    },
    label: box.memberOnly ? { text: '👑', fontSize: '12px', className: 'box-member-label' } : undefined,
    opacity: active ? 1 : 0.35,
    animation: animate ? google.maps.Animation.BOUNCE : null,
    zIndex: box.hiddenBox ? 30 : 20,
  });
  if (animate) setTimeout(() => marker.setAnimation(null), 2200);

  const range = 20;
  marker.addListener('click', () => {
    if (_collectedBoxes.has(box.id)) {
      infoWindow.setContent(`<div style="font-size:13px;color:#888;padding:4px;">${_t('box_already_collected')}</div>`);
      infoWindow.open(map, marker);
      return;
    }
    if (!isBoxActive(box)) { showBoxInfo(box, marker); return; }
    if (!_uid) {
      infoWindow.setContent(`<div style="font-size:13px;padding:4px;">${_t('need_login')}</div>`);
      infoWindow.open(map, marker);
      return;
    }
    const myLat = _ctx.lastPos?.lat;
    const myLng = _ctx.lastPos?.lng;
    if (!myLat || !myLng) { showBoxInfo(box, marker); return; }

    const dist = haversine(myLat, myLng, lat, lng);
    if (dist > range) { showBoxInfo(box, marker, dist); return; }

    attackBox(box, marker);
  });
  return marker;
}

function _playFoundSound() {
  try {
    const AC = window.AudioContext || /** @type {any} */(window).webkitAudioContext;
    const ctx = new AC();
    const tone = (freq, vol, t, dur, type = 'sine') => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0, ctx.currentTime + t);
      g.gain.linearRampToValueAtTime(vol, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + dur);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + dur);
    };
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.3, i * 0.1, 0.2, 'triangle'));
  } catch (_) { /* 무시 */ }
}

// 관리자 전용: 클릭 지점 100m 내 숨김 박스를 반투명 마커로 표시
const _adminGhostMarkers = {};  // { boxId: google.maps.Marker }

function _adminRevealNearbyHiddenBoxes(clickLat, clickLng) {
  const ADMIN_REVEAL_M = 100;
  let found = false;
  for (const box of treasureBoxes) {
    if (!box.hiddenBox || !box.lat || !box.lng) continue;
    const dist = haversine(clickLat, clickLng, Number(box.lat), Number(box.lng));
    if (dist > ADMIN_REVEAL_M) continue;
    found = true;

    // 이미 마커가 있으면 인포윈도우만 재표시
    if (_adminGhostMarkers[box.id]) {
      _adminShowHiddenBoxInfo(box, _adminGhostMarkers[box.id]);
      continue;
    }

    // 반투명 고스트 마커 생성
    const lat = Number(box.lat), lng = Number(box.lng);
    const ghost = new google.maps.Marker({
      position: { lat, lng }, map,
      title: `[관리자] 숨김: ${box.name || '보물박스'}`,
      icon: {
        url: '/assets/images/item/box.png',
        scaledSize: new google.maps.Size(32, 32),
        anchor: new google.maps.Point(16, 16),
      },
      opacity: 0.45,
      zIndex: 200,
    });
    _adminGhostMarkers[box.id] = ghost;
    ghost.addListener('click', () => _adminShowHiddenBoxInfo(box, ghost));
    _adminShowHiddenBoxInfo(box, ghost);
  }
  if (!found) {
    infoWindow.setContent('<div style="font-size:12px;color:#888;padding:4px;">100m 내 숨겨진 보물박스 없음</div>');
    infoWindow.setPosition({ lat: clickLat, lng: clickLng });
    infoWindow.open(map);
  }
}

function _adminShowHiddenBoxInfo(box, marker) {
  const keyName = box.keyId ? (_keyDefs[box.keyId]?.name || box.keyId) : '없음';
  const active  = isBoxActive(box);
  const st      = getBoxHpState(box);
  infoWindow.setContent(`
    <div style="font-size:12px;line-height:1.8;min-width:200px;">
      <div style="font-weight:700;font-size:13px;color:#7c3aed;margin-bottom:4px;">🕵️ [숨김] ${escHtml(box.name||'보물박스')}</div>
      <div>위치: ${Number(box.lat).toFixed(6)}, ${Number(box.lng).toFixed(6)}</div>
      <div>필요 열쇠: <b>${escHtml(keyName)}</b></div>
      <div>정회원 전용: ${box.memberOnly ? '✅' : '❌'}</div>
      <div>활성: ${active ? '✅' : `❌ (${box.startHour||'?'}~${box.endHour||'?'}시)`}</div>
      <div>HP: ${st.current} / ${box.hp || 300}</div>
      <button onclick="window.__adminHiddenBoxDelete('${box.id}')"
        style="margin-top:6px;padding:3px 8px;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px">🗑️ 삭제</button>
    </div>`);
  infoWindow.open(map, marker);
}

window.__adminHiddenBoxDelete = async (boxId) => {
  if (!_isAdmin) return;
  if (!confirm('이 숨김 보물박스를 삭제하시겠습니까?')) return;
  try {
    await deleteDoc(doc(db, 'treasure_boxes', boxId));
    treasureBoxes = treasureBoxes.filter(b => b.id !== boxId);
    if (_adminGhostMarkers[boxId]) { _adminGhostMarkers[boxId].setMap(null); delete _adminGhostMarkers[boxId]; }
    infoWindow.close();
    alert('삭제 완료');
  } catch (err) { alert('삭제 오류: ' + err.message); }
};

function _revealHiddenBox(box) {
  if (box._marker) return;
  const lat = Number(box.lat), lng = Number(box.lng);
  _playFoundSound();

  const el = document.createElement('div');
  el.style.cssText = `position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);
    background:rgba(124,58,237,0.92);color:#fff;font-size:16px;font-weight:700;
    padding:14px 28px;border-radius:12px;z-index:9999;pointer-events:none;
    text-align:center;box-shadow:0 0 32px rgba(124,58,237,0.7);`;
  el.textContent = '✨ 숨겨진 보물 발견!';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);

  const marker = _makeBoxMarker(box, lat, lng, 38, true);
  box._marker = marker;
  boxMarkers.push(marker);
}

function renderBoxMarkers() {
  boxMarkers.forEach(m => m.setMap(null));
  boxMarkers = [];
  if (!map) return;
  if (!isGameServerConnected()) return; // 서버 연결 시에만 보물박스 표시
  if (!_sharedBounds) _sharedBounds = new google.maps.LatLngBounds();

  treasureBoxes.forEach(box => {
    const lat = Number(box.lat), lng = Number(box.lng);
    if (!lat || !lng) return;
    getBoxHpState(box);

    // 숨김 보물: 초기 마커 생성 안 함 — checkProximity에서 20m 내 진입 시 출현
    if (box.hiddenBox) { box._marker = null; return; }

    const marker = _makeBoxMarker(box, lat, lng, 20, false);
    boxMarkers.push(marker);
    box._marker = marker;
    _sharedBounds.extend({ lat, lng });
  });
}

// ── 카드 렌더링 ──────────────────────────────────────────────────────────────
function renderCards(list) {
  const grid = $('mcGrid');
  if (!list.length) { grid.innerHTML = `<p class="mc-state">${_t('no_merchants')}</p>`; $('mcCount').textContent = ''; return; }
  $('mcCount').textContent = _t('merchant_count', list.length);
  grid.innerHTML = '';
  list.forEach(m => {
    const el = document.createElement('div');
    el.className = 'mc-card';
    el.dataset.id = m.id;
    el.innerHTML = `
      <div class="mc-card-name">${escHtml(m.name || _t('no_name_label'))}${m._latLng ? '<span class="mc-badge-map">지도</span>' : ''}</div>
      ${m.career  ? `<div class="mc-card-career">${escHtml(m.career)}</div>` : ''}
      ${m.region  ? `<div class="mc-card-region">📍 ${escHtml(m.region)}</div>` : ''}
      ${m.phone   ? `<div class="mc-card-phone">📞 ${escHtml(m.phone)}</div>` : ''}
      ${m.description ? `<div class="mc-card-desc">${escHtml(m.description)}</div>` : ''}
      ${m._latLng
        ? `<a class="mc-card-gmap" href="${escHtml(m.gmap||'')}" target="_blank" rel="noopener">${_t('gmap_link')}</a>`
        : `<div class="mc-card-no-map">${_t('no_map_label')}</div>`}`;
    if (m._latLng) {
      el.addEventListener('click', e => {
        if (e.target.tagName === 'A') return;
        map?.panTo(m._latLng); map?.setZoom(17);
        if (m._marker) google.maps.event.trigger(m._marker, 'click');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
    grid.appendChild(el);
  });
}

// ── 검색 필터 ────────────────────────────────────────────────────────────────
$('mcSearch').addEventListener('input', () => {
  const q = $('mcSearch').value.trim().toLowerCase();
  const filtered = q ? allMerchants.filter(m =>
    [m.name, m.career, m.region, m.description].some(v => (v||'').toLowerCase().includes(q))) : allMerchants;
  renderCards(filtered);
  renderMarkers(filtered);
});

// ── 이동거리 표시 업데이트 ────────────────────────────────────────────────────
function updateDistDisplay() {
  const panel = $('distPanel');
  const el = $('distValue');
  if (!el) return;
  if (panel && !panel.classList.contains('active')) panel.classList.add('active');
  el.textContent = _ctx.totalDist >= 1000
    ? (_ctx.totalDist / 1000).toFixed(2) + ' km'
    : Math.round(_ctx.totalDist) + ' m';
}

// ── 주변 유저 실시간 표시 (100m 이내) ────────────────────────────────────────
const NEARBY_RADIUS_M    = 100;
const LOC_WRITE_INTERVAL = 5000;   // 5초마다 위치 쓰기
const LOC_STALE_MS       = 30000;  // 30초 이상 미업데이트 시 마커 제거
const LOC_POLL_INTERVAL  = 30000;  // 30초마다 근처 유저 폴링

// ── Geohash 인라인 구현 (CDN 불필요) ─────────────────────────────────────────
const _GH32 = '0123456789bcdefghjkmnpqrstuvwxyz';

function _ghEncode(lat, lng, precision) {
  let hash = '', v = 0, bits = 0, even = true;
  let mnLat = -90, mxLat = 90, mnLng = -180, mxLng = 180;
  while (hash.length < precision) {
    const mid = even ? (mnLng + mxLng) / 2 : (mnLat + mxLat) / 2;
    if (even) { if (lng >= mid) { v = v * 2 + 1; mnLng = mid; } else { v *= 2; mxLng = mid; } }
    else       { if (lat >= mid) { v = v * 2 + 1; mnLat = mid; } else { v *= 2; mxLat = mid; } }
    even = !even;
    if (++bits === 5) { hash += _GH32[v]; v = 0; bits = 0; }
  }
  return hash;
}

// precision=7 → 셀 약 150m×120m, 9셀이 450m×360m 커버 → 100m 반경 완전 포함
function _ghCells(lat, lng, precision = 7) {
  const latBits = Math.floor(precision * 5 / 2);
  const lngBits = Math.ceil(precision * 5 / 2);
  const dLat = 180 / Math.pow(2, latBits);   // 셀 높이
  const dLng = 360 / Math.pow(2, lngBits);   // 셀 너비
  const cells = new Set();
  for (const r of [-dLat, 0, dLat]) {
    for (const c of [-dLng, 0, dLng]) {
      const nLat = Math.max(-90, Math.min(90, lat + r));
      const nLng = ((lng + c + 180) % 360) - 180;
      cells.add(_ghEncode(nLat, nLng, precision));
    }
  }
  return [...cells]; // 최대 9개
}

function getNearbyPlayerIcon(name) {
  const initials = (name || '?').slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
    <circle cx="18" cy="18" r="17" fill="rgba(59,130,246,0.9)" stroke="#fff" stroke-width="2"/>
    <text x="18" y="23" font-size="12" font-weight="700" fill="#fff" text-anchor="middle">${initials}</text>
  </svg>`;
  return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
           scaledSize: new google.maps.Size(36,36), anchor: new google.maps.Point(18,18) };
}

// GPS 업데이트 시 호출 — 5초 rate-limit
async function broadcastMyLocation(lat, lng) {
  if (!_uid) return;
  const now = Date.now();
  if (now - _locWriteTs < LOC_WRITE_INTERVAL) return;
  _locWriteTs = now;
  const name = (_userEmail || '').split('@')[0] || _t('player_default_name');
  try {
    await setDoc(doc(db, 'user_locations', _uid), {
      uid: _uid, lat, lng, name,
      geohash7: _ghEncode(lat, lng, 7),
      updatedAt: serverTimestamp(),
    });
  } catch { /* 무시 */ }
}

// 주변 유저 마커 갱신
function updateNearbyMarkers(snap) {
  const myPos = _ctx.lastPos;
  if (!myPos || !map) return;
  const now = Date.now();

  // 기존 마커 중 스냅에 없는 것 제거
  const activeUids = new Set();
  snap.forEach(d => activeUids.add(d.id));
  Object.keys(_nearbyMarkers).forEach(uid => {
    if (!activeUids.has(uid)) { _nearbyMarkers[uid].setMap(null); delete _nearbyMarkers[uid]; }
  });

  snap.forEach(d => {
    const data = d.data();
    if (d.id === _uid) return; // 내 자신 제외
    // 30초 이상 업데이트 없으면 제거
    const ts = data.updatedAt?.toMillis?.() || 0;
    if (now - ts > LOC_STALE_MS) {
      if (_nearbyMarkers[d.id]) { _nearbyMarkers[d.id].setMap(null); delete _nearbyMarkers[d.id]; }
      return;
    }
    const dist = haversine(myPos.lat, myPos.lng, data.lat, data.lng);
    if (dist > NEARBY_RADIUS_M) {
      if (_nearbyMarkers[d.id]) { _nearbyMarkers[d.id].setMap(null); delete _nearbyMarkers[d.id]; }
      return;
    }
    // 마커 생성 or 이동
    if (_nearbyMarkers[d.id]) {
      _nearbyMarkers[d.id].setPosition({ lat: data.lat, lng: data.lng });
      _nearbyMarkers[d.id].setTitle(`👤 ${data.name} (${Math.round(dist)}m)`);
    } else {
      const marker = new google.maps.Marker({
        position: { lat: data.lat, lng: data.lng },
        map,
        title: `👤 ${data.name} (${Math.round(dist)}m)`,
        icon: getNearbyPlayerIcon(data.name),
        zIndex: 80,
      });
      marker.addListener('click', () => {
        infoWindow?.setContent(`
          <div style="font-size:13px;line-height:1.7;">
            <b>👤 ${escHtml(data.name)}</b>
            <div style="font-size:11px;color:#888;margin-top:2px;">거리 ${Math.round(dist)}m</div>
          </div>`);
        infoWindow?.open(map, marker);
      });
      _nearbyMarkers[d.id] = marker;
    }
  });
}

// geohash7 기반 근처 유저 폴링 (onSnapshot 전체 컬렉션 → O(n²) 방지)
async function _pollNearbyPlayers() {
  const myPos = _ctx?.lastPos;
  if (!myPos || !map || !_uid) return;
  const cells = _ghCells(myPos.lat, myPos.lng, 7);
  try {
    const snap = await getDocs(query(
      collection(db, 'user_locations'),
      where('geohash7', 'in', cells)
    ));
    updateNearbyMarkers(snap);
  } catch { /* 무시 */ }
}

// ── 게임 서버 몬스터 마커 ─────────────────────────────────────────────────────
const GS_MONSTER_ATTACK_RANGE_M = 40;

// ── 게임 서버 몬스터 — SVG 마커 아이콘 (비-스프라이트 타입용) ─────────────────
function _gsMonsterIcon(state, hpPct) {
  const dead  = state === 'dead' || state === 'respawning';
  const color = dead ? '#6b7280' : hpPct > 0.5 ? '#ef4444' : hpPct > 0.2 ? '#f97316' : '#dc2626';
  const emoji = dead ? '💀' : '👾';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
    <circle cx="18" cy="18" r="17" fill="${color}" stroke="#fff" stroke-width="2" opacity="${dead ? 0.4 : 0.9}"/>
    <text x="18" y="24" font-size="16" text-anchor="middle">${emoji}</text>
  </svg>`;
  return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
           scaledSize: new google.maps.Size(36, 36), anchor: new google.maps.Point(18, 18) };
}

// ── 게임 서버 몬스터 렌더링 ────────────────────────────────────────────────────
// dragon 등 스프라이트 타입 → MonsterSpriteOverlay
// goblin/orc 등 기타 → SVG Marker

function _renderGsMonster(monster) {
  if (!map) return;
  const { monsterId, type, state, hp, maxHp } = monster;

  // dead 상태 → 렌더링 생략, 기존 오버레이/마커 정리
  if (state === 'dead') {
    if (_gsOverlays[monsterId]) { _gsOverlays[monsterId].setMap(null); delete _gsOverlays[monsterId]; }
    if (_gsMarkers[monsterId])  { _gsMarkers[monsterId].setMap(null);  delete _gsMarkers[monsterId];  }
    delete _gsMonsters[monsterId];
    return;
  }

  // currentLat/Lng (MonsterInstance 필드명)
  const lat = monster.currentLat ?? monster.lat ?? 0;
  const lng = monster.currentLng ?? monster.lng ?? 0;
  // HP 감소 감지 → 피격음
  const prev = _gsMonsters[monsterId];
  if (prev && monster.hp < prev.hp) playSound('arrow_hit');

  _gsMonsters[monsterId] = monster;

  // ── 스프라이트 타입 (dragon 등) ─────────────────────────────────────────────
  if (hasSpriteConfig(type)) {
    if (_gsOverlays[monsterId]) {
      _gsOverlays[monsterId].updateMonster(monster);
    } else {
      _gsOverlays[monsterId] = createMonsterSpriteOverlay(
        map, monster,
        () => {   // 클릭 핸들러 (근접전투)
          const m = _gsMonsters[monsterId];
          if (!m) return;
          if (isPlayerDead()) return;
          if (!isGameServerConnected()) return;
          // 거리 체크 — GS_MONSTER_ATTACK_RANGE_M 이내에서만 공격
          const myPos = _ctx.lastPos;
          if (!myPos) return;
          const mLat = m.currentLat ?? m.lat ?? lat;
          const mLng = m.currentLng ?? m.lng ?? lng;
          const dist = haversine(myPos.lat, myPos.lng, mLat, mLng);
          if (dist > GS_MONSTER_ATTACK_RANGE_M) {
            showFloat(`${Math.round(dist)}m — 접근!`, '#facc15', mLat, mLng);
            return;
          }
          playSound('melee_hit');
          animateArrow(myPos.lat, myPos.lng, mLat, mLng, '#f87171', () => {
            sendPlayerAttack(monsterId);
            showFloat('⚔️', '#f87171', mLat, mLng);
          });
          if (_isAdmin) _showGsMonsterAdminMenu(monsterId, m.spawnId, m.type, null, { lat: mLat, lng: mLng });
        },
        () => {   // 오버레이 제거 완료 콜백
          delete _gsOverlays[monsterId];
          delete _gsMonsters[monsterId];
        },
      );
    }
    return;
  }

  // ── SVG 마커 타입 (goblin, orc 등) ─────────────────────────────────────────
  const hpPct = maxHp > 0 ? hp / maxHp : 1;
  const pos   = { lat, lng };
  const label = `👾 ${type} HP:${hp}/${maxHp}`;

  if (_gsMarkers[monsterId]) {
    _gsMarkers[monsterId].setPosition(pos);
    _gsMarkers[monsterId].setIcon(_gsMonsterIcon(state, hpPct));
    _gsMarkers[monsterId].setTitle(label);
    return;
  }

  const marker = new google.maps.Marker({
    position: pos, map, title: label,
    icon: _gsMonsterIcon(state, hpPct),
    zIndex: 90,
  });
  marker.addListener('click', () => {
    const m = _gsMonsters[monsterId];
    if (isPlayerDead()) return;
    const myPos = _ctx.lastPos;
    if (!myPos) return;
    const mLat = m?.currentLat ?? m?.lat ?? lat;
    const mLng = m?.currentLng ?? m?.lng ?? lng;
    const dist = haversine(myPos.lat, myPos.lng, mLat, mLng);
    if (dist > GS_MONSTER_ATTACK_RANGE_M) {
      infoWindow?.setContent(`<div style="font-size:13px;padding:4px;">👾 ${escHtml(type)}<br><span style="color:#888;font-size:11px;">거리 ${Math.round(dist)}m — ${GS_MONSTER_ATTACK_RANGE_M}m 이내 접근 후 공격</span></div>`);
      infoWindow?.open(map, marker);
      return;
    }
    playSound('melee_hit');
    animateArrow(myPos.lat, myPos.lng, mLat, mLng, '#f87171', () => {
      sendPlayerAttack(monsterId);
      showFloat('⚔️', '#f87171', mLat, mLng);
    });
    infoWindow?.close();
    if (_isAdmin) _showGsMonsterAdminMenu(monsterId, m?.spawnId, type, marker);
  });
  _gsMarkers[monsterId] = marker;
}

// 어드민 전용 — GS 몬스터 클릭 시 infoWindow로 관리 메뉴 표시
function _showGsMonsterAdminMenu(monsterId, spawnId, type, anchor, pos) {
  const shortMid = monsterId.slice(0, 8);
  const shortSid = spawnId ? spawnId.replace('spawn-admin-', '').slice(0, 8) : '?';
  const html = `
    <div style="font-size:12px;padding:4px 2px;min-width:160px">
      <b>🗡 ${escHtml(type)}</b>
      <span style="color:#888;font-size:10px"> #${shortMid}</span><br>
      <span style="color:#9ca3af;font-size:10px">spawn: ${shortSid}</span>
      <div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">
        <button onclick="window.__gsAdminAttackTest('${monsterId}')"
          style="flex:1;min-width:60px;padding:3px 0;background:#3b82f6;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px">
          ⚔ 테스트공격
        </button>
        <button onclick="window.__gsAdminKill('${monsterId}')"
          style="flex:1;min-width:60px;padding:3px 0;background:#f97316;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px">
          💀 강제사망
        </button>
        <button onclick="window.__gsAdminDelSpawn('${spawnId}')"
          style="flex:1;min-width:60px;padding:3px 0;background:#ef4444;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px">
          🗑 스폰삭제
        </button>
      </div>
    </div>`;
  infoWindow?.setContent(html);
  if (anchor) {
    infoWindow?.open(map, anchor);
  } else if (pos) {
    infoWindow?.setPosition(pos);
    infoWindow?.open(map);
  } else {
    infoWindow?.open(map);
  }
}

window.__gsAdminAttackTest = (monsterId) => {
  infoWindow?.close();
  sendPlayerAttack(monsterId);
  console.log('[GS AdminTest] attack →', monsterId.slice(0,8));
};

window.__gsAdminKill = async (monsterId) => {
  try {
    await gsAdminKillMonster(monsterId);
    infoWindow?.close();
  } catch (e) { alert('강제사망 오류: ' + e.message); }
};

window.__gsAdminDelSpawn = async (spawnId) => {
  if (!spawnId || spawnId === 'undefined') { alert('spawnId 없음'); return; }
  if (!confirm(`스폰 [${spawnId}] 삭제?\n해당 스폰의 모든 몬스터가 즉시 제거됩니다.`)) return;
  try {
    const r = await gsAdminDeleteSpawn(spawnId);
    alert(`✅ 삭제 완료 (인스턴스 ${r.instancesRemoved}개 제거)`);
    infoWindow?.close();
  } catch (e) { alert('삭제 오류: ' + e.message); }
};

async function _gsKeyDrop(monsterId) {
  const mob   = _gsMonsters[monsterId];
  const myUid = _uid;
  if (!myUid || !mob) return;
  if (!Object.keys(_keyDefs).length) await loadKeyDefs();
  if (!Object.keys(_keyDefs).length) return;
  const lat = mob.currentLat ?? mob.lat ?? 0;
  const lng = mob.currentLng ?? mob.lng ?? 0;
  for (const [keyId, keyDef] of Object.entries(_keyDefs)) {
    if (Math.random() < (keyDef.dropRate || 0)) {
      httpsCallable(functions, 'earnKey')({ keyId })
        .then(res => {
          showFloat(_t('float_key_drop', res.data?.keyName || keyDef.name || `Key #${keyId}`), '#fcd34d', lat, lng);
          loadInventory();
        })
        .catch(err => console.warn('[earnKey GS]', err.message));
    }
  }
}

function _removeGsMonster(monsterId) {
  _gsKeyDrop(monsterId);
  playSound('monster_die');
  // 스프라이트 오버레이 (dragon 등) — death 애니메이션 후 자체 제거
  if (_gsOverlays[monsterId]) {
    _gsOverlays[monsterId].playDeathAndRemove();
    // _gsOverlays 및 _gsMonsters 정리는 onRemoved 콜백에서 수행
    return;
  }
  // SVG 마커
  if (_gsMarkers[monsterId]) {
    _gsMarkers[monsterId].setMap(null);
    delete _gsMarkers[monsterId];
  }
  delete _gsMonsters[monsterId];
}

function startNearbyPlayers() {
  if (_nearbyTimer) return;
  _pollNearbyPlayers();                                       // 즉시 1회
  _nearbyTimer = setInterval(_pollNearbyPlayers, LOC_POLL_INTERVAL);
  window.addEventListener('beforeunload', cleanupMyLocation);
}

function stopNearbyPlayers() {
  if (_nearbyTimer) { clearInterval(_nearbyTimer); _nearbyTimer = null; }
}

function stopWatchPosition() {
  if (_ctx.locationWatchId != null) {
    navigator.geolocation.clearWatch(_ctx.locationWatchId);
    _ctx.locationWatchId = null;
  }
}

function stopGame() {
  stopBattleLoop();
  stopWatchPosition();
  stopNearbyPlayers();
  cleanupMyLocation();
  hideMyMarker();
  _gameStarted = false;
  const btn = $('btnMyLocation');
  if (btn) { btn.textContent = '📍'; btn.title = ''; }
}

async function cleanupMyLocation() {
  if (!_uid) return;
  try { await deleteDoc(doc(db, 'user_locations', _uid)); } catch { /* 무시 */ }
}

// ── 내 위치 버튼: 첫 클릭 = 게임 시작, 이후 클릭 = 내 위치로 확대 이동 ────────
let _gameStarted = false;

function _panToMyLocation() {
  const btn = $('btnMyLocation');
  // watchPosition이 이미 실행 중이면 캐시된 위치로 즉시 이동 — 재요청 금지
  const cached = _ctx?.gpsPos || _ctx?.lastPos;
  if (cached) {
    if (_ctx.map) { _ctx.map.panTo({ lat: cached.lat, lng: cached.lng }); _ctx.map.setZoom(17); }
    return;
  }
  if (!navigator.geolocation) return;
  if (btn) btn.textContent = '⏳';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng, accuracy, heading } = pos.coords;
      _ctx.lastPos = { lat, lng, accuracy, heading: heading ?? null };
      _ctx.gpsPos  = { lat, lng, accuracy, ts: Date.now() };
      updateMyLocation(lat, lng, accuracy, heading ?? null);
      if (_ctx.map) { _ctx.map.panTo({ lat, lng }); _ctx.map.setZoom(17); }
      if (btn) btn.textContent = '📍';
    },
    () => { if (btn) btn.textContent = '📍'; },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 6000 }
  );
}

function showMyLocation() {
  if (!_uid) return;
  if (!navigator.geolocation && !isVirtualMode()) { alert(_t('no_geolocation')); return; }

  // 이미 시작됨
  if (_gameStarted) {
    // Virtual 모드면 지도 이동 없이 유지, GPS 모드면 내 위치로 이동
    if (!isVirtualMode()) _panToMyLocation();
    return;
  }

  const btn       = $('btnMyLocation');
  const toggleBtn = $('btnGameToggle');

  preloadSpriteImages();
  connectToGameServer();

  if (isVirtualMode()) {
    // ── Virtual 모드: GPS 시작 없이 게임 서버만 연결 ────────────────────────
    // _ctx.lastPos = 워프 위치 (virtual.js에서 이미 설정됨) → 그대로 유지
    if (btn) btn.textContent = '📍';
    if (toggleBtn) { toggleBtn.textContent = '⏳'; toggleBtn.classList.add('gs-connecting'); }

    // 현재 가상 위치를 게임 서버로 즉시 전송
    const vpos = getVirtualPos();
    if (vpos) {
      sendPlayerLocation(vpos.lat, vpos.lng, 10);
      checkProximity(vpos.lat, vpos.lng);
    }
  } else {
    // ── GPS 모드: 기존 로직 ──────────────────────────────────────────────────
    if (btn) btn.textContent = '⏳';
    if (toggleBtn && !isGameServerConnected()) {
      toggleBtn.textContent = '⏳';
      toggleBtn.classList.add('gs-connecting');
    }

    _requestFullscreen();

    startWatchPosition((lat, lng) => {
      if (_ctx.map) { _ctx.map.panTo({ lat, lng }); _ctx.map.setZoom(18); }
      broadcastMyLocation(lat, lng);
      if (btn) btn.textContent = '📍';
      _maybeInitStarterPack(lat, lng);
      _maybeInitDailyArea(lat, lng);
    });

    setTimeout(() => {
      if (btn && btn.textContent === '⏳') btn.textContent = '📍';
    }, 8000);
  }

  startBattleLoop();
  startNearbyPlayers();
  startSharedSync((boxId, data) => {
    if (!_boxHpState[boxId]) return;
    _boxHpState[boxId].current = data.isDead ? 0 : (data.hp ?? _boxHpState[boxId].current);
  });
  subscribeDroppedItems();
  _gameStarted = true;

  if (btn) btn.title = _t('game_in_progress');
}

// ── 익명 로그인 (1기기 1계정) ───────────────────────────────────────────────
function _getDeviceId() {
  let id = localStorage.getItem('_jumper_did');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
    localStorage.setItem('_jumper_did', id);
  }
  return id;
}

async function _signInAnonymous() {
  const btn = $('btnOverlayAnon');
  const msgEl = $('anonLoginMsg');
  if (btn) { btn.textContent = '연결 중…'; btn.disabled = true; }
  if (msgEl) msgEl.style.display = 'none';

  const deviceId = _getDeviceId();
  try {
    const cred = await signInAnonymously(auth);
    const uid  = cred.user.uid;

    // 이 기기의 계정 등록 확인
    const devRef  = doc(db, 'device_accounts', deviceId);
    const devSnap = await getDoc(devRef);

    if (devSnap.exists()) {
      const registered = devSnap.data().uid;
      if (registered !== uid) {
        // 같은 기기에서 다른 계정 시도 → 차단
        await signOut(auth);
        if (msgEl) {
          msgEl.textContent = '이 기기에 이미 다른 계정이 등록되어 있습니다. 1기기 1계정만 허용됩니다.';
          msgEl.style.display = 'block';
        }
        return;
      }
      // 기존 계정 재접속 → OK
    } else {
      // 신규 기기 → 기기 등록 + 사용자 프로필 생성
      const guestNum = Math.floor(Math.random() * 90000) + 10000;
      const userRef  = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          displayName: `게스트#${guestNum}`,
          isAnonymous: true,
          createdAt: serverTimestamp(),
          role: 'user',
        });
      }
      await setDoc(devRef, { uid, createdAt: serverTimestamp() });
    }
  } catch (e) {
    if (msgEl) {
      msgEl.textContent = '오류: ' + (e.message || e.code || String(e));
      msgEl.style.display = 'block';
    }
  } finally {
    if (btn) { btn.textContent = '👤 익명으로 게임하기'; btn.disabled = false; }
  }
}

async function _linkGoogleAccount() {
  if (!auth.currentUser?.isAnonymous) return;
  try {
    await linkWithPopup(auth.currentUser, googleProvider);
    alert('✅ Google 계정 연동 완료! 앞으로 Google 로그인으로 접속하세요.');
  } catch (e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      alert('연동 오류: ' + (e.message || e.code));
    }
  }
}

// ── 보물 탐지기 (금속탐지기 방식) ────────────────────────────────────────────
function _detectorBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.12);
    setTimeout(() => ctx.close(), 500);
  } catch(e) {}
}

function _scheduleNextBeep() {
  _detectorBeepTimer = null;
  if (!_detectorActive || _detectorNextInterval === 0) return;
  _detectorBeep();
  _detectorBeepTimer = setTimeout(_scheduleNextBeep, _detectorNextInterval);
}

function _updateDetector(lat, lng) {
  if (!_detectorActive) return;
  let minDist = Infinity;
  for (const box of treasureBoxes) {
    if (!box.hiddenBox || !box.lat || !box.lng) continue;
    if (!isBoxActive(box)) continue;
    if (_collectedBoxes.has(box.id)) continue;
    const d = haversine(lat, lng, Number(box.lat), Number(box.lng));
    if (d < minDist) minDist = d;
  }
  // 사용자 숨긴 보물 NPC 위치도 탐지 (NPC 위치 기준)
  for (const npc of _utNpcData) {
    if (!npc.lat || !npc.lng) continue;
    const d = haversine(lat, lng, npc.lat, npc.lng);
    if (d < minDist) minDist = d;
  }
  if (minDist > 30) {
    _detectorNextInterval = 0;
    return;
  }
  // 30m → 2000ms / 0m → 150ms 선형 보간
  _detectorNextInterval = Math.round(Math.max(150, 150 + (minDist / 30) * 1850));
  if (!_detectorBeepTimer) {
    _detectorBeep();
    _detectorBeepTimer = setTimeout(_scheduleNextBeep, _detectorNextInterval);
  }
}

function _stopDetector() {
  _detectorActive = false;
  _detectorNextInterval = 0;
  clearTimeout(_detectorBeepTimer);
  _detectorBeepTimer = null;
  const btn = $('btnDetector');
  if (btn) { btn.style.background = ''; btn.style.boxShadow = ''; btn.title = '보물 탐지기 ON/OFF'; }
}

// ── 초보자 체험 패키지: 항상 생성 (실제 보물 유무 무관) ──────────────────────
let _starterInitDone = false;
function _maybeInitStarterPack(lat, lng) {
  if (_starterInitDone || isStarterActive()) return;
  _starterInitDone = true;
  initStarterPack(_uid, lat, lng, _ctx.map, infoWindow);
}

let _dailyAreaDone = false;
function _maybeInitDailyArea(lat, lng) {
  if (_dailyAreaDone || !_uid || !_ctx.map) return;
  _dailyAreaDone = true;
  // GP 획득 시 HUD 업데이트 콜백 등록
  window._dailyOnGpGain = (gp) => { addPlayerGold(gp); };
  initDailyArea(_uid, lat, lng, _ctx.map, infoWindow);
}

// ── 보물박스 근접 감지 — 범위 내 마커 강조, HP 있으면 공격해야 수집 ──────────
async function checkProximity(lat, lng) {
  if (!_uid) return;
  broadcastMyLocation(lat, lng); // 내 위치 Firestore에 방송
  sendPlayerLocation(lat, lng, _ctx.lastPos?.accuracy ?? 10); // 게임 서버로 전송
  checkTutorialProximity(lat, lng); // 튜토리얼 보물박스 근접 효과
  updateStarterPlayerPos(lat, lng); // 스타터팩 마커 show/hide
  for (const box of treasureBoxes) {
    if (!box.lat || !box.lng) continue;
    if (!isBoxActive(box)) continue;
    if (_collectedBoxes.has(box.id)) continue;
    const dist = haversine(lat, lng, Number(box.lat), Number(box.lng));
    const maxHp = box.hp || 300;

    // ── 숨김 보물: 20m 내 진입 시 출현, 25m 밖 이탈 시 소멸 (히스테리시스) ──
    if (box.hiddenBox) {
      if (dist <= 20) {
        if (!box._marker) _revealHiddenBox(box);
        else box._marker.setTitle(_t('hidden_box_title', box.name || _t('hidden_box_name'), getBoxHpState(box).current, maxHp));
      } else if (dist > 25 && box._marker) {
        box._marker.setMap(null);
        boxMarkers = boxMarkers.filter(m => m !== box._marker);
        box._marker = null;
      }
      continue;
    }

    if (box._marker) {
      const visible = dist <= 100;
      const inRange = dist <= 20;
      box._marker.setMap(visible ? map : null);
      if (visible) {
        box._marker.setIcon({
          url: '/assets/images/item/box.png',
          scaledSize: new google.maps.Size(inRange ? 30 : 20, inRange ? 30 : 20),
          anchor: new google.maps.Point(inRange ? 15 : 10, inRange ? 15 : 10),
        });
        box._marker.setTitle(inRange
          ? _t('box_attack_title', box.name || _t('box_default_name'), getBoxHpState(box).current, maxHp)
          : box.name || _t('box_default_name'));
      }
    }
  }
  checkShopProximity(lat, lng);
  _updateDetector(lat, lng);
  _checkDropProximity(lat, lng);
  _checkUserNpcProximity(lat, lng);
  checkDailyProximity(lat, lng);
}

async function tryCollect(box) {
  if (_collectedBoxes.has(box.id)) return;
  _collectedBoxes.add(box.id); // 동시 중복 호출 방지
  try {
    // watchPosition으로 이미 수집된 위치 사용 — getCurrentPosition 재호출 금지 (Telegram 권한 팝업 방지)
    const cached = _ctx?.gpsPos || _ctx?.lastPos;
    if (!cached) {
      _collectedBoxes.delete(box.id);
      showToast(isVirtualMode()
        ? 'Move your character near the treasure box first (tap the map).'
        : 'Locating your position… please try again in a moment.', 'warn');
      return;
    }
    const result = await httpsCallable(functions, 'collectTreasureBox')({
      boxId: box.id,
      userLat: cached.lat,
      userLng: cached.lng,
    });
    const d = result.data;
    showCollectToast(d.boxName);
    if (!_boxInventory.find(b => b.boxId === box.id)) {
      _boxInventory.push({ boxId: box.id, boxName: d.boxName, hiddenBox: box.hiddenBox || false, keyId: box.keyId || null });
    }
    renderBoxInventory();
    // 보물 발견 생중계
    httpsCallable(functions, 'broadcastGpEvent')({ game: 'treasure_find', amount: 0, label: d.boxName || '보물상자' }).catch(() => {});
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('먼저 인벤토리')) {
      _collectedBoxes.delete(box.id);
      showToast(msg, 'info');
    } else if (msg.includes('이미')) {
      // 리스폰 전까지 재시도 불필요 — 남은 시간 토스트 표시
      const remainMs = err.details?.respawnRemainingMs;
      if (remainMs) {
        const remainMin = Math.ceil(remainMs / 60000);
        const label = remainMin >= 60 ? Math.ceil(remainMin / 60) + '시간' : remainMin + '분';
        showToast(`${label} 후 다시 획득할 수 있습니다`, 'info');
      } else {
        showToast(msg, 'info');
      }
    } else if (msg.includes('너무 멀리')) {
      _collectedBoxes.delete(box.id);
    } else if (msg.includes('정회원')) {
      _collectedBoxes.delete(box.id);
      infoWindow.setContent(`<div style="font-size:13px;padding:8px;min-width:200px;">
        <div style="font-weight:700;margin-bottom:4px;">${_t('member_only_box_title')}</div>
        <div style="color:#555;font-size:12px;">${_t('member_only_box_desc')}</div>
      </div>`);
      if (box._marker) infoWindow.open(map, box._marker);
    } else {
      _collectedBoxes.delete(box.id);
      console.warn('collect:', msg);
    }
  }
}

// ── 수집 사운드 (Web Audio API) ───────────────────────────────────────────────
function playCollectSound() {
  try {
    const AC = window.AudioContext || /** @type {any} */(window).webkitAudioContext;
    const ctx = new AC();
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.35, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  } catch (_) { /* 사운드 실패는 무시 */ }
}

function showInfoToast(msg) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    background:rgba(0,0,0,.82);color:#fff;font-size:15px;font-weight:700;
    padding:12px 22px;border-radius:10px;z-index:9999;pointer-events:none;
    text-align:center;white-space:nowrap;`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function showCollectToast(boxName) {
  playCollectSound();
  const el = $('collectToast');
  el.innerHTML = `${_t('collect_toast_title')}\n<strong>${escHtml(boxName || _t('box_default_name'))}</strong>\n${_t('collect_toast_hint')}`;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// ── 박스 오픈 사운드 (Web Audio API) ──────────────────────────────────────────
function playOpenBoxSound() {
  try {
    const AC = window.AudioContext || /** @type {any} */(window).webkitAudioContext;
    const ctx = new AC();
    const hits = [
      { freq: 120, type: 'triangle', t: 0,    dur: 0.18, vol: 0.5 },
      { freq: 200, type: 'sine',     t: 0.05, dur: 0.12, vol: 0.3 },
      { freq: 880, type: 'sine',     t: 0.20, dur: 0.15, vol: 0.3 },
      { freq: 1320,type: 'sine',     t: 0.32, dur: 0.18, vol: 0.25 },
      { freq: 1760,type: 'sine',     t: 0.44, dur: 0.22, vol: 0.2 },
    ];
    hits.forEach(({ freq, type, t, dur, vol }) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = type; osc.frequency.value = freq;
      const st = ctx.currentTime + t;
      gain.gain.setValueAtTime(0, st);
      gain.gain.linearRampToValueAtTime(vol, st + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, st + dur);
      osc.start(st); osc.stop(st + dur);
    });
  } catch (_) { /* 무시 */ }
}

// ── 관리자: PC에서 GPS 없이 박스 수집 ────────────────────────────────────────
async function adminCollectBox(boxId) {
  if (_collectedBoxes.has(boxId)) { alert(_t('already_collected')); return; }
  _collectedBoxes.add(boxId);
  infoWindow.close();
  try {
    const result = await httpsCallable(functions, 'adminCollectTreasureBox')({ boxId });
    const d = result.data;
    showCollectToast(d.boxName);
    if (!_boxInventory.find(b => b.boxId === boxId)) {
      _boxInventory.push({ boxId, boxName: d.boxName });
    }
    renderBoxInventory();
  } catch (err) {
    _collectedBoxes.delete(boxId);
    alert(_t('collect_failed', err.message || err));
  }
}

// infoWindow 버튼용 전역 핸들러
window.__adminCollect = (boxId) => adminCollectBox(boxId);

// ── 박스 오픈 (인벤토리 박스 클릭) ────────────────────────────────────────────
async function openBox(boxId, slotEl) {
  if (slotEl) slotEl.classList.add('opening');
  const boxMeta = _boxInventory.find(b => b.boxId === boxId);
  try {
    const result = await httpsCallable(functions, 'openTreasureBox')({ boxId });
    const d = result.data;
    // 미개봉 박스 인벤토리에서 제거
    _boxInventory = _boxInventory.filter(b => b.boxId !== boxId);
    renderBoxInventory();
    // 열쇠 소모 — 정확한 keyId 매칭으로 찾아서 차감
    if (boxMeta?.hiddenBox && boxMeta?.keyId) {
      const kKey = Object.keys(_inventory).find(k =>
        k === `key_${boxMeta.keyId}` && _inventory[k] > 0);
      if (kKey) {
        const remaining = Math.max(0, (_inventory[kKey] || 0) - 1);
        if (remaining <= 0) delete _inventory[kKey];
        else _inventory[kKey] = remaining;
      }
    }
    // 아이템 인벤토리 업데이트
    const iid = String(d.itemId);
    _inventory[iid] = (_inventory[iid] || 0) + 1;
    renderInventory();
    // 오픈 사운드 + 아이템 획득 오버레이
    playOpenBoxSound();
    showItemReveal(d.itemName, d.itemImage, d.itemId);
  } catch (err) {
    if (slotEl) slotEl.classList.remove('opening');
    alert(_t('open_box_failed', err.message || err));
  }
}

function showItemReveal(itemName, itemImage, itemId) {
  const img = $('itemRevealImg');
  const name = $('itemRevealName');
  if (img) {
    const fallback = itemId ? `/assets/images/item/${escHtml(String(itemId))}.png` : '/assets/images/item/0.png';
    const src = itemImage ? `/assets/images/item/${escHtml(itemImage)}` : fallback;
    img.src = src;
    img.onerror = () => { img.onerror = null; img.src = fallback; };
    img.style.display = '';
  }
  if (name) name.textContent = itemName || _t('default_item_name');
  $('itemReveal')?.classList.add('open');
}

// ── 미개봉 보물박스 렌더링 ────────────────────────────────────────────────────
function renderBoxInventory() {
  const el = $('boxInvList');
  if (!el) return;
  if (!_boxInventory.length) {
    el.innerHTML = `<div class="voucher-empty">${_t('no_boxes')}</div>`;
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'box-inv-grid';
  _boxInventory.forEach(item => {
    const { boxId, boxName, hiddenBox, keyId } = item;
    const needsKey = hiddenBox && keyId;
    const hasKey   = needsKey && (_inventory[`key_${keyId}`] || 0) > 0;
    const locked   = needsKey && !hasKey;
    const keyName  = needsKey ? (_keyDefs[keyId]?.name || `Key #${keyId}`) : null;
    const slot = document.createElement('div');
    slot.className = 'box-inv-slot' + (locked ? ' locked' : (hasKey ? ' has-key' : ''));
    const _bName = boxName || _t('box_default_name2');
    slot.title = locked
      ? _t('box_locked_hint', keyId, _bName)
      : _t('box_open_hint', _bName);
    slot.innerHTML = `
      <img src="/assets/images/item/box.png" alt="box" onerror="this.style.display='none'">
      <span class="box-slot-name">${escHtml(boxName || _t('box_default_name2'))}</span>
      ${needsKey ? `<span class="box-slot-key" title="Key #${escHtml(String(keyId))}">${locked ? '🔒' : '🔑'}</span>` : ''}`;
    slot.addEventListener('click', () => {
      if (locked) {
        showInfoToast(_t('box_key_toast', keyId, keyName || `Key #${keyId}`));
        return;
      }
      openBox(boxId, slot);
    });
    grid.appendChild(slot);
  });
  el.innerHTML = '';
  el.appendChild(grid);
}

// ── 인벤토리 렌더링 (4×5 = 20 슬롯) ────────────────────────────────────────
const ARMOR_SLOT_META = {
  helmet: { label: _t('slot_helmet'), icon: '🪖' },
  chest:  { label: _t('slot_chest'),  icon: '🛡' },
  legs:   { label: _t('slot_legs'),   icon: '🦵' },
  gloves: { label: _t('slot_gloves'), icon: '🥊' },
  boots:  { label: _t('slot_boots'),  icon: '👟' },
};

function _defValFromId(itemId) {
  const m = String(itemId || '').match(/(\d+)$/);
  return m ? parseInt(m[1]) : 0;
}

function _showArmorSlotPicker(itemId, defVal) {
  const existing = document.getElementById('armorSlotPickerModal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'armorSlotPickerModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;';
  const slotList = [
    { key: 'helmet', icon: '🪖', label: _t('slot_helmet') },
    { key: 'chest',  icon: '🛡', label: _t('slot_chest') },
    { key: 'legs',   icon: '🦵', label: _t('slot_legs') },
    { key: 'gloves', icon: '🥊', label: _t('slot_gloves') },
    { key: 'boots',  icon: '👟', label: _t('slot_boots') },
  ];
  modal.innerHTML = `
    <div style="background:#1a0a00;border:2px solid #c9a870;border-radius:12px;padding:20px;max-width:300px;width:90%;text-align:center;">
      <div style="color:#ffd700;font-size:14px;font-weight:700;margin-bottom:4px;">🛡 DEF ${defVal}</div>
      <div style="color:#c9a870;font-size:12px;margin-bottom:14px;">${_t('armor_slot_picker_title')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
        ${slotList.map(s => `
          <button data-slot="${s.key}"
            style="background:#3b1a00;border:1px solid #c9a870;border-radius:8px;padding:10px 6px;cursor:pointer;
                   color:#ffd700;font-size:13px;display:flex;align-items:center;gap:6px;justify-content:center;">
            <span>${s.icon}</span><span>${s.label}</span>
          </button>`).join('')}
      </div>
      <button id="armorSlotPickerCancel"
        style="background:#5c3a1e;border:1px solid #7a5a3a;border-radius:8px;padding:7px 20px;cursor:pointer;color:#aaa;font-size:12px;">
        ${_t('cancel_btn')}
      </button>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-slot]').forEach(btn => {
    btn.addEventListener('click', () => {
      equipArmorToSlot(btn.dataset.slot, itemId);
      modal.remove();
      renderInventory();
      _updateEquipStats();
      showInfoToast(_t('equip_armor_toast', defVal));
    });
  });
  document.getElementById('armorSlotPickerCancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

function _updateEquipStats() {
  const statsEl = $('invEquipStats');
  if (!statsEl) return;
  const wId   = getEquippedWeapon();
  const wNum  = wId ? String(wId).replace('weapon_', '') : null;
  const slots = getEquippedArmorSlots();

  const weaponCard = wNum
    ? `<div data-unequip="weapon" style="display:flex;align-items:center;gap:6px;background:#2c1a0e;border:2px solid #ffd700;border-radius:8px;padding:5px 10px;min-width:100px;cursor:pointer;position:relative;" title="${_t('unequip_hint')}">
        <img src="/assets/images/weapon/${escHtml(wNum)}.png"
             onerror="this.onerror=null;this.style.display='none'"
             style="width:28px;height:28px;object-fit:contain;image-rendering:pixelated;" alt="${_t('weapon_slot_name', wNum)}">
        <div>
          <div style="font-size:9px;color:#c9a870;">${_t('equip_weapon_label')}</div>
          <div style="font-size:12px;color:#ffd700;font-weight:700;">${_t('weapon_slot_name', wNum)}</div>
        </div>
        <span style="position:absolute;top:2px;right:4px;font-size:9px;color:#f87171;">${_t('unequip_btn')}</span>
      </div>`
    : `<div style="background:#1a0e06;border:2px dashed #5c3a1e;border-radius:8px;padding:5px 10px;min-width:100px;color:#5c3a1e;font-size:11px;text-align:center;">${_t('no_weapon')}</div>`;

  const armorCards = Object.entries(slots).map(([slot, itemId]) => {
    const { label, icon } = ARMOR_SLOT_META[slot];
    const defVal = _defValFromId(itemId);
    return itemId
      ? `<div data-unequip-slot="${slot}" style="display:flex;align-items:center;gap:6px;background:#2c1a0e;border:2px solid #60a5fa;border-radius:8px;padding:5px 10px;min-width:90px;cursor:pointer;position:relative;" title="${_t('unequip_hint')}">
          <span style="font-size:20px;">${icon}</span>
          <div>
            <div style="font-size:9px;color:#c9a870;">${label}</div>
            <div style="font-size:12px;color:#60a5fa;font-weight:700;">DEF ${defVal}</div>
          </div>
          <span style="position:absolute;top:2px;right:4px;font-size:9px;color:#f87171;">${_t('unequip_btn')}</span>
        </div>`
      : `<div style="background:#1a0e06;border:2px dashed #5c3a1e;border-radius:8px;padding:5px 10px;min-width:90px;color:#5c3a1e;font-size:11px;text-align:center;">${icon}<br>${label}</div>`;
  }).join('');

  statsEl.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;width:100%;">
      ${weaponCard}
      ${armorCards}
      <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:#c9a870;margin-top:4px;width:100%;">
        <span>⚔️ 총공격력: <b style="color:#ffd700;">${getTotalAtk()}</b></span>
        <span>🛡 방어력: <b style="color:#60a5fa;">${getDefense()}</b></span>
      </div>
    </div>`;

  statsEl.querySelector('[data-unequip="weapon"]')?.addEventListener('click', () => {
    unequipWeapon();
    _updateEquipStats();
    renderInventory();
  });
  statsEl.querySelectorAll('[data-unequip-slot]').forEach(el => {
    el.addEventListener('click', () => {
      unequipArmor(el.dataset.unequipSlot);
      _updateEquipStats();
      renderInventory();
    });
  });
}

function renderInventory() {
  // 장비 능력치는 grid 유무와 무관하게 항상 업데이트
  _updateEquipStats();

  const grid = $('invGrid');
  if (!grid) return;
  const SLOTS = 50;

  // 정렬: potion_red 1순위, revive_ticket 2순위, 나머지 숫자 정렬
  const ITEM_PRIORITY = { potion_red: 0, potion_mp: 1, revive_ticket: 2 };
  const filled = Object.entries(_inventory)
    .filter(([, c]) => c > 0)
    .sort((a, b) => {
      const pa = ITEM_PRIORITY[a[0]] ?? 99;
      const pb = ITEM_PRIORITY[b[0]] ?? 99;
      if (pa !== pb) return pa - pb;
      return Number(a[0]) - Number(b[0]);
    });

  // 스킬바 약 뱃지 업데이트
  const potBadge   = $('skillPotionBadge');
  const potBtn     = $('skillBtnPotion');
  const mpPotBadge = $('skillMpPotionBadge');
  const mpPotBtn   = $('skillBtnMpPotion');
  if (potBadge)   potBadge.textContent   = (_inventory['potion_red'] || 0) > 0 ? String(_inventory['potion_red']) : '';
  if (potBtn)     potBtn.disabled        = (_inventory['potion_red'] || 0) <= 0;
  if (mpPotBadge) mpPotBadge.textContent = (_inventory['potion_mp']  || 0) > 0 ? String(_inventory['potion_mp'])  : '';
  if (mpPotBtn)   mpPotBtn.disabled      = (_inventory['potion_mp']  || 0) <= 0;

  grid.innerHTML = '';
  for (let i = 0; i < SLOTS; i++) {
    const slot = document.createElement('div');
    slot.className = 'inv-slot';
    if (i < filled.length) {
      const [itemId, count] = filled[i];
      slot.classList.add('has-item');
      slot.dataset.itemid = itemId;
      if (itemId === 'potion_red') {
        slot.title = _t('hp_potion_title');
        slot.style.cursor = 'pointer';
        slot.innerHTML = `
          <img src="/assets/images/item/hp.png"
               onerror="this.onerror=null;this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22><circle cx=%2220%22 cy=%2220%22 r=%2218%22 fill=%22%23ef4444%22/><text x=%2220%22 y=%2226%22 font-size=%2220%22 text-anchor=%22middle%22>💊</text></svg>'"
               alt="${_t('hp_potion_name')}" />
          <span class="slot-name">${_t('hp_potion_name')}</span>
          <span class="slot-count">${count}</span>`;
        slot.addEventListener('click', usePotion);
      } else if (itemId === 'potion_mp') {
        slot.title = _t('mp_potion_title');
        slot.style.cursor = 'pointer';
        slot.innerHTML = `
          <img src="/assets/images/item/mp.png"
               onerror="this.onerror=null;this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22><circle cx=%2220%22 cy=%2220%22 r=%2218%22 fill=%22%233b82f6%22/><text x=%2220%22 y=%2226%22 font-size=%2220%22 text-anchor=%22middle%22>🔮</text></svg>'"
               alt="${_t('mp_potion_name')}" />
          <span class="slot-name">${_t('mp_potion_name')}</span>
          <span class="slot-count">${count}</span>`;
        slot.addEventListener('click', useMpPotion);
      } else if (itemId === 'revive_ticket') {
        slot.title = _t('revive_item_title');
        slot.style.cursor = 'pointer';
        slot.innerHTML = `
          <img src="/assets/images/item/revive_ticket.png"
               onerror="this.onerror=null;this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22><circle cx=%2220%22 cy=%2220%22 r=%2218%22 fill=%22%238b5cf6%22/><text x=%2220%22 y=%2226%22 font-size=%2220%22 text-anchor=%22middle%22>✨</text></svg>'"
               alt="${_t('revive_item_name')}" />
          <span class="slot-name">${_t('revive_item_name')}</span>
          <span class="slot-count">${count}</span>`;
        slot.addEventListener('click', () => { useReviveTicket(); sendPlayerRevive(); });
      } else if (String(itemId).startsWith('weapon_')) {
        // ── 무기 ────────────────────────────────────────────────────────────
        const num = String(itemId).replace('weapon_', '');
        const isEquipped = getEquippedWeapon() === itemId;
        slot.title = _t('weapon_slot_title', num);
        slot.style.cursor = 'pointer';
        if (isEquipped) slot.classList.add('equipped');
        slot.innerHTML = `
          <img src="/assets/images/weapon/${escHtml(num)}.png"
               onerror="this.onerror=null;this.src='/assets/images/item/0.png'"
               alt="${_t('weapon_slot_name', num)}" />
          <span class="slot-name">${_t('weapon_slot_name', num)}</span>
          ${isEquipped ? `<span class="slot-equipped">${_t('equipped_label')}</span>` : `<span class="slot-count">${count}</span>`}`;
        slot.addEventListener('click', () => {
          equipWeapon(itemId);
          renderInventory();
          showInfoToast(_t('equip_weapon_toast', num, getTotalAtk()));
        });
      } else if (['helm_','ches_','legs_','glov_','boot_','armo_'].some(p => String(itemId).startsWith(p))) {
        // ── 방어구 (4슬롯) ───────────────────────────────────────────────────
        const defVal = String(itemId).match(/(\d+)$/)?.[1] || '0';
        const armorSlots = getEquippedArmorSlots();
        const isEquipped = Object.values(armorSlots).includes(itemId);
        const folder = Math.floor(parseInt(defVal) / 10);
        const slotMeta = Object.entries(ARMOR_SLOT_META).find(([s]) =>
          ({ helmet:'helm_', chest:'ches_', legs:'legs_', gloves:'glov_', boots:'boot_' }[s] &&
           String(itemId).startsWith({ helmet:'helm_', chest:'ches_', legs:'legs_', gloves:'glov_', boots:'boot_' }[s]))
        );
        const slotLabel = slotMeta ? slotMeta[1].label : _t('equip_armor_label');
        const slotIcon  = slotMeta ? slotMeta[1].icon  : '🛡';
        slot.title = _t('armor_slot_title', defVal);
        slot.style.cursor = 'pointer';
        if (isEquipped) slot.classList.add('equipped');
        slot.innerHTML = `
          <img src="/assets/images/armo/${escHtml(String(folder))}/${escHtml(defVal)}.png"
               onerror="this.onerror=null;this.src='/assets/images/item/0.png'"
               alt="${_t('armor_slot_name', defVal)}" />
          <span class="slot-name">${slotIcon} ${slotLabel}</span>
          ${isEquipped ? `<span class="slot-equipped">${_t('equipped_label')}</span>` : `<span class="slot-count">${count}</span>`}`;
        slot.addEventListener('click', () => {
          if (String(itemId).startsWith('armo_')) {
            _showArmorSlotPicker(itemId, defVal);
          } else {
            equipArmor(itemId);
            renderInventory();
            _updateEquipStats();
            showInfoToast(_t('equip_armor_toast', defVal));
          }
        });
      } else if (String(itemId).startsWith('key_')) {
        const kid = itemId.replace('key_', '');
        const keyDef = _keyDefs[kid] || {};
        const keyName = keyDef.name || `Key #${kid}`;
        slot.title = _t('key_slot_title', keyName, kid);
        slot.innerHTML = `
          <div style="position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
            <img src="/assets/images/item/frame.png"
                 style="position:absolute;inset:0;width:100%;height:100%;object-fit:fill;"
                 alt="" />
            <span style="position:relative;z-index:1;font-size:10px;font-weight:700;color:#3b1a00;
                         text-align:center;line-height:1.2;padding:2px 4px;
                         text-shadow:0 1px 2px rgba(255,220,150,0.8);
                         word-break:break-all;">${escHtml(keyName)}</span>
          </div>
          <span class="slot-count">${count}</span>`;
      } else {
        const meta = _items[String(itemId)] || {};
        const imgFile = meta.image || (itemId + '.png');
        const fallbackImg = `/assets/images/item/${escHtml(String(itemId))}.png`;
        slot.innerHTML = `
          <img src="/assets/images/item/${escHtml(imgFile)}"
               onerror="this.onerror=null;this.src='${fallbackImg}'"
               alt="${escHtml(meta.name || itemId)}" />
          <span class="slot-name">${escHtml(meta.name || ('#' + itemId))}</span>
          <span class="slot-count">${count}</span>`;
      }
      // 버리기 버튼 (소모품·장착 장비 제외)
      const isConsumable = ['potion_red', 'potion_mp', 'revive_ticket'].includes(itemId);
      const isEquipped = (getEquippedWeapon() === itemId) || Object.values(getEquippedArmorSlots()).includes(itemId);
      if (!isConsumable && !isEquipped) {
        const dropBtn = document.createElement('button');
        dropBtn.className = 'drop-btn';
        dropBtn.title = _t('drop_btn_title');
        dropBtn.textContent = '🗑';
        dropBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          dropItem(itemId, 1);
        });
        // 터치: 600ms 길게 눌러야 쓰레기통 표시 (짧은 탭은 장착으로 처리)
        let _lpt = null;
        slot.addEventListener('touchstart', () => {
          _lpt = setTimeout(() => slot.classList.add('touch-active'), 600);
        }, { passive: true });
        slot.addEventListener('touchend', () => {
          clearTimeout(_lpt);
          if (slot.classList.contains('touch-active')) {
            setTimeout(() => slot.classList.remove('touch-active'), 2000);
          }
        }, { passive: true });
        slot.addEventListener('touchcancel', () => {
          clearTimeout(_lpt);
          slot.classList.remove('touch-active');
        }, { passive: true });
        slot.appendChild(dropBtn);
      }
    } else {
      slot.innerHTML = '<span class="slot-placeholder">□</span>';
    }
    grid.appendChild(slot);
  }
}

async function useMpPotion() {
  if (!_uid) return;
  if ((_inventory['potion_mp'] || 0) <= 0) { alert(_t('no_mp_potion')); return; }
  try {
    const fn = httpsCallable(functions, 'useMpPotion');
    const res = await fn();
    _inventory['potion_mp'] = res.data.remaining;
    healMp(0);
    showInfoToast(_t('use_mp_potion_toast'));
    playSound('heal');
    renderInventory();
  } catch (err) {
    alert(_t('use_failed', err.message));
  }
}

async function usePotion() {
  if (!_uid) return;
  const current = _inventory['potion_red'] || 0;
  if (current <= 0) { alert(_t('no_hp_potion')); return; }

  try {
    const fn = httpsCallable(functions, 'usePotion');
    const res = await fn();
    _inventory['potion_red'] = res.data.remaining;
    healHp(100);
    showInfoToast(_t('use_hp_potion_toast'));
    playSound('heal');
    renderInventory();
  } catch (err) {
    alert(_t('use_failed', err.message));
  }
}

// ── 바닥 드랍 시스템 ──────────────────────────────────────────────────────────

async function dropItem(itemId, count = 1) {
  if (!_uid) return;
  const pos = _ctx.lastPos;
  if (!pos) { showToast(_t('drop_no_location'), 'info'); return; }

  const meta = _items[String(itemId)] || {};
  const label = meta.name || ('#' + itemId);
  if (!confirm(_t('drop_confirm', label))) return;

  try {
    const fn = httpsCallable(functions, 'dropInventoryItem');
    const res = await fn({ itemId, count, userLat: pos.lat, userLng: pos.lng });
    const cur = _inventory[itemId] || 0;
    const remaining = cur - count;
    if (remaining <= 0) delete _inventory[itemId];
    else _inventory[itemId] = remaining;
    renderInventory();
    showToast(_t('drop_success'), 'success');
    // onSnapshot 도달 전 마커를 즉시 표시
    if (res.data?.dropId) {
      const dropData = { itemId, count, lat: pos.lat, lng: pos.lng };
      _droppedItems[res.data.dropId] = dropData;
      _addDropMarker(res.data.dropId, dropData);
    }
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('인벤토리에')) showToast(_t('drop_no_item'), 'info');
    else if (msg.includes('부족')) showToast(_t('drop_insufficient'), 'info');
    else showToast(msg, 'info');
  }
}

async function pickupDrop(dropId) {
  if (!_uid) return;
  const pos = _ctx.lastPos;
  if (!pos) { showToast(_t('drop_no_location'), 'info'); return; }

  try {
    const fn = httpsCallable(functions, 'pickupDroppedItem');
    const res = await fn({ dropId, userLat: pos.lat, userLng: pos.lng });
    const meta = _items[String(res.data.itemId)] || {};
    const label = meta.name || ('#' + res.data.itemId);
    const count = res.data.count;
    // 로컬 인벤토리 즉시 반영
    _inventory[res.data.itemId] = (_inventory[res.data.itemId] || 0) + count;
    delete _droppedItems[dropId];
    _removeDropMarker(dropId);
    renderInventory();
    showToast(_t('pickup_success', `${label} x${count}`), 'success');
    playSound('collect');
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('소각')) showToast(_t('pickup_expired'), 'info');
    else if (msg.includes('멀리')) showToast(_t('pickup_too_far'), 'info');
    else if (msg.includes('찾을 수 없')) showToast(_t('pickup_gone'), 'info');
    else showToast(msg, 'info');
  }
}

function _addDropMarker(dropId, data) {
  if (!_ctx.map) return;
  if (_dropMarkers[dropId]) return; // 이미 존재
  const label = (_items[data.itemId]?.name || data.itemId) + (data.count > 1 ? ` x${data.count}` : '');

  // 이미지 존재 여부 확인 후 마커 생성
  const imgUrl = `/assets/images/item/${data.itemId}.png`;
  const img = new Image();
  img.onload = () => _buildDropMarker(dropId, data, label, {
    url: imgUrl, scaledSize: new google.maps.Size(28, 28), anchor: new google.maps.Point(14, 14),
  });
  img.onerror = () => _buildDropMarker(dropId, data, label, null);
  img.src = imgUrl;
}

function _buildDropMarker(dropId, data, label, icon) {
  if (!_ctx.map) return;
  if (_dropMarkers[dropId]) return; // 이미 생성됨 (중복 방지)
  const markerOpts = {
    position: { lat: data.lat, lng: data.lng },
    map: _ctx.map,
    title: label,
    zIndex: 10,
  };
  if (icon) {
    markerOpts.icon = icon;
  } else {
    // 이미지 없을 때 — 📦 라벨 마커
    markerOpts.label = { text: '📦', fontSize: '20px' };
  }
  const marker = new google.maps.Marker(markerOpts);
  const infoWin = new google.maps.InfoWindow({
    content: `<div class="drop-marker-label">📦 ${escHtml(label)}<br><button onclick="window._pickupDrop('${escHtml(dropId)}')" style="margin-top:4px;padding:2px 8px;background:#7a3a00;color:#fff;border:none;border-radius:4px;cursor:pointer">${_t('pickup_btn_label')}</button></div>`,
  });
  marker.addListener('click', () => infoWin.open(_ctx.map, marker));
  _dropMarkers[dropId] = marker;
}

function _removeDropMarker(dropId) {
  const m = _dropMarkers[dropId];
  if (m) { m.setMap(null); delete _dropMarkers[dropId]; }
  _alertedDropIds.delete(dropId);
}

function subscribeDroppedItems() {
  if (_dropsUnsubscribe) { _dropsUnsubscribe(); _dropsUnsubscribe = null; }
  // 만료되지 않은 아이템만 구독
  const now = new Date();
  const q = query(collection(db, 'dropped_items'),
    where('expiresAt', '>', now));
  _dropsUnsubscribe = onSnapshot(q, (snap) => {
    snap.docChanges().forEach(change => {
      const dropId = change.doc.id;
      const data = change.doc.data();
      if (change.type === 'added') {
        _droppedItems[dropId] = data;
        _addDropMarker(dropId, data);
      } else if (change.type === 'removed' || change.type === 'modified') {
        delete _droppedItems[dropId];
        _removeDropMarker(dropId);
        if (change.type === 'modified' && change.doc.exists) {
          _droppedItems[dropId] = data;
          _addDropMarker(dropId, data);
        }
      }
    });
  }, (err) => {
    console.warn('dropped_items snapshot error:', err.message);
  });
}

// ── 드랍 아이템 근접 알림 ─────────────────────────────────────────────────────

function _dropAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // 두 음 연속: 탐지기(880Hz)와 구별되는 밝은 상승 톤
    [[660, 0], [880, 0.1]].forEach(([freq, delay]) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.18);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.2);
    });
    setTimeout(() => ctx.close(), 600);
  } catch(e) {}
}

function _updateDropNearbyBadge(count) {
  const badge = $('dropNearbyBadge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove('hidden');
    badge.title = _t('drop_nearby_hud');
  } else {
    badge.classList.add('hidden');
  }
}

function _checkDropProximity(lat, lng) {
  let nearbyCount = 0;
  const newAlerts = [];

  for (const [dropId, data] of Object.entries(_droppedItems)) {
    if (!data.lat || !data.lng) continue;
    const dist = haversine(lat, lng, data.lat, data.lng);
    if (dist <= 20) {
      nearbyCount++;
      if (!_alertedDropIds.has(dropId)) {
        newAlerts.push({ dropId, data, dist });
        _alertedDropIds.add(dropId);
      }
    }
  }

  // 범위를 벗어난 드랍은 알림 상태 초기화 (재진입 시 다시 알림)
  for (const dropId of _alertedDropIds) {
    if (!_droppedItems[dropId]) {
      _alertedDropIds.delete(dropId);
      continue;
    }
    const d = _droppedItems[dropId];
    if (!d.lat || !d.lng) continue;
    if (haversine(lat, lng, d.lat, d.lng) > 25) { // 히스테리시스 5m
      _alertedDropIds.delete(dropId);
    }
  }

  _updateDropNearbyBadge(nearbyCount);

  if (newAlerts.length === 0) return;

  // 소리 + 진동 1회
  _dropAlertSound();
  if (navigator.vibrate) navigator.vibrate([80, 40, 80]);

  // 토스트: 여러 개면 대표 1개만 표시
  const first = newAlerts[0];
  const meta  = _items[first.data.itemId] || {};
  const label = meta.name || ('#' + first.data.itemId);
  const extra = newAlerts.length > 1 ? ` 외 ${newAlerts.length - 1}개` : '';
  showToast(_t('drop_nearby_toast', label + extra), 'info');
}

// 전역 노출 (InfoWindow 버튼용)
window._pickupDrop = pickupDrop;

// ── 바우처 레시피 렌더링 ─────────────────────────────────────────────────────
function renderVouchers() {
  const el = $('voucherList');
  if (!el) return;
  if (!_vouchers.length) { el.innerHTML = `<div class="voucher-empty">${_t('no_craft_recipes')}</div>`; return; }

  const vouchersSorted = _vouchers.map(v => {
    const requirements = v.requirements || [];
    let metCount = 0, totalRatio = 0;
    for (const r of requirements) {
      const isGold = r.type === 'gold' || r.itemId === 'coin';
      const have   = isGold ? getPlayerGold() : (_inventory[String(r.itemId)] || 0);
      const ratio  = r.count > 0 ? Math.min(have / r.count, 1) : 1;
      totalRatio += ratio;
      if (ratio >= 1) metCount++;
    }
    const pct = requirements.length > 0 ? Math.round(totalRatio / requirements.length * 100) : 0;
    return { v, requirements, metCount, pct, canCraft: metCount === requirements.length && requirements.length > 0 };
  }).sort((a, b) => b.pct - a.pct);

  el.innerHTML = vouchersSorted.map(({ v, requirements, metCount, pct, canCraft }) => {
    const reqs = (v.requirements || []).map(r => {
      const isGold = r.type === 'gold' || r.itemId === 'coin';
      const have   = isGold ? getPlayerGold() : (_inventory[String(r.itemId)] || 0);
      const label  = isGold ? _t('coin_label') : escHtml(_items[String(r.itemId)]?.name || '#' + r.itemId);
      const ok     = have >= r.count;
      return `<span style="color:${ok?'#86efac':'#fca5a5'}">${label} ×${r.count} (${_t('have_label', have)})</span>`;
    }).join(' + ');
    const progressBar = requirements.length > 0 ? `
      <div class="voucher-progress-wrap">
        <div class="voucher-progress-bar">
          <div class="voucher-progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="voucher-progress-text">
          <span class="vp-met">${metCount}/${requirements.length} 재료 충족</span>
          <span>${pct}%</span>
        </div>
      </div>` : '';

    return `
      <div class="voucher-row">
        <div class="voucher-name">🎟 ${escHtml(v.name)}</div>
        <div class="voucher-reqs">${reqs}</div>
        ${progressBar}
        <div class="voucher-reward">${_t('craft_reward_label', escHtml(v.reward || _t('default_voucher_reward')))}</div>
        <button class="btn-craft" data-voucher="${escHtml(v.id)}" ${canCraft?'':'disabled'}>
          ${canCraft ? _t('craft_btn') : _t('craft_insufficient')}
        </button>
      </div>`;
  }).join('');

  el.querySelectorAll('.btn-craft:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', async () => {
      const vid = btn.dataset.voucher;
      btn.disabled = true; btn.textContent = _t('craft_processing');
      try {
        const res = await httpsCallable(functions, 'craftVoucher')({ voucherId: vid });
        const reward = res.data.reward || '';
        if (reward.startsWith('weapon_')) {
          equipWeapon(reward);
          showInfoToast(_t('weapon_equip_craft', reward, getTotalAtk()));
        } else if (reward.startsWith('armo_')) {
          equipArmor(reward);
          showInfoToast(_t('armor_equip_craft', reward, getDefense()));
        }
        alert(_t('craft_success', res.data.voucherName, reward));
        await loadInventory({ force: true });
      } catch (err) {
        alert(_t('craft_failed', err.message || err));
        btn.disabled = false; btn.textContent = _t('craft_btn');
      }
    });
  });
}

// ── 데이터 로드 ──────────────────────────────────────────────────────────────
async function loadPlaces() {
  const snap = await getDocs(collection(db, 'places'));
  allPlaces = [];
  snap.forEach(d => { if (d.data().visible !== false) allPlaces.push({ id: d.id, ...d.data() }); });
}

async function loadTreasureBoxes() {
  const snap = await getDocs(collection(db, 'treasure_boxes'));
  treasureBoxes = [];
  snap.forEach(d => { if (d.data().active !== false) treasureBoxes.push({ id: d.id, ...d.data() }); });
  _updateTreasureOnMapCount();
}

function _updateTreasureOnMapCount() {
  const el = document.getElementById('tsbOnMap');
  if (!el) return;
  const total = treasureBoxes.length + _utNpcData.length;
  el.textContent = total.toLocaleString();
}

async function loadTreasureStats() {
  try {
    const snap = await getDoc(doc(db, 'treasure_stats', 'global'));
    const data = snap.exists() ? snap.data() : {};
    const elP = document.getElementById('tsbParticipants');
    const elF = document.getElementById('tsbFound');
    if (elP) elP.textContent = ((data.participants || 0) + 10000).toLocaleString() + '+';
    if (elF) elF.textContent = (data.foundCount || 0).toLocaleString();
  } catch (_) { /* 통계 실패 시 무시 */ }
}

async function loadItems() {
  const snap = await getDocs(collection(db, 'treasure_items'));
  _items = {};
  snap.forEach(d => { _items[d.id] = d.data(); });
}

async function loadKeyDefs() {
  const snap = await getDocs(query(collection(db, 'treasure_keys'), where('active', '==', true)));
  _keyDefs = {};
  snap.forEach(d => { _keyDefs[d.id] = d.data(); });
}

async function loadVouchers() {
  const snap = await getDocs(collection(db, 'treasure_vouchers'));
  _vouchers = [];
  snap.forEach(d => { if (d.data().active !== false) _vouchers.push({ id: d.id, ...d.data() }); });
}

let _invLastFetch = 0;
const INV_CACHE_MS = 30000; // 30초 TTL

async function loadInventory({ force = false } = {}) {
  if (!_uid) {
    _inventory = {}; _boxInventory = [];
    renderBoxInventory(); renderInventory(); renderVouchers(); renderMyVouchers([]);
    return;
  }

  const now = Date.now();
  if (!force && now - _invLastFetch < INV_CACHE_MS) {
    renderBoxInventory(); renderInventory(); renderVouchers();
    return;
  }
  _invLastFetch = now;

  const settle = p => p.then(v => ({ ok: true, v })).catch(e => { console.error('loadInventory query error:', e.message); showToast(`인벤토리 로드 오류: ${e.message}`, 'error'); return { ok: false }; });

  const [invRes, boxRes, vRes, purchaseRes] = await Promise.all([
    settle(getDocs(query(collection(db, 'treasure_inventory'), where('uid', '==', _uid)))),
    settle(getDocs(query(collection(db, 'treasure_inventory_boxes'), where('uid', '==', _uid)))),
    settle(getDocs(query(
      collection(db, 'treasure_voucher_logs'),
      where('uid', '==', _uid),
      orderBy('craftedAt', 'desc'),
      limit(50)
    ))),
    settle(getDocs(query(collection(db, 'treasure_voucher_purchases'), where('uid', '==', _uid)))),
  ]);

  // items/key 메타데이터가 아직 안 로드됐으면 여기서 로드
  if (!Object.keys(_items).length) await loadItems();
  if (!Object.keys(_keyDefs).length) await loadKeyDefs();

  _inventory = {};
  if (invRes.ok) invRes.v.forEach(d => {
    const r = d.data();
    if (r.count > 0) _inventory[String(r.itemId)] = r.count;
  });

  // 무기/방어구가 하나도 없으면 기본 장비 표시 (클라이언트 전용 — DB 미저장)
  const hasWeapon = Object.keys(_inventory).some(k => k.startsWith('weapon_'));
  const hasArmor  = Object.keys(_inventory).some(k => k.startsWith('armo_'));
  if (!hasWeapon) _inventory['weapon_100'] = (_inventory['weapon_100'] || 0) + 1;
  if (!hasArmor)  _inventory['armo_10']    = (_inventory['armo_10']    || 0) + 1;

  _boxInventory = [];
  if (boxRes.ok) boxRes.v.forEach(d => {
    const r = d.data();
    _boxInventory.push({ boxId: r.boxId, boxName: r.boxName, hiddenBox: r.hiddenBox || false, keyId: r.keyId || null });
    _collectedBoxes.add(r.boxId);
  });

  _purchasedVouchers = new Set();
  if (purchaseRes.ok) purchaseRes.v.forEach(d => _purchasedVouchers.add(d.data().voucherId));

  renderBoxInventory();
  renderInventory();
  renderVouchers();
  renderMyVouchers(vRes.ok ? vRes.v.docs.map(d => ({ id: d.id, ...d.data() })) : []);
  renderExchangeSection();
}

function renderMyVouchers(logs) {
  _myVoucherLogs = logs;
  const el = $('myVoucherList');
  if (!el) return;
  if (!logs.length) { el.innerHTML = `<div class="voucher-empty">${_t('no_vouchers')}</div>`; return; }

  el.innerHTML = logs.map(r => {
    const ts = r.craftedAt?.toDate?.();
    const dateStr = ts ? ts.toLocaleDateString('ko-KR') : '';
    const imgSrc = r.image ? `/assets/images/vouchers/${escHtml(r.image)}` : '';
    return `
      <div class="voucher-row" style="display:flex;gap:10px;align-items:center;">
        ${imgSrc ? `<img src="${imgSrc}" class="lb-trigger" onclick="openLightbox(this.src,this.alt)" alt="${escHtml(r.voucherName || '')}" style="width:44px;height:44px;object-fit:contain;border-radius:6px;background:#1a0e06;" onerror="this.style.display='none'">` : '<div style="width:44px;height:44px;background:#1a0e06;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:22px;">🎟</div>'}
        <div style="flex:1;">
          <div class="voucher-name">${escHtml(r.voucherName || _t('voucher_label'))}</div>
          <div class="voucher-reward">${escHtml(r.reward || '')}</div>
          ${dateStr ? `<div style="font-size:10px;color:#888;">${dateStr}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

// ── 상품교환권 섹션 (메인 페이지 노출) ───────────────────────────────────────
function renderExchangeSection() {
  const grid = $('excGrid');
  if (!grid) return;
  if (!_vouchers.length) {
    grid.innerHTML = `<div class="exc-empty">${_t('no_exchange')}</div>`;
    return;
  }

  grid.innerHTML = _vouchers.map(v => {
    const reqs = v.requirements || [];

    // 서버와 동일: gold 요건 합계 + minCoins = 실제 필요 코인
    const goldInReqs    = reqs.filter(r => r.type === 'gold' || r.itemId === 'coin')
                              .reduce((s, r) => s + (r.count || 0), 0);
    const totalGoldNeed = goldInReqs + (v.minCoins || 0);
    const itemReqs      = reqs.filter(r => r.type !== 'gold' && r.itemId !== 'coin');

    let totalRatio = 0;
    let reqCount   = 0;

    // 아이템 요건 칩 (비코인)
    const chips = itemReqs.map(r => {
      const have  = _inventory[String(r.itemId)] || 0;
      const need  = r.count || 1;
      const ratio = Math.min(1, have / need);
      totalRatio += ratio; reqCount++;

      const meta   = _items[String(r.itemId)];
      const label  = escHtml(meta?.name || ('#' + r.itemId));
      const imgSrc = meta?.image ? `/assets/images/item/${escHtml(meta.image)}` : '';
      const cls    = !_uid ? 'no-data' : ratio >= 1 ? 'ok' : 'lack';
      const haveStr = _uid ? ` <small>(${have}/${need})</small>` : '';
      const imgTag = imgSrc
        ? `<img src="${imgSrc}" alt="" onerror="this.style.display='none'">`
        : '';
      return `<span class="exc-req-chip ${cls}">${imgTag}${label}×${need}${haveStr}</span>`;
    }).join('');

    // 코인 합계 칩 (goldReqs + minCoins를 합산해 1개로 표시 — 서버 로직과 일치)
    const coinChip = (() => {
      if (!totalGoldNeed) return '';
      const have  = getPlayerGold();
      const ratio = Math.min(1, have / totalGoldNeed);
      totalRatio += ratio; reqCount++;
      const cls   = !_uid ? 'no-data' : ratio >= 1 ? 'ok' : 'lack';
      const haveStr = _uid ? ` <small>(${have}/${totalGoldNeed})</small>` : '';
      return `<span class="exc-req-chip ${cls}">${_t('coin_chip', totalGoldNeed)}${haveStr}</span>`;
    })();

    // 레벨 조건 칩
    const levelChip = (() => {
      if (!v.minLevel) return '';
      const have  = getPlayerLevel();
      const ok    = have >= v.minLevel;
      totalRatio += ok ? 1 : Math.min(1, have / v.minLevel); reqCount++;
      const cls   = !_uid ? 'no-data' : ok ? 'ok' : 'lack';
      const haveStr = _uid ? ` <small>(LV.${have})</small>` : '';
      return `<span class="exc-req-chip ${cls}">${_t('level_chip', v.minLevel)}${haveStr}</span>`;
    })();

    // 마정석 조건 칩
    const stoneChip = (() => {
      const cost = v.magicStoneCost || 0;
      if (!cost) return '';
      const have  = getPlayerToken();
      const ratio = Math.min(1, have / cost);
      totalRatio += ratio; reqCount++;
      const cls   = !_uid ? 'no-data' : ratio >= 1 ? 'ok' : 'lack';
      const haveStr = _uid ? ` <small>(${have}/${cost})</small>` : '';
      return `<span class="exc-req-chip ${cls}">${_t('magic_stone_chip', cost)}${haveStr}</span>`;
    })();

    const allChips = chips + coinChip + stoneChip + levelChip;

    const pct    = reqCount > 0 ? Math.round(totalRatio / reqCount * 100) : 0;
    const canDo  = _uid
      && (totalGoldNeed === 0 || getPlayerGold() >= totalGoldNeed)
      && itemReqs.every(r => (_inventory[String(r.itemId)] || 0) >= r.count)
      && (!(v.magicStoneCost || 0) || getPlayerToken() >= v.magicStoneCost)
      && (!v.minLevel || getPlayerLevel() >= v.minLevel);

    // 이미지 경로 정규화
    const imgUrl = (() => {
      const img = v.image;
      if (!img) return '';
      if (img.startsWith('http') || img.startsWith('/')) return img;
      if (img.includes('/')) return '/' + img;            // "assets/images/..." 형태
      return `/assets/images/vouchers/${img}`;            // 파일명만 있는 경우
    })();

    const alreadyBought = _uid && _purchasedVouchers.has(v.id);
    const btnLabel = !_uid ? _t('exchange_btn_login') : alreadyBought ? _t('exchange_btn_done') : canDo ? _t('exchange_btn_go') : _t('exchange_btn_lack');

    return `
      <div class="exc-card">
        ${imgUrl
          ? `<div class="exc-card-img-wrap">
               <img src="${escHtml(imgUrl)}" alt="${escHtml(v.name)}" class="lb-trigger"
                 onclick="openLightbox(this.src,this.alt)"
                 onerror="this.parentNode.innerHTML='<span class=exc-card-img-fallback>🎟</span>'">
             </div>`
          : `<div class="exc-card-img-wrap">
               <span class="exc-card-img-fallback">🎟</span>
             </div>`
        }
        <div class="exc-card-banner">
          <div class="exc-card-reward">${escHtml(v.reward || _t('default_reward_label'))}</div>
          <div class="exc-card-name">${escHtml(v.name)}</div>
        </div>
        <div class="exc-card-body">
          <div>
            <div class="exc-req-label">${_t('exchange_req_label')}</div>
            <div class="exc-req-list" style="margin-top:6px;">${allChips || `<span style="color:var(--muted,#9ca3af);font-size:.82rem;">${_t('exchange_no_req')}</span>`}</div>
          </div>
          ${_uid ? `
          <div class="exc-progress-wrap">
            <div class="exc-progress-bar"><div class="exc-progress-fill" style="width:${pct}%"></div></div>
            <div class="exc-progress-text">${_t('exchange_progress', pct)}</div>
          </div>` : `<div class="exc-login-hint">${_t('exchange_login_hint')}</div>`}
          <button class="btn-exc" data-vid="${escHtml(v.id)}" ${(canDo && !alreadyBought) ? '' : 'disabled'}>${btnLabel}</button>
        </div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.btn-exc:not(:disabled)').forEach(btn => {
    btn.addEventListener('click', async () => {
      const vid = btn.dataset.vid;
      btn.disabled = true; btn.textContent = _t('exchange_processing');
      try {
        const res = await httpsCallable(functions, 'craftVoucher')({ voucherId: vid });
        alert(_t('exchange_success', res.data.voucherName, res.data.reward));
        await loadInventory({ force: true });
        renderExchangeSection();
      } catch (err) {
        alert(_t('craft_failed', err.message || err));
        btn.disabled = false; btn.textContent = _t('exchange_btn_go');
      }
    });
  });
}

// ── 인벤토리 모달 ────────────────────────────────────────────────────────────
function openInventory() {
  $('invModal').classList.add('open');
  _updateEquipStats();
  loadInventory();
  const goldEl  = document.getElementById('invGold');
  const tokenEl = document.getElementById('invToken');
  if (goldEl)  goldEl.textContent  = getPlayerGold();
  if (tokenEl) tokenEl.textContent = getPlayerToken();
  // Firestore에서 최신 골드/토큰 동기화 (상점 판매 수익 반영)
  loadPlayerState().then(() => {
    if (goldEl)  goldEl.textContent  = getPlayerGold();
    if (tokenEl) tokenEl.textContent = getPlayerToken();
  }).catch(() => {});
}
function closeInventory() { $('invModal').classList.remove('open'); }

// ── 튜토리얼 ────────────────────────────────────────────────────────────────
const TUT_KEY = 'jmp_tut_v1';

const TUT_STEPS = [
  { icon: '📍', titleKey: 'tut_step1_title', bodyKey: 'tut_step1_body' },
  { icon: '👾', titleKey: 'tut_step2_title', bodyKey: 'tut_step2_body' },
  { icon: '📦', titleKey: 'tut_step3_title', bodyKey: 'tut_step3_body' },
];

function initTutorial() {
  const modal    = $('tutModal');
  const header   = $('tutHeader');
  const icon     = $('tutIcon');
  const stepTitle = $('tutStepTitle');
  const stepBody  = $('tutStepBody');
  const dotsWrap  = $('tutDots');
  const prevBtn   = $('tutPrev');
  const nextBtn   = $('tutNext');
  const closeBtn  = $('tutClose');
  if (!modal) return;

  let currentStep = 0;

  function renderStep(idx) {
    const step = TUT_STEPS[idx];
    const total = TUT_STEPS.length;
    if (header)    header.textContent   = `${_t('tut_title')} (${idx + 1}/${total})`;
    if (icon)      icon.textContent     = step.icon;
    if (stepTitle) stepTitle.textContent = _t(step.titleKey);
    if (stepBody)  stepBody.textContent  = _t(step.bodyKey);

    if (dotsWrap) {
      dotsWrap.innerHTML = '';
      TUT_STEPS.forEach((_, i) => {
        const dot = document.createElement('span');
        dot.className = 'tut-dot' + (i === idx ? ' active' : '');
        dot.addEventListener('click', () => { currentStep = i; renderStep(i); });
        dotsWrap.appendChild(dot);
      });
    }

    if (prevBtn) {
      prevBtn.textContent = _t('tut_prev');
      prevBtn.disabled    = idx === 0;
    }
    if (nextBtn) {
      const isLast = idx === total - 1;
      nextBtn.textContent = isLast ? _t('tut_done') : _t('tut_next');
    }
  }

  function openTutorial() {
    currentStep = 0;
    renderStep(0);
    modal.classList.remove('hidden');
  }

  function closeTutorial() {
    modal.classList.add('hidden');
    try { localStorage.setItem(TUT_KEY, '1'); } catch (_) {}
  }

  prevBtn?.addEventListener('click', () => {
    if (currentStep > 0) { currentStep--; renderStep(currentStep); }
  });

  nextBtn?.addEventListener('click', () => {
    if (currentStep < TUT_STEPS.length - 1) {
      currentStep++;
      renderStep(currentStep);
    } else {
      closeTutorial();
    }
  });

  closeBtn?.addEventListener('click', closeTutorial);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeTutorial(); });

  $('btnTutHelp')?.addEventListener('click', openTutorial);

  // 첫 방문 시 자동 표시
  try {
    if (!localStorage.getItem(TUT_KEY)) openTutorial();
  } catch (_) {}
}

// ── 메인 ────────────────────────────────────────────────────────────────────
async function init() {
  // battle 모듈 초기화 (ctx와 callbacks 연결)
  initBattle(_ctx, {
    onCheckProximity: checkProximity,
    onLoadInventory:  loadInventory,
    onUpdateDistDisplay: updateDistDisplay,
  });

  // 상점 콜백 등록
  _ctx._onShopNear  = (shop) => openShopModal(shop);
  _ctx._onShopClick = (shop) => {
    if (_isAdmin) { openShopAdminModal(shop); return; }
    // 공격 모드 중 → 마커 탭으로도 바로 공격
    if (_attackMode?.shopId === shop.id) { _doAttackShop(shop); return; }
    openShopModal(shop);
  };

  // Auth 리스너 (비동기 — 블로킹 없음)
  onAuthStateChanged(auth, async user => {
    _uid         = user?.uid         || null;
    _userEmail   = user?.email       || null;
    _isAnonymous = user?.isAnonymous || false;
    _ctx.uid     = _uid;

    const loginOverlay = $('gameLoginOverlay');
    const gameToggle   = $('btnGameToggle');

    if (_uid) {
      // 로그인됨 (일반 또는 익명) → 오버레이 숨김
      if (loginOverlay) loginOverlay.style.display = 'none';
      if (gameToggle)   gameToggle.disabled = false;

      _isAdmin = false;
      _ctx.isAdmin = false;
      if (!_isAnonymous) {
        const snap = await getDoc(doc(db, 'admins', _uid));
        _isAdmin = snap.exists() || (_userEmail === 'daguri75@gmail.com');
        _ctx.isAdmin = _isAdmin;
      }

      // 익명 유저 배지 표시
      _renderAnonBadge(_isAnonymous);

      loadPlayerState().then(async (status) => {
        if (status === 'new' && !_isAnonymous) {
          try {
            await httpsCallable(functions, 'initBattlePlayer')();
            await loadPlayerState(); // 스타터 아이템 포함 재로드
            await loadInventory({ force: true });
          } catch (e) { /* ignore */ }
          _initTutorialBoxesWhenReady();
        } else if (!_isAnonymous) {
          _initTutorialBoxesWhenReady();
        }
        // 유저 표시 이름/사진 battle_players에 동기화 (랭킹 표시용)
        if (!_isAnonymous) {
          let displayName = user?.displayName || null;
          if (!displayName) {
            try {
              const uSnap = await getDoc(doc(db, 'users', _uid));
              if (uSnap.exists()) {
                const d = uSnap.data();
                displayName = d.name || d.displayName || d.nickname || null;
              }
            } catch { /* ignore */ }
          }
          if (displayName) {
            setDoc(doc(db, 'battle_players', _uid), {
              displayName,
              photoURL: user?.photoURL || null,
            }, { merge: true }).catch(() => {});
          }
        }
        renderExchangeSection();
        showDeathMarkerIfDead();
      });
      loadInventory();
      _renderMemberStatus(_uid);
    } else {
      // 비로그인 → 오버레이 표시
      if (loginOverlay) loginOverlay.style.display = 'flex';
      if (gameToggle)   gameToggle.disabled = true;
      _isAdmin = false;
      _ctx.isAdmin = false;
      _renderAnonBadge(false);
      _renderMemberStatus(null);
      // 튜토리얼 마커 정리
      clearTutorialBoxes();
      clearTrialMonsters();
      // 드랍 구독 해제 및 마커 정리
      if (_dropsUnsubscribe) { _dropsUnsubscribe(); _dropsUnsubscribe = null; }
      Object.keys(_dropMarkers).forEach(id => { _dropMarkers[id].setMap(null); });
      _dropMarkers = {};
      _droppedItems = {};
      _alertedDropIds.clear();
      _updateDropNearbyBadge(0);
    }
    // 관리자 패널 표시
    const abp = $('adminBattlePanel');
    if (abp) abp.classList.toggle('open', !!_isAdmin);
  });

  // ── 튜토리얼 박스 초기화 ────────────────────────────────────────────────────
  async function _initTutorialBoxesWhenReady() {
    const waitFor = (check, maxTries = 20) => new Promise(resolve => {
      if (check()) { resolve(); return; }
      let tries = 0;
      const id = setInterval(() => {
        if (check() || ++tries >= maxTries) { clearInterval(id); resolve(); }
      }, 500);
    });

    // 지도 초기화까지 최대 10초 대기
    await waitFor(() => !!_ctx?.map);
    if (!_ctx?.map) return;

    // 위치 확보: 캐시된 GPS 우선 사용 — 자동 GPS 요청 금지 (Telegram 권한 팝업 방지)
    let pos = _ctx?.gpsPos || _ctx?.lastPos;
    if (!pos && _ctx?.map) {
      const c = _ctx.map.getCenter();
      if (c) pos = { lat: c.lat(), lng: c.lng() };
    }
    if (!pos) return;

    try {
      const fn = httpsCallable(functions, 'initTutorialBoxes');
      const res = await fn({ lat: pos.lat, lng: pos.lng });
      if (res.data?.boxes?.length) loadTutorialBoxes(res.data.boxes);
    } catch { /* 튜토리얼 초기화 실패는 비치명적 */ }

    // 체험판 몬스터 배치 — 사용자 위치 기준 50~120m 거리에 2마리
    try {
      const _bearingOffset = (lat, lng, distM, bearingDeg) => {
        const R   = 6371000;
        const rad = Math.PI / 180;
        const b   = bearingDeg * rad;
        const dLat = (distM / R) / rad;
        const dLng = (distM / R) / rad / Math.cos(lat * rad);
        return {
          lat: lat + dLat * Math.cos(b),
          lng: lng + dLng * Math.sin(b),
        };
      };
      const monDefs = [
        { defIdx: 0, hp: 1, id: 'tm0' },  // 슬라임 (쉬움)
        { defIdx: 3, hp: 3, id: 'tm1' },  // 오크 (보통)
      ];
      const monsters = monDefs.map((def, i) => {
        const bearing = 40 + i * 140 + Math.random() * 60;
        const dist    = 60  + i * 30  + Math.random() * 30;
        const p = _bearingOffset(pos.lat, pos.lng, dist, bearing);
        return { ...def, maxHp: def.hp, lat: p.lat, lng: p.lng };
      });
      loadTrialMonsters(monsters);
    } catch { /* 몬스터 배치 실패는 비치명적 */ }
  }

  // ── Phase 1: 지도 표시에 필요한 것만 병렬 로드 ──────────────────────────────
  const settle1 = p => p.catch(() => null);
  const [, merchantSnap] = await Promise.all([
    settle1(loadMapsScript()),
    settle1(getDocs(collection(db, 'merchants'))),
    settle1(loadTreasureBoxes()),
    settle1(loadTreasureStats()),
  ]);

  // 가맹점 데이터 파싱
  allMerchants = [];
  merchantSnap?.forEach(d => {
    const m = d.data();
    if (m.active === false) return;
    const latLng = (m.lat && m.lng) ? { lat: m.lat, lng: m.lng } : parseLatLng(m.gmap);
    allMerchants.push({ id: d.id, ...m, _latLng: latLng });
  });
  allMerchants.sort((a, b) => (b._latLng ? 1 : 0) - (a._latLng ? 1 : 0));

  // 지도 + 카드 즉시 표시
  if (window.google?.maps) {
    initMap();
    showDeathMarkerIfDead(); // 사망 상태 재접속 시 해골 마커 표시
    renderMarkers(allMerchants);
    renderBoxMarkers();
    loadUserTreasureNpcs();
    fitMapToAllMarkers();
    // 배치 상점 초기화 (지도 준비 후)
    if (_uid) {
      initUserPlace(_ctx.map, infoWindow, getPlayerGold, () => {
        loadPlayerState({ force: true });
        loadTreasureBoxes().then(renderBoxMarkers);
        loadBattleData();
        loadShops(); // 새 상점 마커 즉시 갱신
      });
    }

    // Virtual Explore Mode 초기화
    initVirtualMode(_ctx, map, infoWindow, (active, _shop) => {
      if (!active) {
        const pos = _ctx.gpsPos || _ctx.lastPos;
        if (pos) checkProximity(pos.lat, pos.lng);
      }
    }, {
      spendMp:    (amount) => spendPlayerMp(amount),
      getMp:      ()       => getPlayerMp(),
      getMaxMp:   ()       => getPlayerMaxMp(),
      // 실제 플레이어 마커를 가상 위치로 이동 + _ctx.lastPos 동기화
      moveMarker: (lat, lng) => {
        _ctx.lastPos = { lat, lng, accuracy: 10, heading: null };
        updateMyLocation(lat, lng, 10, null);
      },
    });
    // 가상 위치 탭 이동 시 proximity 체크 연결
    _ctx._onVirtualMove = (lat, lng) => checkProximity(lat, lng);

    // 첫 방문 Virtual Mode 안내
    _initVirtualModeGuide();
  }
  renderCards(allMerchants);

  // 익명 배지 렌더
  function _renderAnonBadge(isAnon) {
    let badge = $('anonBadge');
    if (isAnon) {
      if (!badge) {
        badge = document.createElement('div');
        badge.id = 'anonBadge';
        badge.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:900;' +
          'background:#1f2937;border:1px solid #374151;border-radius:20px;padding:4px 14px;' +
          'display:flex;align-items:center;gap:8px;font-size:12px;color:#9ca3af;';
        badge.innerHTML = '<span>👤 게스트 모드</span>' +
          '<button id="btnLinkGoogle" style="background:#ff6b00;color:#fff;border:none;border-radius:12px;' +
          'padding:2px 10px;font-size:11px;cursor:pointer;font-weight:600;">Google 연동</button>';
        document.body.appendChild(badge);
        $('btnLinkGoogle')?.addEventListener('click', _linkGoogleAccount);
      }
      badge.style.display = 'flex';
    } else if (badge) {
      badge.style.display = 'none';
    }
  }

  // ── 텔레그램 Mini App 자동 인증 ─────────────────────────────────────────────
  // merchants.html에 직접 진입한 경우에도 텔레그램 인증 처리
  if (isTelegramMiniApp()) {
    // 텔레그램 로그인 버튼 표시
    const tgBtn = $('btnOverlayTelegram');
    if (tgBtn) tgBtn.style.display = '';

    // Firebase 미인증 상태에서만 자동 인증 시도
    if (!auth.currentUser) {
      loginWithTelegram().catch(() => {/* 실패 시 수동 버튼으로 fallback */});
    }
  }

  // 텔레그램 로그인 버튼 핸들러
  $('btnOverlayTelegram')?.addEventListener('click', async () => {
    const btn = $('btnOverlayTelegram');
    if (btn) { btn.textContent = '인증 중…'; btn.disabled = true; }
    try {
      const result = await loginWithTelegram();
      if (!result) throw new Error('텔레그램 인증 실패');
    } catch (e) {
      if (btn) { btn.textContent = '📱 텔레그램 계정으로 로그인'; btn.disabled = false; }
      alert('텔레그램 로그인 오류: ' + (e?.message || '알 수 없는 오류'));
    }
  });

  // 로그인 오버레이 버튼 — Google 팝업 로그인
  $('btnOverlayLogin')?.addEventListener('click', async () => {
    const btn = $('btnOverlayLogin');
    if (btn) { btn.textContent = '로그인 중…'; btn.disabled = true; }
    try { await signInWithPopup(auth, googleProvider); }
    catch (e) {
      const code = e?.code || '';
      if (code && code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        alert('로그인 오류: ' + code);
      }
    } finally {
      if (btn) { btn.textContent = '🔑 Google 로그인'; btn.disabled = false; }
    }
  });

  // 익명 로그인
  $('btnOverlayAnon')?.addEventListener('click', _signInAnonymous);

  // 버튼 이벤트
  $('btnInventory')?.addEventListener('click', openInventory);
  $('btnVirtualMode')?.addEventListener('click', () => {
    // Virtual Explore는 GPS 게임이 꺼진 상태에서만 가능
    if (_gameStarted && !isVirtualMode()) {
      showToast('📍 GPS 게임 중에는 Virtual 모드를 사용할 수 없습니다. 게임을 종료(■)하세요.', 'warn');
      return;
    }
    toggleVirtualMode();
  });
  $('btnDetector')?.addEventListener('click', () => {
    const btn = $('btnDetector');
    if (_detectorActive) {
      _stopDetector();
      if (btn) btn.title = '보물 탐지기 OFF — 클릭해서 켜기';
    } else {
      _detectorActive = true;
      if (btn) {
        btn.style.background = '#7c3aed';
        btn.style.boxShadow = '0 0 10px #7c3aed88';
        btn.title = '보물 탐지기 ON — 클릭해서 끄기';
      }
      // 현재 위치 기준으로 즉시 업데이트
      if (_ctx.lastPos) _updateDetector(_ctx.lastPos.lat, _ctx.lastPos.lng);
    }
  });
  initTutorial();
  $('btnFullscreen')?.addEventListener('click', () => {
    if (_isInFullscreen()) { _exitFullscreen(); } else { _requestFullscreen(); }
  });

  // AR 스캔: 전체화면 먼저 종료 후 이동
  $('btnArScan')?.addEventListener('click', () => {
    const go = () => { location.href = '/ar-scan.html'; };
    if (_isInFullscreen()) { _exitFullscreen(); setTimeout(go, 200); } else { go(); }
  });

  function _onFullscreenChange() {
    const isFs = _isInFullscreen();
    const btn = $('btnFullscreen');
    if (btn) btn.textContent = isFs ? '✕' : '⛶';
    if (!isFs && _ctx.map) {
      setTimeout(() => {
        google.maps.event.trigger(_ctx.map, 'resize');
        if (_ctx.lastPos) _ctx.map.panTo({ lat: _ctx.lastPos.lat, lng: _ctx.lastPos.lng });
      }, 150);
    }
  }
  document.addEventListener('fullscreenchange', _onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', _onFullscreenChange);
  $('btnResetDist')?.addEventListener('click', () => {
    _ctx.totalDist = 0; _ctx.lastDistPos = null; updateDistDisplay();
  });
  $('btnCloseInv')?.addEventListener('click', closeInventory);
  $('invModal')?.addEventListener('click', e => { if (e.target === $('invModal')) closeInventory(); });
  $('btnRevealClose')?.addEventListener('click', () => $('itemReveal')?.classList.remove('open'));
  $('itemReveal')?.addEventListener('click', e => { if (e.target === $('itemReveal')) $('itemReveal').classList.remove('open'); });

  // ── 바우쳐 서비스 주문 모달 ──────────────────────────────────────────────────
  async function _openVoucherOrderModal() {
    if (!_uid) { alert('로그인이 필요합니다'); return; }
    const modal  = $('voucherOrderModal');
    const sel    = $('voVoucherSel');
    const status = $('voStatus');
    if (modal) modal.classList.remove('hidden');
    if (sel) sel.innerHTML = '<option value="">불러오는 중...</option>';
    if (status) status.textContent = '';
    try {
      const res = await httpsCallable(functions, 'coopGetMyVouchers')();
      const vouchers = res.data?.vouchers || [];
      _myVoucherLogs = vouchers;
      if (sel) {
        if (!vouchers.length) {
          sel.innerHTML = '<option value="">보유 바우쳐가 없습니다</option>';
        } else {
          sel.innerHTML = vouchers.map((v, i) =>
            `<option value="${i}">${escHtml(v.description || '바우쳐')} [${v.source === 'game' ? '게임' : '상품'}]</option>`
          ).join('');
        }
      }
    } catch (err) {
      if (sel) sel.innerHTML = '<option value="">불러오기 실패</option>';
    }
  }

  $('btnOpenVoucherOrder')?.addEventListener('click', _openVoucherOrderModal);
  $('btnOpenVoucherOrderMap')?.addEventListener('click', _openVoucherOrderModal);

  $('voucherOrderModal')?.addEventListener('click', e => {
    if (e.target === $('voucherOrderModal')) $('voucherOrderModal').classList.add('hidden');
  });

  $('btnVoGps')?.addEventListener('click', () => {
    const inp = $('voLatLng');
    if (!inp) return;
    if (_ctx.gpsPos) {
      inp.value = `${_ctx.gpsPos.lat.toFixed(6)}, ${_ctx.gpsPos.lng.toFixed(6)}`;
    } else if (_ctx.lastPos) {
      inp.value = `${_ctx.lastPos.lat.toFixed(6)}, ${_ctx.lastPos.lng.toFixed(6)}`;
    } else {
      alert('GPS 위치를 가져올 수 없습니다. 지도에서 위치를 확인하세요.');
    }
  });

  $('btnSubmitVoucherOrder')?.addEventListener('click', async () => {
    const btn    = $('btnSubmitVoucherOrder');
    const sel    = $('voVoucherSel');
    const status = $('voStatus');
    const idx    = parseInt(sel?.value ?? '', 10);
    if (isNaN(idx) || !_myVoucherLogs[idx]) {
      if (status) { status.style.color = '#ef4444'; status.textContent = '바우쳐를 선택하세요'; }
      return;
    }
    const latLng = $('voLatLng')?.value?.trim();
    if (!latLng) {
      if (status) { status.style.color = '#ef4444'; status.textContent = '설치 위치를 입력하세요'; }
      return;
    }
    const [latStr, lngStr] = latLng.split(',').map(s => s.trim());
    if (isNaN(parseFloat(latStr)) || isNaN(parseFloat(lngStr))) {
      if (status) { status.style.color = '#ef4444'; status.textContent = '좌표를 올바르게 입력하세요 (예: 21.110101, 106.393556)'; }
      return;
    }
    const voucher = _myVoucherLogs[idx];
    if (!confirm(`"${voucher.description || '바우쳐'}"를 관리자에게 이체하고 서비스를 신청합니다.\n취소할 수 없습니다. 계속하시겠습니까?`)) return;
    if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }
    if (status) { status.style.color = '#6b7280'; status.textContent = ''; }
    try {
      const params = {
        docId:           voucher.id || null,
        sourceCollection: voucher.source === 'game' ? 'treasure_voucher_logs' : null,
        voucherId:       voucher.voucherId != null ? voucher.voucherId : undefined,
        requestedName:   $('voName')?.value?.trim() || '',
        latLng,
        imageUrl:        $('voImageUrl')?.value?.trim() || '',
      };
      const res = await httpsCallable(functions, 'submitVoucherOrder')(params);
      if (status) { status.style.color = '#22c55e'; status.textContent = `✅ 주문 완료! (주문ID: ${res.data.orderId?.slice(0, 8)}…)`; }
      await loadInventory({ force: true });
      setTimeout(() => $('voucherOrderModal')?.classList.add('hidden'), 2500);
    } catch (err) {
      if (status) { status.style.color = '#ef4444'; status.textContent = '오류: ' + (err.message || err); }
      if (btn) { btn.disabled = false; btn.textContent = '주문 제출'; }
    }
  });

  // 관리자 전투 배치 패널 버튼
  $('btnPlaceMonster')?.addEventListener('click', () => enterAdminPlaceMode('monster'));
  $('btnPlaceDragon')?.addEventListener('click',  () => enterAdminPlaceMode('dragon'));
  $('btnPlaceOrc')?.addEventListener('click',     () => enterAdminPlaceMode('orc'));
  $('btnPlaceOrc2')?.addEventListener('click',    () => enterAdminPlaceMode('orc2'));
  $('btnPlaceOrc3')?.addEventListener('click',    () => enterAdminPlaceMode('orc3'));
  $('btnPlacePirate')?.addEventListener('click',  () => enterAdminPlaceMode('pirate'));
  $('btnPlacePirate2')?.addEventListener('click', () => enterAdminPlaceMode('pirate2'));
  $('btnPlacePirate3')?.addEventListener('click',  () => enterAdminPlaceMode('pirate3'));
  $('btnPlaceZombie1')?.addEventListener('click',  () => enterAdminPlaceMode('zombie1'));
  $('btnPlaceZombie3')?.addEventListener('click',  () => enterAdminPlaceMode('zombie3'));
  $('btnPlaceArcherTower')?.addEventListener('click', () => enterAdminPlaceMode('archer_tower'));
  $('btnPlaceCannonTower')?.addEventListener('click', () => enterAdminPlaceMode('cannon_tower'));
  $('btnPlaceDeco')?.addEventListener('click',    () => enterAdminPlaceMode('deco'));
  $('btnPlaceShopWeapon')?.addEventListener('click', () => enterAdminPlaceMode('shop_weapon_armor'));
  $('btnPlaceShopPotion')?.addEventListener('click', () => enterAdminPlaceMode('shop_potion'));
  $('btnPlaceShopMisc')?.addEventListener('click',   () => enterAdminPlaceMode('shop_misc'));
  $('btnGiveRevive')?.addEventListener('click', async () => {
    const targetUid = prompt('부활권 지급할 UID (비우면 본인):', _uid || '') || _uid;
    if (!targetUid) return;
    const count = parseInt(prompt('지급 수량:', '10000') || '10000');
    if (!count || count < 1) return;
    try {
      const res = await httpsCallable(functions, 'adminGiveRevive')({ targetUid, count });
      alert(`✅ 부활권 ${res.data.given}장 지급 완료`);
      if (targetUid === _uid) await loadInventory({ force: true });
    } catch (err) { alert('실패: ' + err.message); }
  });

  $('btnGivePotion')?.addEventListener('click', async () => {
    const targetUid = prompt('빨간약 지급할 UID (비우면 본인):', _uid || '') || _uid;
    if (!targetUid) return;
    const count = parseInt(prompt('지급 수량:', '5') || '5');
    if (!count || count < 1) return;
    try {
      const res = await httpsCallable(functions, 'adminGivePotion')({ targetUid, count });
      alert(`✅ ${targetUid.slice(0,8)}… 에게 빨간약 ${res.data.given}병 지급 완료`);
      if (targetUid === _uid) await loadInventory({ force: true });
    } catch (err) { alert('실패: ' + err.message); }
  });
  $('btnAdminInitAllPlayers')?.addEventListener('click', async () => {
    if (!confirm('모든 유저에게 스타터 팩을 초기화하시겠습니까?\n(이미 더 많이 가진 유저는 영향 없음)')) return;
    try {
      const res = await httpsCallable(functions, 'adminInitAllPlayers')();
      alert(`✅ ${res.data.processed}명 초기화 완료`);
    } catch (err) { alert('실패: ' + err.message); }
  });
  $('btnCancelPlace')?.addEventListener('click',  exitAdminPlaceMode);
  $('btnToggleTowerRange')?.addEventListener('click', toggleTowerRanges);

  // 스킬 버튼
  $('skillBtn0')?.addEventListener('click', castLightning);
  $('skillBtn1')?.addEventListener('click', castIceFreeze);
  $('skillBtn2')?.addEventListener('click', castFireStorm);
  $('skillBtn3')?.addEventListener('click', castWhirlwind);
  $('skillBtn4')?.addEventListener('click', castMeteor);
  $('skillBtnPotion')?.addEventListener('click', usePotion);
  $('skillBtnHeal')?.addEventListener('click', castHeal);
  $('skillBtnMpPotion')?.addEventListener('click', useMpPotion);
  $('skillBtnMagicStone')?.addEventListener('click', useMagicStone);

  initDungeonGame({
    onSpendGold:      (amount)        => spendPlayerGold(amount),
    onAddGold:        (amount)        => addPlayerGold(amount),
    onPlaySound:      (type)          => playSound(type),
    getInventory:     ()              => ({ ..._inventory }),
    getPlayerSnapshot: ()             => getPlayerSnapshot(),
    onSyncPlayer:     (state)         => syncPlayerFromDungeon(state),
    onUseItem:    (itemId, cnt=1) => {
      const cur = _inventory[itemId] || 0;
      if (cur < cnt) return false;
      const remaining = cur - cnt;
      if (remaining <= 0) delete _inventory[itemId];
      else _inventory[itemId] = remaining;
      updateInventoryBar?.();
      return true;
    },
    onExit: () => {
      try { document.getElementById('ghFloatBtn')?.style && (document.getElementById('ghFloatBtn').style.display = 'flex'); } catch {}
    },
  });

  // 미니게임 버튼 — 팝업 서브메뉴
  (function () {
    const popup = $('miniGamePopup');
    $('skillBtnMiniGame')?.addEventListener('click', (e) => {
      e.stopPropagation();
      popup?.classList.toggle('hidden');
    });
    $('miniGameDungeon')?.addEventListener('click', () => {
      popup?.classList.add('hidden');
      // ── 던전 진입 사전 안내 ────────────────────────────────────────────
      if (!_gameStarted) {
        showToast('📍 먼저 게임 시작 버튼(▶)을 눌러 보물찾기를 시작하세요!', 'warn');
        return;
      }
      if (isPlayerDead()) {
        showToast('💀 사망 상태입니다. 부활 아이템을 사용하거나 부활 지점으로 이동하세요.', 'warn');
        return;
      }
      openDungeonGame();
    });
    // 팝업 외부 클릭 시 닫기
    document.addEventListener('click', () => popup?.classList.add('hidden'));
  })();

  // 키보드 단축키 1-9
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === '1') castLightning();
    else if (e.key === '2') castIceFreeze();
    else if (e.key === '3') castFireStorm();
    else if (e.key === '4') castWhirlwind();
    else if (e.key === '5') castMeteor();
    else if (e.key === '6') usePotion();
    else if (e.key === '7') castHeal();
    else if (e.key === '8') useMpPotion();
    else if (e.key === '9') useMagicStone();
  });

  // 전투 HUD 클릭 → 접기/펼치기 (모바일: 기본 접힘)
  $('combatHud')?.addEventListener('click', () => $('combatHud')?.classList.toggle('compact'));
  if (window.innerWidth <= 640) $('combatHud')?.classList.add('compact');

  updateSkillBar();

  // ── 게임 서버 초기화 ─────────────────────────────────────────────────────────
  // _ctx.playerLevel을 동적으로 battle 모듈에서 읽도록 getter 추가
  Object.defineProperty(_ctx, 'playerLevel', { get: () => getPlayerLevel(), configurable: true });

  initGameServer(_ctx, {
    onStateChange: (state) => {
      const btn   = $('btnGameToggle');
      const badge = $('gsStatusBadge');
      if (!btn) return;
      btn.classList.remove('gs-connecting', 'gs-connected', 'gs-error');
      if (state === 'connecting') {
        btn.classList.add('gs-connecting');
        btn.textContent = '⏳';
        btn.title = _t('gs_connecting');
        if (badge) badge.textContent = _t('gs_connecting_badge');
      } else if (state === 'connected') {
        btn.classList.add('gs-connected');
        btn.textContent = '■';
        btn.title = _t('gs_connected');
        if (badge) badge.textContent = _t('gs_connected_badge');
        renderBoxMarkers(); // 연결 시 보물박스 표시
      } else if (state === 'error') {
        btn.classList.add('gs-error');
        btn.textContent = '▶';
        btn.title = _t('gs_error');
        if (badge) badge.textContent = _t('gs_error_badge');
      } else {
        btn.textContent = '▶';
        btn.title = _t('gs_idle');
        if (badge) badge.textContent = '';
        renderBoxMarkers(); // 연결 해제 시 보물박스 숨김
        stopGame();         // GPS·전투루프·주변유저 정지 및 재접속 허용
      }
    },
    onError:           (msg) => console.warn('[GS]', msg),
    onZoneSnapshot:    (data) => {
      // 기존 마커/오버레이 전체 제거
      Object.keys(_gsMarkers).forEach(id => { _gsMarkers[id].setMap(null); delete _gsMarkers[id]; });
      Object.keys(_gsOverlays).forEach(id => { _gsOverlays[id]?.setMap(null); delete _gsOverlays[id]; });
      _gsMonsters = {};
      data.monsters?.forEach(m => _renderGsMonster(m));
    },
    onMonsterUpdate:    (m) => _renderGsMonster(m),
    onMonsterDied:      (d) => _removeGsMonster(d.monsterId),
    onMonsterRespawned: (m) => _renderGsMonster(m),
    onDropSpawned:   (d)    => spawnGsDrop(d.dropId, d.lat, d.lng, d.gold ?? d.count, () => sendDropCollect(d.dropId)),
    onDropRemoved:   (d)   => removeGsDrop(d.dropId),
    onDropCollected: (d)   => { /* gold already added in spawnGsDrop click handler */ },
    onPlayerHit:    (data) => {
      const _gsKind = String(_gsMonsters[data.monsterId]?.type || '').replace(/\d+$/, '');
      const _gsAtk  = (_gsKind === 'dragon') ? 'monster_atk_dragon'
                    : (_gsKind === 'orc')    ? 'monster_atk_orc'
                    : (_gsKind === 'pirate') ? 'monster_atk_pirate'
                    : 'monster_atk';
      playSound(_gsAtk);
      syncHpFromServer(data.remainHp, data.damage);
    },
    onPlayerDied:    ()     => {
      syncDeathFromServer();
      ['utNpcModal', 'utRegModal', 'utMyModal'].forEach(id => document.getElementById(id)?.classList.remove('open'));
    },
    onPlayerRevived: (data) => syncReviveFromServer(data.hp),
    onPlayerExp:     (d)    => onPlayerExp(d),
    onPlayerLevelUp: (d)    => onPlayerLevelUp(d),
    onNotify:        (d)    => { if (d?.msg) showToast(d.msg); },
  });

  // WS 이벤트를 못 받은 경우 관리자 스폰 후 강제 렌더링
  window.addEventListener('gs:forceRenderMonster', (e) => _renderGsMonster(e.detail));

  $('btnGameToggle')?.addEventListener('click', () => {
    if (!_uid) return; // 비로그인 차단 (disabled이지만 방어코드 유지)
    if (isGameServerConnected()) {
      disconnectFromGameServer();
    } else {
      // GPS + 지도 확대 + 캐릭터 + 전체화면 + 서버 연결 한 번에
      showMyLocation();
    }
  });

  // PC 모드: 맵 패닝 시 lastPos를 맵 중심으로 갱신 (렌더링 전용)
  // 실제 GPS가 있으면(gpsPos 존재) 덮어쓰지 않는다
  if (map) {
    map.addListener('idle', () => {
      if (!isGameServerConnected()) return;
      if (_ctx.gpsPos) return; // 실제 GPS 있으면 맵 센터로 대체 금지
      if (!_ctx.lastPos) {
        const c = map.getCenter();
        if (c) _ctx.lastPos = { lat: c.lat(), lng: c.lng(), accuracy: 10 };
      }
    });
  }

  // ── Phase 2: 백그라운드에서 나머지 로드 (UI 블로킹 없음) ─────────────────────
  Promise.all([loadPlaces(), loadItems(), loadVouchers(), loadKeyDefs(), loadBattleData(), loadDecorations(), loadShops()]).then(() => {
    // 장소 마커 추가
    if (window.google?.maps) {
      renderPlaceMarkers();
      fitMapToAllMarkers();
    }
    // 인벤토리 초기 렌더
    renderBoxInventory();
    renderInventory();
    renderVouchers();
    renderExchangeSection();
  });
}

// ── 상점 모달 (유저용) ────────────────────────────────────────────────────────
let _activeShopId    = null;
let _shopCurrentData = null;
let _shopSelectedItem = null;
let _shopQty         = 1;
const _nameCache     = new Map(); // uid → 표시 이름 캐시

// ── 공격 모드 (10분) ─────────────────────────────────────────────────────────
let _attackMode = null; // { shopId, shop, expiresAt, timerId, countdownId }

function _enterAttackMode(shop) {
  if (_attackMode) _exitAttackMode();
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const timerId   = setTimeout(_exitAttackMode, 10 * 60 * 1000);
  _attackMode = { shopId: shop.id, shop: { ...shop }, expiresAt, timerId, countdownId: null };
  _renderAttackPanel();
  _attackMode.countdownId = setInterval(_updateAttackPanelTimer, 1000);
}

function _exitAttackMode() {
  if (_attackMode) {
    clearTimeout(_attackMode.timerId);
    clearInterval(_attackMode.countdownId);
    _attackMode = null;
  }
  if (_shopAtkCdTimer) { clearInterval(_shopAtkCdTimer); _shopAtkCdTimer = null; }
  const p = document.getElementById('shopAttackPanel');
  if (p) p.classList.add('hidden');
}

function _getAttackPanelRoot() {
  return document.fullscreenElement || document.webkitFullscreenElement || document.body;
}

function _renderAttackPanel() {
  let panel = document.getElementById('shopAttackPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'shopAttackPanel';
    panel.style.cssText = [
      'position:fixed;bottom:80px;left:50%;transform:translateX(-50%)',
      'z-index:9999;width:min(360px,92vw)',
      'background:#1a0a0a;border:2px solid #dc2626;border-radius:14px',
      'padding:14px 16px;box-shadow:0 4px 24px rgba(220,38,38,.45)',
    ].join(';');
    // fullscreenchange 시 패널을 fullscreen 컨테이너로 이동
    const _onFsChange = () => {
      const p = document.getElementById('shopAttackPanel');
      if (!p) return;
      _getAttackPanelRoot().appendChild(p);
    };
    document.addEventListener('fullscreenchange', _onFsChange);
    document.addEventListener('webkitfullscreenchange', _onFsChange);
  }
  _getAttackPanelRoot().appendChild(panel);
  panel.classList.remove('hidden');
  _refreshAttackPanel();
}

function _refreshAttackPanel() {
  const panel = document.getElementById('shopAttackPanel');
  if (!panel || !_attackMode) return;
  const { shop } = _attackMode;
  const hp    = shop.hp    ?? '?';
  const maxHp = shop.maxHp ?? '?';
  const hpPct = (shop.maxHp && shop.hp != null) ? Math.max(0, Math.round(shop.hp / shop.maxHp * 100)) : 100;
  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <span style="color:#fca5a5;font-weight:700;font-size:14px">⚔️ 공격 중 — ${escHtml(shop.name)}</span>
      <button id="atkPanelExit" style="background:none;border:none;color:#9ca3af;font-size:20px;cursor:pointer;line-height:1">✕</button>
    </div>
    <div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#9ca3af;margin-bottom:4px">
        <span>HP</span><span id="atkPanelHp">${hp} / ${maxHp}</span>
      </div>
      <div style="background:#374151;border-radius:4px;height:8px;overflow:hidden">
        <div id="atkPanelHpBar" style="background:#dc2626;width:${hpPct}%;height:100%;border-radius:4px;transition:width .4s"></div>
      </div>
    </div>
    <div style="display:flex;gap:10px;align-items:center">
      <button id="atkPanelBtn"
        style="flex:1;padding:13px;border-radius:10px;border:none;font-weight:700;font-size:16px;cursor:pointer;
               background:linear-gradient(135deg,#dc2626,#991b1b);color:#fff;
               box-shadow:0 3px 12px rgba(220,38,38,.4);letter-spacing:.3px">
        ⚔️ 공격
      </button>
      <span id="atkPanelTimer" style="color:#6b7280;font-size:13px;min-width:44px;text-align:center"></span>
    </div>`;
  _updateAttackPanelTimer();
  document.getElementById('atkPanelExit')?.addEventListener('click', _exitAttackMode);
  document.getElementById('atkPanelBtn')?.addEventListener('click', () => _doAttackShop(_attackMode?.shop));
}

function _updateAttackPanelTimer() {
  const el = document.getElementById('atkPanelTimer');
  if (!el || !_attackMode) return;
  const rem = Math.max(0, Math.ceil((_attackMode.expiresAt - Date.now()) / 1000));
  const m = Math.floor(rem / 60), s = rem % 60;
  el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  if (rem === 0) _exitAttackMode();
}

function _updateAttackPanelHp(newHp) {
  if (!_attackMode) return;
  _attackMode.shop.hp = newHp;
  const maxHp = _attackMode.shop.maxHp ?? newHp;
  const pct   = maxHp > 0 ? Math.max(0, Math.round(newHp / maxHp * 100)) : 0;
  const hpEl  = document.getElementById('atkPanelHp');
  const barEl = document.getElementById('atkPanelHpBar');
  if (hpEl)  hpEl.textContent  = `${newHp} / ${maxHp}`;
  if (barEl) barEl.style.width = `${pct}%`;
  updateShopHpMarker(_attackMode.shop.id, newHp);
}

let _shopAtkCdTimer = null;

function _startShopAtkCd(sec) {
  const btn = $('atkPanelBtn');
  if (!btn) return;
  if (_shopAtkCdTimer) clearInterval(_shopAtkCdTimer);
  let left = sec;
  btn.disabled = true;
  btn.textContent = `⚔️ ${left}s`;
  _shopAtkCdTimer = setInterval(() => {
    left--;
    if (left <= 0) {
      clearInterval(_shopAtkCdTimer);
      _shopAtkCdTimer = null;
      btn.disabled = false;
      btn.textContent = '⚔️ 공격';
    } else {
      btn.textContent = `⚔️ ${left}s`;
    }
  }, 1000);
}

async function _doAttackShop(shop) {
  if (!shop) return;
  if (!_uid || _isAnonymous) {
    showFloat(_t('login_required') || '로그인 필요', '#ef4444', shop.lat, shop.lng);
    return;
  }
  const btn = $('atkPanelBtn');
  if (btn?.disabled) return;

  playSound('melee_hit');
  if (_ctx.lastPos) animateArrow(_ctx.lastPos.lat, _ctx.lastPos.lng, shop.lat, shop.lng, '#ef4444');
  showFloat('⚔️', '#ef4444', shop.lat, shop.lng);
  _startShopAtkCd(5);
  try {
    const fn = httpsCallable(functions, 'attackShop');
    const res = await fn({ shopId: shop.id });
    const { atk, newHp, conquered, shopName } = res.data;
    _updateAttackPanelHp(newHp);
    if (conquered) {
      playSound('monster_die');
      showFloat(`👑 정복! ${shopName}`, '#facc15', shop.lat, shop.lng);
      _exitAttackMode();
    } else {
      showFloat(`-${atk} HP`, '#f87171', shop.lat, shop.lng);
    }
  } catch (e) {
    const msg = e?.message || '';
    const cdMatch = msg.match(/(\d+)초 남음/);
    if (cdMatch) {
      const remSec = Number(cdMatch[1]);
      _startShopAtkCd(remSec);
      showFloat(`⏳ ${remSec}초`, '#94a3b8', shop.lat, shop.lng);
    } else if (msg.includes('자신의 상점')) {
      showFloat('자신의 상점은 공격 불가', '#94a3b8', shop.lat, shop.lng);
      _exitAttackMode();
    } else {
      showFloat('공격 실패', '#ef4444', shop.lat, shop.lng);
    }
  }
}

async function _execRepairShop(shop) {
  const missing = Math.max(0, (shop.maxHp ?? 0) - (shop.hp ?? shop.maxHp ?? 0));
  if (!missing) return;
  const cost = missing;
  if (!confirm(`HP ${missing.toLocaleString()} 수리 → 💰 ${cost.toLocaleString()} 골드 차감\n진행하시겠습니까?`)) return;
  try {
    const res = await httpsCallable(functions, 'repairShop')({ shopId: shop.id });
    const { repairHp, cost: paid, newHp } = res.data;
    closeShopModal();
    await Promise.all([loadPlayerState({ force: true }), loadShops()]);
    showToast(`🔧 수리 완료 (+${repairHp.toLocaleString()} HP, -💰${paid.toLocaleString()})`, 'success');
  } catch (e) {
    showToast(e?.message || '수리 실패', 'error');
  }
}

function openShopModal(shop) {
  // Virtual 모드: 가상 위치(lastPos) 사용 / GPS 모드: 실제 GPS(gpsPos) 사용
  const myPos = isVirtualMode() ? _ctx?.lastPos : _ctx?.gpsPos;
  if (!myPos) {
    showToast(isVirtualMode()
      ? 'Move your character near the shop first (tap the map).'
      : _t('shop_gps_wait'), 'warn');
    return;
  }
  if (shop.lat && shop.lng) {
    const distM = haversine(myPos.lat, myPos.lng, shop.lat, shop.lng);
    if (distM > 1000) {
      showToast(isVirtualMode()
        ? `Your character is ${Math.round(distM / 100) / 10}km away. Walk closer to use this shop.`
        : _t('shop_too_far', Math.round(distM / 100) / 10), 'warn');
      return;
    }
  }

  _activeShopId     = shop.id;
  _shopCurrentData  = shop;
  _shopSelectedItem = null;
  _shopQty          = 1;
  const modal = $('shopModal');
  if (!modal) return;

  const typeLabelMap = { weapon_armor: '⚔️ 무기/방어구', potion: '🧪 약물', misc: '🛍️ 잡템' };
  $('shopModalTitle').textContent = `${shop.name} (${typeLabelMap[shop.type] || shop.type})`;

  const adminBtn = $('shopModalAdminBtn');
  if (adminBtn) {
    if (_isAdmin) {
      adminBtn.style.display = '';
      adminBtn.onclick = () => { closeShopModal(); openShopAdminModal(shop); };
    } else {
      adminBtn.style.display = 'none';
    }
  }

  _renderShopModalBody();
  modal.classList.add('open');

  // 비동기 소유자 이름 조회 (내 상점이 아닌 경우만)
  const ownerUidForLookup = shop.ownerUid;
  if (ownerUidForLookup && ownerUidForLookup !== _uid && !shop.ownerName) {
    _resolveUserName(ownerUidForLookup).then(name => {
      if (!name) return;
      _shopCurrentData.ownerName = name;
      const el = document.getElementById('shopOwnerNameEl');
      if (el) el.textContent = name;
    }).catch(() => {});
  }
}

function _renderShopModalBody() {
  const body = $('shopModalBody');
  if (!body || !_shopCurrentData) return;

  const shop      = _shopCurrentData;
  const items     = shop.items || [];
  const playerGold = getPlayerGold();
  const sel       = _shopSelectedItem;
  const maxQty    = sel ? (sel.stock === -1 ? 99 : sel.stock) : 1;
  const total     = sel ? sel.price * _shopQty : 0;
  const canBuy    = !!sel && playerGold >= total;

  // 상점 정보 헤더 (소유자 + 보유 골드)
  const ownerUid  = shop.ownerUid || '';
  const isOwnerMe = ownerUid && ownerUid === _uid;
  const ownerDisp = isOwnerMe ? '👑 나' : (shop.ownerName ? escHtml(shop.ownerName) : (ownerUid ? ownerUid.slice(0, 8) + '…' : '─'));
  let html = `<div style="padding-bottom:10px;border-bottom:1px solid #1f2937;margin-bottom:10px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <span style="color:#9ca3af;font-size:12px">🏪 소유자</span>
      <span id="shopOwnerNameEl" style="color:${isOwnerMe ? '#60a5fa' : '#d1d5db'};font-size:12px;font-weight:600">${ownerDisp}</span>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between">
      <span style="color:#9ca3af;font-size:12px">보유 골드</span>
      <span style="color:#fbbf24;font-weight:700;font-size:14px">💰 ${playerGold.toLocaleString()}</span>
    </div>
  </div>`;

  // 아이템 목록
  if (!items.length) {
    html += `<p style="color:#9ca3af;text-align:center;padding:16px 0">판매 중인 아이템이 없습니다</p>`;
  } else {
    items.forEach(it => {
      const soldOut    = it.stock === 0;
      const isSelected = sel?.itemId === it.itemId;
      html += `<div class="shop-item-row" data-item-id="${escHtml(it.itemId)}"
        style="display:flex;align-items:center;gap:10px;padding:10px;border-radius:10px;
               margin-bottom:6px;cursor:${soldOut ? 'default' : 'pointer'};
               border:2px solid ${isSelected ? '#3b82f6' : '#1f2937'};
               background:${isSelected ? 'rgba(59,130,246,.12)' : 'rgba(255,255,255,.02)'};
               opacity:${soldOut ? '0.45' : '1'};transition:border-color .15s,background .15s">
        <div style="width:22px;height:22px;border-radius:50%;flex-shrink:0;
                    border:2px solid ${isSelected ? '#3b82f6' : '#374151'};
                    background:${isSelected ? '#3b82f6' : 'transparent'};
                    display:flex;align-items:center;justify-content:center;
                    font-size:12px;color:#fff">${isSelected ? '✓' : ''}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px;color:#f3f4f6">${escHtml(it.name)}</div>
          <div style="font-size:12px;margin-top:3px;color:#fbbf24">
            💰 ${it.price.toLocaleString()} ${_t('shop_gold_label')}
            <span style="color:#6b7280;margin-left:6px">
              ${it.stock === -1 ? '∞ 무제한' : `재고 ${it.stock}`}
            </span>
          </div>
        </div>
        ${soldOut ? `<span style="font-size:11px;color:#ef4444;font-weight:600;flex-shrink:0">${_t('shop_out_of_stock')}</span>` : ''}
      </div>`;
    });
  }

  // 하단: 수량 / 합계 / 구매 버튼
  html += `<div style="border-top:1px solid #1f2937;margin-top:12px;padding-top:12px">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <span style="color:#9ca3af;font-size:13px">구매 수량</span>
      <div style="display:flex;align-items:center;gap:10px">
        <button id="shopQtyMinus"
          style="width:30px;height:30px;border-radius:8px;border:1px solid #374151;
                 background:#1f2937;font-size:18px;line-height:1;
                 color:${(!sel || _shopQty <= 1) ? '#4b5563' : '#f3f4f6'};
                 cursor:${(!sel || _shopQty <= 1) ? 'not-allowed' : 'pointer'}"
          ${(!sel || _shopQty <= 1) ? 'disabled' : ''}>−</button>
        <span style="color:#f3f4f6;font-size:16px;font-weight:700;min-width:28px;text-align:center">
          ${sel ? _shopQty : '─'}
        </span>
        <button id="shopQtyPlus"
          style="width:30px;height:30px;border-radius:8px;border:1px solid #374151;
                 background:#1f2937;font-size:18px;line-height:1;
                 color:${(!sel || _shopQty >= maxQty) ? '#4b5563' : '#f3f4f6'};
                 cursor:${(!sel || _shopQty >= maxQty) ? 'not-allowed' : 'pointer'}"
          ${(!sel || _shopQty >= maxQty) ? 'disabled' : ''}>+</button>
      </div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <span style="color:#9ca3af;font-size:13px">합계</span>
      <span style="color:#fbbf24;font-weight:700;font-size:16px">
        ${sel ? `💰 ${total.toLocaleString()} ${_t('shop_gold_label')}` : '─'}
      </span>
    </div>
    <button id="shopBuyBtn"
      style="width:100%;padding:13px;border-radius:10px;border:none;
             font-weight:700;font-size:15px;letter-spacing:.2px;
             cursor:${canBuy ? 'pointer' : 'not-allowed'};
             background:${canBuy ? 'linear-gradient(135deg,#2563eb,#1d4ed8)' : '#1f2937'};
             color:${canBuy ? '#fff' : '#6b7280'};
             box-shadow:${canBuy ? '0 3px 12px rgba(37,99,235,.4)' : 'none'}"
      ${canBuy ? '' : 'disabled'}>
      ${!sel ? '아이템을 선택하세요' : !canBuy ? '💸 골드가 부족합니다' : '🛒 구매하기'}
    </button>
    ${(() => {
      const isOwn = shop.ownerUid && shop.ownerUid === _uid;
      const hp    = shop.hp    ?? shop.maxHp ?? 0;
      const maxHp = shop.maxHp ?? 0;
      if (isOwn) {
        const missing   = Math.max(0, maxHp - hp);
        const cost      = missing; // 1 골드 / 1 HP
        const hpPct     = maxHp > 0 ? Math.round(hp / maxHp * 100) : 100;
        const canRepair = missing > 0 && playerGold >= cost;
        const lvlCost   = (shop.level ?? 1) * (shop.level ?? 1) * 10000;
        const canLvlUp  = playerGold >= lvlCost;
        return `<div style="margin-top:10px;padding:10px;background:rgba(255,255,255,.03);border-radius:10px;border:1px solid #1f2937">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:#9ca3af;margin-bottom:5px">
            <span>🏠 내 상점 HP</span>
            <span style="color:${hpPct < 50 ? '#ef4444' : '#10b981'};font-weight:600">${hp.toLocaleString()} / ${maxHp.toLocaleString()}</span>
          </div>
          <div style="background:#374151;border-radius:4px;height:6px;margin-bottom:8px;overflow:hidden">
            <div style="background:${hpPct < 50 ? '#ef4444' : '#10b981'};width:${hpPct}%;height:100%;border-radius:4px"></div>
          </div>
          ${missing > 0
            ? `<button id="shopRepairBtn" ${canRepair ? '' : 'disabled'}
                style="width:100%;padding:10px;border-radius:8px;border:none;font-weight:700;font-size:13px;
                       cursor:${canRepair ? 'pointer' : 'not-allowed'};
                       background:${canRepair ? 'linear-gradient(135deg,#059669,#047857)' : '#1f2937'};
                       color:${canRepair ? '#fff' : '#6b7280'}">
                🔧 전체 수리 <span style="font-weight:400;opacity:.8">(💰 ${cost.toLocaleString()} 골드)</span>
              </button>`
            : `<div style="text-align:center;color:#10b981;font-size:12px;font-weight:600">✅ HP 최대</div>`
          }
          <button id="shopLevelUpBtn" ${canLvlUp ? '' : 'disabled'}
            style="width:100%;margin-top:8px;padding:10px;border-radius:8px;border:none;
                   font-weight:700;font-size:13px;
                   cursor:${canLvlUp ? 'pointer' : 'not-allowed'};
                   background:${canLvlUp ? 'linear-gradient(135deg,#7c3aed,#6d28d9)' : '#1f2937'};
                   color:${canLvlUp ? '#fff' : '#6b7280'}">
            ⬆️ 레벨업 (Lv.${shop.level ?? 1} → ${(shop.level ?? 1) + 1})
            <span style="font-weight:400;opacity:.8">(💰 ${lvlCost.toLocaleString()} 골드)</span>
          </button>
          <button id="shopSalesBtn"
            style="width:100%;margin-top:8px;padding:10px;border-radius:8px;border:1px solid #374151;
                   background:transparent;color:#9ca3af;font-size:13px;font-weight:600;cursor:pointer">
            📊 매출 실적 보기
          </button>
          <div id="shopSalesPanel" style="display:none;margin-top:8px"></div>
        </div>`;
      }
      return `<button id="shopAttackBtn"
        style="width:100%;margin-top:8px;padding:11px;border-radius:10px;border:none;
               font-weight:700;font-size:14px;cursor:pointer;
               background:linear-gradient(135deg,#dc2626,#991b1b);color:#fff;
               box-shadow:0 3px 12px rgba(220,38,38,.35)">
        ⚔️ 공격하기 <span style="font-weight:400;font-size:12px;opacity:.8">(HP ${hp.toLocaleString()}/${maxHp.toLocaleString()})</span>
      </button>`;
    })()}
  </div>`;

  body.innerHTML = html;

  // 아이템 행 클릭 → 선택
  body.querySelectorAll('.shop-item-row[data-item-id]').forEach(row => {
    const it = items.find(i => i.itemId === row.dataset.itemId);
    if (!it || it.stock === 0) return;
    row.addEventListener('click', () => {
      _shopSelectedItem = it;
      _shopQty = 1;
      _renderShopModalBody();
    });
  });

  // 수량 조절
  $('shopQtyMinus')?.addEventListener('click', () => {
    if (_shopQty > 1) { _shopQty--; _renderShopModalBody(); }
  });
  $('shopQtyPlus')?.addEventListener('click', () => {
    if (sel && _shopQty < maxQty) { _shopQty++; _renderShopModalBody(); }
  });

  // 구매하기
  if (canBuy) {
    $('shopBuyBtn')?.addEventListener('click', () => {
      _execShopBuy(shop.id, sel.itemId, sel.name, sel.price, _shopQty);
    });
  }

  // 공격하기 → 공격 모드 진입 (10분)
  $('shopAttackBtn')?.addEventListener('click', () => {
    closeShopModal();
    _enterAttackMode(shop);
  });

  // 내 상점 HP 수리
  $('shopRepairBtn')?.addEventListener('click', () => _execRepairShop(shop));

  // 상점 레벨업
  $('shopLevelUpBtn')?.addEventListener('click', () => _execLevelUpShop(shop));

  // 매출 실적
  $('shopSalesBtn')?.addEventListener('click', () => _loadShopSales(shop.id));
}

function closeShopModal() {
  $('shopModal')?.classList.remove('open');
  _activeShopId     = null;
  _shopCurrentData  = null;
  _shopSelectedItem = null;
  _shopQty          = 1;
}

async function _resolveUserName(uid) {
  if (!uid) return null;
  if (_nameCache.has(uid)) return _nameCache.get(uid);
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const d    = snap.exists() ? snap.data() : {};
    const name = d.name || d.displayName || d.nickname || null;
    _nameCache.set(uid, name);
    return name;
  } catch {
    _nameCache.set(uid, null);
    return null;
  }
}

async function _loadShopSales(shopId) {
  const panel = document.getElementById('shopSalesPanel');
  const btn   = document.getElementById('shopSalesBtn');
  if (!panel) return;

  if (!panel.style.display || panel.style.display === 'none') {
    panel.style.display = 'block';
    panel.innerHTML = '<div style="text-align:center;color:#9ca3af;font-size:13px;padding:12px 0">로딩 중…</div>';
    if (btn) btn.textContent = '📊 매출 실적 닫기';
  } else {
    panel.style.display = 'none';
    if (btn) btn.textContent = '📊 매출 실적 보기';
    return;
  }

  try {
    const res = await httpsCallable(functions, 'getShopSales')({ shopId, limit: 20 });
    const { sales, totalRevenue, totalSales } = res.data;
    let html = `
      <div style="background:rgba(255,255,255,.03);border:1px solid #1f2937;border-radius:10px;padding:12px">
        <div style="display:flex;gap:12px;margin-bottom:12px">
          <div style="flex:1;background:#1f2937;border-radius:8px;padding:10px;text-align:center">
            <div style="color:#9ca3af;font-size:11px;margin-bottom:4px">총 수익 (골드)</div>
            <div style="color:#fbbf24;font-weight:700;font-size:18px">💰 ${(totalRevenue||0).toLocaleString()}</div>
          </div>
          <div style="flex:1;background:#1f2937;border-radius:8px;padding:10px;text-align:center">
            <div style="color:#9ca3af;font-size:11px;margin-bottom:4px">총 판매 수량</div>
            <div style="color:#60a5fa;font-weight:700;font-size:18px">${(totalSales||0).toLocaleString()} 개</div>
          </div>
        </div>`;
    if (!sales.length) {
      html += `<div style="text-align:center;color:#6b7280;font-size:13px;padding:8px 0">판매 기록이 없습니다</div>`;
    } else {
      html += `<div style="font-size:11px;color:#6b7280;margin-bottom:6px">최근 판매 내역 (최대 20건)</div>`;
      sales.forEach(s => {
        const dt = s.createdAt ? new Date(s.createdAt).toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '─';
        html += `<div style="display:flex;align-items:center;justify-content:space-between;
                              padding:7px 0;border-bottom:1px solid #1f2937;font-size:12px">
          <div style="flex:1;min-width:0">
            <div style="color:#f3f4f6;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(s.itemName || s.itemId)}</div>
            <div style="color:#6b7280;margin-top:2px">${dt} · ×${s.qty}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:10px">
            <div style="color:#fbbf24;font-weight:700">+${(s.ownerShare||0).toLocaleString()} G</div>
            <div style="color:#4b5563;font-size:11px">합계 ${(s.totalCost||0).toLocaleString()}</div>
          </div>
        </div>`;
      });
    }
    html += `</div>`;
    panel.innerHTML = html;
  } catch (err) {
    panel.innerHTML = `<div style="color:#ef4444;font-size:13px;text-align:center;padding:10px">${escHtml(err.message || '조회 실패')}</div>`;
  }
}

async function _execLevelUpShop(shop) {
  const lvl     = shop.level ?? 1;
  const lvlCost = lvl * lvl * 10000;
  if (!confirm(`🏪 ${escHtml(shop.name)} 레벨업\nLv.${lvl} → Lv.${lvl + 1}\n💰 ${lvlCost.toLocaleString()} 골드 차감\n진행하시겠습니까?`)) return;
  try {
    const res = await httpsCallable(functions, 'levelUpShop')({ shopId: shop.id });
    closeShopModal();
    await Promise.all([loadPlayerState({ force: true }), loadShops()]);
    showToast(`⬆️ 레벨업 완료! Lv.${res.data.newLevel} (Max HP ${res.data.newMaxHp.toLocaleString()})`, 'success');
  } catch (err) {
    showToast(err.message || '레벨업 실패', 'error');
  }
}

async function _execShopBuy(shopId, itemId, itemName, price, qty) {
  const pos = isVirtualMode() ? _ctx?.lastPos : _ctx?.gpsPos;
  if (!pos?.lat || !pos?.lng) {
    showToast(isVirtualMode()
      ? 'Move your character near the shop first (tap the map).'
      : _t('shop_gps_wait'), 'warn');
    return;
  }
  if (_shopCurrentData?.lat && _shopCurrentData?.lng) {
    const distM = haversine(pos.lat, pos.lng, _shopCurrentData.lat, _shopCurrentData.lng);
    if (distM > 1000) {
      showToast(isVirtualMode()
        ? `Your character is ${Math.round(distM / 100) / 10}km away. Walk closer to buy.`
        : _t('shop_too_far', Math.round(distM / 100) / 10), 'warn');
      return;
    }
  }
  const total = price * qty;
  if (!confirm(_t('shop_buy_confirm', qty, total.toLocaleString()))) return;
  try {
    await httpsCallable(functions, 'buyShopItem')({
      shopId, itemId, quantity: qty,
    });
    closeShopModal();
    await Promise.all([loadInventory({ force: true }), loadPlayerState({ force: true }), loadShops()]);
    showToast(_t('shop_buy_ok', itemName), 'success');
  } catch (err) {
    showToast(_t('shop_buy_fail', err.message), 'error');
  }
}

// ── 상점 관리자 모달 ──────────────────────────────────────────────────────────
function openShopAdminModal(shop) {
  const modal = $('shopAdminModal');
  if (!modal) return;

  $('shopAdminModalTitle').textContent = `${_t('shop_admin_title')}: ${shop.name}`;
  $('shopAdminShopId').value   = shop.id;
  $('shopAdminShopName').value = shop.name;
  $('shopAdminShopType').value = shop.type;

  _renderShopAdminItems(shop.items || []);
  modal.classList.add('open');
}

// 코드에 하드코딩된 아이템 (treasure_items 컬렉션에 없을 수 있는 것들)
const KNOWN_ITEMS = {
  potion_red:    { name: '빨간 약 (HP +100)', type: 'potion' },
  potion_mp:     { name: '마나 물약 (MP 전체회복)', type: 'potion' },
  revive_ticket: { name: '부활 티켓', type: 'misc' },
};

function _getShopAdminType() {
  return $('shopAdminShopType')?.value || 'misc';
}

function _buildItemCatalog() {
  const catalog = {};
  // treasure_items 컬렉션에서 로드된 아이템
  for (const [id, data] of Object.entries(_items)) {
    catalog[id] = { name: data.name || id, type: data.type || 'misc' };
  }
  // 코드 하드코딩 아이템 (없으면 추가)
  for (const [id, data] of Object.entries(KNOWN_ITEMS)) {
    if (!catalog[id]) catalog[id] = data;
  }
  return catalog;
}

function _buildItemSelectOptions(currentItemId, shopType) {
  const catalog = _buildItemCatalog();
  const PREFIX_MAP = { potion: ['potion_', 'revive_'], weapon_armor: ['weapon_', 'armo_', 'helm_', 'legs_', 'glov_', 'boot_', 'sword_', 'bow_', 'shield_', 'armor_'], misc: [] };
  const prefixes = PREFIX_MAP[shopType] || [];

  const filtered = Object.entries(catalog).filter(([id]) => {
    if (!prefixes.length) return true;
    return prefixes.some(p => id.startsWith(p));
  });

  const options = filtered.map(([id, data]) => {
    const sel = id === currentItemId ? ' selected' : '';
    return `<option value="${escHtml(id)}"${sel}>${escHtml(data.name)} (${escHtml(id)})</option>`;
  });

  const noSel = currentItemId ? '' : ' selected';
  return `<option value=""${noSel}>-- 아이템 선택 --</option>` + options.join('');
}

function _makeItemRow(it, idx) {
  const shopType = _getShopAdminType();
  const s = 'background:#1a1a1a;color:#e5e7eb;border:1px solid #374151;border-radius:4px;padding:4px 6px;font-size:12px;width:100%;box-sizing:border-box';
  const div = document.createElement('div');
  div.className = 'shop-admin-item-row';
  div.dataset.idx = idx;
  div.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 72px 68px 32px;gap:4px;margin-bottom:6px;align-items:center';
  div.innerHTML = `
    <select class="sad-itemid" style="${s}">
      ${_buildItemSelectOptions(it?.itemId || '', shopType)}
    </select>
    <input type="text"   class="sad-name"  value="${escHtml(it?.name || '')}"  placeholder="표시 이름" style="${s}">
    <input type="number" class="sad-price" value="${it?.price ?? 100}"         placeholder="100"        style="${s}" min="0">
    <input type="number" class="sad-stock" value="${it?.stock ?? -1}"          placeholder="-1=무한"    style="${s}" min="-1">
    <button onclick="this.closest('.shop-admin-item-row').remove()" style="background:#ef4444;color:white;border:none;border-radius:4px;padding:4px 6px;cursor:pointer;font-size:13px">✕</button>`;

  const sel  = div.querySelector('.sad-itemid');
  const nameInput = div.querySelector('.sad-name');

  // KNOWN_ITEMS has canonical names — always override stored names for these items
  if (it?.itemId && KNOWN_ITEMS[it.itemId]) {
    nameInput.value = KNOWN_ITEMS[it.itemId].name;
  }

  sel.addEventListener('change', () => {
    const id = sel.value;
    if (!id) return;
    const catalog = _buildItemCatalog();
    if (catalog[id] && !nameInput.value) nameInput.value = catalog[id].name;
    else if (catalog[id] && nameInput.value === nameInput.dataset.prev) nameInput.value = catalog[id].name;
    nameInput.dataset.prev = nameInput.value;
  });
  return div;
}

function _renderShopAdminItems(items) {
  const container = $('shopAdminItemList');
  if (!container) return;
  container.innerHTML = '';
  items.forEach((it, i) => container.appendChild(_makeItemRow(it, i)));
}

function _collectShopAdminItems() {
  const rows = $('shopAdminItemList')?.querySelectorAll('.shop-admin-item-row') || [];
  const items = [];
  for (const row of rows) {
    const itemId = row.querySelector('.sad-itemid')?.value?.trim();
    const name   = row.querySelector('.sad-name')?.value?.trim();
    const price  = Number(row.querySelector('.sad-price')?.value);
    const stock  = Number(row.querySelector('.sad-stock')?.value ?? -1);
    if (!itemId || !name || isNaN(price)) continue;
    items.push({ itemId, name, price, stock });
  }
  return items;
}

$('btnShopAdminAddItem')?.addEventListener?.('click', () => {
  const container = $('shopAdminItemList');
  if (!container) return;
  const idx = container.querySelectorAll('.shop-admin-item-row').length;
  container.appendChild(_makeItemRow(null, idx));
});

$('btnShopAdminSave')?.addEventListener?.('click', async () => {
  const shopId   = $('shopAdminShopId')?.value;
  const name     = $('shopAdminShopName')?.value?.trim();
  const type     = $('shopAdminShopType')?.value;
  const items    = _collectShopAdminItems();
  if (!name) { alert('Please enter a shop name.'); return; }

  // 5km 반경 내 동일 카테고리 중복 검사
  const shopData = getShops().find(s => s.id === shopId);
  const lat = shopData?.lat, lng = shopData?.lng;
  if (lat && lng) {
    const conflict = getShops().find(s =>
      s.id !== shopId && s.type === type &&
      haversine(lat, lng, s.lat, s.lng) <= 5000
    );
    if (conflict) {
      alert(
        `⛔ Cannot place this shop here.\n\n` +
        `A "${type}" shop already exists within 5km:\n"${conflict.name}"\n\n` +
        `Only one shop per category is allowed within a 5km radius.`
      );
      return;
    }
  }

  try {
    await httpsCallable(functions, 'adminSaveShop')({ shopId, name, type, items, lat, lng });
    await loadShops();
    $('shopAdminModal')?.classList.remove('open');
    showToast(_t('shop_admin_saved'), 'success');
  } catch (err) { alert('Save failed: ' + err.message); }
});

$('btnShopAdminDelete')?.addEventListener?.('click', async () => {
  const shopId = $('shopAdminShopId')?.value;
  if (!shopId) return;
  if (!confirm('상점을 삭제하시겠습니까?')) return;
  try {
    await deleteShop(shopId);
    $('shopAdminModal')?.classList.remove('open');
    showToast(_t('shop_admin_deleted'), 'success');
  } catch (err) { alert('삭제 실패: ' + err.message); }
});

$('btnCloseShopModal')?.addEventListener?.('click', closeShopModal);
$('shopModal')?.addEventListener?.('click', e => { if (e.target === $('shopModal')) closeShopModal(); });
$('btnCloseShopAdminModal')?.addEventListener?.('click', () => $('shopAdminModal')?.classList.remove('open'));
$('shopAdminModal')?.addEventListener?.('click', e => { if (e.target === $('shopAdminModal')) $('shopAdminModal').classList.remove('open'); });
$('shopAdminShopType')?.addEventListener?.('change', () => {
  const container = $('shopAdminItemList');
  if (!container) return;
  container.querySelectorAll('.shop-admin-item-row .sad-itemid').forEach(sel => {
    const cur = sel.value;
    sel.innerHTML = _buildItemSelectOptions(cur, _getShopAdminType());
  });
});

function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = 'game-toast';
  el.textContent = msg;
  el.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    padding:10px 18px;border-radius:8px;font-size:13px;z-index:9999;
    background:${type === 'success' ? '#16a34a' : type === 'error' ? '#dc2626' : '#1e40af'};color:white;
    box-shadow:0 4px 12px rgba(0,0,0,.4);pointer-events:none;`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── 트레져헌터 랭킹 ────────────────────────────────────────────────────────────
let _hunterRankTab = 'monsters'; // 'monsters' | 'treasures'
let _hunterRankCache = { monsters: null, treasures: null };
const _RANK_TTL = 5 * 60 * 1000; // 5분 로컬캐시

function _rankLoad(tab) {
  try {
    const raw = localStorage.getItem(`hunterRank_${tab}`);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    return Date.now() - ts < _RANK_TTL ? data : null;
  } catch { return null; }
}
function _rankSave(tab, rows) {
  try { localStorage.setItem(`hunterRank_${tab}`, JSON.stringify({ data: rows, ts: Date.now() })); } catch { /* 무시 */ }
}

async function loadHunterRanking(tab) {
  const list = $('hunterRankList');
  if (!list) return;

  // 1) 메모리 캐시
  if (_hunterRankCache[tab]) { renderHunterRanking(_hunterRankCache[tab], tab); return; }

  // 2) localStorage 캐시 (5분 TTL)
  const cached = _rankLoad(tab);
  if (cached) { _hunterRankCache[tab] = cached; renderHunterRanking(cached, tab); return; }

  // 3) Firestore 요청
  list.innerHTML = '<div class="hunter-rank-loading">Loading...</div>';
  try {
    const field = tab === 'monsters' ? 'monstersKilled' : 'treasuresFound';
    const snap = await Promise.race([
      getDocs(query(collection(db, 'battle_players'), where(field, '>', 0), orderBy(field, 'desc'), limit(20))),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
    ]);
    const rows = [];
    snap.forEach(d => {
      const data = d.data();
      const val = data[field] || 0;
      rows.push({ uid: d.id, val, displayName: data.displayName || null, photoURL: data.photoURL || null, gsLevel: data.gsLevel || data.level || 1 });
    });
    _hunterRankCache[tab] = rows;
    _rankSave(tab, rows);
    renderHunterRanking(rows, tab);
  } catch {
    list.innerHTML = '<div class="hunter-rank-empty">Failed to load ranking.</div>';
  }
}

function renderHunterRanking(rows, tab) {
  const list = $('hunterRankList');
  if (!list) return;
  if (!rows.length) {
    list.innerHTML = '<div class="hunter-rank-empty">No data yet. Be the first!</div>';
    return;
  }
  const myUid = _uid;
  const label = tab === 'monsters' ? 'kills' : 'found';
  const medalClass = ['gold', 'silver', 'bronze'];
  list.innerHTML = rows.map((r, i) => {
    const rank = i + 1;
    const numCls = medalClass[i] || '';
    const isSelf = r.uid === myUid;
    const name = escHtml(r.displayName || r.uid.slice(0, 8) + '…');
    const avatar = r.photoURL
      ? `<img src="${escHtml(r.photoURL)}" alt="" loading="lazy">`
      : (name[0] || '?').toUpperCase();
    return `<div class="hunter-rank-row${isSelf ? ' me' : ''}">
      <div class="hunter-rank-num ${numCls}">${rank}</div>
      <div class="hunter-rank-avatar">${r.photoURL ? `<img src="${escHtml(r.photoURL)}" alt="" loading="lazy">` : (escHtml(r.displayName || '?')[0] || '?')}</div>
      <div class="hunter-rank-name">Lv.${r.gsLevel} ${name}</div>
      <div>
        <div class="hunter-rank-score">${r.val.toLocaleString()}</div>
        <div class="hunter-rank-sub">${label}</div>
      </div>
    </div>`;
  }).join('');
}

// ── 사용자 보물 NPC 시스템 ─────────────────────────────────────────────────────

async function loadUserTreasureNpcs() {
  try {
    const { data } = await httpsCallable(functions, 'listUserTreasureNpcs')();
    const npcs = Array.isArray(data) ? data : [];
    // 기존 마커 제거
    Object.values(_utNpcMarkers).forEach(m => m.setMap(null));
    Object.values(_utActualMarkers).forEach(({ marker, line }) => { marker.setMap(null); line?.setMap(null); });
    _utNpcMarkers    = {};
    _utActualMarkers = {};
    _utNpcData = npcs;
    _updateTreasureOnMapCount(); // 유저 숨김 보물 포함해서 재집계
    // 실제 위치 마커 (관리자/소유자 전용 — 항상 표시)
    npcs.forEach(npc => {
      if (npc.treasureLat != null) _utActualMarkers[npc.id] = _makeActualTreasureMarker(npc);
    });
    // NPC 마커: 관리자는 전체 즉시 표시, 일반은 GPS 200m 이내만
    if (_isAdmin) {
      _checkUserNpcProximity(0, 0);
    } else {
      const pos = _ctx.gpsPos || _ctx.lastPos;
      if (pos) _checkUserNpcProximity(pos.lat, pos.lng);
    }
  } catch (_e) { /* silent */ }
}

// 200m 이내 NPC 마커 표시 / 250m 초과 시 숨김 (히스테리시스) — 관리자는 전체 표시
function _checkUserNpcProximity(lat, lng) {
  for (const npc of _utNpcData) {
    if (_isAdmin) {
      if (!_utNpcMarkers[npc.id]) _utNpcMarkers[npc.id] = _makeUserNpcMarker(npc);
      continue;
    }
    const d = haversine(lat, lng, npc.lat, npc.lng);
    if (d <= 200 && !_utNpcMarkers[npc.id]) {
      _utNpcMarkers[npc.id] = _makeUserNpcMarker(npc);
    } else if (d > 250 && _utNpcMarkers[npc.id]) {
      _utNpcMarkers[npc.id].setMap(null);
      delete _utNpcMarkers[npc.id];
    }
  }
}

function _circularIcon(src, size) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d');
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, 0, 0, size, size);
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
      ctx.stroke();
      resolve(c.toDataURL());
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

function _makeUserNpcMarker(npc) {
  const imgUrl = npc.npcImageUrl || `/assets/images/npc/npc${npc.npcImageNum || 1}.png`;
  const titleBase = (npc.ownerName || '?') + '의 보물';
  const title = _isAdmin
    ? `[ADMIN] ${titleBase} | ${npc.lat?.toFixed(6)}, ${npc.lng?.toFixed(6)}`
    : titleBase;
  const SZ = 64;
  const marker = new google.maps.Marker({
    position: { lat: npc.lat, lng: npc.lng },
    map: _ctx.map,
    title,
    icon: {
      url: imgUrl,
      scaledSize: new google.maps.Size(SZ, SZ),
      anchor: new google.maps.Point(SZ / 2, SZ / 2),
    },
    zIndex: 50,
  });
  marker.addListener('click', () => showUserNpcInfo(npc));
  _circularIcon(imgUrl, SZ).then(dataUrl => {
    marker.setIcon({
      url: dataUrl,
      scaledSize: new google.maps.Size(SZ, SZ),
      anchor: new google.maps.Point(SZ / 2, SZ / 2),
    });
  });
  return marker;
}

function _makeActualTreasureMarker(npc) {
  const label = npc.ownerName ? `📍 ${npc.ownerName}의 실제 보물` : '📍 실제 보물 위치';
  // 별 모양 마커
  const marker = new google.maps.Marker({
    position: { lat: npc.treasureLat, lng: npc.treasureLng },
    map: _ctx.map,
    title: label,
    label: { text: '★', color: '#facc15', fontSize: '18px', fontWeight: 'bold' },
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 13,
      fillColor: '#78350f',
      fillOpacity: 0.9,
      strokeColor: '#facc15',
      strokeWeight: 2.5,
    },
    zIndex: 65,
  });
  // NPC 위치(미끼) → 실제 위치 점선
  const line = new google.maps.Polyline({
    path: [
      { lat: npc.lat, lng: npc.lng },
      { lat: npc.treasureLat, lng: npc.treasureLng },
    ],
    map: _ctx.map,
    strokeColor: '#facc15',
    strokeOpacity: 0,
    strokeWeight: 2,
    icons: [{
      icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 },
      offset: '0',
      repeat: '12px',
    }],
    zIndex: 55,
  });
  const iw = new google.maps.InfoWindow({ content: `<div style="font-size:12px;padding:4px 6px">${label}</div>` });
  marker.addListener('click', () => iw.open(_ctx.map, marker));
  return { marker, line };
}

function showUserNpcInfo(npc) {
  _utCurrentNpc = npc;
  _hintUnlocked = false;
  const modal = document.getElementById('utNpcModal');
  if (!modal) return;
  const avatarEl = document.getElementById('utNpcAvatar');
  if (avatarEl) avatarEl.src = npc.npcImageUrl || `/assets/images/npc/npc${npc.npcImageNum || 1}.png`;
  const ownerEl = document.getElementById('utNpcOwner');
  if (ownerEl) ownerEl.textContent = npc.ownerName || '?';
  // 관리자용 좌표 정보
  let adminRow = document.getElementById('utNpcAdminInfo');
  if (_isAdmin) {
    if (!adminRow) {
      adminRow = document.createElement('div');
      adminRow.id = 'utNpcAdminInfo';
      adminRow.style.cssText = 'font-size:0.75rem;background:#1e293b;color:#7dd3fc;border-radius:6px;padding:6px 10px;margin:6px 0;font-family:monospace;word-break:break-all;';
      ownerEl?.parentElement?.after(adminRow);
    }
    const dist = (_ctx.gpsPos || _ctx.lastPos)
      ? Math.round(haversine((_ctx.gpsPos || _ctx.lastPos).lat, (_ctx.gpsPos || _ctx.lastPos).lng, npc.lat, npc.lng)) + 'm'
      : '거리 불명';
    adminRow.textContent = `📍 ${npc.lat?.toFixed(6)}, ${npc.lng?.toFixed(6)} | 현위치 ${dist} | id: ${npc.id}`;
    adminRow.classList.remove('hidden');
  } else if (adminRow) {
    adminRow.classList.add('hidden');
  }
  const storyEl = document.getElementById('utNpcStory');
  if (storyEl) storyEl.textContent = npc.story || '';
  const commentEl = document.getElementById('utNpcComment');
  if (commentEl) commentEl.textContent = npc.comment || '';
  const storyWrap = document.getElementById('utNpcStoryWrap');
  const commentWrap = document.getElementById('utNpcCommentWrap');
  if (storyWrap) storyWrap.classList.toggle('hidden', !npc.story);
  if (commentWrap) commentWrap.classList.toggle('hidden', !npc.comment);
  const rewardTypeEl = document.getElementById('utNpcRewardType');
  if (rewardTypeEl) rewardTypeEl.textContent = npc.type === 'item' ? '아이템' : '코인';
  const rewardValEl = document.getElementById('utNpcRewardVal');
  if (rewardValEl) rewardValEl.textContent = npc.type === 'item' ? `×${npc.itemCount}` : `${npc.itemCount}`;
  const radiusEl = document.getElementById('utNpcRadius');
  if (radiusEl) radiusEl.textContent = `발견 반경: ${npc.radiusM}m`;
  // 자기 보물이면 발견하기 버튼 숨김
  const discoverBtn = document.getElementById('btnDiscoverTreasure');
  if (discoverBtn) discoverBtn.classList.toggle('hidden', npc.ownerId === _uid);
  // 힌트: 초기에는 흐림 처리, 버튼 숨김
  const hintEl = document.getElementById('utNpcHint');
  const unlockBtn = document.getElementById('btnUnlockHint');
  if (hintEl) { hintEl.textContent = npc.hint || ''; hintEl.classList.add('hint-locked'); }
  if (unlockBtn) { unlockBtn.classList.remove('visible'); unlockBtn.disabled = false; unlockBtn.textContent = '🔓 힌트 잠금 해제 (10 Coin)'; }
  _utNpcMsg('');
  modal.classList.add('open');
  // 잠금 해제 여부 비동기 확인 (자기 보물이면 즉시 해제)
  if (npc.ownerId === _uid) {
    _applyHintUnlocked();
  } else {
    _checkHintUnlockStatus(npc.id);
  }
  loadNpcComments(npc.id);
}

function _utNpcMsg(text, isErr) {
  const el = document.getElementById('utNpcMsg');
  if (!el) return;
  el.textContent = text;
  el.style.color = isErr ? '#f87171' : '#6ee7b7';
}

async function _checkHintUnlockStatus(npcId) {
  const unlockBtn = document.getElementById('btnUnlockHint');
  if (!_uid) {
    if (unlockBtn) unlockBtn.classList.remove('visible');
    return;
  }
  try {
    const { data } = await httpsCallable(functions, 'checkHintUnlock')({ npcId });
    if (data.unlocked) {
      _applyHintUnlocked();
    } else {
      if (unlockBtn) unlockBtn.classList.add('visible');
    }
  } catch (_e) {
    if (unlockBtn) unlockBtn.classList.add('visible');
  }
}

function _applyHintUnlocked() {
  _hintUnlocked = true;
  const hintEl = document.getElementById('utNpcHint');
  if (hintEl) hintEl.classList.remove('hint-locked');
  const unlockBtn = document.getElementById('btnUnlockHint');
  if (unlockBtn) unlockBtn.classList.remove('visible');
}

async function unlockHintAction() {
  const npc = _utCurrentNpc;
  if (!npc) return;
  if (!_uid) { _utNpcMsg('로그인이 필요합니다.', true); return; }
  const btn = document.getElementById('btnUnlockHint');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 처리 중...'; }
  try {
    await httpsCallable(functions, 'unlockHint')({ npcId: npc.id });
    _applyHintUnlocked();
    _utNpcMsg('힌트 잠금이 해제되었습니다! 🔓', false);
  } catch (e) {
    _utNpcMsg('⚠️ ' + (e.message || '잠금 해제 실패'), true);
    if (btn) { btn.disabled = false; btn.textContent = '🔓 힌트 잠금 해제 (10 Coin)'; }
  }
}

function _renderCommentText(text) {
  const escaped = escHtml(text);
  return escaped.replace(/(https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp))(?:\s|$)/gi,
    (_, url) => `<img class="comment-img" src="${url}" alt="이미지" onclick="openLightbox('${url}','')"> `);
}

async function discoverTreasure(npcId) {
  const pos = _ctx.lastPos;
  if (!pos) {
    _utNpcMsg('📡 GPS 위치를 확인 중입니다. 게임을 시작하세요.', true);
    return;
  }
  const btn = document.getElementById('btnDiscoverTreasure');
  const origTxt = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 확인 중...'; }
  _utNpcMsg('');
  try {
    const { data } = await httpsCallable(functions, 'discoverUserTreasure')(
      { npcId, userLat: pos.lat, userLng: pos.lng }
    );
    document.getElementById('utNpcModal').classList.remove('open');
    if (_utNpcMarkers[npcId]) {
      _utNpcMarkers[npcId].setMap(null);
      delete _utNpcMarkers[npcId];
    }
    _utNpcData = _utNpcData.filter(n => n.id !== npcId);
    const reward = data.type === 'item' ? `아이템 ×${data.itemCount}` : `${data.itemCount} 코인`;
    const toast = document.getElementById('collectToast');
    if (toast) {
      toast.innerHTML = `🎉 보물 발견!<br><small>${esc(data.ownerName)}님의 보물 · ${esc(reward)}</small>`;
      toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 4000);
    }
  } catch (e) {
    _utNpcMsg('⚠️ ' + (e.message || '보물 발견 실패'), true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origTxt; }
  }
}

// ── 댓글 시스템 ────────────────────────────────────────────────────────────────

async function loadNpcComments(npcId) {
  const listEl = document.getElementById('utNpcCommentList');
  if (!listEl) return;
  listEl.innerHTML = '<div class="ut-npc-comment-empty">로딩 중…</div>';
  try {
    const { data } = await httpsCallable(functions, 'listTreasureComments')({ npcId });
    const comments = Array.isArray(data) ? data : [];
    if (!comments.length) {
      listEl.innerHTML = '<div class="ut-npc-comment-empty">댓글이 없습니다. 첫 번째 댓글을 남겨보세요!</div>';
      return;
    }
    listEl.innerHTML = comments.map(c => {
      const canDel = (c.uid === _uid || _isAdmin) && _uid;
      const dateStr = c.createdAt ? new Date(c.createdAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      return `<div class="ut-npc-comment-item" data-cid="${c.id}">
        <div class="ut-npc-comment-author">${escHtml(c.displayName || '익명')} <span style="color:#6b7280;font-weight:400">${dateStr}</span></div>
        <div class="ut-npc-comment-text">${_renderCommentText(c.text)}</div>
        ${canDel ? `<button class="ut-npc-comment-del" data-cid="${c.id}" title="삭제">✕</button>` : ''}
      </div>`;
    }).join('');
    listEl.querySelectorAll('.ut-npc-comment-del').forEach(btn => {
      btn.addEventListener('click', () => deleteNpcComment(npcId, btn.dataset.cid));
    });
  } catch (e) {
    listEl.innerHTML = `<div class="ut-npc-comment-empty" style="color:#f87171">댓글 로드 실패</div>`;
  }
}

async function submitNpcComment() {
  const npc = _utCurrentNpc;
  if (!npc) return;
  if (!_uid) { _utNpcMsg('댓글을 달려면 로그인하세요.', true); return; }
  if (!_hintUnlocked && npc.ownerId !== _uid) {
    _utNpcMsg('댓글을 달려면 먼저 힌트를 잠금 해제하세요. (10 Coin)', true);
    return;
  }
  const input = document.getElementById('utNpcCommentInput');
  const text = input?.value?.trim();
  if (!text) return;
  const btn = document.getElementById('btnUtNpcCommentSubmit');
  if (btn) btn.disabled = true;
  try {
    await httpsCallable(functions, 'addTreasureComment')({ npcId: npc.id, text });
    if (input) input.value = '';
    loadNpcComments(npc.id);
  } catch (e) {
    _utNpcMsg('⚠️ ' + (e.message || '댓글 전송 실패'), true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteNpcComment(npcId, commentId) {
  try {
    await httpsCallable(functions, 'deleteTreasureComment')({ npcId, commentId });
    loadNpcComments(npcId);
  } catch (e) {
    _utNpcMsg('⚠️ ' + (e.message || '삭제 실패'), true);
  }
}

// ── 보물 등록 ──────────────────────────────────────────────────────────────────

// 지도 클릭으로 선택된 보물 위치
let _utPickedLat = null, _utPickedLng = null;
let _utPickMarker = null, _utPickListener = null;

function _utSetPickedCoords(lat, lng) {
  _utPickedLat = lat;
  _utPickedLng = lng;
  const hidden = document.getElementById('utRegCoords');
  const text   = document.getElementById('utRegCoordsText');
  if (hidden) hidden.value = `${lat}, ${lng}`;
  if (text)   text.textContent = `📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  if (text)   text.style.color = '#059669';
}

function _utStartMapPick() {
  // 모달 닫고 지도 클릭 모드 진입
  document.getElementById('utRegModal')?.classList.remove('open');

  const banner = document.getElementById('userPlaceBanner');
  const cancelBtn = document.getElementById('btnUserPlaceCancelMode');
  if (banner) { banner.textContent = '📍 보물을 숨길 위치를 지도에서 클릭하세요'; banner.style.display = 'block'; }
  if (cancelBtn) cancelBtn.style.display = 'inline-block';

  // 기존 마커 제거
  if (_utPickMarker) { _utPickMarker.setMap(null); _utPickMarker = null; }
  if (_utPickListener) { google.maps.event.removeListener(_utPickListener); _utPickListener = null; }

  _utPickListener = map.addListener('click', e => {
    const lat = e.latLng.lat(), lng = e.latLng.lng();

    // 선택 마커 표시
    if (_utPickMarker) _utPickMarker.setMap(null);
    _utPickMarker = new google.maps.Marker({
      position: { lat, lng }, map,
      icon: { url: '/assets/images/item/box.png', scaledSize: new google.maps.Size(32, 32), anchor: new google.maps.Point(16, 16) },
      title: '보물 위치', zIndex: 99,
    });

    // 리스너 정리 & 배너 숨김
    google.maps.event.removeListener(_utPickListener); _utPickListener = null;
    if (banner) banner.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';

    // 좌표 저장 후 모달 재오픈
    _utSetPickedCoords(lat, lng);
    openRegisterTreasureModal(true); // skipPickReset=true
  });

  // 취소 버튼 공유 (user-place와 동일 버튼 재사용)
  const cancelHandler = () => {
    if (_utPickListener) { google.maps.event.removeListener(_utPickListener); _utPickListener = null; }
    if (banner) banner.style.display = 'none';
    if (cancelBtn) { cancelBtn.style.display = 'none'; cancelBtn.removeEventListener('click', cancelHandler); }
    openRegisterTreasureModal(true);
  };
  cancelBtn?.addEventListener('click', cancelHandler, { once: true });
}

function openRegisterTreasureModal(skipPickReset = false) {
  const modal = document.getElementById('utRegModal');
  if (!modal) return;

  // 아이템 목록
  const sel = document.getElementById('utRegItemSel');
  if (sel) {
    sel.innerHTML = '<option value="">-- 아이템 선택 --</option>';
    Object.entries(_inventory)
      .filter(([, cnt]) => cnt > 0)
      .forEach(([itemId, cnt]) => {
        const opt = document.createElement('option');
        opt.value = itemId;
        opt.textContent = `${itemId} (보유: ${cnt})`;
        sel.appendChild(opt);
      });
  }

  // 좌표: 이미 선택된 게 없고 GPS 있으면 자동 세팅
  if (!skipPickReset && !_utPickedLat && _ctx.lastPos) {
    _utSetPickedCoords(_ctx.lastPos.lat, _ctx.lastPos.lng);
  }

  modal.classList.add('open');
}

function _utRegMsg(text, isErr) {
  const el = document.getElementById('utRegMsg');
  if (!el) return;
  el.textContent = text;
  el.style.color = isErr ? '#f87171' : '#6ee7b7';
}

async function registerTreasure() {
  const activeTypeBtn = document.querySelector('.ut-reg-type-btn.active');
  const type    = activeTypeBtn?.dataset.type || 'item';
  const itemId  = document.getElementById('utRegItemSel')?.value || null;
  const count   = parseInt(document.getElementById('utRegCount')?.value || '1', 10);
  const radiusM = parseInt(document.getElementById('utRegRadius')?.value || '5', 10);
  const hint    = document.getElementById('utRegHint')?.value?.trim();
  const story   = document.getElementById('utRegStory')?.value?.trim();
  const comment = document.getElementById('utRegComment')?.value?.trim();
  const lat = _utPickedLat, lng = _utPickedLng;
  if (!lat || !lng) { _utRegMsg('지도에서 보물 위치를 먼저 선택하세요.', true); return; }
  if (!hint || hint.length < 5) { _utRegMsg('힌트는 5자 이상 입력하세요.', true); return; }
  if (type === 'item' && !itemId) { _utRegMsg('아이템을 선택하세요.', true); return; }
  const btn = document.getElementById('btnUtRegSubmit');
  if (btn) btn.disabled = true;
  _utRegMsg('등록 중…');
  try {
    await httpsCallable(functions, 'registerUserTreasure')(
      { type, itemId, itemCount: count, lat, lng, hint, story, comment, radiusM }
    );
    document.getElementById('utRegModal').classList.remove('open');
    // 선택 마커·상태 초기화
    if (_utPickMarker) { _utPickMarker.setMap(null); _utPickMarker = null; }
    _utPickedLat = null; _utPickedLng = null;
    const coordsText = document.getElementById('utRegCoordsText');
    if (coordsText) { coordsText.textContent = '위치 미선택'; coordsText.style.color = ''; }
    const toast = document.getElementById('collectToast');
    if (toast) {
      toast.innerHTML = '✅ 보물이 숨겨졌습니다! NPC가 근처에 자동 생성됩니다.';
      toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 3500);
    }
    loadUserTreasureNpcs();
    loadPlayerState().then(() => renderInventory());
  } catch (e) {
    _utRegMsg('⚠️ ' + (e.message || '등록 실패'), true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function openMyTreasuresModal() {
  const modal  = document.getElementById('utMyModal');
  if (!modal) return;
  const listEl = document.getElementById('utMyList');
  if (listEl) listEl.innerHTML = '<p style="color:#aaa">불러오는 중...</p>';
  modal.classList.add('open');
  try {
    const { data } = await httpsCallable(functions, 'getMyUserTreasures')();
    const items = Array.isArray(data) ? data : [];
    if (!items.length) {
      listEl.innerHTML = '<p style="color:#aaa">숨긴 보물이 없습니다.</p>';
      return;
    }
    const statusLabel = { active: '활성', found: '발견됨', cancelled: '취소됨', expired: '만료' };
    listEl.innerHTML = items.map(t => {
      const reward = t.type === 'item' ? `아이템 ×${t.itemCount}` : `${t.itemCount} 코인`;
      const label  = statusLabel[t.status] || t.status;
      const hasCoords = t.lat != null && t.lng != null;
      return `<div class="ut-my-item">` +
        `<span class="ut-my-status ut-status-${t.status}">${label}</span>` +
        `<span>${reward}</span>` +
        (hasCoords
          ? `<button class="ut-my-locate" data-lat="${t.lat}" data-lng="${t.lng}" title="지도에서 보기">📍</button>` : '') +
        (t.status === 'active'
          ? `<button class="ut-my-cancel" data-id="${t.id}">취소</button>` : '') +
        `</div>`;
    }).join('');
    listEl.querySelectorAll('.ut-my-locate').forEach(btn => {
      btn.addEventListener('click', () => {
        const lat = parseFloat(btn.dataset.lat);
        const lng = parseFloat(btn.dataset.lng);
        if (!isNaN(lat) && !isNaN(lng) && _ctx.map) {
          modal.classList.remove('open');
          _ctx.map.panTo({ lat, lng });
          _ctx.map.setZoom(18);
        }
      });
    });
    listEl.querySelectorAll('.ut-my-cancel').forEach(btn => {
      btn.addEventListener('click', () => cancelTreasure(btn.dataset.id));
    });
  } catch (e) {
    if (listEl) listEl.innerHTML = `<p style="color:#f88">오류: ${e.message}</p>`;
  }
}

async function cancelTreasure(treasureId) {
  const listEl = document.getElementById('utMyList');
  if (!listEl) return;
  const prev = listEl.innerHTML;
  listEl.innerHTML = '<p style="color:#aaa;text-align:center;padding:12px">취소 중…</p>';
  try {
    await httpsCallable(functions, 'cancelUserTreasure')({ treasureId });
    openMyTreasuresModal();
    loadUserTreasureNpcs();
  } catch (e) {
    listEl.innerHTML = prev;
    listEl.insertAdjacentHTML('afterbegin', `<p style="color:#f87171;font-size:12px;padding:6px 0">⚠️ ${e.message || '취소 실패'}</p>`);
  }
}

function initHunterRanking() {
  const section = $('hunterRankSection');
  if (!section) return;

  section.querySelectorAll('.hunter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      section.querySelectorAll('.hunter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _hunterRankTab = btn.dataset.tab;
      loadHunterRanking(_hunterRankTab);
    });
  });

  // 섹션이 뷰포트에 들어올 때만 로드 (DOMContentLoaded 즉시 요청 방지)
  const observer = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    observer.disconnect();
    loadHunterRanking(_hunterRankTab);
  }, { threshold: 0.1 });
  observer.observe(section);
}

// 페이지 로드 시 랭킹 초기화
document.addEventListener('DOMContentLoaded', () => {
  initHunterRanking();

  // Phiếu đổi hàng 섹션 접기/펼치기
  const excSection = document.getElementById('excSection');
  const excToggleBtn = document.getElementById('excToggleBtn');
  const excGrid = document.getElementById('excGrid');
  if (excToggleBtn && excSection && excGrid) {
    excToggleBtn.addEventListener('click', () => {
      const isOpen = excSection.classList.toggle('open');
      excGrid.classList.toggle('hidden', !isOpen);
    });
  }

  // ── 사용자 보물 이벤트 ────────────────────────────────────────────────────────
  const utNpcModal = document.getElementById('utNpcModal');
  const utRegModal = document.getElementById('utRegModal');
  const utMyModal  = document.getElementById('utMyModal');

  document.getElementById('btnRegisterTreasure')
    ?.addEventListener('click', openMyTreasuresModal);
  document.getElementById('btnCloseUtNpc')
    ?.addEventListener('click', e => { e.stopPropagation(); utNpcModal?.classList.remove('open'); });
  document.getElementById('btnCloseUtReg')
    ?.addEventListener('click', e => { e.stopPropagation(); utRegModal?.classList.remove('open'); });
  document.getElementById('btnCloseUtMy')
    ?.addEventListener('click', e => { e.stopPropagation(); utMyModal?.classList.remove('open'); });
  utNpcModal?.addEventListener('click', e => { if (e.target === utNpcModal) utNpcModal.classList.remove('open'); });
  utRegModal?.addEventListener('click', e => { if (e.target === utRegModal) utRegModal.classList.remove('open'); });
  utMyModal?.addEventListener('click',  e => { if (e.target === utMyModal)  utMyModal.classList.remove('open'); });
  document.getElementById('btnDiscoverTreasure')
    ?.addEventListener('click', () => { if (_utCurrentNpc) discoverTreasure(_utCurrentNpc.id); });
  document.getElementById('btnUnlockHint')
    ?.addEventListener('click', unlockHintAction);
  document.getElementById('btnUtRegSubmit')
    ?.addEventListener('click', registerTreasure);
  document.getElementById('btnOpenUtReg')
    ?.addEventListener('click', () => {
      utMyModal?.classList.remove('open');
      openRegisterTreasureModal();
    });
  document.getElementById('btnUtRegPickMap')
    ?.addEventListener('click', _utStartMapPick);
  document.getElementById('btnUtRegGps')
    ?.addEventListener('click', () => {
      const pos = _ctx.gpsPos || _ctx.lastPos;
      if (!pos) { _utRegMsg('📡 GPS 신호 대기 중... 게임을 먼저 시작하세요.', true); return; }
      _utSetPickedCoords(pos.lat, pos.lng);
      _utRegMsg(`📍 현재 위치 적용됨`, false);
    });
  document.querySelectorAll('.ut-reg-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ut-reg-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('utRegItemWrap')
        ?.classList.toggle('hidden', btn.dataset.type !== 'item');
      // 코인 선택 시 기본 수량 100, 아이템 선택 시 1
      const countEl = document.getElementById('utRegCount');
      if (countEl) countEl.value = btn.dataset.type === 'coin' ? '100' : '1';
    });
  });

  document.getElementById('btnUtNpcCommentSubmit')
    ?.addEventListener('click', submitNpcComment);
  document.getElementById('utNpcCommentInput')
    ?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitNpcComment(); }
    });
});

// ── 첫 방문 Virtual Mode 안내 ─────────────────────────────────────────────
function _initVirtualModeGuide() {
  const KEY = 'jmp_vm_guide_v1';
  try { if (localStorage.getItem(KEY)) return; } catch { return; }

  // HUD가 Google Maps Custom Control로 렌더될 때까지 대기
  setTimeout(() => {
    const btn = document.getElementById('btnVirtualMode');
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    if (!rect.width) return;

    // 버튼 기준 오른쪽 정렬, 버튼 바로 위에 배치
    const right  = Math.max(4, window.innerWidth  - rect.right);
    const bottom = Math.max(4, window.innerHeight - rect.top + 12);

    const el = document.createElement('div');
    el.id = 'vmGuide';
    el.style.cssText = `position:fixed;z-index:10000;right:${right}px;bottom:${bottom}px;
      display:flex;flex-direction:column;align-items:flex-end;cursor:pointer;`;

    el.innerHTML = `
<style>
#vmGuide .vg-box {
  background:#0f172a; border:2px solid #7c3aed; border-radius:14px;
  padding:13px 15px; max-width:210px;
  box-shadow:0 6px 28px rgba(124,58,237,.55);
  font-size:12px; color:#e2e8f0; line-height:1.65;
}
#vmGuide .vg-title {
  color:#a78bfa; font-weight:800; font-size:13px;
  display:block; margin-bottom:5px;
}
#vmGuide .vg-close {
  float:right; font-size:11px; color:#475569;
  background:none; border:none; cursor:pointer; padding:0; margin-left:6px;
}
#vmGuide .vg-arrow {
  font-size:26px; text-align:right; padding-right:10px; line-height:1;
  animation: vgBounce .55s ease-in-out infinite alternate;
  margin-top:3px;
}
@keyframes vgBounce {
  from { transform:translateY(0); }
  to   { transform:translateY(9px); }
}
#btnVirtualMode.vg-glow {
  animation: vgPulse .9s ease-in-out infinite alternate;
}
@keyframes vgPulse {
  from { box-shadow:0 0 6px 2px rgba(124,58,237,.55); }
  to   { box-shadow:0 0 16px 7px rgba(124,58,237,.9); }
}
</style>
<div class="vg-box">
  <button class="vg-close" id="vmGuideClose">✕</button>
  <span class="vg-title">🌍 Tap here to Warp!</span>
  Turn off GPS, select a shop, and your
  character will teleport there.<br>
  Hunt monsters &amp; collect treasures
  within the <strong style="color:#a78bfa;">5km radius</strong>.
</div>
<div class="vg-arrow">👇</div>`;

    document.body.appendChild(el);
    btn.classList.add('vg-glow');

    function dismiss() {
      el.remove();
      btn.classList.remove('vg-glow');
      try { localStorage.setItem(KEY, '1'); } catch {}
    }

    el.addEventListener('click', dismiss);
    document.getElementById('vmGuideClose')?.addEventListener('click', e => {
      e.stopPropagation(); dismiss();
    });
    btn.addEventListener('click', dismiss, { once: true });
    setTimeout(dismiss, 15000); // 15초 후 자동 닫힘
  }, 1400);
}

init();
