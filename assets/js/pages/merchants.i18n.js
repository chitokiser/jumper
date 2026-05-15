// assets/js/pages/merchants.i18n.js
// ko / vi 다국어 지원 — window.LANG 으로 언어 선택

'use strict';

const MESSAGES = {
  // ── 회원 배지 ────────────────────────────────────────────────────────────────
  badge_member:          { ko: '👑 정회원',       vi: '👑 Hội viên' },
  badge_general:         { ko: '일반회원',         vi: 'Thành viên thường' },
  badge_join_link:       { ko: '정회원 가입하기 →', vi: 'Đăng ký hội viên →' },

  // ── 장소 인포윈도우 ───────────────────────────────────────────────────────────
  place_area:            { ko: '구역',             vi: 'Khu vực' },
  gmap_link:             { ko: '구글 지도에서 보기 →', vi: 'Xem trên Google Maps →' },

  // ── 보물박스 인포윈도우 ───────────────────────────────────────────────────────
  box_default_name:      { ko: '보물박스',          vi: 'Hộp kho báu' },
  box_member_only:       { ko: '👑 정회원 전용',    vi: '👑 Chỉ hội viên' },
  box_admin_collect:     { ko: '🔑 관리자 수집',    vi: '🔑 Quản trị viên thu' },
  box_appears:           { ko: '등장',              vi: 'Xuất hiện' },
  box_active:            { ko: '✅ 활성',           vi: '✅ Hoạt động' },
  box_inactive:          { ko: '⏰ 비활성',         vi: '⏰ Không hoạt động' },
  // {0} = range m
  box_approach:          { ko: '{0}m 이내 접근 후 클릭하여 공격!', vi: 'Đến trong vòng {0}m rồi nhấn để tấn công!' },
  // {0} = dist m
  box_dist_prefix:       { ko: '거리 {0}m — ',     vi: 'Cách {0}m — ' },
  box_already_collected: { ko: '✓ 이미 수집됨',    vi: '✓ Đã thu thập' },

  // ── 전투 HUD ─────────────────────────────────────────────────────────────────
  // {0}=lv, {1}=gold, {2}=token
  hud_lv:                { ko: 'LV.{0}  💰{1}  💎마정석{2}', vi: 'LV.{0}  💰{1}  💎Đá phép{2}' },
  // {0} = m remaining
  hud_dead:              { ko: '💀 사망 — 부활까지 {0}m 남음', vi: '💀 Đã chết — còn {0}m để hồi sinh' },

  // ── 스킬 에러 메시지 ──────────────────────────────────────────────────────────
  skill_locating:        { ko: '📍 위치 확인 중...', vi: '📍 Đang xác định vị trí...' },
  skill_mp_low_lightning:{ ko: '⚡ MP 부족!',        vi: '⚡ MP không đủ!' },
  skill_mp_low_ice:      { ko: '❄ MP 부족!',         vi: '❄ MP không đủ!' },
  skill_mp_low_fire:     { ko: '🔥 MP 부족!',        vi: '🔥 MP không đủ!' },
  skill_no_target_lightning: { ko: '⚡ 범위 내 몬스터 없음', vi: '⚡ Không có quái trong tầm' },
  skill_no_target_ice:   { ko: '❄ 범위 내 몬스터 없음', vi: '❄ Không có quái trong tầm' },
  skill_no_target_fire:  { ko: '🔥 범위 내 몬스터 없음', vi: '🔥 Không có quái trong tầm' },

  // ── 스킬 플로팅 텍스트 ────────────────────────────────────────────────────────
  // {0} = count
  skill_lightning_hit:   { ko: '⚡ 벼락! ({0}마리)',  vi: '⚡ Sét đánh! ({0} quái)' },
  skill_freeze_single:   { ko: '❄ 동결!',             vi: '❄ Đóng băng!' },
  // {0} = count, {1} = sec
  skill_freeze_multi:    { ko: '❄ 동결! ({0}마리 / {1}초)', vi: '❄ Đóng băng! ({0} quái / {1}s)' },
  // {0} = count
  skill_fire_hit:        { ko: '🔥 화염! ({0}마리)',   vi: '🔥 Bão lửa! ({0} quái)' },

  // ── 스킬 대상 선택 모달 ───────────────────────────────────────────────────────
  skill_label_lightning: { ko: '⚡ 벼락',             vi: '⚡ Sét' },
  skill_label_ice:       { ko: '❄ 빙결',              vi: '❄ Đóng băng' },
  skill_label_fire:      { ko: '🔥 화염',             vi: '🔥 Lửa' },
  skill_label_default:   { ko: '스킬',                vi: 'Kỹ năng' },
  // {0} = skill label
  skill_modal_title:     { ko: '{0} — 공격 대상 선택', vi: '{0} — Chọn mục tiêu' },
  skill_modal_cancel:    { ko: '취소',                vi: 'Hủy' },

  // ── 부활 ──────────────────────────────────────────────────────────────────────
  revive_not_dead:       { ko: '사망 상태가 아닙니다',  vi: 'Bạn chưa chết' },
  revive_success:        { ko: '✨ 부활! HP·MP 50%',   vi: '✨ Hồi sinh! HP·MP 50%' },
  // {0} = error message
  revive_error:          { ko: '오류: {0}',            vi: 'Lỗi: {0}' },

  // ── 몬스터 마커 ───────────────────────────────────────────────────────────────
  monster_default:       { ko: '몬스터',               vi: 'Quái vật' },
  dragon_default:        { ko: '드래곤',               vi: 'Rồng' },
  admin_delete:          { ko: '🗑 삭제',              vi: '🗑 Xóa' },

  // ── 전투 이벤트 플로팅 ────────────────────────────────────────────────────────
  float_kill:            { ko: '💀 처치!',             vi: '💀 Tiêu diệt!' },
  float_player_dead:     { ko: '💀 사망했습니다',       vi: '💀 Bạn đã chết' },
  // {0} = count
  float_magic_stone:     { ko: '💎+{0} 마정석!',       vi: '💎+{0} Đá phép!' },
  // {0} = key name
  float_key_drop:        { ko: '🔑 열쇠 드랍! {0}',   vi: '🔑 Chìa khóa rơi! {0}' },

  // ── 타워 ──────────────────────────────────────────────────────────────────────
  tower_default:         { ko: '방어탑',               vi: 'Tháp phòng thủ' },
  tower_destroyed:       { ko: '🏚 타워 파괴!',        vi: '🏚 Tháp bị phá hủy!' },
  tower_respawn:         { ko: '🏰 타워 부활!',        vi: '🏰 Tháp hồi sinh!' },
  tower_click_to_attack: { ko: '계속 클릭하여 공격!',  vi: 'Nhấn liên tục để tấn công!' },
  // {0} = radius, {1} = damage
  tower_radius_dmg:      { ko: '반경 {0}m · 데미지 {1}', vi: 'Bán kính {0}m · Sát thương {1}' },
  tower_approach:        { ko: '공격 범위 안으로 접근 후 클릭하여 공격!', vi: 'Tiến vào phạm vi tấn công rồi nhấn để tấn công!' },

  // ── 사망 마커 ─────────────────────────────────────────────────────────────────
  death_marker_title:    { ko: '사망 지점',            vi: 'Điểm tử vong' },
  death_marker_label:    { ko: '💀 사망 지점',         vi: '💀 Điểm tử vong' },
  death_marker_hint:     { ko: '부활하면 마커가 사라집니다', vi: 'Marker sẽ biến mất khi hồi sinh' },

  // ── 플레이어 위치 마커 라벨 ───────────────────────────────────────────────────
  player_label_dead:     { ko: '사망',                 vi: 'Chết' },
  player_label_alive:    { ko: '나',                   vi: 'Tôi' },
};

/**
 * 번역 헬퍼
 * @param {string} key
 * @param {...string|number} args  — {0}, {1} 치환
 * @returns {string}
 */
export function _t(key, ...args) {
  const lang = (window.LANG || 'ko');
  const entry = MESSAGES[key];
  if (!entry) return key;
  let str = entry[lang] ?? entry.ko ?? key;
  args.forEach((v, i) => { str = str.replaceAll(`{${i}}`, v); });
  return str;
}
