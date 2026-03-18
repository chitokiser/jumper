// assets/js/pages/merchants.gameserver.js
// game-server WebSocket 클라이언트
//
// 의존: Socket.io CDN — merchants.html에 아래 태그 필요
//   <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
//
// ⚠️ GAME_SERVER_URL을 Railway 배포 URL로 교체하거나
//    페이지에서 window.GAME_SERVER_URL을 먼저 설정할 것

const GAME_SERVER_URL =
  window.GAME_SERVER_URL ?? 'https://jumper-game-server-production.up.railway.app';

// 존 설정 — defaultWorldData.ts와 좌표 동일하게 유지
const ZONE_CONFIGS = [
  { zoneId: 'oceanpark-a', centerLat: 20.9716, centerLng: 105.9366, radiusM: 500 },
  { zoneId: 'oceanpark-b', centerLat: 20.9650, centerLng: 105.9420, radiusM: 500 },
  { zoneId: 'ecopark-a',   centerLat: 20.9430, centerLng: 105.9748, radiusM: 600 },
];

function _dist(lat1, lng1, lat2, lng2) {
  const R = 6371000, r = d => d * Math.PI / 180;
  const a = Math.sin(r(lat2-lat1)/2)**2
    + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2-lng1)/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function _nearestZone(lat, lng) {
  let best = ZONE_CONFIGS[0], min = Infinity;
  for (const z of ZONE_CONFIGS) {
    const d = _dist(lat, lng, z.centerLat, z.centerLng);
    if (d < min) { min = d; best = z; }
  }
  return best.zoneId;
}

// GPS 없는 환경(PC)에서 사용할 fallback accuracy (m)
// isTrustworthy ≤100, isTargetable ≤30 모두 통과하도록 30 미만 사용
const PC_FALLBACK_ACCURACY = 10;

// ── 상태 ──────────────────────────────────────────────────────────────────────
let _socket        = null;
let _ctx           = null;
let _handlers      = null;
let _keepAliveTimer = null;
/** 'idle' | 'connecting' | 'connected' | 'error' */
let _state = 'idle';

// ── 초기화 ─────────────────────────────────────────────────────────────────────
/**
 * @param {object} ctx - merchants.js 공유 컨텍스트 (_uid, lastPos, playerLevel 포함)
 * @param {object} handlers - 이벤트 콜백 모음
 *   onStateChange(state)
 *   onError(msg)
 *   onZoneSnapshot(data)   — { zoneId, monsters[], drops[], serverTime }
 *   onMonsterUpdate(m)     — MonsterInstance
 *   onMonsterDied(data)    — { monsterId }
 *   onMonsterRespawned(m)  — MonsterInstance (state=respawning)
 *   onPlayerHit(data)      — { damage, remainHp, monsterId }
 *   onPlayerDied()
 *   onPlayerRevived(data)  — { hp }
 *   onDropSpawned(drop)    — DropInstance
 */
export function initGameServer(ctx, handlers) {
  _ctx      = ctx;
  _handlers = handlers;
}

export function getGameServerState() { return _state; }
export function isGameServerConnected() { return _state === 'connected'; }

// ── 연결 ───────────────────────────────────────────────────────────────────────
export function connectToGameServer() {
  if (_state === 'connecting' || _state === 'connected') return;

  const io = window.io;
  if (!io) {
    console.error('[GS] Socket.io 미로드 — CDN 태그 확인');
    _handlers?.onError?.('Socket.io 미로드');
    return;
  }

  _setState('connecting');

  _socket = io(GAME_SERVER_URL, {
    transports:          ['websocket', 'polling'],
    reconnectionAttempts: 3,
    reconnectionDelay:   2000,
    timeout:             10000,
  });

  _socket.on('connect', () => {
    _setState('connected');

    const pos    = _ctx?.lastPos;
    const lat    = pos?.lat    ?? 0;
    const lng    = pos?.lng    ?? 0;
    const zoneId = (lat && lng) ? _nearestZone(lat, lng) : ZONE_CONFIGS[0].zoneId;
    const level  = _ctx?.playerLevel ?? 1;

    const accuracy = pos?.accuracy != null && pos.accuracy < 999
      ? pos.accuracy
      : PC_FALLBACK_ACCURACY;

    _socket.emit('player:join', {
      userId: _ctx?.uid ?? 'anonymous',
      zoneId, lat, lng, accuracy, level,
    });

    // keep-alive: GPS 없는 PC에서 isStale(10s) 방지 — 5초마다 위치 재전송
    _keepAliveTimer = setInterval(() => {
      if (_state !== 'connected' || !_socket) return;
      const p = _ctx?.lastPos;
      const klat = p?.lat ?? lat;
      const klng = p?.lng ?? lng;
      const kacc = (p?.accuracy != null && p.accuracy < 999) ? p.accuracy : PC_FALLBACK_ACCURACY;
      _socket.emit('player:location', { lat: klat, lng: klng, accuracy: kacc });
    }, 5000);

    console.log(`[GS] connected → zone:${zoneId} level:${level} accuracy:${accuracy}`);
  });

  _socket.on('disconnect', reason => {
    _setState('idle');
    console.log('[GS] disconnected:', reason);
  });

  _socket.on('connect_error', err => {
    _setState('error');
    _handlers?.onError?.(err.message);
    console.error('[GS] connect_error:', err.message);
  });

  _socket.on('reconnect_failed', () => {
    _setState('error');
    _handlers?.onError?.('서버 연결 실패 (재시도 초과)');
  });

  // S2C 이벤트
  _socket.on('zone:snapshot',     d => _handlers?.onZoneSnapshot?.(d));
  _socket.on('monster:update',    d => _handlers?.onMonsterUpdate?.(d));
  _socket.on('monster:died',      d => _handlers?.onMonsterDied?.(d));
  _socket.on('monster:respawned', d => _handlers?.onMonsterRespawned?.(d));
  _socket.on('player:hit',        d => _handlers?.onPlayerHit?.(d));
  _socket.on('player:died',       () => _handlers?.onPlayerDied?.());
  _socket.on('player:revived',    d => _handlers?.onPlayerRevived?.(d));
  _socket.on('drop:spawned',      d => _handlers?.onDropSpawned?.(d));
  _socket.on('drop:removed',      d => _handlers?.onDropRemoved?.(d));
  _socket.on('drop:collected',    d => _handlers?.onDropCollected?.(d));
}

