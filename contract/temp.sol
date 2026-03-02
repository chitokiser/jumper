// /contracts/JumperCoopPayLite.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
  function transfer(address to, uint256 amount) external returns (bool);
  function transferFrom(address from, address to, uint256 amount) external returns (bool);
  function balanceOf(address account) external view returns (uint256);
}

interface IJumpBank {
  function onTaxReceived(uint256 amount) external;
}

contract JumperPlatfrom {
  IERC20 public immutable HEX;

  // ---------- custom errors (no revert strings) ----------
  error OnlyOwner();
  error MemberRequired();
  error MemberBlocked();
  error AlreadyMember();
  error MentorRequired();
  error NotMember();
  error ZeroAddr();
  error ZeroAmount();
  error RefUsed();
  error TransferFail();
  error MerchantMissing();
  error MerchantInactive();
  error NotMerchantOwner();
  error FeeTooHigh();
  error InsufficientPoints();
  error InsufficientHex();
  error NeedExp();
  error MentorLevelRequired();
  error JumpBankZero();

  // ---------- constants ----------
  uint16 public constant BPS_DENOM = 10000;
  uint16 public constant MAX_FEE_BPS = 3000; // 30%

  // ---------- admin params ----------
  address public owner;
  address public bootstrapMentor;

  uint32 public pointBaseDiv = 10;     // points -> HEX : points * level / div
  uint16 public mentorShareBps = 1000; // fee split to mentor points
  uint256 public taxThresholdWei = 100e18;

  address public jumpBank;
  bool public callJumpBankHook;

  // ---------- FX (display only) ----------
  // valueScaled = hexBalanceWei * fxPerHexScaled / 1e18
  uint256 public fxKrwPerHexScaled;
  uint256 public fxUsdPerHexScaled;
  uint256 public fxVndPerHexScaled;
  uint32 public fxScale = 100;

  // ---------- state ----------
  struct Member {
    uint32 level;     // 0=not member
    address mentor;
    uint256 exp;
    uint256 points;   // pointWei
    bool blocked;
  }

  struct Merchant {
    address ownerAddr;
    uint16 feeBps;       // admin only
    bool active;
    string metadataURI;  // optional, offchain pointer
    bool exists;
  }

  mapping(address => Member) public members;
  mapping(uint256 => Merchant) public merchants;
  uint256 public nextMerchantId = 1;

  mapping(bytes32 => bool) public usedTopupRef;

  uint256 public taxAccWei;

  // ---------- events (minimal but enough for ops) ----------
  event Registered(address indexed user, address indexed mentor);

  event AdminCreditHex(address indexed user, uint256 hexWei, bytes32 indexed ref);

  event MerchantRegistered(uint256 indexed merchantId, address indexed ownerAddr);
  event MerchantMetaUpdated(uint256 indexed merchantId, string metadataURI, bool active);
  event MerchantFeeUpdated(uint256 indexed merchantId, uint16 feeBps);
  event MerchantOwnerUpdated(uint256 indexed merchantId, address indexed ownerAddr);

  event PaidHex(address indexed buyer, uint256 indexed merchantId, uint256 amountWei, uint256 feeWei, uint256 expGain);

  event PointsConverted(address indexed user, uint256 pointsWei, uint256 hexWei);

  // flush only when attempted (threshold reached)
  event TaxFlush(address indexed to, uint256 amountWei, bool ok);

  event FxUpdated(uint256 krwPerHexScaled, uint256 usdPerHexScaled, uint256 vndPerHexScaled, uint32 fxScale);

  // ---------- modifiers ----------
  modifier onlyOwner() {
    if (msg.sender != owner) revert OnlyOwner();
    _;
  }

  modifier onlyMember() {
    Member storage m = members[msg.sender];
    if (m.level == 0) revert MemberRequired();
    if (m.blocked) revert MemberBlocked();
    _;
  }

  modifier memberExists(address user) {
    if (user == address(0)) revert ZeroAddr();
    if (members[user].level == 0) revert NotMember();
    _;
  }

  constructor(address hexToken, address _bootstrapMentor) {
    if (hexToken == address(0)) revert ZeroAddr();
    HEX = IERC20(hexToken);
    owner = msg.sender;

    bootstrapMentor = _bootstrapMentor;
    if (_bootstrapMentor != address(0)) {
      members[_bootstrapMentor] = Member({
        level: 1,
        mentor: address(0),
        exp: 0,
        points: 0,
        blocked: false
      });
      emit Registered(_bootstrapMentor, address(0));
    }
  }

  // ---------- admin: basic ----------
  function setParams(uint32 div_, uint16 mentorShareBps_, uint256 taxThresholdWei_) external onlyOwner {
    if (div_ == 0) revert ZeroAmount();
    if (mentorShareBps_ > 5000) revert FeeTooHigh(); // cap 50%
    if (taxThresholdWei_ == 0) revert ZeroAmount();
    pointBaseDiv = div_;
    mentorShareBps = mentorShareBps_;
    taxThresholdWei = taxThresholdWei_;
  }

  function setBootstrapMentor(address m) external onlyOwner {
    bootstrapMentor = m;
  }

  function setJumpBank(address jb, bool callHook) external onlyOwner {
    jumpBank = jb;
    callJumpBankHook = callHook;
  }

  function setFx(
    uint256 krwPerHexScaled,
    uint256 usdPerHexScaled,
    uint256 vndPerHexScaled,
    uint32 scale
  ) external onlyOwner {
    if (scale == 0) revert ZeroAmount();
    fxKrwPerHexScaled = krwPerHexScaled;
    fxUsdPerHexScaled = usdPerHexScaled;
    fxVndPerHexScaled = vndPerHexScaled;
    fxScale = scale;
    emit FxUpdated(krwPerHexScaled, usdPerHexScaled, vndPerHexScaled, scale);
  }

  function adminSetBlocked(address user, bool blocked_) external onlyOwner memberExists(user) {
    members[user].blocked = blocked_;
  }

  function adminSetLevel(address user, uint32 level_) external onlyOwner memberExists(user) {
    if (level_ == 0) revert ZeroAmount();
    members[user].level = level_;
  }

  function adminChangeMentor(address user, address newMentor) external onlyOwner memberExists(user) {
    if (newMentor == address(0)) revert ZeroAddr();
    members[user].mentor = newMentor;
  }

  // ---------- owner HEX funding ----------
  // owner must approve this contract first
  function ownerDepositHex(uint256 amountWei) external onlyOwner {
    if (amountWei == 0) revert ZeroAmount();
    if (!HEX.transferFrom(msg.sender, address(this), amountWei)) revert TransferFail();
  }

  function ownerWithdrawHex(address to, uint256 amountWei) external onlyOwner {
    if (to == address(0)) revert ZeroAddr();
    if (amountWei == 0) revert ZeroAmount();
    if (!HEX.transfer(to, amountWei)) revert TransferFail();
  }

  // ---------- member ----------
  function register(address mentorAddr) external {
    if (members[msg.sender].level != 0) revert AlreadyMember();

    address m = mentorAddr;
    if (m == address(0)) m = bootstrapMentor;
    if (m == address(0)) revert MentorRequired();

    members[msg.sender] = Member({
      level: 1,
      mentor: m,
      exp: 0,
      points: 0,
      blocked: false
    });

    emit Registered(msg.sender, m);
  }

  function requiredExpForNextLevel(address user) public view memberExists(user) returns (uint256) {
    uint256 lv = members[user].level;
    return (lv * lv) * 10000;
  }

  function requestLevelUp() external onlyMember {
    Member storage u = members[msg.sender];
    uint256 need = (uint256(u.level) * uint256(u.level)) * 10000;
    if (u.exp < need) revert NeedExp();
    unchecked {
      u.exp -= need;
      u.level += 1;
    }
  }

  // ---------- KRW(offchain) -> admin approve -> HEX transfer ----------
  function adminCreditHex(address user, uint256 hexWei, bytes32 ref) external onlyOwner memberExists(user) {
    if (hexWei == 0) revert ZeroAmount();
    if (usedTopupRef[ref]) revert RefUsed();
    usedTopupRef[ref] = true;

    if (!HEX.transfer(user, hexWei)) revert TransferFail();
    emit AdminCreditHex(user, hexWei, ref);
  }

  // ---------- merchant ----------
  // requirement: register fee=0, admin sets later
  function registerMerchant(string calldata metadataURI) external onlyMember returns (uint256 merchantId) {
    merchantId = nextMerchantId++;
    merchants[merchantId] = Merchant({
      ownerAddr: msg.sender,
      feeBps: 0,
      active: true,
      metadataURI: metadataURI,
      exists: true
    });
    emit MerchantRegistered(merchantId, msg.sender);
  }

  function updateMerchantByOwner(uint256 merchantId, string calldata metadataURI, bool active) external {
    Merchant storage m = merchants[merchantId];
    if (!m.exists) revert MerchantMissing();
    if (msg.sender != m.ownerAddr) revert NotMerchantOwner();
    m.metadataURI = metadataURI;
    m.active = active;
    emit MerchantMetaUpdated(merchantId, metadataURI, active);
  }

  function adminUpdateMerchantFee(uint256 merchantId, uint16 feeBps) external onlyOwner {
    Merchant storage m = merchants[merchantId];
    if (!m.exists) revert MerchantMissing();
    if (feeBps > MAX_FEE_BPS) revert FeeTooHigh();
    m.feeBps = feeBps;
    emit MerchantFeeUpdated(merchantId, feeBps);
  }

  function adminUpdateMerchantOwner(uint256 merchantId, address newOwner) external onlyOwner {
    Merchant storage m = merchants[merchantId];
    if (!m.exists) revert MerchantMissing();
    if (newOwner == address(0)) revert ZeroAddr();
    m.ownerAddr = newOwner;
    emit MerchantOwnerUpdated(merchantId, newOwner);
  }

  // ---------- payments ----------
  // User must approve HEX to this contract first
  function payMerchantHex(uint256 merchantId, uint256 amountWei) external onlyMember {
    Merchant storage mer = merchants[merchantId];
    if (!mer.exists) revert MerchantMissing();
    if (!mer.active) revert MerchantInactive();
    if (amountWei == 0) revert ZeroAmount();

    if (!HEX.transferFrom(msg.sender, address(this), amountWei)) revert TransferFail();

    uint256 fee = (amountWei * mer.feeBps) / BPS_DENOM;
    uint256 net = amountWei - fee;

    if (!HEX.transfer(mer.ownerAddr, net)) revert TransferFail();

    uint256 expGain;
    if (fee != 0) {
      address mentor = members[msg.sender].mentor;
      if (mentor == address(0)) mentor = bootstrapMentor;

      uint256 mentorPts = (fee * mentorShareBps) / BPS_DENOM;
      uint256 tax = fee - mentorPts;

      if (mentor != address(0) && mentorPts != 0) {
        members[mentor].points += mentorPts;
      }
      if (tax != 0) {
        taxAccWei += tax;
      }

      expGain = fee / 1e16;
      if (expGain != 0) members[msg.sender].exp += expGain;
    }

    emit PaidHex(msg.sender, merchantId, amountWei, fee, expGain);
  }

  // ---------- points conversion ----------
  // requirement: points cannot directly pay merchant. Must convert to HEX first, then payMerchantHex.
  function convertPointsToHex(uint256 pointsWei) external onlyMember {
    _convertPoints(msg.sender, pointsWei, false);
  }

  // alias
  function withdrawPoints(uint256 pointsWei) external onlyMember {
    _convertPoints(msg.sender, pointsWei, false);
  }

  // requirement #6: mentor withdraw -> 50% credited to mentor's mentor (2 levels up)
  function mentorWithdrawPoints(uint256 pointsWei) external onlyMember {
    if (members[msg.sender].level < 2) revert MentorLevelRequired();
    _convertPoints(msg.sender, pointsWei, true);
  }

  function _convertPoints(address user, uint256 pointsWei, bool twoLevelUp) internal {
    if (pointsWei == 0) revert ZeroAmount();

    Member storage u = members[user];
    if (u.points < pointsWei) revert InsufficientPoints();

    u.points -= pointsWei;

    uint256 hexOut = (pointsWei * uint256(u.level)) / uint256(pointBaseDiv);
    if (hexOut == 0) revert ZeroAmount();

    if (HEX.balanceOf(address(this)) < hexOut) revert InsufficientHex();
    if (!HEX.transfer(user, hexOut)) revert TransferFail();

    emit PointsConverted(user, pointsWei, hexOut);

    // base target = my mentor (1 level up)
    address target = u.mentor;
    if (target == address(0)) target = bootstrapMentor;

    // twoLevelUp=true -> mentor's mentor (2 levels up)
    if (twoLevelUp) {
      address upline = members[target].mentor;
      if (upline == address(0)) upline = bootstrapMentor;
      target = upline;
    }

    uint256 addPts = pointsWei / 2;
    if (target != address(0) && addPts != 0) {
      members[target].points += addPts;
    }

    _tryFlushTax();
  }

  // DoS-safe: attempt only when threshold reached; never revert on failure
  function _tryFlushTax() internal {
    if (taxAccWei < taxThresholdWei) return;

    uint256 amount = taxAccWei;
    address jb = jumpBank;

    if (jb == address(0)) {
      emit TaxFlush(address(0), amount, false);
      return;
    }

    if (HEX.balanceOf(address(this)) < amount) {
      emit TaxFlush(jb, amount, false);
      return;
    }

    bool ok = HEX.transfer(jb, amount);
    if (!ok) {
      emit TaxFlush(jb, amount, false);
      return;
    }

    taxAccWei = 0;
    emit TaxFlush(jb, amount, true);

    if (callJumpBankHook) {
      try IJumpBank(jb).onTaxReceived(amount) {
      } catch {
      }
    }
  }

  function manualFlushTax(uint256 maxAmountWei) external onlyOwner {
    address jb = jumpBank;
    if (jb == address(0)) revert JumpBankZero();

    uint256 amount = taxAccWei;
    if (maxAmountWei != 0 && amount > maxAmountWei) amount = maxAmountWei;
    if (amount == 0) revert ZeroAmount();

    if (HEX.balanceOf(address(this)) < amount) revert InsufficientHex();
    if (!HEX.transfer(jb, amount)) revert TransferFail();

    taxAccWei -= amount;
    emit TaxFlush(jb, amount, true);

    if (callJumpBankHook) {
      try IJumpBank(jb).onTaxReceived(amount) {
      } catch {
      }
    }
  }

  // ---------- view helpers ----------
  // requirement #1: show KRW/USD/VND value (display-only; depends on owner-set FX)
  function getUserValueScaled(address user) external view returns (
    uint256 hexBalWei,
    uint256 krwValueScaled,
    uint256 usdValueScaled,
    uint256 vndValueScaled,
    uint32 scale
  ) {
    hexBalWei = HEX.balanceOf(user);
    scale = fxScale;
    krwValueScaled = (hexBalWei * fxKrwPerHexScaled) / 1e18;
    usdValueScaled = (hexBalWei * fxUsdPerHexScaled) / 1e18;
    vndValueScaled = (hexBalWei * fxVndPerHexScaled) / 1e18;
  }
}