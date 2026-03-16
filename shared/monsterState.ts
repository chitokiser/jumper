/**
 * shared/monsterState.ts
 * 몬스터 상태 머신 enum 및 전환 규칙 문서
 *
 * 상태 전환 흐름:
 *   idle → chasing → attacking
 *   attacking → chasing (사거리 이탈)
 *   chasing → return (타겟 소실/어그로 범위 이탈)
 *   return → idle (스폰 지점 복귀 완료)
 *   any → dead (HP <= 0)
 *   dead → respawning (respawnAt 도달, 스탯 초기화)
 *   respawning → idle (nonCombatUntil 도달, 전투 재개)
 */

export const MONSTER_STATE = {
  IDLE:       'idle',
  CHASING:    'chasing',
  ATTACKING:  'attacking',
  RETURN:     'return',
  DEAD:       'dead',
  RESPAWNING: 'respawning',
} as const;

export type MonsterState = typeof MONSTER_STATE[keyof typeof MONSTER_STATE];

/**
 * 플레이어 상태
 *   alive → dead (HP <= 0)
 *   dead → alive (부활, HP 30% 복구)
 *   revive_wait: 부활 아이템 대기 (향후 Firebase 아이템 연동용)
 */
export const PLAYER_STATE = {
  ALIVE:       'alive',
  DEAD:        'dead',
  REVIVE_WAIT: 'revive_wait',
} as const;

export type PlayerState = typeof PLAYER_STATE[keyof typeof PLAYER_STATE];
