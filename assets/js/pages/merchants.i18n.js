// assets/js/pages/merchants.i18n.js
// ko / en / vi 다국어 지원 — window.LANG 으로 언어 선택 (기본: en)

'use strict';

const MESSAGES = {
  // ── 회원 배지 ────────────────────────────────────────────────────────────────
  badge_member:          { en: '👑 Member',              ko: '👑 정회원',       vi: '👑 Hội viên' },
  badge_general:         { en: 'General Member',          ko: '일반회원',         vi: 'Thành viên thường' },
  badge_join_link:       { en: 'Join Premium →',          ko: '정회원 가입하기 →', vi: 'Đăng ký hội viên →' },

  // ── 장소 인포윈도우 ───────────────────────────────────────────────────────────
  place_area:            { en: 'Area',                    ko: '구역',             vi: 'Khu vực' },
  gmap_link:             { en: 'View on Google Maps →',   ko: '구글 지도에서 보기 →', vi: 'Xem trên Google Maps →' },
  npc_too_far:           { en: '💬 Get within 20m of the NPC (currently {0}m)',
                           ko: '💬 NPC에게 20m 이내로 접근하세요 (현재 {0}m)',
                           vi: '💬 Tiến đến trong 20m của NPC (hiện tại {0}m)' },
  no_map_label:          { en: 'No map',                  ko: '지도 미등록',       vi: 'Chưa có bản đồ' },
  no_name_label:         { en: '(No name)',               ko: '(이름없음)',         vi: '(Không tên)' },
  no_geolocation:        { en: 'This browser does not support location services.',
                           ko: '이 브라우저는 위치 서비스를 지원하지 않습니다.',
                           vi: 'Trình duyệt này không hỗ trợ dịch vụ vị trí.' },
  box_attack_title:      { en: '⚔️ {0} — Tap to attack! (HP {1}/{2})',
                           ko: '⚔️ {0} — 클릭하여 공격! (HP {1}/{2})',
                           vi: '⚔️ {0} — Nhấn để tấn công! (HP {1}/{2})' },
  hidden_box_title:      { en: '✨ {0} — Tap to attack! (HP {1}/{2})',
                           ko: '✨ {0} — 클릭하여 공격! (HP {1}/{2})',
                           vi: '✨ {0} — Nhấn để tấn công! (HP {1}/{2})' },
  hidden_box_name:       { en: 'Hidden Treasure',         ko: '숨겨진 보물',                           vi: 'Kho báu ẩn' },
  box_attack_hint:       { en: 'Keep tapping to attack!', ko: '계속 클릭하여 공격!',                   vi: 'Nhấn tiếp để tấn công!' },

  // ── 보물박스 인포윈도우 ───────────────────────────────────────────────────────
  box_default_name:      { en: 'Treasure Box',            ko: '보물박스',          vi: 'Hộp kho báu' },
  box_member_only:       { en: '👑 Members Only',         ko: '👑 정회원 전용',    vi: '👑 Chỉ hội viên' },
  box_admin_collect:     { en: '🔑 Admin Collect',        ko: '🔑 관리자 수집',    vi: '🔑 Quản trị viên thu' },
  box_appears:           { en: 'Appears',                 ko: '등장',              vi: 'Xuất hiện' },
  box_active:            { en: '✅ Active',               ko: '✅ 활성',           vi: '✅ Hoạt động' },
  box_inactive:          { en: '⏰ Inactive',             ko: '⏰ 비활성',         vi: '⏰ Không hoạt động' },
  box_approach:          { en: 'Get within {0}m then tap to attack!',
                           ko: '{0}m 이내 접근 후 클릭하여 공격!',
                           vi: 'Đến trong vòng {0}m rồi nhấn để tấn công!' },
  box_dist_prefix:       { en: 'Distance {0}m — ',        ko: '거리 {0}m — ',     vi: 'Cách {0}m — ' },
  box_already_collected: { en: '✓ Already collected',     ko: '✓ 이미 수집됨',    vi: '✓ Đã thu thập' },

  // ── 전투 HUD ─────────────────────────────────────────────────────────────────
  hud_lv:                { en: 'LV.{0}  💰{1}  💎Stone{2}',
                           ko: 'LV.{0}  💰{1}  💎마정석{2}',
                           vi: 'LV.{0}  💰{1}  💎Đá phép{2}' },
  hud_dead:              { en: '💀 Dead — {0}m to revive',
                           ko: '💀 사망 — 부활까지 {0}m 남음',
                           vi: '💀 Đã chết — còn {0}m để hồi sinh' },

  // ── 스킬 에러 메시지 ──────────────────────────────────────────────────────────
  skill_locating:        { en: '📍 Getting location...',  ko: '📍 위치 확인 중...', vi: '📍 Đang xác định vị trí...' },
  skill_mp_low_lightning:{ en: '⚡ Not enough MP!',       ko: '⚡ MP 부족!',        vi: '⚡ MP không đủ!' },
  skill_mp_low_ice:      { en: '❄ Not enough MP!',        ko: '❄ MP 부족!',         vi: '❄ MP không đủ!' },
  skill_mp_low_fire:     { en: '🔥 Not enough MP!',       ko: '🔥 MP 부족!',        vi: '🔥 MP không đủ!' },
  skill_mp_low_wind:     { en: '🌪️ Not enough MP!',      ko: '🌪️ MP 부족!',       vi: '🌪️ MP không đủ!' },
  skill_mp_low_meteor:   { en: '☄️ Not enough MP!',       ko: '☄️ MP 부족!',        vi: '☄️ MP không đủ!' },
  skill_mp_low_heal:     { en: '💚 Not enough MP!',       ko: '💚 MP 부족!',        vi: '💚 MP không đủ!' },
  skill_hp_full_heal:    { en: '💚 HP is already full',   ko: '💚 이미 HP가 가득 찼습니다', vi: '💚 HP đã đầy rồi!' },
  skill_heal_used:       { en: '💚 HP +{0} restored!',    ko: '💚 HP +{0} 회복!',   vi: '💚 Hồi phục HP +{0}!' },
  skill_label_heal:      { en: '💚 Heal',                 ko: '💚 힐',              vi: '💚 Hồi máu' },
  skill_no_target_lightning: { en: '⚡ No monsters in range', ko: '⚡ 범위 내 몬스터 없음', vi: '⚡ Không có quái trong tầm' },
  skill_no_target_ice:   { en: '❄ No monsters in range',  ko: '❄ 범위 내 몬스터 없음', vi: '❄ Không có quái trong tầm' },
  skill_no_target_fire:  { en: '🔥 No monsters in range', ko: '🔥 범위 내 몬스터 없음', vi: '🔥 Không có quái trong tầm' },
  skill_no_target_wind:  { en: '🌪️ No monsters within 30m', ko: '🌪️ 30m 내 몬스터 없음', vi: '🌪️ Không có quái trong 30m' },
  skill_no_target_meteor:{ en: '☄️ No monsters within 60m', ko: '☄️ 60m 내 몬스터 없음', vi: '☄️ Không có quái trong 60m' },

  // ── 스킬 플로팅 텍스트 ────────────────────────────────────────────────────────
  skill_lightning_hit:   { en: '⚡ Thunder! ({0} monsters)', ko: '⚡ 벼락! ({0}마리)',  vi: '⚡ Sét đánh! ({0} quái)' },
  skill_freeze_single:   { en: '❄ Frozen!',               ko: '❄ 동결!',             vi: '❄ Đóng băng!' },
  skill_freeze_multi:    { en: '❄ Frozen! ({0} monsters / {1}s)',
                           ko: '❄ 동결! ({0}마리 / {1}초)',
                           vi: '❄ Đóng băng! ({0} quái / {1}s)' },
  skill_fire_hit:        { en: '🔥 Fire! ({0} monsters)',  ko: '🔥 화염! ({0}마리)',   vi: '🔥 Bão lửa! ({0} quái)' },
  skill_wind_hit:        { en: '🌪️ Whirlwind! ({0} monsters)', ko: '🌪️ 회오리! ({0}마리)', vi: '🌪️ Lốc xoáy! ({0} quái)' },
  skill_meteor_hit:      { en: '☄️ Meteor! ({0} monsters)', ko: '☄️ 유성! ({0}마리)',   vi: '☄️ Thiên thạch! ({0} quái)' },

  // ── 스킬 대상 선택 모달 ───────────────────────────────────────────────────────
  skill_label_lightning: { en: '⚡ Thunder',              ko: '⚡ 벼락',             vi: '⚡ Sét' },
  skill_label_ice:       { en: '❄ Ice',                   ko: '❄ 빙결',              vi: '❄ Đóng băng' },
  skill_label_fire:      { en: '🔥 Fire',                 ko: '🔥 화염',             vi: '🔥 Lửa' },
  skill_label_wind:      { en: '🌪️ Whirlwind',           ko: '🌪️ 회오리바람',       vi: '🌪️ Lốc xoáy' },
  skill_label_meteor:    { en: '☄️ Meteor',               ko: '☄️ 유성',             vi: '☄️ Thiên thạch' },
  skill_label_default:   { en: 'Skill',                   ko: '스킬',                vi: 'Kỹ năng' },
  skill_modal_title:     { en: '{0} — Select Target',     ko: '{0} — 공격 대상 선택', vi: '{0} — Chọn mục tiêu' },
  skill_modal_cancel:    { en: 'Cancel',                  ko: '취소',                vi: 'Hủy' },

  // ── 부활 ──────────────────────────────────────────────────────────────────────
  revive_not_dead:       { en: 'You are not dead',        ko: '사망 상태가 아닙니다',  vi: 'Bạn chưa chết' },
  revive_success:        { en: '✨ Revived! HP·MP 50%',   ko: '✨ 부활! HP·MP 50%',   vi: '✨ Hồi sinh! HP·MP 50%' },
  revive_error:          { en: 'Error: {0}',              ko: '오류: {0}',            vi: 'Lỗi: {0}' },

  // ── 몬스터 마커 ───────────────────────────────────────────────────────────────
  monster_default:       { en: 'Monster',                 ko: '몬스터',               vi: 'Quái vật' },
  dragon_default:        { en: 'Dragon',                  ko: '드래곤',               vi: 'Rồng' },
  admin_delete:          { en: '🗑 Delete',               ko: '🗑 삭제',              vi: '🗑 Xóa' },

  // ── 전투 이벤트 플로팅 ────────────────────────────────────────────────────────
  float_kill:            { en: '💀 Defeated!',            ko: '💀 처치!',             vi: '💀 Tiêu diệt!' },
  float_player_dead:     { en: '💀 You died',             ko: '💀 사망했습니다',       vi: '💀 Bạn đã chết' },
  float_magic_stone:     { en: '💎+{0} Magic Stone!',     ko: '💎+{0} 마정석!',       vi: '💎+{0} Đá phép!' },
  float_key_drop:        { en: '🔑 Key dropped! {0}',     ko: '🔑 열쇠 드랍! {0}',   vi: '🔑 Chìa khóa rơi! {0}' },

  // ── 타워 ──────────────────────────────────────────────────────────────────────
  tower_default:         { en: 'Defense Tower',           ko: '방어탑',               vi: 'Tháp phòng thủ' },
  tower_destroyed:       { en: '🏚 Tower Destroyed!',     ko: '🏚 타워 파괴!',        vi: '🏚 Tháp bị phá hủy!' },
  tower_respawn:         { en: '🏰 Tower Revived!',       ko: '🏰 타워 부활!',        vi: '🏰 Tháp hồi sinh!' },
  tower_click_to_attack: { en: 'Keep tapping to attack!', ko: '계속 클릭하여 공격!',  vi: 'Nhấn liên tục để tấn công!' },
  tower_radius_dmg:      { en: 'Radius {0}m · Damage {1}', ko: '반경 {0}m · 데미지 {1}', vi: 'Bán kính {0}m · Sát thương {1}' },
  tower_approach:        { en: 'Get within attack range then tap!',
                           ko: '공격 범위 안으로 접근 후 클릭하여 공격!',
                           vi: 'Tiến vào phạm vi tấn công rồi nhấn để tấn công!' },

  // ── 사망 마커 ─────────────────────────────────────────────────────────────────
  death_marker_title:    { en: 'Death Point',             ko: '사망 지점',            vi: 'Điểm tử vong' },
  death_marker_label:    { en: '💀 Death Point',          ko: '💀 사망 지점',         vi: '💀 Điểm tử vong' },
  death_marker_hint:     { en: 'Marker disappears on revive', ko: '부활하면 마커가 사라집니다', vi: 'Marker sẽ biến mất khi hồi sinh' },

  // ── 플레이어 위치 마커 라벨 ───────────────────────────────────────────────────
  player_label_dead:     { en: 'Dead',                    ko: '사망',                 vi: 'Chết' },
  player_label_alive:    { en: 'Me',                      ko: '나',                   vi: 'Tôi' },
  nearby_player_label:   { en: 'Nearby Player',           ko: '근처 플레이어',         vi: 'Người chơi gần đây' },

  // ── 가맹점 카드 / 범례 ────────────────────────────────────────────────────────
  need_login:            { en: 'Login required.',         ko: '로그인이 필요합니다.',  vi: 'Cần đăng nhập.' },
  no_merchants:          { en: 'No merchants registered.', ko: '등록된 가맹점이 없습니다.', vi: 'Không có đại lý nào.' },
  merchant_count:        { en: '{0} merchants',           ko: '{0}개',                vi: '{0} đại lý' },

  // ── 보물박스 수집 / 오픈 ─────────────────────────────────────────────────────
  collect_toast_title:   { en: '📦 Treasure Box obtained!', ko: '📦 보물박스 획득!',          vi: '📦 Nhận được hộp kho báu!' },
  collect_toast_hint:    { en: 'Open it in your inventory!', ko: '인벤토리에서 열어보세요!',    vi: 'Hãy mở trong túi đồ!' },
  already_collected:     { en: 'Already collected this treasure box.', ko: '이미 수집한 보물박스입니다.', vi: 'Hộp kho báu đã được thu thập.' },
  collect_failed:        { en: 'Collection failed: {0}', ko: '수집 실패: {0}',              vi: 'Thu thập thất bại: {0}' },
  open_box_failed:       { en: 'Failed to open box: {0}', ko: '박스 오픈 실패: {0}',         vi: 'Mở hộp thất bại: {0}' },
  default_item_name:     { en: 'Item',                    ko: '아이템',                      vi: 'Vật phẩm' },

  // ── 보물박스 인벤토리 ─────────────────────────────────────────────────────────
  no_boxes:              { en: 'No unopened treasure boxes.', ko: '미개봉 보물박스가 없습니다.', vi: 'Không có hộp kho báu nào.' },
  box_default_name2:     { en: 'Treasure Box',            ko: '보물박스',              vi: 'Hộp kho báu' },
  box_open_hint:         { en: '{0} — Tap to open',       ko: '{0} — 클릭하여 열기',   vi: '{0} — Nhấn để mở' },
  box_locked_hint:       { en: '{1} — 🔑 Needs key with prefix {0}',
                           ko: '{1} — 🔑 앞 3자리 {0} 열쇠 필요',
                           vi: '{1} — 🔑 Cần chìa khóa 3 ký tự đầu {0}' },
  box_key_toast:         { en: '🔑 Need "{1}" key.\nDefeat monsters to get keys!',
                           ko: '🔑 "{1}" 열쇠가 필요합니다.\n몬스터를 처치하여 열쇠를 획득하세요!',
                           vi: '🔑 Cần chìa khóa "{1}".\nHãy tiêu diệt quái vật để lấy chìa khóa!' },

  // ── 장비 능력치 패널 ──────────────────────────────────────────────────────────
  equip_weapon_label:    { en: 'Weapon',      ko: '장착 무기',             vi: 'Vũ khí đang dùng' },
  equip_armor_label:     { en: 'Armor',       ko: '장착 방어구',           vi: 'Giáp đang dùng' },
  no_weapon:             { en: 'No Weapon',   ko: '무기 없음',             vi: 'Không có vũ khí' },
  no_armor:              { en: 'No Armor',    ko: '방어구 없음',           vi: 'Không có giáp' },
  unequip_hint:          { en: 'Click to unequip', ko: '클릭하여 해제',    vi: 'Nhấn để tháo' },
  unequip_btn:           { en: 'Unequip',     ko: '해제',                  vi: 'Tháo' },
  // ── 방어구 슬롯 이름 ──────────────────────────────────────────────────────────
  slot_helmet:           { en: 'Helmet',      ko: '투구',     vi: 'Mũ giáp' },
  slot_legs:             { en: 'Leg Guard',   ko: '레그가드', vi: 'Bảo vệ chân' },
  slot_gloves:           { en: 'Gloves',      ko: '글로브',   vi: 'Găng tay' },
  slot_chest:            { en: 'Chestplate',  ko: '흉갑',     vi: 'Giáp ngực' },
  slot_boots:            { en: 'Boots',       ko: '부츠',     vi: 'Giày chiến đấu' },

  // ── 인벤토리 슬롯 ─────────────────────────────────────────────────────────────
  hp_potion_name:        { en: 'Red Potion',  ko: '빨간약',                vi: 'Thuốc đỏ' },
  hp_potion_title:       { en: 'Red Potion — Tap to use (HP +100)', ko: '빨간약 — 클릭하여 사용 (HP +100)', vi: 'Thuốc đỏ — Nhấn để dùng (HP +100)' },
  mp_potion_name:        { en: 'Blue Potion', ko: '마법약',                vi: 'Thuốc phép' },
  mp_potion_title:       { en: 'Blue Potion — Tap to use (Full MP restore)', ko: '마법약 — 클릭하여 사용 (MP 전체 회복)', vi: 'Thuốc phép — Nhấn để dùng (Phục hồi toàn bộ MP)' },
  revive_item_name:      { en: 'Revive Ticket', ko: '부활권',              vi: 'Thẻ hồi sinh' },
  revive_item_title:     { en: 'Revive Item — Tap when dead to instantly revive (HP·MP 50%)',
                           ko: '부활 아이템 — 사망 시 클릭하여 즉시 부활 (HP·MP 50%)',
                           vi: 'Vật phẩm hồi sinh — Nhấn khi chết để hồi sinh (HP·MP 50%)' },
  weapon_slot_title:     { en: 'Weapon +{0} — Tap to equip',  ko: '무기 +{0} — 클릭하여 장착',     vi: 'Vũ khí +{0} — Nhấn để trang bị' },
  weapon_slot_name:      { en: 'Weapon +{0}',  ko: '무기 +{0}',            vi: 'Vũ khí +{0}' },
  armor_slot_title:      { en: 'Armor DEF {0} — Tap to equip', ko: '방어구 DEF {0} — 클릭하여 장착', vi: 'Giáp DEF {0} — Nhấn để trang bị' },
  armor_slot_name:       { en: 'Armor {0}',    ko: '방어 {0}',             vi: 'Giáp {0}' },
  equipped_label:        { en: 'Equipped',     ko: '장착',                  vi: 'Đang dùng' },
  equip_weapon_toast:    { en: '⚔️ Weapon +{0} equipped! Total ATK {1}',
                           ko: '⚔️ 무기 +{0} 장착! 총공격력 {1}',
                           vi: '⚔️ Trang bị vũ khí +{0}! Tổng sát thương {1}' },
  equip_armor_toast:     { en: '🛡 Armor DEF {0} equipped!',
                           ko: '🛡 방어구 DEF {0} 장착!',
                           vi: '🛡 Trang bị giáp DEF {0}!' },
  armor_slot_picker_title: { en: 'Select Slot', ko: '슬롯 선택',  vi: 'Chọn vị trí' },
  cancel_btn:              { en: 'Cancel',       ko: '취소',        vi: 'Hủy' },
  key_slot_title:        { en: '{0} (Key ID: {1}) — Treasure key',
                           ko: '{0} (Key ID: {1}) — 보물박스 열쇠',
                           vi: '{0} (Key ID: {1}) — Chìa khóa hộp' },

  // ── 물약 사용 ─────────────────────────────────────────────────────────────────
  no_mp_potion:          { en: 'No blue potions.',        ko: '마법약이 없습니다.',    vi: 'Không có thuốc phép.' },
  use_mp_potion_toast:   { en: '🔮 Blue Potion used! Full MP restored',
                           ko: '🔮 마법약 사용! MP 전체 회복',
                           vi: '🔮 Dùng thuốc phép! MP phục hồi hoàn toàn' },
  no_hp_potion:          { en: 'No red potions.',         ko: '빨간약이 없습니다.',    vi: 'Không có thuốc đỏ.' },
  use_hp_potion_toast:   { en: '💊 Red Potion used! HP +100',
                           ko: '💊 빨간약 사용! HP +100',
                           vi: '💊 Dùng thuốc đỏ! HP +100' },
  use_failed:            { en: 'Use failed: {0}',         ko: '사용 실패: {0}',        vi: 'Sử dụng thất bại: {0}' },

  // ── 바우처 조합 ───────────────────────────────────────────────────────────────
  no_craft_recipes:      { en: 'No craft recipes registered.', ko: '등록된 조합 레시피가 없습니다.', vi: 'Không có công thức tổng hợp.' },
  craft_reward_label:    { en: 'Reward: {0}',             ko: '보상: {0}',             vi: 'Phần thưởng: {0}' },
  craft_btn:             { en: 'Craft',                   ko: '조합하기',              vi: 'Tổng hợp' },
  craft_insufficient:    { en: 'Not enough materials',    ko: '재료 부족',             vi: 'Thiếu nguyên liệu' },
  craft_processing:      { en: 'Processing...',           ko: '처리 중...',            vi: 'Đang xử lý...' },
  craft_success:         { en: '✅ Craft success!\n{0}\nReward: {1}',
                           ko: '✅ 조합 성공!\n{0}\n보상: {1}',
                           vi: '✅ Tổng hợp thành công!\n{0}\nPhần thưởng: {1}' },
  craft_failed:          { en: 'Craft failed: {0}',       ko: '조합 실패: {0}',        vi: 'Tổng hợp thất bại: {0}' },
  weapon_equip_craft:    { en: '⚔️ {0} equipped! Total ATK {1}',
                           ko: '⚔️ {0} 장착! 총공격력 {1}',
                           vi: '⚔️ Trang bị {0}! Tổng sát thương {1}' },
  armor_equip_craft:     { en: '🛡 {0} equipped! Defense {1}',
                           ko: '🛡 {0} 장착! 방어력 {1}',
                           vi: '🛡 Trang bị {0}! Phòng thủ {1}' },
  no_vouchers:           { en: 'No vouchers available.',  ko: '보유 바우처가 없습니다.',  vi: 'Không có phiếu nào.' },
  coin_label:            { en: '💰 Coins',                ko: '💰 코인',               vi: '💰 Xu' },
  have_label:            { en: 'Have:{0}',                ko: '보유:{0}',              vi: 'Có:{0}' },
  default_voucher_reward:{ en: 'Voucher granted',         ko: '바우처 지급',            vi: 'Cấp phiếu' },

  // ── 상품교환권 ────────────────────────────────────────────────────────────────
  no_exchange:           { en: 'No exchange tickets registered.', ko: '등록된 교환권이 없습니다.', vi: 'Không có phiếu đổi nào.' },
  exchange_req_label:    { en: 'Required items',          ko: '필요 아이템',            vi: 'Vật phẩm cần' },
  exchange_no_req:       { en: 'No requirements',         ko: '조건 없음',              vi: 'Không có điều kiện' },
  exchange_progress:     { en: 'Progress {0}%',           ko: '진행도 {0}%',           vi: 'Tiến độ {0}%' },
  exchange_login_hint:   { en: 'Login to check your balance', ko: '로그인 후 보유량을 확인하세요', vi: 'Đăng nhập để xem số lượng' },
  exchange_btn_login:    { en: 'Login required',          ko: '로그인 필요',            vi: 'Cần đăng nhập' },
  exchange_btn_done:     { en: '✅ Purchased',            ko: '✅ 구매 완료',           vi: '✅ Đã mua' },
  exchange_btn_go:       { en: '🎟 Exchange now',         ko: '🎟 지금 교환하기',       vi: '🎟 Đổi ngay' },
  exchange_btn_lack:     { en: 'Not enough materials',    ko: '재료 부족',              vi: 'Thiếu nguyên liệu' },
  exchange_processing:   { en: 'Processing...',           ko: '처리 중...',             vi: 'Đang xử lý...' },
  exchange_success:      { en: '✅ Exchange success!\n{0}\nReward: {1}',
                           ko: '✅ 교환 성공!\n{0}\n보상: {1}',
                           vi: '✅ Đổi thành công!\n{0}\nPhần thưởng: {1}' },
  default_reward_label:  { en: 'Exchange ticket',         ko: '상품교환권',             vi: 'Phiếu đổi hàng' },
  coin_chip:             { en: '💰 Coins×{0}',            ko: '💰 코인×{0}',            vi: '💰 Xu×{0}' },
  magic_stone_chip:      { en: '💎 Magic Stone×{0}',      ko: '💎 마정석×{0}',          vi: '💎 Đá phép×{0}' },
  magic_stone_none:      { en: 'No magic stones',         ko: '마정석이 없습니다',        vi: 'Không có đá phép' },
  level_chip:            { en: '⭐ LV.{0} or above',      ko: '⭐ LV.{0} 이상',        vi: '⭐ LV.{0} trở lên' },

  // ── 플레이어 / 게임 상태 ──────────────────────────────────────────────────────
  player_default_name:   { en: 'Player',                  ko: '플레이어',               vi: 'Người chơi' },
  game_in_progress:      { en: 'Game in progress',        ko: '게임 진행 중',            vi: 'Đang trong trò chơi' },
  voucher_label:         { en: 'Voucher',                  ko: '바우처',                  vi: 'Phiếu' },

  // ── 정회원 전용 박스 안내 ───────────────────────────────────────────────────────
  member_only_box_title: { en: '👑 Members-Only Treasure Box',
                           ko: '👑 정회원 전용 보물박스',
                           vi: '👑 Hộp kho báu dành riêng hội viên' },
  member_only_box_desc:  { en: 'Pay 10 HEX at coop.html to<br>become a CoopMall member.',
                           ko: 'coop.html에서 10 HEX를 지불하고<br>CoopMall 정회원에 가입하세요.',
                           vi: 'Vào coop.html, trả 10 HEX để<br>trở thành hội viên CoopMall.' },

  // ── 게임 서버 연결 상태 ───────────────────────────────────────────────────────
  gs_connecting:         { en: 'Connecting...',            ko: '연결 중...',              vi: 'Đang kết nối...' },
  gs_connecting_badge:   { en: 'Connecting',               ko: '연결 중',                 vi: 'Kết nối' },
  gs_connected:          { en: 'Connected to game server — Tap to disconnect',
                           ko: '게임 서버 접속 중 — 클릭하여 종료',
                           vi: 'Đang kết nối máy chủ — Nhấn để ngắt' },
  gs_connected_badge:    { en: 'Connected',                ko: '접속 중',                 vi: 'Đã kết nối' },
  gs_error:              { en: 'Connection error — Tap to retry',
                           ko: '연결 오류 — 클릭하여 재시도',
                           vi: 'Lỗi kết nối — Nhấn để thử lại' },
  gs_error_badge:        { en: 'Error',                    ko: '오류',                    vi: 'Lỗi' },
  gs_idle:               { en: '▶ Press PLAY — connect game server to fight monsters & collect treasure',   ko: '▶ 게임 시작 (서버 연결)',  vi: '▶ Nhấn để bắt đầu — kết nối máy chủ & chiến đấu' },

  // ── 튜토리얼 ────────────────────────────────────────────────────────────────
  tut_title:             { en: 'Game Guide',               ko: '게임 가이드',              vi: 'Hướng dẫn chơi' },
  tut_step1_title:       { en: '📍 Find my location',      ko: '📍 내 위치 확인',          vi: '📍 Xem vị trí của tôi' },
  tut_step1_body:        { en: 'Tap the 📍 button to move the map to your location.\nBlue dot = Your current location\n\nPlease allow location permission.',
                           ko: '📍 버튼을 누르면 지도가 내 위치로 이동합니다.\n파란 점 = 나의 현재 위치\n\n위치 권한을 허용해야 정확한 위치가 표시됩니다.',
                           vi: 'Nhấn nút 📍 để bản đồ di chuyển đến vị trí của bạn.\nChấm xanh = Vị trí hiện tại của bạn\n\nHãy cho phép quyền truy cập vị trí.' },
  tut_step2_title:       { en: '👾 Press ▶ Play to start', ko: '👾 ▶ 버튼으로 게임 시작',       vi: '👾 Nhấn ▶ để bắt đầu' },
  tut_step2_body:        { en: 'Tap ▶ to connect to the game server.\nServer monsters appear on the map after connecting.\nTap a monster to attack!\n\n⚠️ You MUST press ▶ Play first — without it, Firestore monsters cannot be attacked.\n\n💡 Some monsters may appear invisible but still attack you — this is normal when they are far from the map center.',
                           ko: '▶ 버튼을 눌러 게임 서버에 접속하세요.\n접속하면 지도에 몬스터가 나타납니다.\n몬스터를 탭하여 공격하세요!\n\n⚠️ 반드시 ▶ 버튼을 먼저 눌러야 몬스터를 공격할 수 있습니다.\n\n💡 일부 몬스터가 보이지 않아도 공격하는 경우가 있습니다 — 지도 중심에서 멀 때 발생합니다.',
                           vi: 'Nhấn ▶ để kết nối máy chủ game.\nSau khi kết nối, quái vật sẽ xuất hiện trên bản đồ.\nNhấn vào quái vật để tấn công!\n\n⚠️ Bạn PHẢI nhấn ▶ Chơi trước — nếu không quái Firestore không thể tấn công.\n\n💡 Một số quái có thể không hiển thị nhưng vẫn tấn công bạn — bình thường khi chúng ở xa tâm bản đồ.' },
  tut_step3_title:       { en: '📦 Find Treasure',         ko: '📦 보물 찾기',              vi: '📦 Tìm kho báu' },
  tut_step3_body:        { en: 'After connecting, find the golden 📦 icon.\nGet close → Tap to attack → Collect when HP = 0!\nOpen collected boxes in 🎒 Inventory.',
                           ko: '게임 서버 접속 후 금색 📦 아이콘을 찾으세요.\n가까이 접근 → 탭하여 공격 → HP 0이 되면 획득!\n획득한 박스는 🎒 인벤토리에서 열어보세요.',
                           vi: 'Sau khi kết nối, tìm biểu tượng 📦 màu vàng.\nĐến gần → Nhấn tấn công → Khi HP = 0 thì nhận được!\nMở hộp trong 🎒 Túi đồ.' },
  tut_step4_title:       { en: '🌍 Virtual Explore (Warp)', ko: '🌍 버추얼 탐험 (워프)',     vi: '🌍 Khám phá ảo (Warp)' },
  tut_step4_body:        { en: '1. Make sure ▶ is NOT pressed yet\n2. Tap 🌍 Virtual Explorer → Select a shop\n3. Your character warps there (10 GP entrance fee + MP cost)\n4. Tap the map to walk & explore within the 5km radius circle\n5. Press ▶ to start the game server at your warp location\n\n🔄 To warp to a different location while already warping:\n   — Tap 🌍 again (works even during game)\n\n⚔️ Shop attacks only available in real GPS mode (visit in person)',
                           ko: '1. ▶ 버튼을 누르지 않은 상태에서\n2. 🌍 버추얼 익스폴러 탭 → 상점 선택\n3. 캐릭터가 그곳으로 워프 (입장료 10GP + MP 소모)\n4. 지도를 탭하여 5km 반경 내 탐험\n5. ▶ 누르면 워프 위치에서 게임 서버 연결\n\n🔄 워프 중 다른 장소로 재워프하려면:\n   — 🌍 버튼을 다시 탭 (게임 중에도 가능)\n\n⚔️ 상점 공격은 GPS 모드(직접 방문)에서만 가능',
                           vi: '1. Chưa nhấn ▶\n2. Nhấn nút 🌍 Virtual Explorer → Chọn cửa hàng\n3. Nhân vật dịch chuyển đến đó (mất 10 GP + MP)\n4. Nhấn bản đồ để khám phá trong vòng tròn 5km\n5. Nhấn ▶ để kết nối máy chủ từ vị trí warp\n\n🔄 Muốn warp sang nơi khác khi đang warp:\n   — Nhấn 🌍 lần nữa (hoạt động kể cả khi đang chơi)' },
  tut_step5_title:       { en: '🏪 Shop & Monster Placement', ko: '🏪 상점·몬스터 배치',             vi: '🏪 Đặt Shop & Quái vật' },
  tut_step5_body:        { en: 'Shop owners earn GP from:\n• Item sales to other players\n• Warp entrance fee (10 GP per visitor)\n\nShop rules:\n• Only 1 shop per category within 5km radius\n• Owner can set items, price & shop name\n• Conquer enemy shops in GPS mode (▶ + visit in person)\n\nPlace shops & monsters via 🏪 button\n💰 GP required — button grayed out if insufficient funds\n⛔ Same-category shop already exists within 5km → blocked',
                           ko: '상점 주인은 아이템 판매 및 방문자 입장료(10GP)로 수익\n• 5km 내 동일 카테고리 상점 1개 제한\n• 소유자는 아이템·이름·가격 설정 가능\n• 상점 점령은 GPS 모드에서만 (▶ + 직접 방문)\n• 🏪 버튼으로 상점/몬스터 배치\n💰 GP 필요 — 부족하면 버튼 비활성화\n⛔ 5km 내 동일 카테고리 상점 존재 시 배치 불가',
                           vi: 'Chủ cửa hàng kiếm GP từ bán đồ & phí vào cửa (10 GP)\n• Chỉ 1 cửa hàng mỗi loại trong 5km\n• Chủ có thể đặt vật phẩm, giá & tên\n• Chinh phục shop địch trong chế độ GPS (▶ + đến tận nơi)\n• Đặt shop & quái qua nút 🏪\n💰 Cần GP — nút mờ nếu không đủ tiền\n⛔ Đã có shop cùng loại trong 5km → bị chặn' },
  tut_prev:              { en: '◀ Back',                   ko: '◀ 이전',                   vi: '◀ Trước' },
  tut_next:              { en: 'Next ▶',                   ko: '다음 ▶',                   vi: 'Tiếp ▶' },
  tut_done:              { en: 'Start ✓',                  ko: '시작하기 ✓',                vi: 'Bắt đầu ✓' },

  // ── 상점 ─────────────────────────────────────────────────────────────────────
  shop_gps_wait:         { en: '📍 Getting GPS location. Please try again shortly.',
                           ko: '📍 GPS 위치를 확인 중입니다. 잠시 후 다시 시도하세요.',
                           vi: '📍 Đang xác định vị trí GPS. Vui lòng thử lại sau.' },
  shop_too_far:          { en: '📍 You are too far from the shop ({0}km — within 1km only)',
                           ko: '📍 상점과 너무 멀리 있습니다 (현재 {0}km — 1km 이내에서만 이용 가능)',
                           vi: '📍 Bạn ở quá xa cửa hàng ({0}km — chỉ sử dụng được trong vòng 1km)' },
  shop_buy_confirm:      { en: 'Buy {0}? ({1} gold)',      ko: '{0}개 구매 ({1} 골드)?',   vi: 'Mua {0} cái ({1} vàng)?' },
  shop_not_enough_gold:  { en: 'Not enough gold',          ko: '골드가 부족합니다',         vi: 'Không đủ vàng' },
  shop_buy_ok:           { en: '{0} purchased!',           ko: '{0} 구매 완료!',            vi: 'Đã mua {0} thành công!' },
  shop_buy_fail:         { en: 'Purchase failed: {0}',     ko: '구매 실패: {0}',            vi: 'Mua thất bại: {0}' },
  shop_out_of_stock:     { en: 'Out of stock',             ko: '재고 없음',                 vi: 'Hết hàng' },
  shop_type_weapon:      { en: 'Weapons/Armor',            ko: '무기/방어구',               vi: 'Vũ khí / Giáp' },
  shop_type_potion:      { en: 'Potions',                  ko: '약물',                      vi: 'Thuốc' },
  shop_type_misc:        { en: 'Misc',                     ko: '잡템',                      vi: 'Đồ linh tinh' },
  shop_place_weapon:     { en: 'Place weapon/armor shop',  ko: '무기/방어구 상점 배치',      vi: 'Đặt cửa hàng vũ khí/giáp' },
  shop_place_potion:     { en: 'Place potion shop',        ko: '약물 상점 배치',            vi: 'Đặt cửa hàng thuốc' },
  shop_place_misc:       { en: 'Place misc shop',          ko: '잡템 상점 배치',            vi: 'Đặt cửa hàng đồ linh tinh' },
  shop_admin_title:      { en: 'Shop Settings',            ko: '상점 설정',                 vi: 'Cài đặt cửa hàng' },
  shop_admin_name:       { en: 'Shop name',                ko: '상점 이름',                 vi: 'Tên cửa hàng' },
  shop_admin_items:      { en: 'Items for sale',           ko: '판매 아이템',               vi: 'Hàng bán' },
  shop_admin_item_id:    { en: 'Item ID',                  ko: '아이템 ID',                 vi: 'ID vật phẩm' },
  shop_admin_item_name:  { en: 'Item name',                ko: '아이템 이름',               vi: 'Tên vật phẩm' },
  shop_admin_price:      { en: 'Price (gold)',             ko: '가격 (골드)',               vi: 'Giá (vàng)' },
  shop_admin_stock:      { en: 'Stock (-1=unlimited)',     ko: '재고 (-1=무제한)',          vi: 'Tồn kho (-1=vô hạn)' },
  shop_admin_add_item:   { en: '+ Add item',               ko: '+ 아이템 추가',             vi: '+ Thêm vật phẩm' },
  shop_admin_save:       { en: 'Save',                     ko: '저장',                      vi: 'Lưu' },
  shop_admin_delete:     { en: 'Delete shop',              ko: '상점 삭제',                 vi: 'Xóa cửa hàng' },
  shop_admin_saved:      { en: 'Shop saved',               ko: '상점이 저장되었습니다',      vi: 'Đã lưu cửa hàng' },
  shop_admin_deleted:    { en: 'Shop deleted',             ko: '상점이 삭제되었습니다',      vi: 'Đã xóa cửa hàng' },
  shop_name_prompt:      { en: 'Enter shop name',          ko: '상점 이름을 입력하세요',     vi: 'Nhập tên cửa hàng' },
  shop_enter_range:      { en: 'Get closer! (within 20m)', ko: '가까이 접근하세요! (20m 이내)', vi: 'Hãy đến gần hơn! (trong vòng 20m)' },
  shop_gold_label:       { en: 'Gold',                     ko: '골드',                      vi: 'Vàng' },

  // ── 바닥 드랍 시스템 ──────────────────────────────────────────────────────────
  drop_btn_title:        { en: 'Drop',                     ko: '버리기',                    vi: 'Bỏ' },
  pickup_btn_label:      { en: 'Pick up',                  ko: '줍기',                      vi: 'Nhặt' },
  drop_confirm:          { en: 'Drop 1 {0}?\nWill be destroyed after 10 minutes.',
                           ko: '{0} 1개를 바닥에 버리겠습니까?\n10분 후 자동 소각됩니다.',
                           vi: 'Bỏ 1 {0} xuống đất?\nSẽ tự hủy sau 10 phút.' },
  drop_success:          { en: 'Item dropped',             ko: '아이템을 버렸습니다',        vi: 'Đã bỏ vật phẩm' },
  drop_no_location:      { en: 'Cannot determine location', ko: '위치 정보를 확인할 수 없습니다', vi: 'Không thể xác định vị trí' },
  drop_no_item:          { en: 'Item not in inventory',    ko: '인벤토리에 없는 아이템입니다', vi: 'Không có vật phẩm trong kho' },
  drop_insufficient:     { en: 'Not enough items',         ko: '아이템이 부족합니다',        vi: 'Không đủ vật phẩm' },
  pickup_success:        { en: '{0} obtained!',            ko: '{0} 획득!',                  vi: 'Nhận được {0}!' },
  pickup_expired:        { en: 'Item has been destroyed',  ko: '아이템이 소각되었습니다',    vi: 'Vật phẩm đã bị hủy' },
  pickup_too_far:        { en: 'Get closer to the item',   ko: '아이템에 더 가까이 접근하세요', vi: 'Hãy đến gần vật phẩm hơn' },
  pickup_gone:           { en: 'Someone already picked it up', ko: '이미 누군가 주워갔습니다',   vi: 'Đã có người nhặt mất rồi' },
  drop_nearby_toast:     { en: '📦 Item nearby! ({0})',    ko: '📦 근처에 아이템이 있습니다! ({0})', vi: '📦 Có vật phẩm gần đây! ({0})' },
  drop_nearby_hud:       { en: 'Nearby item',              ko: '근처 아이템',               vi: 'Vật phẩm gần' },

  // ── 튜토리얼 보물박스 ─────────────────────────────────────────────────────────
  tutorial_init_fail:    { en: '⚠️ Tutorial initialization failed', ko: '⚠️ 튜토리얼 초기화 실패',  vi: '⚠️ Khởi tạo hướng dẫn thất bại' },
  tutorial_location_needed: { en: '📍 Location permission required', ko: '📍 위치 권한이 필요합니다', vi: '📍 Cần quyền vị trí' },
};

/**
 * Translation helper — defaults to English
 * @param {string} key
 * @param {...string|number} args  — {0}, {1} substitution
 * @returns {string}
 */
export function _t(key, ...args) {
  const lang  = (window.LANG || 'en');
  const entry = MESSAGES[key];
  if (!entry) return key;
  let str = entry[lang] ?? entry.en ?? entry.ko ?? key;
  args.forEach((v, i) => { str = str.replaceAll(`{${i}}`, v); });
  return str;
}
