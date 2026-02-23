// /contracts/jumpPlatform.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
  function transfer(address to, uint256 amount) external returns (bool);
  function transferFrom(address from, address to, uint256 amount) external returns (bool);
  function balanceOf(address account) external view returns (uint256);
  function allowance(address owner, address spender) external view returns (uint256);
  function approve(address spender, uint256 amount) external returns (bool);
}

/*
  jumpPlatform.sol (기능 포함 + 수정보완 전체본)

  목표/정책
  - 유저 USDT 충전 없음: 원화 입금 → 관리자 승인
  - 관리자 승인 시:
      creditPoints() 1회 호출로
        (1) 관리자 지갑(Owner)에서 컨트랙트로 HEX 자동 transferFrom
        (2) 유저 pointWei 증가
    * owner는 사전에 HEX.approve(컨트랙트, 충분히 큰 금액)를 1회 해야 함.
  - 포인트 단위: HEX wei(18 decimals)
  - 상품 등록/구매: 조합원만 가능
  - 가입: 온체인 멘토 주소 필요(오프체인에서 이메일→주소 매칭 후 register 호출)
  - 구매: pointWei 차감 → 판매자/멘토 payableWei 누적
  - 판매자/멘토: withdraw로 HEX 인출 (개인지갑 설치 후 직접 인출 가능)
  - ref 중복 승인 방지(온체인) + 이벤트로 감사 추적
  - 안전 보강:
      * 멘토 변경 기능(선택)
      * 회원 탈퇴/차단(선택)
      * 상품 가격/수수료 안전 범위
      * rescue(실수로 들어온 토큰 회수) - HEX는 제외(선택)
*/