// ── 연결 해제 ──────────────────────────────────────────────────────────────────
export function disconnectFromGameServer() {
  if (_keepAliveTimer) { clearInterval(_keepAliveTimer); _keepAliveTimer = null; }
  if (!_socket) return;
  try {
    _socket.emit('player:leave');
    _socket.disconnect();
  } catch { /* 무시 */ }
  _socket = null;
  _setState('idle');
}

// ── C2S 전송 ───────────────────────────────────────────────────────────────────
export function sendPlayerLocation(lat, lng, accuracy) {
  if (_state !== 'connected' || !_socket) return;
  _socket.emit('player:location', { lat, lng, accuracy });
}

export function sendPlayerAttack(monsterId) {
  if (_state !== 'connected' || !_socket) return;
  _socket.emit('player:attack', { monsterId });
}

export function sendPlayerRevive() {
  if (_state !== 'connected' || !_socket) return;
  _socket.emit('player:revive');
}

export function sendPlayerSkill(skillId, monsterId) {
  if (_state !== 'connected' || !_socket) return;
  _socket.emit('player:skill', { skillId, monsterId });
}

export function sendDropCollect(dropId) {
  if (_state !== 'connected' || !_socket) return;
  _socket.emit('drop:collect', { dropId });
}

// ── 관리자 REST API ─────────────────────────────────────────────────────────────
// window.GS_ADMIN_SECRET 이 설정되어 있어야 한다 (merchants.html에서 주입)

async function _adminFetch(method, path, body) {
  const url  = GAME_SERVER_URL + path;
  const key  = window.GS_ADMIN_SECRET || '';
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  };
  let res;
  try {
    res = await fetch(url, opts);
  } catch (netErr) {
    // 네트워크 오류 (CORS 포함)
    console.error('[GS Admin] fetch 실패:', url, netErr);
    throw new Error(`네트워크 오류 — 게임서버 미배포 또는 CORS 차단\n(${netErr.message})`);
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { error: `HTTP ${res.status} — ${text.slice(0, 120)}` }; }
  if (!res.ok) {
    console.error('[GS Admin] 오류 응답:', res.status, json);
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  return json;
}

/** 전체 스폰 목록 + 실시간 인스턴스 현황 */
export const gsAdminGetSpawns = () =>
  _adminFetch('GET', '/admin/spawns');

/** 스폰 포인트 추가 → 게임서버가 즉시 인스턴스 생성 */
export const gsAdminAddSpawn = (spawn) =>
  _adminFetch('POST', '/admin/spawns', spawn);

/** 스폰 제거 + 모든 인스턴스 사망 broadcast */
export const gsAdminDeleteSpawn = (spawnId) =>
  _adminFetch('DELETE', `/admin/spawns/${encodeURIComponent(spawnId)}`);

/** 특정 인스턴스 강제 사망 (스폰은 유지 → 리스폰됨) */
export const gsAdminKillMonster = (monsterId) =>
  _adminFetch('POST', `/admin/monsters/${encodeURIComponent(monsterId)}/kill`);

// ── 내부 유틸 ──────────────────────────────────────────────────────────────────
function _setState(s) {
  _state = s;
  _handlers?.onStateChange?.(s);
}
