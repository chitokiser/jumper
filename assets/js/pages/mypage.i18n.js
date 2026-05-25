// assets/js/pages/mypage.i18n.js
// ko / en / vi 다국어 지원

'use strict';

const SUPPORTED_LANGS = ['ko', 'en', 'vi'];

const MESSAGES = {
  // ── 페이지 ────────────────────────────────────────────────────────────────
  page_title:              { ko: '마이페이지', en: 'My Page', vi: 'Trang cá nhân' },
  need_login_desc:         { ko: '로그인이 필요합니다.', en: 'Please log in.', vi: 'Vui lòng đăng nhập.' },
  btn_login:               { ko: '구글 로그인', en: 'Google Login', vi: 'Đăng nhập Google' },

  // ── 미가입 ─────────────────────────────────────────────────────────────────
  no_profile_title:        { ko: '회원가입이 필요합니다', en: 'Registration Required', vi: 'Cần đăng ký' },
  no_profile_desc:         { ko: '수탁 지갑 생성 및 서비스 이용을 위해 먼저 회원가입을 완료해 주세요.', en: 'Complete registration to create a wallet and use the service.', vi: 'Hoàn tất đăng ký để tạo ví và sử dụng dịch vụ.' },
  btn_register:            { ko: '회원가입 하러 가기', en: 'Go to Register', vi: 'Đến trang đăng ký' },

  // ── 멘토 안내 ──────────────────────────────────────────────────────────────
  mentor_notice_title:     { ko: '⚠️ 멘토 연결 필요', en: '⚠️ Mentor Required', vi: '⚠️ Cần kết nối mentor' },
  mentor_notice_link:      { ko: '멘토 등록하기 ↓', en: 'Register Mentor ↓', vi: 'Đăng ký mentor ↓' },

  // ── 내 정보 ────────────────────────────────────────────────────────────────
  section_profile:         { ko: '내 정보', en: 'My Info', vi: 'Thông tin' },
  btn_edit:                { ko: '수정', en: 'Edit', vi: 'Sửa' },
  label_name:              { ko: '이름', en: 'Name', vi: 'Tên' },
  label_email:             { ko: '이메일', en: 'Email', vi: 'Email' },
  label_phone:             { ko: '전화번호', en: 'Phone', vi: 'Điện thoại' },

  // ── 수탁 지갑 ──────────────────────────────────────────────────────────────
  section_wallet:          { ko: '수탁 지갑', en: 'Custodial Wallet', vi: 'Ví ký thác' },
  btn_metamask:            { ko: 'MetaMask 연결', en: 'Connect MetaMask', vi: 'Kết nối MetaMask' },
  btn_create_wallet:       { ko: '지갑 생성', en: 'Create Wallet', vi: 'Tạo ví' },
  label_wallet_addr:       { ko: '지갑 주소', en: 'Wallet Address', vi: 'Địa chỉ ví' },
  btn_copy:                { ko: '📋 복사', en: '📋 Copy', vi: '📋 Sao chép' },
  label_onchain:           { ko: '온체인 등록', en: 'On-chain Status', vi: 'Trạng thái on-chain' },
  label_level:             { ko: '레벨', en: 'Level', vi: 'Cấp độ' },
  label_exp:               { ko: '경험치 (EXP)', en: 'EXP', vi: 'Kinh nghiệm (EXP)' },
  label_point:             { ko: '포인트(hex로 변경가능)', en: 'Points (→HEX)', vi: 'Điểm (→HEX)' },
  btn_redeem:              { ko: 'HEX로 전환', en: 'Convert to HEX', vi: 'Chuyển sang HEX' },
  label_my_mentor:         { ko: '나의 멘토', en: 'My Mentor', vi: 'Người hướng dẫn' },
  label_hex_balance:       { ko: '보유 HEX', en: 'HEX Balance', vi: 'Số dư HEX' },
  label_jump_balance:      { ko: '보유 JUMP', en: 'JUMP Balance', vi: 'Số dư JUMP' },
  label_jump_staked:       { ko: '스테이킹 JUMP', en: 'Staked JUMP', vi: 'JUMP đang stake' },

  // ── 온체인 상태 ────────────────────────────────────────────────────────────
  status_loading:          { ko: '조회 중...', en: 'Loading...', vi: 'Đang tải...' },
  status_registered:       { ko: '등록 완료 ✓', en: 'Registered ✓', vi: 'Đã đăng ký ✓' },
  status_not_registered:   { ko: '미등록', en: 'Not registered', vi: 'Chưa đăng ký' },
  status_error:            { ko: '조회 실패', en: 'Load failed', vi: 'Tải thất bại' },

  // ── EXP ───────────────────────────────────────────────────────────────────
  exp_remain:              { ko: '다음 레벨까지 {0} EXP 필요', en: '{0} EXP needed for next level', vi: 'Cần {0} EXP để lên cấp' },
  exp_can_levelup:         { ko: '레벨업 가능', en: 'Level up available', vi: 'Có thể lên cấp' },

  // ── 멘토 상태 ──────────────────────────────────────────────────────────────
  mentor_not_linked:       { ko: '미연결 (기본 멘토)', en: 'Not linked (default)', vi: 'Chưa liên kết (mặc định)' },

  // ── MetaMask 경고 ──────────────────────────────────────────────────────────
  no_wallet_hint:          { ko: '수탁 지갑이 아직 없습니다.\n멘토 지갑 주소를 입력한 후 지갑을 생성하세요.', en: 'No custodial wallet yet.\nEnter mentor wallet address to create one.', vi: 'Chưa có ví ký thác.\nNhập địa chỉ ví mentor để tạo ví.' },
  label_mentor_addr_field: { ko: '멘토 지갑 주소', en: 'Mentor Wallet Address', vi: 'Địa chỉ ví mentor' },
  btn_register_onchain:    { ko: '온체인 등록', en: 'Register On-chain', vi: 'Đăng ký on-chain' },

  // ── 멘토 등록 요청 ─────────────────────────────────────────────────────────
  btn_mentor_request:      { ko: '멘토 등록 요청', en: 'Request Mentor', vi: 'Yêu cầu mentor' },
  label_mentor_email:      { ko: '멘토 이메일', en: 'Mentor Email', vi: 'Email mentor' },
  mentor_req_done:         { ko: '✓ 요청이 접수되었습니다. 관리자 확인 후 반영됩니다.', en: '✓ Request received. Admin will process it.', vi: '✓ Yêu cầu đã ghi nhận. Admin sẽ xử lý.' },

  // ── HEX 이체 ───────────────────────────────────────────────────────────────
  section_hex_transfer:    { ko: 'HEX 개인 지갑 이체', en: 'HEX Transfer to Personal Wallet', vi: 'Chuyển HEX ra ví cá nhân' },
  label_to_wallet:         { ko: '수령 지갑 주소', en: 'Recipient Address', vi: 'Địa chỉ nhận' },
  label_transfer_amt:      { ko: '이체 수량 (HEX)', en: 'Transfer Amount (HEX)', vi: 'Số lượng chuyển (HEX)' },
  placeholder_all:         { ko: '비워 놓으면 전액 이체됨', en: 'Leave empty to transfer all', vi: 'Để trống để chuyển tất cả' },
  btn_transfer_hex:        { ko: '이체', en: 'Transfer', vi: 'Chuyển' },

  // ── HEX 충전 ───────────────────────────────────────────────────────────────
  section_deposit:         { ko: 'HEX 충전 (원화)', en: 'HEX Top-up (Fiat)', vi: 'Nạp HEX (tiền mặt)' },
  label_kr_account:        { ko: '🇰🇷 한국 계좌 (KRW 입금)', en: '🇰🇷 Korean Account (KRW)', vi: '🇰🇷 Tài khoản Hàn Quốc (KRW)' },
  label_vn_account:        { ko: '🇻🇳 베트남 계좌 (VND 입금)', en: '🇻🇳 Vietnam Account (VND)', vi: '🇻🇳 Tài khoản Việt Nam (VND)' },
  label_bank:              { ko: '은행', en: 'Bank', vi: 'Ngân hàng' },
  label_account_no:        { ko: '계좌번호', en: 'Account No.', vi: 'Số tài khoản' },
  label_account_holder:    { ko: '예금주', en: 'Account Holder', vi: 'Chủ tài khoản' },
  label_deposit_amt:       { ko: '충전 금액 (원)', en: 'Deposit Amount (KRW)', vi: 'Số tiền nạp (KRW)' },
  label_depositor:         { ko: '입금자명', en: "Depositor's Name", vi: 'Tên người nạp' },
  btn_deposit:             { ko: '충전 요청', en: 'Request Deposit', vi: 'Yêu cầu nạp' },
  deposit_warn:            { ko: '입금자명을 정확히 입력하세요. 관리자 확인 후 HEX 토큰이 수탁 지갑으로 지급됩니다.', en: 'Enter the depositor name accurately. HEX will be credited after admin confirmation.', vi: 'Nhập chính xác tên người nạp. HEX sẽ được cộng sau khi admin xác nhận.' },
  label_ref_code:          { ko: '참조코드', en: 'Reference Code', vi: 'Mã tham chiếu' },
  label_deposit_result_amount: { ko: '금액', en: 'Amount', vi: 'Số tiền' },
  label_deposit_result_hex: { ko: '충전 금액', en: 'Top-up Amount', vi: 'Số lượng nạp' },

  // ── 가맹점 결제 ────────────────────────────────────────────────────────────
  section_merchant_pay:    { ko: '가맹점 직접 결제', en: 'Direct Merchant Payment', vi: 'Thanh toán trực tiếp' },
  btn_qr_scan:             { ko: '📷 QR 스캔', en: '📷 QR Scan', vi: '📷 Quét QR' },
  label_select_merchant:   { ko: '가맹점 선택', en: 'Select Merchant', vi: 'Chọn cửa hàng' },
  label_currency:          { ko: '통화 선택', en: 'Currency', vi: 'Chọn tiền tệ' },
  label_pay_amount_vnd:    { ko: '결제 금액 (동 VND) *', en: 'Amount (VND) *', vi: 'Số tiền (VND) *' },
  label_pay_amount_krw:    { ko: '결제 금액 (원 KRW) *', en: 'Amount (KRW) *', vi: 'Số tiền (KRW) *' },
  btn_pay:                 { ko: '결제', en: 'Pay', vi: 'Thanh toán' },
  pay_result_merchant:     { ko: '가맹점', en: 'Merchant', vi: 'Cửa hàng' },
  pay_result_amount:       { ko: '결제 금액', en: 'Amount Paid', vi: 'Số tiền thanh toán' },
  pay_result_tx:           { ko: '트랜잭션', en: 'Transaction', vi: 'Giao dịch' },
  pay_done:                { ko: '결제가 완료되었습니다.', en: 'Payment completed.', vi: 'Thanh toán hoàn tất.' },

  // ── 충전 내역 ──────────────────────────────────────────────────────────────
  section_deposit_hist:    { ko: '충전 내역', en: 'Deposit History', vi: 'Lịch sử nạp tiền' },
  btn_refresh:             { ko: '새로고침', en: 'Refresh', vi: 'Làm mới' },
  deposit_empty:           { ko: '충전 내역이 없습니다.', en: 'No deposit history.', vi: 'Không có lịch sử nạp tiền.' },
  deposit_hist_error:      { ko: '충전 내역 조회에 실패했습니다.', en: 'Failed to load deposit history.', vi: 'Tải lịch sử nạp thất bại.' },
  reject_reason:           { ko: '사유:', en: 'Reason:', vi: 'Lý do:' },

  // ── 충전 상태 레이블 ───────────────────────────────────────────────────────
  status_pending:          { ko: '대기중', en: 'Pending', vi: 'Chờ xử lý' },
  status_processing:       { ko: '처리중', en: 'Processing', vi: 'Đang xử lý' },
  status_approved:         { ko: '완료 ✓', en: 'Done ✓', vi: 'Xong ✓' },
  status_rejected:         { ko: '반려', en: 'Rejected', vi: 'Bị từ chối' },

  // ── TX 유형 레이블 ─────────────────────────────────────────────────────────
  tx_buy:                  { ko: '충전', en: 'Top-up', vi: 'Nạp tiền' },
  tx_credit:               { ko: '포인트 지급', en: 'Points Credit', vi: 'Cộng điểm' },
  tx_p2p:                  { ko: 'P2P 수령', en: 'P2P Received', vi: 'Nhận P2P' },
  tx_p2p_merge:            { ko: 'P2P 합산', en: 'P2P Merged', vi: 'Gộp P2P' },
  tx_withdraw:             { ko: '인출', en: 'Withdrawal', vi: 'Rút tiền' },
  tx_pay_merchant:         { ko: '가맹점 결제', en: 'Merchant Payment', vi: 'Thanh toán' },
  tx_merchant_income:      { ko: '가맹점 수익', en: 'Merchant Income', vi: 'Thu nhập cửa hàng' },

  // ── 거래 내역 ──────────────────────────────────────────────────────────────
  section_tx:              { ko: '거래 내역', en: 'Transaction History', vi: 'Lịch sử giao dịch' },
  tx_total_income:         { ko: '총 수입', en: 'Total Income', vi: 'Tổng thu' },
  tx_total_expense:        { ko: '총 지출', en: 'Total Expense', vi: 'Tổng chi' },

  // ── 포인트·레벨 안내 ───────────────────────────────────────────────────────
  section_guide:           { ko: '포인트 · 레벨 안내', en: 'Points & Level Guide', vi: 'Hướng dẫn điểm & cấp độ' },

  // ── 나의 멘티 ──────────────────────────────────────────────────────────────
  section_mentee:          { ko: '나의 멘티', en: 'My Mentees', vi: 'Học viên của tôi' },
  mentee_loading:          { ko: '불러오는 중...', en: 'Loading...', vi: 'Đang tải...' },
  mentee_empty:            { ko: '등록된 멘티가 없습니다.', en: 'No mentees registered.', vi: 'Không có học viên.' },
  mentee_error:            { ko: '멘티 목록 조회에 실패했습니다.', en: 'Failed to load mentees.', vi: 'Tải danh sách học viên thất bại.' },
  mentee_count:            { ko: '총 {0}명', en: 'Total: {0}', vi: 'Tổng: {0} người' },
  mentee_join_date:        { ko: '가입일:', en: 'Joined:', vi: 'Ngày tham gia:' },

  // ── 멘티 수익 분석 ─────────────────────────────────────────────────────────
  section_mentee_income:   { ko: '💰 멘티 수익 분석', en: '💰 Mentee Income', vi: '💰 Thu nhập học viên' },
  mi_loading:              { ko: '불러오는 중...', en: 'Loading...', vi: 'Đang tải...' },
  mi_empty:                { ko: '등록된 멘티가 없습니다.', en: 'No mentees registered.', vi: 'Không có học viên.' },
  mi_error:                { ko: '오류: {0}', en: 'Error: {0}', vi: 'Lỗi: {0}' },
  mi_mentee_count:         { ko: '멘티 수', en: 'Mentees', vi: 'Số học viên' },
  mi_tx_count:             { ko: '총 결제 건수', en: 'Total Payments', vi: 'Tổng giao dịch' },
  mi_total_earning:        { ko: '누적 수익 (추정)', en: 'Total Earnings (est.)', vi: 'Tổng thu nhập (ước tính)' },
  mi_fee_note:             { ko: 'fee × 30% 합산', en: 'fee × 30% sum', vi: 'phí × 30% cộng lại' },
  mi_points_balance:       { ko: '현재 포인트 잔액', en: 'Current Points Balance', vi: 'Số dư điểm hiện tại' },
  mi_onchain_realtime:     { ko: '온체인 실시간', en: 'On-chain realtime', vi: 'Thời gian thực on-chain' },
  mi_join_short:           { ko: '가입 {0}', en: 'Joined {0}', vi: 'Tham gia {0}' },
  mi_cumulative_earn:      { ko: '누적 수익 (추정)', en: 'Cumulative Earnings (est.)', vi: 'Thu nhập tích lũy (ước tính)' },
  mi_stat_tx_count:        { ko: '결제 횟수', en: 'Payment Count', vi: 'Số lần thanh toán' },
  mi_stat_total_hex:       { ko: '총 결제액 HEX', en: 'Total Payment HEX', vi: 'Tổng HEX thanh toán' },
  mi_stat_mentor_earn:     { ko: '내 멘토 수익', en: 'My Mentor Earnings', vi: 'Thu nhập mentor' },
  mi_recent_tx:            { ko: '최근 결제 내역', en: 'Recent Payments', vi: 'Giao dịch gần đây' },
  mi_tx_no_data:           { ko: '결제 내역 없음', en: 'No payments', vi: 'Không có giao dịch' },
  mi_tx_row:               { ko: '결제 {0} HEX → 내 수익 {1} HEX', en: 'Payment {0} HEX → My earnings {1} HEX', vi: 'Thanh toán {0} HEX → Thu nhập {1} HEX' },
  mi_mentees_label:        { ko: '명', en: '', vi: ' người' },
  mi_payments_label:       { ko: '건', en: '', vi: ' lần' },

  // ── 잭팟 ───────────────────────────────────────────────────────────────────
  section_jackpot:         { ko: '🎰 잭팟 당첨 내역', en: '🎰 Jackpot History', vi: '🎰 Lịch sử trúng thưởng' },
  jackpot_stat_total:      { ko: '누적 잭팟 당첨', en: 'Total Jackpot Wins', vi: 'Tổng lần trúng jackpot' },
  jackpot_stat_redeemable: { ko: 'HEX 전환 가능 포인트', en: 'Redeemable Points (HEX)', vi: 'Điểm có thể đổi HEX' },
  jackpot_stat_min:        { ko: '10 HEX 이상 시 전환 가능', en: 'Min 10 HEX to convert', vi: 'Tối thiểu 10 HEX để chuyển đổi' },
  jackpot_total_count:     { ko: '총 {0}회 당첨', en: 'Total {0} wins', vi: 'Tổng {0} lần trúng' },
  jackpot_empty:           { ko: '아직 잭팟 당첨 내역이 없습니다.', en: 'No jackpot wins yet.', vi: 'Chưa có lần trúng jackpot nào.' },
  jackpot_building:        { ko: '인덱스 빌드 중 (1~5분 소요)', en: 'Index building (1–5 min)', vi: 'Đang xây dựng chỉ mục (1–5 phút)' },
  jackpot_retry_msg:       { ko: '인덱스 빌드 중입니다. 잠시 후 새로고침 해주세요.', en: 'Index is building. Please refresh in a moment.', vi: 'Chỉ mục đang xây dựng. Vui lòng làm mới sau.' },
  jackpot_err:             { ko: '오류: {0}', en: 'Error: {0}', vi: 'Lỗi: {0}' },
  jackpot_hist_title:      { ko: '잭팟 당첨 · {0}', en: 'Jackpot · {0}', vi: 'Trúng jackpot · {0}' },
  jackpot_merchant_default:{ ko: '가맹점', en: 'Merchant', vi: 'Cửa hàng' },
  jackpot_item_reward:     { ko: '아이템 보상', en: 'Item Reward', vi: 'Phần thưởng vật phẩm' },
  jackpot_loading:         { ko: '불러오는 중...', en: 'Loading...', vi: 'Đang tải...' },
  jp_onchain_badge:        { ko: '온체인', en: 'On-chain', vi: 'On-chain' },
  jp_pts_label:            { ko: 'HEX 포인트', en: 'HEX pts', vi: 'điểm HEX' },

  // ── 아이템 이름 ────────────────────────────────────────────────────────────
  item_potion:             { ko: '빨간약', en: 'HP Potion', vi: 'Thuốc đỏ' },
  item_mp_potion:          { ko: '마법약', en: 'MP Potion', vi: 'Thuốc phép' },
  item_revive:             { ko: '부활권', en: 'Revive Ticket', vi: 'Vé hồi sinh' },
  item_drop_title:         { ko: '🎁 득템!', en: '🎁 Item Drop!', vi: '🎁 Nhận được vật phẩm!' },

  // ── 잭팟 모달 ──────────────────────────────────────────────────────────────
  jm_jackpot_title:        { ko: 'JACKPOT!! 🎰', en: 'JACKPOT!! 🎰', vi: 'JACKPOT!! 🎰' },
  jm_jackpot_desc:         { ko: '잭팟 당첨! 아이템을 획득했습니다.', en: 'Jackpot! You received items.', vi: 'Trúng jackpot! Nhận được vật phẩm.' },
  jm_onchain_title:        { ko: '잭팟 포인트 당첨!', en: 'Jackpot Points!', vi: 'Trúng điểm jackpot!' },
  jm_onchain_desc:         { ko: '온체인 복권 당첨! {0} HEX 포인트 적립', en: 'On-chain lottery win! +{0} HEX points', vi: 'Trúng xổ số on-chain! +{0} HEX điểm' },
  jm_item_title:           { ko: '아이템 획득!', en: 'Item Received!', vi: 'Nhận được vật phẩm!' },
  jm_item_desc:            { ko: '결제 보상으로 아이템을 받았습니다.', en: 'You received items as payment rewards.', vi: 'Nhận được vật phẩm từ thanh toán.' },
  jm_confirm:              { ko: '확인', en: 'OK', vi: 'Xác nhận' },
  jm_jackpot_pts:          { ko: '잭팟 포인트', en: 'Jackpot Points', vi: 'Điểm jackpot' },

  // ── 바우처 지갑 ────────────────────────────────────────────────────────────
  section_voucher:         { ko: '내 바우처 지갑', en: 'My Voucher Wallet', vi: 'Ví voucher của tôi' },
  btn_show_qr:             { ko: '📲 내 수탁 지갑 주소 QR 보기', en: '📲 Show Wallet QR', vi: '📲 Xem QR ví' },
  voucher_empty:           { ko: '보유한 바우처가 없습니다.', en: 'No vouchers found.', vi: 'Không có voucher nào.' },
  voucher_loading:         { ko: '불러오는 중...', en: 'Loading...', vi: 'Đang tải...' },
  btn_voucher_transfer:    { ko: '이체', en: 'Transfer', vi: 'Chuyển' },
  btn_voucher_burn:        { ko: '소각', en: 'Burn', vi: 'Đốt' },
  voucher_wallet_title:    { ko: '내 수탁 지갑 주소 (상대방에게 보여주세요)', en: 'My Custodial Wallet (show to recipient)', vi: 'Địa chỉ ví ký thác (cho người nhận xem)' },
  btn_copy_addr:           { ko: '주소 복사', en: 'Copy Address', vi: 'Sao chép địa chỉ' },
  btn_copy_done:           { ko: '복사됨!', en: 'Copied!', vi: 'Đã sao chép!' },
  btn_hide_qr:             { ko: '닫기', en: 'Close', vi: 'Đóng' },
  voucher_game_badge:      { ko: '🎮 게임', en: '🎮 Game', vi: '🎮 Game' },
  voucher_shop_badge:      { ko: '🛍 쇼핑몰', en: '🛍 Shop', vi: '🛍 Cửa hàng' },
  voucher_default_name:    { ko: '바우처', en: 'Voucher', vi: 'Voucher' },
  voucher_usage_label:     { ko: '보상:', en: 'Reward:', vi: 'Phần thưởng:' },
  voucher_game_src:        { ko: '게임에서 획득한 바우처', en: 'Voucher earned in game', vi: 'Voucher nhận được trong game' },
  voucher_price:           { ko: '가격: {0} HEX', en: 'Price: {0} HEX', vi: 'Giá: {0} HEX' },
  voucher_refund:          { ko: '소각 환급: {0} HEX', en: 'Burn refund: {0} HEX', vi: 'Hoàn đốt: {0} HEX' },
  voucher_load_error:      { ko: '바우처 조회 실패: {0}', en: 'Voucher load failed: {0}', vi: 'Tải voucher thất bại: {0}' },

  // ── 이체 패널 ──────────────────────────────────────────────────────────────
  transfer_title:          { ko: '바우처 이체', en: 'Voucher Transfer', vi: 'Chuyển voucher' },
  transfer_desc:           { ko: '바우처 {0}을(를) 이체할 지갑 주소를 입력하세요.', en: 'Enter wallet address to transfer voucher {0}.', vi: 'Nhập địa chỉ ví để chuyển voucher {0}.' },
  btn_transfer_confirm:    { ko: '이체 확인', en: 'Confirm Transfer', vi: 'Xác nhận chuyển' },
  btn_cancel:              { ko: '취소', en: 'Cancel', vi: 'Hủy' },
  transfer_no_addr:        { ko: '지갑 주소를 입력하세요.', en: 'Enter a wallet address.', vi: 'Nhập địa chỉ ví.' },
  transfer_pending:        { ko: '이체 중...', en: 'Transferring...', vi: 'Đang chuyển...' },
  transfer_done:           { ko: '이체 완료!', en: 'Transfer complete!', vi: 'Chuyển xong!' },
  transfer_error:          { ko: '이체 실패: {0}', en: 'Transfer failed: {0}', vi: 'Chuyển thất bại: {0}' },
  btn_qr_scan_addr:        { ko: '📷 스캔', en: '📷 Scan', vi: '📷 Quét' },

  // ── 소각 패널 ──────────────────────────────────────────────────────────────
  burn_title:              { ko: '🔥 바우처 소각', en: '🔥 Burn Voucher', vi: '🔥 Đốt voucher' },
  burn_confirm_btn:        { ko: '소각 확인', en: 'Confirm Burn', vi: 'Xác nhận đốt' },
  burn_game_note:          { ko: '게임 바우처는 HEX 환급이 없습니다.', en: 'Game vouchers have no HEX refund.', vi: 'Voucher game không hoàn lại HEX.' },
  burn_info:               { ko: '{0}을(를) 소각하면 <strong>{1} HEX</strong>{2}를 환급받고 <strong>{3} HEX</strong>는 수수료로 차감됩니다.', en: 'Burning {0} refunds <strong>{1} HEX</strong>{2} and deducts <strong>{3} HEX</strong> as fee.', vi: 'Đốt {0} hoàn <strong>{1} HEX</strong>{2} và trừ <strong>{3} HEX</strong> phí.' },
  burn_game_info:          { ko: '<strong>{0}</strong>을(를) 소각합니다.<br><span style="color:#9ca3af;font-size:0.85em;">게임 바우처는 HEX 환급이 없습니다.</span>', en: 'Burning <strong>{0}</strong>.<br><span style="color:#9ca3af;font-size:0.85em;">Game vouchers have no HEX refund.</span>', vi: 'Đốt <strong>{0}</strong>.<br><span style="color:#9ca3af;font-size:0.85em;">Voucher game không hoàn lại HEX.</span>' },
  burn_step1:              { ko: '소각 요청 전송 중', en: 'Sending burn request', vi: 'Đang gửi yêu cầu đốt' },
  burn_step2_onchain:      { ko: '스마트 컨트랙트 실행 중', en: 'Executing smart contract', vi: 'Đang thực thi hợp đồng' },
  burn_step2_game:         { ko: '바우처 기록 삭제 중', en: 'Deleting voucher record', vi: 'Đang xóa bản ghi voucher' },
  burn_step3_onchain:      { ko: 'HEX 환급 처리 중', en: 'Processing HEX refund', vi: 'Đang xử lý hoàn HEX' },
  burn_step3_game:         { ko: '삭제 확인 중', en: 'Confirming deletion', vi: 'Đang xác nhận xóa' },
  burn_step4:              { ko: '완료 확인', en: 'Completion check', vi: 'Kiểm tra hoàn thành' },
  burn_done_game:          { ko: '✅ 소각 완료! 바우처가 삭제되었습니다.', en: '✅ Burned! Voucher deleted.', vi: '✅ Đã đốt! Voucher đã bị xóa.' },
  burn_done_onchain:       { ko: '✅ 소각 완료! HEX가 지갑으로 전송되었습니다.', en: '✅ Burned! HEX sent to wallet.', vi: '✅ Đã đốt! HEX đã gửi vào ví.' },
  burn_error:              { ko: '❌ 소각 실패: {0}', en: '❌ Burn failed: {0}', vi: '❌ Đốt thất bại: {0}' },
  burn_selected_voucher:   { ko: '선택된 바우처', en: 'Selected voucher', vi: 'Voucher đã chọn' },

  // ── Alert 메시지 ───────────────────────────────────────────────────────────
  alert_mentor_addr_invalid: { ko: '멘토 지갑 주소를 올바르게 입력하세요.\n예: 0x로 시작하는 42자리 주소', en: 'Enter a valid mentor wallet address.\nExample: 42-char address starting with 0x', vi: 'Nhập địa chỉ ví mentor hợp lệ.\nVí dụ: địa chỉ 42 ký tự bắt đầu bằng 0x' },
  alert_wallet_created:    { ko: '수탁 지갑이 생성되었습니다.', en: 'Custodial wallet created.', vi: 'Ví ký thác đã được tạo.' },
  alert_wallet_error:      { ko: '지갑 생성 실패: {0}', en: 'Wallet creation failed: {0}', vi: 'Tạo ví thất bại: {0}' },
  alert_creating:          { ko: '생성 중...', en: 'Creating...', vi: 'Đang tạo...' },
  alert_processing:        { ko: '처리 중...', en: 'Processing...', vi: 'Đang xử lý...' },
  alert_requesting:        { ko: '요청 중...', en: 'Requesting...', vi: 'Đang yêu cầu...' },
  alert_registering:       { ko: '등록 중...', en: 'Registering...', vi: 'Đang đăng ký...' },
  alert_levelup_confirm:   { ko: '레벨업을 진행하시겠습니까?\n조건 충족 시 레벨이 상승합니다.', en: 'Proceed with level up?\nYou will level up if conditions are met.', vi: 'Xác nhận lên cấp?\nCấp độ sẽ tăng nếu đủ điều kiện.' },
  alert_levelup_done:      { ko: '레벨업 완료! Lv.{0}', en: 'Level up! Lv.{0}', vi: 'Lên cấp! Lv.{0}' },
  alert_levelup_error:     { ko: '레벨업 실패: {0}', en: 'Level up failed: {0}', vi: 'Lên cấp thất bại: {0}' },
  btn_level_up:            { ko: '레벨업 가능! →', en: 'Level Up! →', vi: 'Lên cấp! →' },
  redeem_not_enough:       { ko: '포인트가 부족합니다. 10 HEX 이상 적립 후 전환할 수 있습니다.\n현재: {0} HEX', en: 'Insufficient points. Need at least 10 HEX.\nCurrent: {0} HEX', vi: 'Không đủ điểm. Cần ít nhất 10 HEX.\nHiện tại: {0} HEX' },
  redeem_confirm:          { ko: '포인트를 HEX로 전환하시겠습니까?', en: 'Convert points to HEX?', vi: 'Chuyển điểm sang HEX?' },
  redeem_loading:          { ko: '전환 중...', en: 'Converting...', vi: 'Đang chuyển...' },
  redeem_result_amount:    { ko: '전환 금액', en: 'Amount Converted', vi: 'Số tiền đổi' },
  redeem_result_tx:        { ko: '트랜잭션', en: 'Transaction', vi: 'Giao dịch' },
  redeem_done:             { ko: 'HEX 전환이 완료되었습니다.', en: 'HEX conversion complete.', vi: 'Đã chuyển đổi HEX xong.' },
  redeem_error:            { ko: '전환 실패: {0}', en: 'Conversion failed: {0}', vi: 'Chuyển thất bại: {0}' },
  redeem_btn:              { ko: 'HEX로 전환', en: 'Convert to HEX', vi: 'Chuyển sang HEX' },
  onchain_reg_error:       { ko: '온체인 등록 실패: {0}', en: 'On-chain registration failed: {0}', vi: 'Đăng ký on-chain thất bại: {0}' },
  onchain_reg_btn:         { ko: '등록', en: 'Register', vi: 'Đăng ký' },
  deposit_min_error:       { ko: '입금 금액은 10,000원 이상이어야 합니다.', en: 'Minimum deposit is ₩10,000.', vi: 'Số tiền nạp tối thiểu là ₩10,000.' },
  deposit_name_error:      { ko: '입금자명을 입력해 주세요.', en: 'Enter the depositor name.', vi: 'Nhập tên người nạp tiền.' },
  deposit_loading:         { ko: '요청 중...', en: 'Requesting...', vi: 'Đang yêu cầu...' },
  deposit_error_alert:     { ko: '충전 요청 실패: {0}', en: 'Deposit request failed: {0}', vi: 'Yêu cầu nạp thất bại: {0}' },
  deposit_btn_after:       { ko: '입금 요청', en: 'Request Deposit', vi: 'Yêu cầu nạp' },
  mentor_email_error:      { ko: '멘토 이메일을 입력해 주세요.', en: 'Enter mentor email.', vi: 'Nhập email mentor.' },
  mentor_req_error:        { ko: '멘토 요청 실패: {0}', en: 'Mentor request failed: {0}', vi: 'Yêu cầu mentor thất bại: {0}' },
  mentor_req_btn_label:    { ko: '멘토 요청', en: 'Request Mentor', vi: 'Yêu cầu mentor' },
  merchant_select_placeholder: { ko: '가맹점을 선택하세요', en: 'Select a merchant', vi: 'Chọn cửa hàng' },
  merchant_empty_list:     { ko: '결제 가능한 가맹점이 없습니다', en: 'No merchants available', vi: 'Không có cửa hàng nào' },
  merchant_load_error:     { ko: '가맹점 목록 조회에 실패했습니다', en: 'Failed to load merchants', vi: 'Tải danh sách cửa hàng thất bại' },
  merchant_loading:        { ko: '불러오는 중...', en: 'Loading...', vi: 'Đang tải...' },
  merchant_select_error:   { ko: '가맹점을 선택해 주세요.', en: 'Please select a merchant.', vi: 'Vui lòng chọn cửa hàng.' },
  pay_vnd_min_error:       { ko: 'VND 최소 결제 금액은 10,000동입니다.', en: 'Minimum VND payment is 10,000 VND.', vi: 'Số tiền tối thiểu là 10.000 VND.' },
  pay_krw_min_error:       { ko: 'KRW 최소 결제 금액은 1,000원입니다.', en: 'Minimum KRW payment is ₩1,000.', vi: 'Số tiền tối thiểu là ₩1,000.' },
  pay_confirm_vnd:         { ko: '{0}동 (VND)을 결제하시겠습니까?', en: 'Pay {0} VND?', vi: 'Thanh toán {0} VND?' },
  pay_confirm_krw:         { ko: '{0}원 (KRW)을 결제하시겠습니까?', en: 'Pay ₩{0} KRW?', vi: 'Thanh toán {0} KRW?' },
  pay_loading:             { ko: '결제 중...', en: 'Paying...', vi: 'Đang thanh toán...' },
  pay_error:               { ko: '결제 실패: {0}', en: 'Payment failed: {0}', vi: 'Thanh toán thất bại: {0}' },
  pay_btn_label:           { ko: '결제', en: 'Pay', vi: 'Thanh toán' },

  // ── QR 스캔 ────────────────────────────────────────────────────────────────
  qr_start:                { ko: '카메라 시작 중...', en: 'Starting camera...', vi: 'Đang khởi động camera...' },
  qr_hint:                 { ko: 'QR 코드를 사각형 안에 맞춰주세요', en: 'Align QR code in the square', vi: 'Căn QR vào khung vuông' },
  qr_recognized:           { ko: '인식: {0} | ID: {1}', en: 'Detected: {0} | ID: {1}', vi: 'Nhận dạng: {0} | ID: {1}' },
  qr_success:              { ko: '✅ QR 스캔 완료 — 가맹점: {0}, 금액: {1}', en: '✅ QR scanned — Merchant: {0}, Amount: {1}', vi: '✅ Quét QR xong — Cửa hàng: {0}, Số tiền: {1}' },
  qr_amount_only:          { ko: '✅ 금액 {0} 반영 완료. 가맹점을 직접 선택해 주세요.', en: '✅ Amount {0} applied. Please select a merchant.', vi: '✅ Đã áp dụng số tiền {0}. Vui lòng chọn cửa hàng.' },
  qr_loading_merchant:     { ko: '가맹점 정보 조회 중...', en: 'Loading merchant info...', vi: 'Đang tải thông tin cửa hàng...' },
  qr_merchant_not_found:   { ko: '가맹점(ID: {0})을 찾을 수 없습니다 — 직접 선택해 주세요.', en: 'Merchant (ID: {0}) not found — select manually.', vi: 'Không tìm thấy cửa hàng (ID: {0}) — chọn thủ công.' },
  qr_merchant_fail:        { ko: '가맹점 조회 실패 — 직접 선택해 주세요.', en: 'Merchant lookup failed — select manually.', vi: 'Tra cứu cửa hàng thất bại — chọn thủ công.' },
  qr_parse_fail:           { ko: 'QR 파싱 실패 — 원본: {0}', en: 'QR parse failed — raw: {0}', vi: 'Phân tích QR thất bại — gốc: {0}' },
  qr_scan_progress:        { ko: '스캔 중... ({0}) QR 코드를 사각형 안에 맞춰주세요', en: 'Scanning... ({0}) Align QR in square', vi: 'Đang quét... ({0}) Căn QR vào khung' },
  qr_camera_fail:          { ko: '카메라 사용 실패', en: 'Camera access failed', vi: 'Truy cập camera thất bại' },
  qr_camera_error_alert:   { ko: '카메라 접근 실패: {0}', en: 'Camera access failed: {0}', vi: 'Truy cập camera thất bại: {0}' },
  qr_jsqr_fail:            { ko: 'jsQR 라이브러리 로드 실패 — 페이지를 새로고침 해주세요.', en: 'jsQR library failed — please refresh.', vi: 'Thư viện jsQR thất bại — vui lòng tải lại trang.' },
  qr_scan_progress2:       { ko: '스캔 중... QR 코드를 사각형 안에 맞춰주세요', en: 'Scanning... Align QR in square', vi: 'Đang quét... Căn QR vào khung' },
  qr_recognized_short:     { ko: '인식: {0}…', en: 'Detected: {0}…', vi: 'Nhận dạng: {0}…' },

  // ── MetaMask 연결 ──────────────────────────────────────────────────────────
  mm_open_app:             { ko: 'MetaMask 앱으로 열기', en: 'Open in MetaMask App', vi: 'Mở trong MetaMask App' },
  mm_install:              { ko: 'MetaMask 설치 필요', en: 'Install MetaMask', vi: 'Cần cài MetaMask' },
  mm_connecting:           { ko: '연결 중...', en: 'Connecting...', vi: 'Đang kết nối...' },
  mm_cancel:               { ko: '서명이 취소되었습니다.', en: 'Signing was cancelled.', vi: 'Đã hủy ký.' },
  mm_error:                { ko: 'MetaMask 연결 실패: {0}', en: 'MetaMask connection failed: {0}', vi: 'Kết nối MetaMask thất bại: {0}' },

  // ── 캐시 초기화 ────────────────────────────────────────────────────────────
  cache_loading:           { ko: '초기화 중...', en: 'Clearing...', vi: 'Đang xóa...' },
  cache_done:              { ko: '캐시가 삭제되었습니다. 3초 후 새로고침...', en: 'Cache cleared. Refreshing in 3s...', vi: 'Đã xóa cache. Làm mới sau 3 giây...' },
  cache_error:             { ko: '초기화 실패: {0}', en: 'Clear failed: {0}', vi: 'Xóa thất bại: {0}' },

  // ── 바우처 QR ──────────────────────────────────────────────────────────────
  voucher_no_login:        { ko: '로그인이 필요합니다', en: 'Login required', vi: 'Cần đăng nhập' },
  voucher_no_wallet:       { ko: '수탁 지갑이 없습니다. 먼저 지갑을 생성해 주세요.', en: 'No custodial wallet. Please create one first.', vi: 'Chưa có ví ký thác. Vui lòng tạo ví trước.' },
  voucher_wallet_loading:  { ko: '불러오는 중...', en: 'Loading...', vi: 'Đang tải...' },
  voucher_wallet_btn_label: { ko: '📲 내 수탁 지갑 주소 QR 보기', en: '📲 Show My Wallet QR', vi: '📲 Xem QR ví của tôi' },

  // ── 통화 단위 ──────────────────────────────────────────────────────────────
  krw_unit:                { ko: '원', en: 'KRW', vi: 'KRW' },
  vnd_unit:                { ko: '동', en: 'VND', vi: 'đồng' },
  fee_pct:                 { ko: '수수료 {0}%', en: 'Fee {0}%', vi: 'Phí {0}%' },
  jackpot_inline:          { ko: '잭팟', en: 'Jackpot', vi: 'Jackpot' },
  addr_lookup_fail:        { ko: '주소 조회 실패', en: 'Address lookup failed', vi: 'Tra cứu địa chỉ thất bại' },
  placeholder_vnd_amount:  { ko: '예: 200000', en: 'e.g. 200000', vi: 'VD: 200000' },
  placeholder_krw_amount:  { ko: '예: 30000', en: 'e.g. 30000', vi: 'VD: 30000' },
  server_error:            { ko: '서버 오류', en: 'Server error', vi: 'Lỗi máy chủ' },
};

