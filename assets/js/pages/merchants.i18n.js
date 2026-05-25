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
  // {0} = dist m
  npc_too_far:           { ko: '💬 NPC에게 20m 이내로 접근하세요 (현재 {0}m)', vi: '💬 Tiến đến trong 20m của NPC (hiện tại {0}m)' },
  no_map_label:          { ko: '지도 미등록',       vi: 'Chưa có bản đồ' },
  no_name_label:         { ko: '(이름없음)',         vi: '(Không tên)' },
  no_geolocation:        { ko: '이 브라우저는 위치 서비스를 지원하지 않습니다.',
                           vi: 'Trình duyệt này không hỗ trợ dịch vụ vị trí.' },
  // {0}=name, {1}=curHp, {2}=maxHp
  box_attack_title:      { ko: '⚔️ {0} — 클릭하여 공격! (HP {1}/{2})', vi: '⚔️ {0} — Nhấn để tấn công! (HP {1}/{2})' },
  hidden_box_title:      { ko: '✨ {0} — 클릭하여 공격! (HP {1}/{2})', vi: '✨ {0} — Nhấn để tấn công! (HP {1}/{2})' },
  hidden_box_name:       { ko: '숨겨진 보물',                           vi: 'Kho báu ẩn' },
  box_attack_hint:       { ko: '계속 클릭하여 공격!',                   vi: 'Nhấn tiếp để tấn công!' },

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
  skill_mp_low_wind:     { ko: '🌪️ MP 부족!',       vi: '🌪️ MP không đủ!' },
  skill_mp_low_meteor:   { ko: '☄️ MP 부족!',        vi: '☄️ MP không đủ!' },
  skill_mp_low_heal:     { ko: '💚 MP 부족!',        vi: '💚 MP không đủ!' },
  skill_hp_full_heal:    { ko: '💚 이미 HP가 가득 찼습니다', vi: '💚 HP đã đầy rồi!' },
  skill_heal_used:       { ko: '💚 HP +{0} 회복!',   vi: '💚 Hồi phục HP +{0}!' },
  skill_label_heal:      { ko: '💚 힐',              vi: '💚 Hồi máu' },
  skill_no_target_lightning: { ko: '⚡ 범위 내 몬스터 없음', vi: '⚡ Không có quái trong tầm' },
  skill_no_target_ice:   { ko: '❄ 범위 내 몬스터 없음', vi: '❄ Không có quái trong tầm' },
  skill_no_target_fire:  { ko: '🔥 범위 내 몬스터 없음', vi: '🔥 Không có quái trong tầm' },
  skill_no_target_wind:  { ko: '🌪️ 30m 내 몬스터 없음', vi: '🌪️ Không có quái trong 30m' },
  skill_no_target_meteor:{ ko: '☄️ 60m 내 몬스터 없음', vi: '☄️ Không có quái trong 60m' },

  // ── 스킬 플로팅 텍스트 ────────────────────────────────────────────────────────
  // {0} = count
  skill_lightning_hit:   { ko: '⚡ 벼락! ({0}마리)',  vi: '⚡ Sét đánh! ({0} quái)' },
  skill_freeze_single:   { ko: '❄ 동결!',             vi: '❄ Đóng băng!' },
  // {0} = count, {1} = sec
  skill_freeze_multi:    { ko: '❄ 동결! ({0}마리 / {1}초)', vi: '❄ Đóng băng! ({0} quái / {1}s)' },
  // {0} = count
  skill_fire_hit:        { ko: '🔥 화염! ({0}마리)',   vi: '🔥 Bão lửa! ({0} quái)' },
  // {0} = count
  skill_wind_hit:        { ko: '🌪️ 회오리! ({0}마리)', vi: '🌪️ Lốc xoáy! ({0} quái)' },
  // {0} = count
  skill_meteor_hit:      { ko: '☄️ 유성! ({0}마리)',   vi: '☄️ Thiên thạch! ({0} quái)' },

  // ── 스킬 대상 선택 모달 ───────────────────────────────────────────────────────
  skill_label_lightning: { ko: '⚡ 벼락',             vi: '⚡ Sét' },
  skill_label_ice:       { ko: '❄ 빙결',              vi: '❄ Đóng băng' },
  skill_label_fire:      { ko: '🔥 화염',             vi: '🔥 Lửa' },
  skill_label_wind:      { ko: '🌪️ 회오리바람',       vi: '🌪️ Lốc xoáy' },
  skill_label_meteor:    { ko: '☄️ 유성',             vi: '☄️ Thiên thạch' },
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
  nearby_player_label:   { ko: '근처 플레이어',         vi: 'Người chơi gần đây' },

  // ── 가맹점 카드 / 범례 ────────────────────────────────────────────────────────
  need_login:            { ko: '로그인이 필요합니다.',  vi: 'Cần đăng nhập.' },
  no_merchants:          { ko: '등록된 가맹점이 없습니다.', vi: 'Không có đại lý nào.' },
  // {0} = count
  merchant_count:        { ko: '{0}개',                vi: '{0} đại lý' },

  // ── 보물박스 수집 / 오픈 ─────────────────────────────────────────────────────
  // {0} = boxName
  collect_toast_title:   { ko: '📦 보물박스 획득!',          vi: '📦 Nhận được hộp kho báu!' },
  collect_toast_hint:    { ko: '인벤토리에서 열어보세요!',    vi: 'Hãy mở trong túi đồ!' },
  already_collected:     { ko: '이미 수집한 보물박스입니다.', vi: 'Hộp kho báu đã được thu thập.' },
  collect_failed:        { ko: '수집 실패: {0}',              vi: 'Thu thập thất bại: {0}' },
  open_box_failed:       { ko: '박스 오픈 실패: {0}',         vi: 'Mở hộp thất bại: {0}' },
  default_item_name:     { ko: '아이템',                      vi: 'Vật phẩm' },

  // ── 보물박스 인벤토리 ─────────────────────────────────────────────────────────
  no_boxes:              { ko: '미개봉 보물박스가 없습니다.', vi: 'Không có hộp kho báu nào.' },
  box_default_name2:     { ko: '보물박스',              vi: 'Hộp kho báu' },
  box_open_hint:         { ko: '{0} — 클릭하여 열기',   vi: '{0} — Nhấn để mở' },
  // {0} = prefix, {1} = name
  box_locked_hint:       { ko: '{1} — 🔑 앞 3자리 {0} 열쇠 필요', vi: '{1} — 🔑 Cần chìa khóa 3 ký tự đầu {0}' },
  // {0} = prefix, {1} = key name
  box_key_toast:         { ko: '🔑 "{1}" 열쇠가 필요합니다.\n몬스터를 처치하여 열쇠를 획득하세요!',
                           vi: '🔑 Cần chìa khóa "{1}".\nHãy tiêu diệt quái vật để lấy chìa khóa!' },

  // ── 장비 능력치 패널 ──────────────────────────────────────────────────────────
  equip_weapon_label:    { ko: '장착 무기',             vi: 'Vũ khí đang dùng' },
  equip_armor_label:     { ko: '장착 방어구',           vi: 'Giáp đang dùng' },
  no_weapon:             { ko: '무기 없음',             vi: 'Không có vũ khí' },
  no_armor:              { ko: '방어구 없음',           vi: 'Không có giáp' },
  unequip_hint:          { ko: '클릭하여 해제',         vi: 'Nhấn để tháo' },
  unequip_btn:           { ko: '해제',                  vi: 'Tháo' },

  // ── 인벤토리 슬롯 ─────────────────────────────────────────────────────────────
  hp_potion_name:        { ko: '빨간약',                vi: 'Thuốc đỏ' },
  hp_potion_title:       { ko: '빨간약 — 클릭하여 사용 (HP +100)', vi: 'Thuốc đỏ — Nhấn để dùng (HP +100)' },
  mp_potion_name:        { ko: '마법약',                vi: 'Thuốc phép' },
  mp_potion_title:       { ko: '마법약 — 클릭하여 사용 (MP 전체 회복)', vi: 'Thuốc phép — Nhấn để dùng (Phục hồi toàn bộ MP)' },
  revive_item_name:      { ko: '부활권',                vi: 'Thẻ hồi sinh' },
  revive_item_title:     { ko: '부활 아이템 — 사망 시 클릭하여 즉시 부활 (HP·MP 50%)',
                           vi: 'Vật phẩm hồi sinh — Nhấn khi chết để hồi sinh (HP·MP 50%)' },
  // {0} = num
  weapon_slot_title:     { ko: '무기 +{0} — 클릭하여 장착',     vi: 'Vũ khí +{0} — Nhấn để trang bị' },
  // {0} = weapon name/num
  weapon_slot_name:      { ko: '무기 +{0}',            vi: 'Vũ khí +{0}' },
  // {0} = defVal
  armor_slot_title:      { ko: '방어구 DEF {0} — 클릭하여 장착', vi: 'Giáp DEF {0} — Nhấn để trang bị' },
  armor_slot_name:       { ko: '방어 {0}',             vi: 'Giáp {0}' },
  equipped_label:        { ko: '장착',                  vi: 'Đang dùng' },
  // {0} = num, {1} = totalAtk
  equip_weapon_toast:    { ko: '⚔️ 무기 +{0} 장착! 총공격력 {1}', vi: '⚔️ Trang bị vũ khí +{0}! Tổng sát thương {1}' },
  // {0} = defVal
  equip_armor_toast:     { ko: '🛡 방어구 DEF {0} 장착!', vi: '🛡 Trang bị giáp DEF {0}!' },
  // {0} = keyName, {1} = kid
  key_slot_title:        { ko: '{0} (Key ID: {1}) — 보물박스 열쇠', vi: '{0} (Key ID: {1}) — Chìa khóa hộp' },

  // ── 물약 사용 ─────────────────────────────────────────────────────────────────
  no_mp_potion:          { ko: '마법약이 없습니다.',    vi: 'Không có thuốc phép.' },
  use_mp_potion_toast:   { ko: '🔮 마법약 사용! MP 전체 회복', vi: '🔮 Dùng thuốc phép! MP phục hồi hoàn toàn' },
  no_hp_potion:          { ko: '빨간약이 없습니다.',    vi: 'Không có thuốc đỏ.' },
  use_hp_potion_toast:   { ko: '💊 빨간약 사용! HP +100', vi: '💊 Dùng thuốc đỏ! HP +100' },
  use_failed:            { ko: '사용 실패: {0}',        vi: 'Sử dụng thất bại: {0}' },

  // ── 바우처 조합 ───────────────────────────────────────────────────────────────
  no_craft_recipes:      { ko: '등록된 조합 레시피가 없습니다.', vi: 'Không có công thức tổng hợp.' },
  craft_reward_label:    { ko: '보상: {0}',             vi: 'Phần thưởng: {0}' },
  craft_btn:             { ko: '조합하기',              vi: 'Tổng hợp' },
  craft_insufficient:    { ko: '재료 부족',             vi: 'Thiếu nguyên liệu' },
  craft_processing:      { ko: '처리 중...',            vi: 'Đang xử lý...' },
  // {0}=voucherName, {1}=reward
  craft_success:         { ko: '✅ 조합 성공!\n{0}\n보상: {1}', vi: '✅ Tổng hợp thành công!\n{0}\nPhần thưởng: {1}' },
  craft_failed:          { ko: '조합 실패: {0}',        vi: 'Tổng hợp thất bại: {0}' },
  // {0}=rewardId, {1}=totalAtk
  weapon_equip_craft:    { ko: '⚔️ {0} 장착! 총공격력 {1}', vi: '⚔️ Trang bị {0}! Tổng sát thương {1}' },
  // {0}=rewardId, {1}=defense
  armor_equip_craft:     { ko: '🛡 {0} 장착! 방어력 {1}',    vi: '🛡 Trang bị {0}! Phòng thủ {1}' },
  no_vouchers:           { ko: '보유 바우처가 없습니다.',  vi: 'Không có phiếu nào.' },
  coin_label:            { ko: '💰 코인',               vi: '💰 Xu' },
  // {0}=have
  have_label:            { ko: '보유:{0}',              vi: 'Có:{0}' },
  default_voucher_reward:{ ko: '바우처 지급',            vi: 'Cấp phiếu' },

  // ── 상품교환권 ────────────────────────────────────────────────────────────────
  no_exchange:           { ko: '등록된 교환권이 없습니다.', vi: 'Không có phiếu đổi nào.' },
  exchange_req_label:    { ko: '필요 아이템',            vi: 'Vật phẩm cần' },
  exchange_no_req:       { ko: '조건 없음',              vi: 'Không có điều kiện' },
  // {0}=pct
  exchange_progress:     { ko: '진행도 {0}%',           vi: 'Tiến độ {0}%' },
  exchange_login_hint:   { ko: '로그인 후 보유량을 확인하세요', vi: 'Đăng nhập để xem số lượng' },
  exchange_btn_login:    { ko: '로그인 필요',            vi: 'Cần đăng nhập' },
  exchange_btn_done:     { ko: '✅ 구매 완료',           vi: '✅ Đã mua' },
  exchange_btn_go:       { ko: '🎟 지금 교환하기',       vi: '🎟 Đổi ngay' },
  exchange_btn_lack:     { ko: '재료 부족',              vi: 'Thiếu nguyên liệu' },
  exchange_processing:   { ko: '처리 중...',             vi: 'Đang xử lý...' },
  // {0}=voucherName, {1}=reward
  exchange_success:      { ko: '✅ 교환 성공!\n{0}\n보상: {1}', vi: '✅ Đổi thành công!\n{0}\nPhần thưởng: {1}' },
  default_reward_label:  { ko: '상품교환권',             vi: 'Phiếu đổi hàng' },
  // {0}=count  {1}=need
  coin_chip:             { ko: '💰 코인×{0}',            vi: '💰 Xu×{0}' },
  // {0}=cost
  magic_stone_chip:      { ko: '💎 마정석×{0}',          vi: '💎 Đá phép×{0}' },
  magic_stone_none:      { ko: '마정석이 없습니다',        vi: 'Không có đá phép' },
  // {0}=minLevel
  level_chip:            { ko: '⭐ LV.{0} 이상',        vi: '⭐ LV.{0} trở lên' },

  // ── 플레이어 / 게임 상태 ──────────────────────────────────────────────────────
  player_default_name:   { ko: '플레이어',               vi: 'Người chơi' },
  game_in_progress:      { ko: '게임 진행 중',            vi: 'Đang trong trò chơi' },
  voucher_label:         { ko: '바우처',                  vi: 'Phiếu' },

  // ── 정회원 전용 박스 안내 ───────────────────────────────────────────────────────
  member_only_box_title: { ko: '👑 정회원 전용 보물박스', vi: '👑 Hộp kho báu dành riêng hội viên' },
  member_only_box_desc:  { ko: 'coop.html에서 10 HEX를 지불하고<br>CoopMall 정회원에 가입하세요.',
                           vi: 'Vào coop.html, trả 10 HEX để<br>trở thành hội viên CoopMall.' },

  // ── 게임 서버 연결 상태 ───────────────────────────────────────────────────────
  gs_connecting:         { ko: '연결 중...',              vi: 'Đang kết nối...' },
  gs_connecting_badge:   { ko: '연결 중',                 vi: 'Kết nối' },
  gs_connected:          { ko: '게임 서버 접속 중 — 클릭하여 종료', vi: 'Đang kết nối máy chủ — Nhấn để ngắt' },
  gs_connected_badge:    { ko: '접속 중',                 vi: 'Đã kết nối' },
  gs_error:              { ko: '연결 오류 — 클릭하여 재시도', vi: 'Lỗi kết nối — Nhấn để thử lại' },
  gs_error_badge:        { ko: '오류',                    vi: 'Lỗi' },
  gs_idle:               { ko: '게임 서버 연결',           vi: 'Kết nối máy chủ' },

  // ── 튜토리얼 ────────────────────────────────────────────────────────────────
  tut_title:             { ko: '게임 가이드',              vi: 'Hướng dẫn chơi' },
  tut_step1_title:       { ko: '📍 내 위치 확인',          vi: '📍 Xem vị trí của tôi' },
  tut_step1_body:        { ko: '📍 버튼을 누르면 지도가 내 위치로 이동합니다.\n파란 점 = 나의 현재 위치\n\n위치 권한을 허용해야 정확한 위치가 표시됩니다.',
                           vi: 'Nhấn nút 📍 để bản đồ di chuyển đến vị trí của bạn.\nChấm xanh = Vị trí hiện tại của bạn\n\nHãy cho phép quyền truy cập vị trí.' },
  tut_step2_title:       { ko: '👾 서버 몬스터 켜기',       vi: '👾 Bật quái vật máy chủ' },
  tut_step2_body:        { ko: '▶ 버튼을 눌러 게임 서버에 접속하세요.\n접속하면 지도에 몬스터가 나타납니다.\n몬스터를 탭하여 공격하세요!',
                           vi: 'Nhấn ▶ để kết nối máy chủ game.\nSau khi kết nối, quái vật sẽ xuất hiện trên bản đồ.\nNhấn vào quái vật để tấn công!' },
  tut_step3_title:       { ko: '📦 보물 찾기',              vi: '📦 Tìm kho báu' },
  tut_step3_body:        { ko: '게임 서버 접속 후 금색 📦 아이콘을 찾으세요.\n가까이 접근 → 탭하여 공격 → HP 0이 되면 획득!\n획득한 박스는 🎒 인벤토리에서 열어보세요.',
                           vi: 'Sau khi kết nối, tìm biểu tượng 📦 màu vàng.\nĐến gần → Nhấn tấn công → Khi HP = 0 thì nhận được!\nMở hộp trong 🎒 Túi đồ.' },
  tut_prev:              { ko: '◀ 이전',                   vi: '◀ Trước' },
  tut_next:              { ko: '다음 ▶',                   vi: 'Tiếp ▶' },
  tut_done:              { ko: '시작하기 ✓',                vi: 'Bắt đầu ✓' },

  // ── 상점 ─────────────────────────────────────────────────────────────────────
  shop_too_far:          { ko: '상점과 너무 멀리 있습니다 (20m 이내 접근 필요)', vi: 'Bạn đang ở quá xa cửa hàng (cần đến trong vòng 20m)' },
  shop_buy_confirm:      { ko: '{0}개 구매 ({1} 골드)?',   vi: 'Mua {0} cái ({1} vàng)?' },
  shop_not_enough_gold:  { ko: '골드가 부족합니다',         vi: 'Không đủ vàng' },
  shop_buy_ok:           { ko: '{0} 구매 완료!',            vi: 'Đã mua {0} thành công!' },
  shop_buy_fail:         { ko: '구매 실패: {0}',            vi: 'Mua thất bại: {0}' },
  shop_out_of_stock:     { ko: '재고 없음',                 vi: 'Hết hàng' },
  shop_type_weapon:      { ko: '무기/방어구',               vi: 'Vũ khí / Giáp' },
  shop_type_potion:      { ko: '약물',                      vi: 'Thuốc' },
  shop_type_misc:        { ko: '잡템',                      vi: 'Đồ linh tinh' },
  shop_place_weapon:     { ko: '무기/방어구 상점 배치',      vi: 'Đặt cửa hàng vũ khí/giáp' },
  shop_place_potion:     { ko: '약물 상점 배치',            vi: 'Đặt cửa hàng thuốc' },
  shop_place_misc:       { ko: '잡템 상점 배치',            vi: 'Đặt cửa hàng đồ linh tinh' },
  shop_admin_title:      { ko: '상점 설정',                 vi: 'Cài đặt cửa hàng' },
  shop_admin_name:       { ko: '상점 이름',                 vi: 'Tên cửa hàng' },
  shop_admin_items:      { ko: '판매 아이템',               vi: 'Hàng bán' },
  shop_admin_item_id:    { ko: '아이템 ID',                 vi: 'ID vật phẩm' },
  shop_admin_item_name:  { ko: '아이템 이름',               vi: 'Tên vật phẩm' },
  shop_admin_price:      { ko: '가격 (골드)',               vi: 'Giá (vàng)' },
  shop_admin_stock:      { ko: '재고 (-1=무제한)',          vi: 'Tồn kho (-1=vô hạn)' },
  shop_admin_add_item:   { ko: '+ 아이템 추가',             vi: '+ Thêm vật phẩm' },
  shop_admin_save:       { ko: '저장',                      vi: 'Lưu' },
  shop_admin_delete:     { ko: '상점 삭제',                 vi: 'Xóa cửa hàng' },
  shop_admin_saved:      { ko: '상점이 저장되었습니다',      vi: 'Đã lưu cửa hàng' },
  shop_admin_deleted:    { ko: '상점이 삭제되었습니다',      vi: 'Đã xóa cửa hàng' },
  shop_name_prompt:      { ko: '상점 이름을 입력하세요',     vi: 'Nhập tên cửa hàng' },
  shop_enter_range:      { ko: '가까이 접근하세요! (20m 이내)', vi: 'Hãy đến gần hơn! (trong vòng 20m)' },
  shop_gold_label:       { ko: '골드',                      vi: 'Vàng' },

  // ── 바닥 드랍 시스템 ──────────────────────────────────────────────────────────
  drop_btn_title:        { ko: '버리기',                    vi: 'Bỏ' },
  pickup_btn_label:      { ko: '줍기',                      vi: 'Nhặt' },
  // {0} = itemId
  drop_confirm:          { ko: '{0} 1개를 바닥에 버리겠습니까?\n10분 후 자동 소각됩니다.', vi: 'Bỏ 1 {0} xuống đất?\nSẽ tự hủy sau 10 phút.' },
  drop_success:          { ko: '아이템을 버렸습니다',        vi: 'Đã bỏ vật phẩm' },
  drop_no_location:      { ko: '위치 정보를 확인할 수 없습니다', vi: 'Không thể xác định vị trí' },
  drop_no_item:          { ko: '인벤토리에 없는 아이템입니다', vi: 'Không có vật phẩm trong kho' },
  drop_insufficient:     { ko: '아이템이 부족합니다',        vi: 'Không đủ vật phẩm' },
  // {0} = label (아이템명)
  pickup_success:        { ko: '{0} 획득!',                  vi: 'Nhận được {0}!' },
  pickup_expired:        { ko: '아이템이 소각되었습니다',    vi: 'Vật phẩm đã bị hủy' },
  pickup_too_far:        { ko: '아이템에 더 가까이 접근하세요', vi: 'Hãy đến gần vật phẩm hơn' },
  pickup_gone:           { ko: '이미 누군가 주워갔습니다',   vi: 'Đã có người nhặt mất rồi' },
  // {0} = 아이템 이름
  drop_nearby_toast:     { ko: '📦 근처에 아이템이 있습니다! ({0})',
                           vi: '📦 Có vật phẩm gần đây! ({0})' },
  drop_nearby_hud:       { ko: '근처 아이템',               vi: 'Vật phẩm gần' },

  // ── 튜토리얼 보물박스 ─────────────────────────────────────────────────────────
  tutorial_init_fail:    { ko: '⚠️ 튜토리얼 초기화 실패',  vi: '⚠️ Khởi tạo hướng dẫn thất bại' },
  tutorial_location_needed: { ko: '📍 위치 권한이 필요합니다', vi: '📍 Cần quyền vị trí' },
};

/**
 * 번역 헬퍼
 * @param {string} key
 * @param {...string|number} args  — {0}, {1} 치환
 * @returns {string}
 */
export function _t(key, ...args) {
  const lang = (window.LANG || 'en');
  const entry = MESSAGES[key];
  if (!entry) return key;
  let str = entry[lang] ?? entry.en ?? key;
  args.forEach((v, i) => { str = str.replaceAll(`{${i}}`, v); });
  return str;
}
