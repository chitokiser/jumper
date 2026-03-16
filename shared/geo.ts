/**
 * shared/geo.ts
 * 거리 계산 유틸 — game-server / frontend 공통
 *
 * game-server: src/lib/geo.ts 와 동일 알고리즘
 * frontend:    merchants.js / merchants.battle.js의 haversine() 과 동일
 */

const R = 6371000; // 지구 반지름 (미터)

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * 두 좌표 사이의 직선 거리 (미터, Haversine 공식)
 */
export function haversineM(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 특정 좌표가 원형 존 안에 있는지 확인
 */
export function isInsideZone(
  lat: number, lng: number,
  centerLat: number, centerLng: number,
  radiusM: number,
): boolean {
  return haversineM(lat, lng, centerLat, centerLng) <= radiusM;
}
