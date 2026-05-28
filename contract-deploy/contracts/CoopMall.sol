// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ─────────────────────────────────────────────────────────
// IERC20 (최소)
// ─────────────────────────────────────────────────────────
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

// ─────────────────────────────────────────────────────────
// IJumpBank — jumpBank.sol price getter (HEX wei per 1 JUMP)
// ─────────────────────────────────────────────────────────
interface IJumpBank {
    function price() external view returns (uint256);
}

// ─────────────────────────────────────────────────────────
// CoopMall v4
//
// 회비 규칙:
//   - 금액: 관리자 설정 가능 (기본 10 HEX)
//   - 유효기간: 1년 고정 (만료 후 재가입 가능)
//   - 회비의 20% → 직속 멘토 포인트 적립
//   - 회비의 60% → jumpBank 자동 이체
//   - 회비만큼 JUMP 토큰 지급
//
// 상품 구매:
//   - 판매금의 40% → jumpBank 자동 이체
//   - 판매금의 mentorRewardBps% → 직속 멘토 포인트 적립
//
// jumpBank: 0x16752f8948ff2caA02e756c7C8fF0E04887A3a0E
// ─────────────────────────────────────────────────────────
contract CoopMall {

    // ── 토큰 / 외부 컨트랙트 ─────────────────────────────
    IERC20    public hexToken;
    IERC20    public jumpToken;
    IJumpBank public jumpBank;

    // ── 관리자 ──────────────────────────────────────────
    address public owner;

    // ── 설정값 ──────────────────────────────────────────
    uint256 public membershipFeeHex = 10e18;  // 기본 10 HEX (wei), 관리자 변경 가능
    uint16  public mentorRewardBps  = 1000;   // 상품 구매 멘토 보상 기본 10%
    uint16  constant MEMBER_MENTOR_BPS = 2000; // 회비 멘토 보상 20% 고정
    uint16  constant MAX_MENTOR_BPS    = 3000; // 30% 한도
    uint16  constant BPS               = 10000;
    uint16  constant FEE_BANK_BPS      = 6000; // 회비 60% → jumpBank
    uint16  constant SALE_BANK_BPS     = 4000; // 상품 판매 40% → jumpBank
    uint256 constant MEMBERSHIP_DURATION = 365 days; // 유효기간 1년 고정

    // ── 포인트 준비금 / 바우처 준비금 ────────────────────
    uint256 public totalPoints;
    uint256 public totalVoucherReserve;

    // ── 회원 정보 ────────────────────────────────────────
    struct User {
        bool    eligible;    // 관리자가 자격 부여
        bool    member;      // 회비 납부 이력 (만료 포함)
        address mentor;      // 직속 멘토
        uint256 points;      // 적립 포인트 (HEX wei)
        uint256 memberSince; // 가입/갱신 시각 (block.timestamp)
    }
    mapping(address => User) public users;

    // ── 바우처 템플릿 ─────────────────────────────────────
    struct VoucherTemplate {
        uint256 hexPrice;
        uint16  burnFeeBps;
        bool    active;
        string  description;
        string  usagePlace;
        string  imageURI;
    }
    mapping(uint256 => VoucherTemplate) public voucherTemplates;
    uint256 public voucherTemplateCount;

    // ── 바우처 인스턴스 ───────────────────────────────────
    struct Voucher {
        uint256 templateId;
        address owner;
        bool    burned;
    }
    mapping(uint256 => Voucher) public vouchers;
    uint256 public voucherCount;
    mapping(address => uint256[]) private _ownedVouchers;

    // ── 결제 기록 ────────────────────────────────────────
    struct Payment {
        address buyer;
        uint256 hexAmount;
        uint256 timestamp;
        bool    isMembershipFee;
    }
    Payment[] private _payments;

    // ── 이벤트 ──────────────────────────────────────────
    event EligibilityGranted(address indexed user, address indexed mentor);
    event MemberJoined(address indexed user, uint256 feeHex, uint256 jumpGiven, uint256 bankAmount, bool renewed);
    event Paid(address indexed buyer, uint256 hexAmount, uint256 mentorPoints, uint256 bankAmount);
    event PointsConverted(address indexed user, uint256 pts, uint256 upperBonus);
    event MembershipFeeChanged(uint256 newFeeWei);
    event MentorBpsChanged(uint16 newBps);
    event HexWithdrawn(address indexed to, uint256 amount);
    event JumpWithdrawn(address indexed to, uint256 amount);
    event VoucherTemplateCreated(uint256 indexed templateId, uint256 hexPrice, uint16 burnFeeBps);
    event VoucherTemplateUpdated(uint256 indexed templateId);
    event VoucherBought(uint256 indexed voucherId, uint256 indexed templateId, address indexed buyer, uint256 bankAmount);
    event VoucherTransferred(uint256 indexed voucherId, address indexed from, address indexed to);
    event VoucherBurned(uint256 indexed voucherId, address indexed owner, uint256 hexReturned, uint256 feeKept);

    // ── 접근 제어 ────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "ONLY_OWNER");
        _;
    }
    modifier onlyMember() {
        require(_isActiveMember(msg.sender), "NOT_ACTIVE_MEMBER");
        _;
    }

    // ─────────────────────────────────────────────────────
    // 생성자
    // ─────────────────────────────────────────────────────
    constructor(address _hex, address _jump, address _jumpBank) {
        hexToken  = IERC20(_hex);
        jumpToken = IERC20(_jump);
        jumpBank  = IJumpBank(_jumpBank);
        owner     = msg.sender;
    }

    // ─────────────────────────────────────────────────────
    // [관리자] 입장 자격 부여
    //   - 활성 회원은 재부여 불가 (만료 후 가능)
    // ─────────────────────────────────────────────────────
    function grantEligibility(address user, address mentor) external onlyOwner {
        require(user != address(0), "ZERO_ADDR");
        require(user != mentor, "SELF_MENTOR");
        require(!_isActiveMember(user), "ALREADY_ACTIVE_MEMBER");

        users[user].eligible = true;
        users[user].mentor   = mentor;

        emit EligibilityGranted(user, mentor);
    }

    // ─────────────────────────────────────────────────────
    // [회원] 회비 납부 → 몰 가입 / 갱신
    //   - 만료 후 재가입 가능
    //   - 회비의 20% → 직속 멘토 포인트
    //   - 회비의 60% → jumpBank 자동 이체
    //   - 회비만큼 JUMP 지급 (잔고 있을 때)
    // ─────────────────────────────────────────────────────
    function joinMall() external {
        User storage u = users[msg.sender];
        require(u.eligible, "NOT_ELIGIBLE");

        bool expired = u.member && block.timestamp >= u.memberSince + MEMBERSHIP_DURATION;
        require(!u.member || expired, "ALREADY_ACTIVE_MEMBER");

        uint256 fee = membershipFeeHex;
        require(
            hexToken.transferFrom(msg.sender, address(this), fee),
            "HEX_TRANSFER_FAILED"
        );

        // 20% → 직속 멘토 포인트
        uint256 mentorBonus = (fee * MEMBER_MENTOR_BPS) / BPS;
        address mentor = u.mentor;
        if (mentor != address(0)) {
            users[mentor].points += mentorBonus;
            totalPoints          += mentorBonus;
        }

        // 60% → jumpBank 자동 이체
        uint256 bankAmount = (fee * FEE_BANK_BPS) / BPS;
        if (bankAmount > 0) {
            hexToken.transfer(address(jumpBank), bankAmount);
        }

        // 회비만큼 JUMP 지급
        uint256 jumpGiven = 0;
        uint256 jp = _safeJumpPrice();
        if (jp > 0) {
            jumpGiven = fee / jp;
            uint256 jumpBal = jumpToken.balanceOf(address(this));
            if (jumpBal >= jumpGiven && jumpGiven > 0) {
                jumpToken.transfer(msg.sender, jumpGiven);
            } else {
                jumpGiven = 0;
            }
        }

        bool renewed = u.member; // 갱신 여부
        u.member      = true;
        u.memberSince = block.timestamp;

        _payments.push(Payment({
            buyer:           msg.sender,
            hexAmount:       fee,
            timestamp:       block.timestamp,
            isMembershipFee: true
        }));

        emit MemberJoined(msg.sender, fee, jumpGiven, bankAmount, renewed);
    }

    // ─────────────────────────────────────────────────────
    // [회원] 상품 구매 (HEX 결제)
    //   - 판매금의 40% → jumpBank 자동 이체
    //   - mentorRewardBps% → 직속 멘토 포인트 적립
    // ─────────────────────────────────────────────────────
    function pay(uint256 hexAmount) external onlyMember {
        require(hexAmount > 0, "ZERO_AMOUNT");
        require(
            hexToken.transferFrom(msg.sender, address(this), hexAmount),
            "HEX_TRANSFER_FAILED"
        );

        // 40% → jumpBank 자동 이체
        uint256 bankAmount = (hexAmount * SALE_BANK_BPS) / BPS;
        if (bankAmount > 0) {
            hexToken.transfer(address(jumpBank), bankAmount);
        }

        uint256 mentorPoints = 0;
        address mentor = users[msg.sender].mentor;
        if (mentor != address(0)) {
            mentorPoints = (hexAmount * mentorRewardBps) / BPS;
            users[mentor].points += mentorPoints;
            totalPoints          += mentorPoints;
        }

        _payments.push(Payment({
            buyer:           msg.sender,
            hexAmount:       hexAmount,
            timestamp:       block.timestamp,
            isMembershipFee: false
        }));

        emit Paid(msg.sender, hexAmount, mentorPoints, bankAmount);
    }

    // ─────────────────────────────────────────────────────
    // [회원] 포인트 → HEX 전환
    //   - pts 만큼 HEX 지급
    //   - pts / 2 → 상위 멘토(멘토의 멘토) 포인트 적립
    // ─────────────────────────────────────────────────────
    function convertPoints(uint256 pts) external onlyMember {
        require(pts > 0, "ZERO_POINTS");
        User storage u = users[msg.sender];
        require(u.points >= pts, "INSUFFICIENT_POINTS");

        u.points    -= pts;
        totalPoints -= pts;

        require(
            hexToken.balanceOf(address(this)) >= pts,
            "INSUFFICIENT_HEX_RESERVE"
        );
        hexToken.transfer(msg.sender, pts);

        uint256 upperBonus = pts / 2;
        address m1 = u.mentor;
        address m2 = (m1 != address(0)) ? users[m1].mentor : address(0);

        bool bonusPaid = (m2 != address(0) && m2 != msg.sender);
        if (bonusPaid) {
            users[m2].points += upperBonus;
            totalPoints      += upperBonus;
        }

        emit PointsConverted(msg.sender, pts, bonusPaid ? upperBonus : 0);
    }

    // ─────────────────────────────────────────────────────
    // [관리자] 바우처 템플릿 생성
    // ─────────────────────────────────────────────────────
    function createVoucherTemplate(
        uint256 hexPrice,
        uint16  burnFeeBps,
        string calldata description,
        string calldata usagePlace,
        string calldata imageURI
    ) external onlyOwner returns (uint256) {
        require(hexPrice > 0, "ZERO_PRICE");
        require(burnFeeBps <= BPS, "BPS_OVERFLOW");
        uint256 tId = voucherTemplateCount++;
        voucherTemplates[tId] = VoucherTemplate({
            hexPrice:    hexPrice,
            burnFeeBps:  burnFeeBps,
            active:      true,
            description: description,
            usagePlace:  usagePlace,
            imageURI:    imageURI
        });
        emit VoucherTemplateCreated(tId, hexPrice, burnFeeBps);
        return tId;
    }

    // ─────────────────────────────────────────────────────
    // [관리자] 바우처 소각 수수료 변경
    // ─────────────────────────────────────────────────────
    function setVoucherBurnFee(uint256 templateId, uint16 burnFeeBps) external onlyOwner {
        require(templateId < voucherTemplateCount, "INVALID_TEMPLATE");
        require(burnFeeBps <= BPS, "BPS_OVERFLOW");
        voucherTemplates[templateId].burnFeeBps = burnFeeBps;
        emit VoucherTemplateUpdated(templateId);
    }

    // ─────────────────────────────────────────────────────
    // [관리자] 바우처 템플릿 활성/비활성
    // ─────────────────────────────────────────────────────
    function setVoucherTemplateActive(uint256 templateId, bool active) external onlyOwner {
        require(templateId < voucherTemplateCount, "INVALID_TEMPLATE");
        voucherTemplates[templateId].active = active;
        emit VoucherTemplateUpdated(templateId);
    }

    // ─────────────────────────────────────────────────────
    // [유저] 바우처 구매 → 판매금의 40% jumpBank 이체
    //   - 나머지 60%가 환급 준비금으로 남음
    // ─────────────────────────────────────────────────────
    function buyVoucher(uint256 templateId) external returns (uint256) {
        VoucherTemplate storage t = voucherTemplates[templateId];
        require(t.active, "TEMPLATE_INACTIVE");
        require(t.hexPrice > 0, "TEMPLATE_NOT_FOUND");
        require(
            hexToken.transferFrom(msg.sender, address(this), t.hexPrice),
            "HEX_TRANSFER_FAILED"
        );

        // 40% → jumpBank (상품 판매 매출)
        uint256 bankAmount = (t.hexPrice * SALE_BANK_BPS) / BPS;
        if (bankAmount > 0) {
            hexToken.transfer(address(jumpBank), bankAmount);
        }

        // 환급 준비금 = 잔류분 60%
        uint256 retained = t.hexPrice - bankAmount;
        totalVoucherReserve += retained;

        uint256 vId = voucherCount++;
        vouchers[vId] = Voucher({ templateId: templateId, owner: msg.sender, burned: false });
        _ownedVouchers[msg.sender].push(vId);
        emit VoucherBought(vId, templateId, msg.sender, bankAmount);
        return vId;
    }

    // ─────────────────────────────────────────────────────
    // [유저] 바우처 이체
    // ─────────────────────────────────────────────────────
    function transferVoucher(uint256 voucherId, address to) external {
        Voucher storage v = vouchers[voucherId];
        require(v.owner == msg.sender, "NOT_OWNER");
        require(!v.burned, "ALREADY_BURNED");
        require(to != address(0) && to != msg.sender, "INVALID_RECIPIENT");
        v.owner = to;
        _ownedVouchers[to].push(voucherId);
        emit VoucherTransferred(voucherId, msg.sender, to);
    }

    // ─────────────────────────────────────────────────────
    // [유저] 바우처 소각 → 잔류분(60%)에서 burnFee 차감 후 환급
    // ─────────────────────────────────────────────────────
    function burnVoucher(uint256 voucherId) external {
        Voucher storage v = vouchers[voucherId];
        require(v.owner == msg.sender, "NOT_OWNER");
        require(!v.burned, "ALREADY_BURNED");
        VoucherTemplate storage t = voucherTemplates[v.templateId];

        // 환급 기준액 = 잔류분 60% (jumpBank 이체 후 준비금)
        uint256 retained = (t.hexPrice * (BPS - SALE_BANK_BPS)) / BPS;
        uint256 burnFee  = (retained * t.burnFeeBps) / BPS;
        uint256 refund   = retained - burnFee;

        v.burned = true;
        totalVoucherReserve -= retained;
        if (refund > 0) {
            hexToken.transfer(msg.sender, refund);
        }
        emit VoucherBurned(voucherId, msg.sender, refund, burnFee);
    }

    // ─────────────────────────────────────────────────────
    // [관리자] 회비 설정 (HEX wei 단위)
    // ─────────────────────────────────────────────────────
    function setMembershipFee(uint256 feeWei) external onlyOwner {
        require(feeWei > 0, "ZERO_FEE");
        membershipFeeHex = feeWei;
        emit MembershipFeeChanged(feeWei);
    }

    // ─────────────────────────────────────────────────────
    // [관리자] 상품 구매 멘토 보상 비율 설정 (BPS, 최대 30%)
    // ─────────────────────────────────────────────────────
    function setMentorRewardBps(uint16 bps) external onlyOwner {
        require(bps >= 100 && bps <= MAX_MENTOR_BPS, "BPS_1_TO_30_PCT");
        mentorRewardBps = bps;
        emit MentorBpsChanged(bps);
    }

    // ─────────────────────────────────────────────────────
    // [관리자] JumpBank 주소 변경
    // ─────────────────────────────────────────────────────
    function setJumpBank(address _jb) external onlyOwner {
        require(_jb != address(0), "ZERO_ADDR");
        jumpBank = IJumpBank(_jb);
    }

    // ─────────────────────────────────────────────────────
    // [관리자] HEX 출금 (포인트 + 바우처 준비금 제외 잔액만)
    // ─────────────────────────────────────────────────────
    function withdrawHex(uint256 amount) external onlyOwner {
        uint256 bal    = hexToken.balanceOf(address(this));
        uint256 locked = totalPoints + totalVoucherReserve;
        require(bal >= locked, "RESERVE_LOCKED");
        uint256 available = bal - locked;
        require(amount > 0 && amount <= available, "EXCEEDS_AVAILABLE");
        hexToken.transfer(owner, amount);
        emit HexWithdrawn(owner, amount);
    }

    // ─────────────────────────────────────────────────────
    // [관리자] JUMP 출금
    // ─────────────────────────────────────────────────────
    function withdrawJump(uint256 amount) external onlyOwner {
        require(amount > 0, "ZERO_AMOUNT");
        require(jumpToken.balanceOf(address(this)) >= amount, "INSUFFICIENT_JUMP");
        jumpToken.transfer(owner, amount);
        emit JumpWithdrawn(owner, amount);
    }

    // ─────────────────────────────────────────────────────
    // VIEW
    // ─────────────────────────────────────────────────────

    /// @notice 활성 회원 여부 (유효기간 포함 확인)
    function isActiveMember(address addr) external view returns (bool) {
        return _isActiveMember(addr);
    }

    /// @notice 회원 만료 시각 (Unix timestamp), 미가입 시 0
    function memberExpiry(address addr) external view returns (uint256) {
        User storage u = users[addr];
        if (!u.member) return 0;
        return u.memberSince + MEMBERSHIP_DURATION;
    }

    /// @notice 컨트랙트 HEX 잔고
    function contractHexBalance() external view returns (uint256) {
        return hexToken.balanceOf(address(this));
    }

    /// @notice 컨트랙트 JUMP 잔고
    function contractJumpBalance() external view returns (uint256) {
        return jumpToken.balanceOf(address(this));
    }

    /// @notice 현재 JUMP 가격 (HEX wei per JUMP)
    function jumpPrice() external view returns (uint256) {
        return _safeJumpPrice();
    }

    /// @notice 관리자 출금 가능 HEX
    function withdrawableHex() external view returns (uint256) {
        uint256 bal    = hexToken.balanceOf(address(this));
        uint256 locked = totalPoints + totalVoucherReserve;
        if (bal <= locked) return 0;
        return bal - locked;
    }

    /// @notice 바우처 소유자 목록 조회
    function getVouchersByOwner(address owner_) external view returns (uint256[] memory) {
        return _ownedVouchers[owner_];
    }

    /// @notice 바우처 상세 정보 조회
    function getVoucherInfo(uint256 voucherId) external view returns (
        uint256 templateId,
        address vOwner,
        bool    burned,
        uint256 hexPrice,
        uint16  burnFeeBps,
        bool    templateActive,
        string memory description,
        string memory usagePlace,
        string memory imageURI
    ) {
        Voucher storage v = vouchers[voucherId];
        VoucherTemplate storage t = voucherTemplates[v.templateId];
        return (
            v.templateId, v.owner, v.burned,
            t.hexPrice, t.burnFeeBps, t.active,
            t.description, t.usagePlace, t.imageURI
        );
    }

    /// @notice 결제 기록 총 건수
    function paymentCount() external view returns (uint256) {
        return _payments.length;
    }

    /// @notice 결제 기록 페이지 조회
    function getPayments(uint256 from, uint256 count)
        external
        view
        returns (Payment[] memory result)
    {
        uint256 total = _payments.length;
        if (from >= total) return new Payment[](0);
        uint256 end = from + count;
        if (end > total) end = total;
        result = new Payment[](end - from);
        for (uint256 i = from; i < end; i++) {
            result[i - from] = _payments[i];
        }
    }

    /// @notice 회원 상세 정보 조회 (만료 포함)
    function getUserInfo(address addr)
        external
        view
        returns (
            bool    eligible,
            bool    member,
            bool    activeMember,
            address mentor,
            uint256 points,
            uint256 expiry
        )
    {
        User storage u = users[addr];
        return (
            u.eligible,
            u.member,
            _isActiveMember(addr),
            u.mentor,
            u.points,
            u.member ? u.memberSince + MEMBERSHIP_DURATION : 0
        );
    }

    // ─────────────────────────────────────────────────────
    // INTERNAL
    // ─────────────────────────────────────────────────────

    function _isActiveMember(address addr) internal view returns (bool) {
        User storage u = users[addr];
        return u.member && block.timestamp < u.memberSince + MEMBERSHIP_DURATION;
    }

    function _safeJumpPrice() internal view returns (uint256) {
        try jumpBank.price() returns (uint256 p) {
            return p;
        } catch {
            return 0;
        }
    }
}
