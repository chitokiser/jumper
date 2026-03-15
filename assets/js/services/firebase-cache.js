// /assets/js/services/firebase-cache.js
// 세션 내 Firestore 중복 읽기를 방지하는 TTL 캐시

const _cache = new Map();

/**
 * TTL 캐시로 감싼 Firestore fetcher
 * @param {string} key - 캐시 키
 * @param {() => Promise<any>} fetcher - 실제 fetch 함수
 * @param {number} ttlMs - 유효 시간 (기본 5분)
 */
export async function cached(key, fetcher, ttlMs = 300_000) {
  const entry = _cache.get(key);
  if (entry && Date.now() - entry.ts < ttlMs) return entry.data;
  const data = await fetcher();
  _cache.set(key, { data, ts: Date.now() });
  return data;
}

export function invalidate(key) { _cache.delete(key); }
export function invalidateAll() { _cache.clear(); }
