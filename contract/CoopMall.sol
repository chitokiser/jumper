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
// IJumpBank — jumpBank.sol의 public price 변수 getter 사용
// ─────────────────────────────────────────────────────────
interface IJumpBank {
    function price() external view returns (uint256); // HEX wei per 1 JUMP
}

// ─────────────────────────────────────────────────────────
// CoopMall v3
//
// 입장 흐름:
//   1. 관리자가 레벨1+ 확인 후 grantEligibility(user, mentor) 호출
//   2. 유저가 joinMall() 호출 → 회비(HEX) 납부 → JUMP 지급 + 멘토 포인트 50%
//   3. 이후 pay(amount) 로 HEX 결제 → 멘토 포인트 적립
//   4. convertPoints(pts) 로 포인트 → HEX 전환 → 상위 멘토에 pts/2 적립
// ─────────────────────────────────────────────────────────
contract CoopMall {

    // ── 토큰 / 외부 컨트랙트 ─────────────────────────────
    IERC20    public hexToken;
    IERC20    public jumpToken;
    IJumpBank public jumpBank;

    // ── 관리자 ──────────────────────────────────────────
    address public owner;

    // ── 설정값 ──────────────────────────────────────────
    uint256 public membershipFeeHex = 10e18; // 기본 10 HEX (wei 단위)
    uint16  public mentorRewardBps  = 1000;  // 기본 10%, 최대 30%
    uint16  constant MAX_MENTOR_BPS = 3000;  // 30%
    uint16  constant BPS            = 10000;

    // ── 포인트 준비금 추적 (출금 시 잠금) ──────────────
    uint256 public totalPoints;

    // ── 바우처 준비금 추적 ────────────────────────────
    uint256 public totalVoucherReserve;

    // ── 회원 정보 ────────────────────────────────────────
    struct User {
        bool    eligible; // 관리자가 레벨1+ 확인 후 자격 부여
        bool    member;   // 회비 납부 완료 (몰 활성 회원)
        address mentor;   // 직속 멘토 (없으면 address(0))
        uint256 points;   // 적립 포인트 (HEX wei 단위)
    }
    mapping(address => User) public users;

    // ── 바우처 템플릿 ─────────────────────────────────────
    struct VoucherTemplate {
        uint256 hexPrice;      // 바우처 가격 (HEX wei)
        uint16  burnFeeBps;    // 소각 수수료 (BPS, 예: 1000 = 10%)
        bool    active;
        string  description;   // 바우처 내용/설명
        string  usagePlace;    // 사용처
        string  imageURI;      // 이미지 URL
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

    // 주소별 소유 바우처 ID 목록 (이체 후에도 old entry 유지 → owner 확인으로 필터)
    mapping(address => uint256[]) private _ownedVouchers;

    // ── 결제 기록 ────────────────────────────────────────
    struct Payment {
        address buyer;
        uint256 hexAmount;
        uint256 timestamp;
        bool    isMembershipFee; // true = 회비, false = 상품 구매
    }
    Payment[] private _payments;

    // ── 이벤트 ──────────────────────────────────────────
    event EligibilityGranted(address indexed user, address indexed mentor);
    event MemberJoined(address indexed user, uint256 feeHex, uint256 jumpGiven);
    event Paid(address indexed buyer, uint256 hexAmount, uint256 mentorPoints);
    event PointsConverted(address indexed user, uint256 pts, uint256 upperBonus);
    event MembershipFeeChanged(uint256 newFeeWei);
    event MentorBpsChanged(uint16 newBps);
    event HexWithdrawn(address indexed to, uint256 amount);
    event JumpWithdrawn(address indexed to, uint256 amount);
    event VoucherTemplateCreated(uint256 indexed templateId, uint256 hexPrice, uint16 burnFeeBps);
    event VoucherTemplateUpdated(uint256 indexed templateId);
    event VoucherBought(uint256 indexed voucherId, uint256 indexed templateId, address indexed buyer);
    event VoucherTransferred(uint256 indexed voucherId, address indexed from, address indexed to);
    event VoucherBurned(uint256 indexed voucherId, address indexed owner, uint256 hexReturned, uint256 feeKept);

    // ── 접근 제어 ────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "ONLY_OWNER");
        _;
    }
    modifier onlyMember() {
        require(users[msg.sender].member, "NOT_MEMBER");
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
    // [관리자] 레벨1+ 회원에게 입장 자격 부여 (멘토 지정 포함)
    //   - 이미 몰 회원인 경우 재부여 불가
    //   - 자기 자신을 멘토로 지정 불가
    // ─────────────────────────────────────────────────────
    function grantEligibility(address user, address mentor) external onlyOwner {
        require(user != address(0), "ZERO_ADDR");
        require(user != mentor, "SELF_MENTOR");
        require(!users[user].member, "ALREADY_MEMBER");

        users[user].eligible = true;
        users[user].mentor   = mentor;

        emit EligibilityGranted(user, mentor);
    }

    // ─────────────────────────────────────────────────────
    // [회원] 회비 납부 → 몰 가입 완료 (1회)
    //   - grantEligibility 로 자격 부여된 주소만 가능
    //   - 회비의 50% → 직속 멘토 포인트 적립
    //   - 회비 HEX 만큼 JUMP 지급 (컨트랙트 잔고 있을 때)
    // ─────────────────────────────────────────────────────
    function joinMall() external {
        User storage u = users[msg.sender];
        require(u.eligible, "NOT_ELIGIBLE");
        require(!u.member,  "ALREADY_MEMBER");

        uint256 fee = membershipFeeHex;
        require(
            hexToken.transferFrom(msg.sender, address(this), fee),
            "HEX_TRANSFER_FAILED"
        );

        // 멘토 포인트: 회비의 50%
        uint256 mentorBonus = fee / 2;
        address mentor = u.mentor;
        if (mentor != address(0)) {
            users[mentor].points += mentorBonus;
            totalPoints          += mentorBonus;
        }

        // JUMP 지급: 납부한 HEX 가치만큼
        uint256 jumpGiven = 0;
        uint256 jp = _safeJumpPrice();
        if (jp > 0) {
            // JUMP decimals = 0이므로 wei 변환 없이 수량만 계산
            jumpGiven = fee / jp; // fee(HEX wei) / price(HEX wei per JUMP) = JUMP 수량
            uint256 jumpBal = jumpToken.balanceOf(address(this));
            if (jumpBal >= jumpGiven && jumpGiven > 0) {
                jumpToken.transfer(msg.sender, jumpGiven);
            } else {
                jumpGiven = 0;
            }
        }

        u.member = true;

        _payments.push(Payment({
            buyer:           msg.sender,
            hexAmount:       fee,
            timestamp:       block.timestamp,
            isMembershipFee: true
        }));

        emit MemberJoined(msg.sender, fee, jumpGiven);
    }

    // ─────────────────────────────────────────────────────
    // [회원] HEX 결제 (상품 구매)
    //   - 결제액의 mentorRewardBps% → 직속 멘토 포인트 적립
    // ─────────────────────────────────────────────────────
    function pay(uint256 hexAmount) external onlyMember {
        require(hexAmount > 0, "ZERO_AMOUNT");
        require(
            hexToken.transferFrom(msg.sender, address(this), hexAmount),
            "HEX_TRANSFER_FAILED"
        );

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

        emit Paid(msg.sender, hexAmount, mentorPoints);
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

        // 상위 멘토(멘토의 멘토)에게 pts/2 적립
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
    // [유저] 바우처 구매 → HEX 납부 → 바우처 ID 반환
    // ─────────────────────────────────────────────────────
    function buyVoucher(uint256 templateId) external returns (uint256) {
        VoucherTemplate storage t = voucherTemplates[templateId];
        require(t.active, "TEMPLATE_INACTIVE");
        require(t.hexPrice > 0, "TEMPLATE_NOT_FOUND");
        require(
            hexToken.transferFrom(msg.sender, address(this), t.hexPrice),
            "HEX_TRANSFER_FAILED"
        );
        totalVoucherReserve += t.hexPrice;
        uint256 vId = voucherCount++;
        vouchers[vId] = Voucher({ templateId: templateId, owner: msg.sender, burned: false });
        _ownedVouchers[msg.sender].push(vId);
        emit VoucherBought(vId, templateId, msg.sender);
        return vId;
    }

    // ─────────────────────────────────────────────────────
    // [유저] 바우처 이체 (NFT처럼 제3자에게 이전)
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
    // [유저] 바우처 소각 → 수수료 제외 HEX 환급
    //   - 수수료는 컨트랙트에 적립 (관리자 인출 가능)
    // ─────────────────────────────────────────────────────
    function burnVoucher(uint256 voucherId) external {
        Voucher storage v = vouchers[voucherId];
        require(v.owner == msg.sender, "NOT_OWNER");
        require(!v.burned, "ALREADY_BURNED");
        VoucherTemplate storage t = voucherTemplates[v.templateId];
        uint256 fee    = (t.hexPrice * t.burnFeeBps) / BPS;
        uint256 refund = t.hexPrice - fee;
        v.burned = true;
        totalVoucherReserve -= t.hexPrice;
        if (refund > 0) {
            hexToken.transfer(msg.sender, refund);
        }
        emit VoucherBurned(voucherId, msg.sender, refund, fee);
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
    // [관리자] 멘토 보상 비율 설정 (BPS, 최대 30%)
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
    // [관리자] HEX 출금
    //   - totalPoints(포인트 준비금) 제외 후 잔액만 출금 가능
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

    /// @notice 컨트랙트 HEX 잔고 (wei)
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

    /// @notice 관리자 출금 가능 HEX (포인트 + 바우처 준비금 제외)
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

    /// @notice 결제 기록 페이지 조회 (from 인덱스, count 개수)
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

    /// @notice 특정 주소의 회원 정보 조회
    function getUserInfo(address addr)
        external
        view
        returns (
            bool    eligible,
            bool    member,
            address mentor,
            uint256 points
        )
    {
        User storage u = users[addr];
        return (u.eligible, u.member, u.mentor, u.points);
    }

    // ─────────────────────────────────────────────────────
    // INTERNAL
    // ─────────────────────────────────────────────────────

    /// @dev JumpBank 호출 실패 시 0 반환 (JUMP 지급 스킵 처리용)
    function _safeJumpPrice() internal view returns (uint256) {
        try jumpBank.price() returns (uint256 p) {
            return p;
        } catch {
            return 0;
        }
    }
}
