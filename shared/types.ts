/**
 * shared/types.ts
 * game-server ↔ frontend 공통 인터페이스 (S2C 페이로드 기준)
 *
 * 실제 TypeScript 타입 시스템 공유가 어려운 환경(frontend=vanilla JS)에서
 * 문서 + 참조 용도로 사용
 */

import type { MonsterState, PlayerState } from './monsterState.js';
import type { ZoneId } from './zoneIds.js';

/** S2C: zone:snapshot 페이로드 */
export interface ZoneSnapshotPayload {
  zoneId:   ZoneId;
  monsters: MonsterInstancePayload[];
}

/** S2C: monster:update / monster:respawned 페이로드 */
export interface MonsterInstancePayload {
  monsterId:   string;
  zoneId:      string;
  type:        string;
  currentLat:  number;
  currentLng:  number;
  hp:          number;
  maxHp:       number;
  state:       MonsterState;
  targetUserId: string | null;
  respawnAt:   number | null;
}

/** S2C: player:hit 페이로드 */
export interface PlayerHitPayload {
  damage:    number;
  remainHp:  number;
  monsterId: string;
}

/** S2C: player:revived 페이로드 */
export interface PlayerRevivedPayload {
  hp: number;
}

/** S2C: drop:spawned 페이로드 */
export interface DropSpawnedPayload {
  dropId:  string;
  zoneId:  string;
  lat:     number;
  lng:     number;
  type:    string;
  amount:  number;
  expireAt: number;
}

/** C2S: player:join 페이로드 */
export interface PlayerJoinPayload {
  userId:   string;
  zoneId:   ZoneId;
  lat:      number;
  lng:      number;
  accuracy: number;
  level:    number;
}