function _t(key, ...args) {
  const lang = window.LANG || 'ko';
  const entry = MESSAGES[key];
  if (!entry) return key;
  let text = entry[lang] ?? entry['ko'] ?? key;
  args.forEach((v, i) => { text = text.replaceAll(`{${i}}`, v ?? ''); });
  return text;
}

function initLang() {
  const saved = localStorage.getItem('lang');
  window.LANG = SUPPORTED_LANGS.includes(saved) ? saved : 'ko';

  // data-i18n 속성 적용
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    // innerHTML 허용 키 (bold 태그 포함 등)
    if (el.hasAttribute('data-i18n-html')) {
      el.innerHTML = _t(key);
    } else {
      el.textContent = _t(key);
    }
  });

  // 언어 스위처 버튼 활성 상태 업데이트
  document.querySelectorAll('.mp-lang-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === window.LANG);
  });
}

function renderLangSwitcher(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  el.innerHTML = SUPPORTED_LANGS.map((lang) => {
    const flags  = { ko: '🇰🇷', en: '🇬🇧', vi: '🇻🇳' };
    const titles = { ko: '한국어', en: 'English', vi: 'Tiếng Việt' };
    return `<button class="mp-lang-btn${lang === (window.LANG || 'ko') ? ' active' : ''}" data-lang="${lang}" title="${titles[lang]}">${flags[lang]}</button>`;
  }).join('');

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.mp-lang-btn');
    if (!btn) return;
    const lang = btn.dataset.lang;
    if (!SUPPORTED_LANGS.includes(lang)) return;
    window.LANG = lang;
    localStorage.setItem('lang', lang);
    initLang();
  });
}

export { _t, initLang, renderLangSwitcher };
