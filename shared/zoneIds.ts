/**
 * shared/zoneIds.ts
 * 게임 존 ID 상수
 *
 * game-server / frontend 공통 참조
 * 새 존 추가 시 이 파일에 먼저 등록 후 defaultWorldData.ts 반영
 */

export const ZONE_IDS = {
  OCEAN_PARK_A: 'oceanpark-a',
  OCEAN_PARK_B: 'oceanpark-b',
  ECO_PARK_A:   'ecopark-a',
} as const;

export type ZoneId = typeof ZONE_IDS[keyof typeof ZONE_IDS];