contract JumpPlatform {
  IERC20 public immutable HEX;          // 1 HEX = 1 USD 가정(18dec)

  address public owner;
  address public treasury;              // 플랫폼 수수료 수령처(0이면 컨트랙트에 남김)
  address public bootstrapMentor;        // 최초 멘토(레벨4)

  uint16 public constant BPS_DENOM = 10000;
  uint16 public constant MAX_FEE_BPS = 3000; // 정책: 최대 30%

  struct Member {
    uint32 level;           // 0 = 미가입, >0 가입
    address mentor;         // 멘토(레벨4 이상)
    uint256 pointWei;       // 사용 포인트(HEX wei)
    uint256 payableWei;     // 판매/수당 인출 가능(HEX wei)
    uint64 joinAt;
    bool blocked;           // 운영 차단(옵션)
  }

  struct Product {
    bool exists;
    address seller;
    uint256 priceWei;       // HEX wei
    uint16 feeBps;          // 0~10000
    bool active;
  }

  mapping(address => Member) public members;
  mapping(uint256 => Product) public products;

  // 충전 중복 승인 방지
  mapping(bytes32 => bool) public usedTopupRef;

  // -------- events --------
  event OwnerChanged(address indexed oldOwner, address indexed newOwner);
  event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);
  event BootstrapMentorChanged(address indexed oldMentor, address indexed newMentor);

  event Registered(address indexed user, address indexed mentor, uint64 at);
  event LevelSet(address indexed user, uint32 level);
  event MemberBlocked(address indexed user, bool blocked);
  event MentorChanged(address indexed user, address indexed oldMentor, address indexed newMentor);

  event ProductUpserted(
    uint256 indexed productId,
    address indexed seller,
    uint256 priceWei,
    uint16 feeBps,
    bool active
  );
  event ProductDeactivated(uint256 indexed productId);

  // 충전 승인 증빙
  // usdKrwSnapshotScaled: 승인 당시 USD/KRW 환율 스냅샷(표시/감사 목적)
  // 예: 1325.45 KRW → 132545(=x100) 같은 스케일 권장
  event PointCredited(
    address indexed user,
    uint256 amountWei,
    bytes32 indexed ref,
    uint256 usdKrwSnapshotScaled,
    uint64 at
  );

  event Purchased(
    address indexed buyer,
    uint256 indexed productId,
    address indexed seller,
    uint256 priceWei,
    uint256 sellerNetWei,
    uint256 mentorCutWei,
    uint256 platformFeeWei,
    uint64 at
  );

  event Withdrawn(address indexed user, uint256 amountWei, uint64 at);
  event Swept(address indexed to, uint256 amountWei, uint64 at);
  event RescueToken(address indexed token, address indexed to, uint256 amount);

  // -------- modifiers --------
  modifier onlyOwner() {
    require(msg.sender == owner, "only owner");
    _;
  }

  modifier onlyMember() {
    require(members[msg.sender].level > 0, "member required");
    require(!members[msg.sender].blocked, "member blocked");
    _;
  }

  modifier memberExists(address user) {
    require(user != address(0), "user=0");
    require(members[user].level > 0, "not member");
    _;
  }

  constructor(address hexToken, address _bootstrapMentor, address _treasury) {
    require(hexToken != address(0), "HEX=0");
    HEX = IERC20(hexToken);

    owner = msg.sender;
    treasury = _treasury; // 0이면 컨트랙트에 남김
    bootstrapMentor = _bootstrapMentor;

    if (_bootstrapMentor != address(0)) {
      members[_bootstrapMentor] = Member({
        level: 4,
        mentor: address(0),
        pointWei: 0,
        payableWei: 0,
        joinAt: uint64(block.timestamp),
        blocked: false
      });
      emit LevelSet(_bootstrapMentor, 4);
    }
  }

  // ---------------------------
  // 운영자 설정
  // ---------------------------

  function changeOwner(address newOwner) external onlyOwner {
    require(newOwner != address(0), "new=0");
    emit OwnerChanged(owner, newOwner);
    owner = newOwner;
  }

  function setTreasury(address newTreasury) external onlyOwner {
    emit TreasuryChanged(treasury, newTreasury);
    treasury = newTreasury;
  }

  function setBootstrapMentor(address newMentor) external onlyOwner {
    emit BootstrapMentorChanged(bootstrapMentor, newMentor);
    bootstrapMentor = newMentor;
  }

  function adminSetLevel(address user, uint32 level) external onlyOwner memberExists(user) {
    members[user].level = level;
    emit LevelSet(user, level);
  }

  function adminSetBlocked(address user, bool blocked_) external onlyOwner memberExists(user) {
    members[user].blocked = blocked_;
    emit MemberBlocked(user, blocked_);
  }

  // 오프체인에서 멘토 이메일→주소 매칭 후, 온체인에서는 주소만 다룸.
  // 가입 이후 멘토를 바꿀 필요가 있을 때(운영자/정책에 따라 허용).
  function adminChangeMentor(address user, address newMentor) external onlyOwner memberExists(user) {
    require(newMentor != address(0), "mentor=0");
    require(members[newMentor].level >= 4, "invalid mentor");
    address old = members[user].mentor;
    members[user].mentor = newMentor;
    emit MentorChanged(user, old, newMentor);
  }

  // ---------------------------
  // 조합원 가입
  // ---------------------------

  function register(address mentorAddress) external {
    require(members[msg.sender].level == 0, "already member");

    address mentor = mentorAddress;
    if (mentor == address(0)) mentor = bootstrapMentor;

    require(mentor != address(0), "mentor=0");
    require(members[mentor].level >= 4, "invalid mentor");

    members[msg.sender] = Member({
      level: 1,
      mentor: mentor,
      pointWei: 0,
      payableWei: 0,
      joinAt: uint64(block.timestamp),
      blocked: false
    });

    emit Registered(msg.sender, mentor, uint64(block.timestamp));
    emit LevelSet(msg.sender, 1);
  }

  // ---------------------------
  // 상품 관리
  // ---------------------------

  function upsertProduct(uint256 productId, uint256 priceWei, uint16 feeBps, bool active) external onlyMember {
    require(members[msg.sender].level >= 4, "level too low");
    require(productId != 0, "productId=0");
    require(priceWei > 0, "price=0");
    require(feeBps <= MAX_FEE_BPS, "fee too high");

    Product storage p = products[productId];

    // 기존 상품이면 판매자 동일인만 수정 가능
    if (p.exists) {
      require(p.seller == msg.sender, "not seller");
    }

    products[productId] = Product({
      exists: true,
      seller: msg.sender,
      priceWei: priceWei,
      feeBps: feeBps,
      active: active
    });

    emit ProductUpserted(productId, msg.sender, priceWei, feeBps, active);
  }

  function deactivateProduct(uint256 productId) external {
    Product storage p = products[productId];
    require(p.exists, "no product");
    require(p.seller == msg.sender || msg.sender == owner, "no auth");
    p.active = false;
    emit ProductDeactivated(productId);
  }

  // ---------------------------
  // 포인트 충전(관리자 승인) - 핵심
  // ---------------------------

  /*
    충전 승인 시마다 자동 HEX 이체 + 포인트 적립:

    - owner는 사전에 HEX.approve(address(this), 충분히 큰 값)을 1회 해둬야 함.
    - 이후 creditPoints 호출 시:
        HEX.transferFrom(owner, address(this), amountWei)
      가 자동 실행되어 컨트랙트 잔액이 증가(인출 지급 가능).
  */
  function creditPoints(
    address user,
    uint256 amountWei,
    bytes32 ref,
    uint256 usdKrwSnapshotScaled
  ) external onlyOwner memberExists(user) {
    require(!members[user].blocked, "member blocked");
    require(amountWei > 0, "amount=0");
    require(!usedTopupRef[ref], "ref used");

    // 실탄 자동 확보: owner 지갑 → 컨트랙트로 HEX 끌어오기
    require(HEX.transferFrom(msg.sender, address(this), amountWei), "HEX transferFrom fail");

    usedTopupRef[ref] = true;
    members[user].pointWei += amountWei;

    emit PointCredited(user, amountWei, ref, usdKrwSnapshotScaled, uint64(block.timestamp));
  }

  // ---------------------------
  // 구매/정산
  // ---------------------------

  function buy(uint256 productId) external onlyMember {
    Product memory p = products[productId];
    require(p.exists, "no product");
    require(p.active, "inactive product");

    Member storage buyer = members[msg.sender];
    require(buyer.pointWei >= p.priceWei, "insufficient point");

    buyer.pointWei -= p.priceWei;

    uint256 fee = (p.priceWei * p.feeBps) / BPS_DENOM;
    uint256 sellerNet = p.priceWei - fee;

    // 판매자 정산 누적
    members[p.seller].payableWei += sellerNet;

    // 멘토 수당: fee의 50% (정책)
    uint256 mentorCut = 0;
    address mentor = buyer.mentor;
    if (mentor != address(0) && members[mentor].level >= 4 && fee > 0) {
      mentorCut = fee / 2;
      members[mentor].payableWei += mentorCut;
    }

    uint256 platformFee = fee - mentorCut;

    // 플랫폼 수수료는 treasury로 즉시 보내거나, treasury=0이면 컨트랙트에 남김
    if (platformFee > 0 && treasury != address(0)) {
      require(HEX.transfer(treasury, platformFee), "treasury transfer fail");
    }

    emit Purchased(
      msg.sender,
      productId,
      p.seller,
      p.priceWei,
      sellerNet,
      mentorCut,
      platformFee,
      uint64(block.timestamp)
    );
  }

  // ---------------------------
  // 인출
  // ---------------------------

  function withdraw(uint256 amountWei) external onlyMember {
    require(amountWei > 0, "amount=0");
    Member storage m = members[msg.sender];
    require(m.payableWei >= amountWei, "insufficient payable");

    m.payableWei -= amountWei;
    require(HEX.transfer(msg.sender, amountWei), "HEX transfer fail");

    emit Withdrawn(msg.sender, amountWei, uint64(block.timestamp));
  }

  // 운영자: 컨트랙트에 남아있는 HEX 회수(플랫폼 잔여금/수수료 등)
  function ownerSweep(address to, uint256 amountWei) external onlyOwner {
    require(to != address(0), "to=0");
    require(amountWei > 0, "amount=0");
    require(HEX.transfer(to, amountWei), "HEX transfer fail");
    emit Swept(to, amountWei, uint64(block.timestamp));
  }

  // ---------------------------
  // 실수 방지/운영 편의
  // ---------------------------

  // 실수로 다른 토큰을 컨트랙트로 보냈을 때 회수(HEX는 회수하지 않음)
  function rescueToken(address token, address to, uint256 amount) external onlyOwner {
    require(token != address(HEX), "no rescue HEX");
    require(to != address(0), "to=0");
    require(amount > 0, "amount=0");
    require(IERC20(token).transfer(to, amount), "rescue transfer fail");
    emit RescueToken(token, to, amount);
  }

  // ---------------------------
  // 조회 헬퍼
  // ---------------------------

  function isMember(address user) external view returns (bool) {
    return members[user].level > 0 && !members[user].blocked;
  }

  function getMember(address user) external view returns (
    uint32 level,
    address mentor,
    uint256 pointWei,
    uint256 payableWei,
    uint64 joinAt,
    bool blocked
  ) {
    Member memory m = members[user];
    return (m.level, m.mentor, m.pointWei, m.payableWei, m.joinAt, m.blocked);
  }

  function getProduct(uint256 productId) external view returns (
    bool exists,
    address seller,
    uint256 priceWei,
    uint16 feeBps,
    bool active
  ) {
    Product memory p = products[productId];
    return (p.exists, p.seller, p.priceWei, p.feeBps, p.active);
  }

  // 관리자 승인 전에 allowance 확인할 때 사용
  function ownerHexAllowance() external view returns (uint256) {
    return HEX.allowance(owner, address(this));
  }

  function contractHexBalance() external view returns (uint256) {
    return HEX.balanceOf(address(this));
  }
}