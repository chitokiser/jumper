// /assets/js/pages/merchants.monster-grid.js
// 공간 분할 그리드 — O(1) 셀 조회로 근접 몬스터만 처리
//
// CELL_DEG = 0.0009 ≈ 위도 기준 100m 크기의 셀
// nearby(lat, lng, cells=1) → 3×3 셀 (~300m) 내 살아있는 몬스터 배열 반환
// distSq(lat1,lng1,lat2,lng2) → Math.sqrt 없이 미터² 거리 반환

const CELL_DEG      = 0.0009;   // ≈ 100m / 셀
const M_PER_DEG_LAT = 111000;   // 위도 1도 ≈ 111km

export class MonsterGrid {
  constructor() {
    this._cells   = new Map(); // cellKey → Set<id>
    this._mobs    = new Map(); // id → mob object
    this._mobCell = new Map(); // id → cellKey  (O(1) 삭제용 캐시)
  }

  _key(lat, lng) {
    return `${Math.floor(lat / CELL_DEG)},${Math.floor(lng / CELL_DEG)}`;
  }

  /** 몬스터를 그리드에 등록 (hp>0인 몬스터만) */
  register(mob) {
    if (!mob?.lat || !mob?.lng || mob.hp <= 0) return;
    const key = this._key(mob.lat, mob.lng);
    if (!this._cells.has(key)) this._cells.set(key, new Set());
    this._cells.get(key).add(mob.id);
    this._mobs.set(mob.id, mob);
    this._mobCell.set(mob.id, key);
  }

  /** 몬스터 위치 변경 시 셀 재배치 */
  update(mob) {
    if (!mob?.lat || !mob?.lng) return;
    const oldKey = this._mobCell.get(mob.id);
    const newKey = this._key(mob.lat, mob.lng);
    if (oldKey === newKey) { this._mobs.set(mob.id, mob); return; }
    if (oldKey) {
      const s = this._cells.get(oldKey);
      if (s) { s.delete(mob.id); if (s.size === 0) this._cells.delete(oldKey); }
    }
    if (!this._cells.has(newKey)) this._cells.set(newKey, new Set());
    this._cells.get(newKey).add(mob.id);
    this._mobs.set(mob.id, mob);
    this._mobCell.set(mob.id, newKey);
  }

  /** 몬스터를 그리드에서 제거 (사망 시) */
  remove(id) {
    const key = this._mobCell.get(id);
    if (key) {
      const s = this._cells.get(key);
      if (s) { s.delete(id); if (s.size === 0) this._cells.delete(key); }
      this._mobCell.delete(id);
    }
    this._mobs.delete(id);
  }

  /** 전체 초기화 후 일괄 재등록 */
  rebuild(mobs) {
    this._cells.clear();
    this._mobs.clear();
    this._mobCell.clear();
    for (const mob of mobs) this.register(mob);
  }

  /**
   * 주변 셀 몬스터 조회 (hp>0 필터 포함)
   * @param {number} lat
   * @param {number} lng
   * @param {number} [cells=1]  1 = 3×3 셀(≈300m), 2 = 5×5(≈500m)
   * @returns {Array}
   */
  nearby(lat, lng, cells = 1) {
    const cx = Math.floor(lat / CELL_DEG);
    const cy = Math.floor(lng / CELL_DEG);
    const result = [];
    for (let dx = -cells; dx <= cells; dx++) {
      for (let dy = -cells; dy <= cells; dy++) {
        const set = this._cells.get(`${cx + dx},${cy + dy}`);
        if (!set) continue;
        for (const id of set) {
          const mob = this._mobs.get(id);
          if (mob && mob.hp > 0 && mob.lat && mob.lng) result.push(mob);
        }
      }
    }
    return result;
  }

  get size()      { return this._mobs.size; }
  get cellCount() { return this._cells.size; }

  /**
   * Math.sqrt 없이 미터 단위 거리² 계산
   * @returns {number} 거리² (m²)
   */
  static distSq(lat1, lng1, lat2, lng2) {
    const dx = (lat2 - lat1) * M_PER_DEG_LAT;
    const dy = (lng2 - lng1) * M_PER_DEG_LAT * Math.cos(lat1 * Math.PI / 180);
    return dx * dx + dy * dy;
  }
}
