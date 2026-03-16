/**
 * shared/eventNames.ts
 * Socket.io 이벤트 이름 공통 정의
 *
 * 클라이언트 → 서버 (C2S)
 * 서버 → 클라이언트 (S2C)
 *
 * game-server: src/modules/gateway/eventNames.ts 와 동일하게 유지
 * frontend:    이 파일을 참조하거나 동일 상수 사용
 */

/** 클라이언트 → 서버 */
export const C2S = {
  /** 존 참가: { userId, zoneId, lat, lng, accuracy, level } */
  PLAYER_JOIN:     'player:join',
  /** 위치 업데이트: { lat, lng, accuracy } */
  PLAYER_LOCATION: 'player:location',
  /** 존 퇴장 */
  PLAYER_LEAVE:    'player:leave',
  /** 몬스터 공격: { monsterId } */
  PLAYER_ATTACK:   'player:attack',
  /** 스킬 사용: { skillId, monsterId? } */
  PLAYER_SKILL:    'player:skill',
  /** 부활 요청 (사망 후) */
  PLAYER_REVIVE:   'player:revive',
} as const;

/** 서버 → 클라이언트 */
export const S2C = {
  /** 존 전체 스냅샷 (접속 직후): { zoneId, monsters[] } */
  ZONE_SNAPSHOT:     'zone:snapshot',
  /** 몬스터 상태 변경 (단건): MonsterInstance */
  MONSTER_UPDATE:    'monster:update',
  /** 몬스터 사망: { monsterId } */
  MONSTER_DIED:      'monster:died',
  /** 몬스터 리스폰: MonsterInstance (state=respawning) */
  MONSTER_RESPAWNED: 'monster:respawned',
  /** 플레이어 피격: { damage, remainHp, monsterId } */
  PLAYER_HIT:        'player:hit',
  /** 플레이어 사망: {} */
  PLAYER_DIED:       'player:died',
  /** 플레이어 부활: { hp } */
  PLAYER_REVIVED:    'player:revived',
  /** 드랍 생성: DropInstance */
  DROP_SPAWNED:      'drop:spawned',
  /** 에러: { message } */
  ERROR:             'error',
} as const;
