// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

/**
 * JumpAutoExchange
 *
 * 게임코인(off-chain) ↔ JUMP 토큰(on-chain) 양방향 교환 컨트랙트.
 *
 * 보안 모델:
 *   - purchaseJumpFor / sellJumpForCoins 는 onlyOperator (Cloud Function 어드민 지갑)
 *   - Firebase가 게임코인 보유 확인·차감/지급 처리 후 이 컨트랙트를 호출
 *   - 컨트랙트는 on-chain 기록 보관 + JUMP 이체만 수행
 *
 * 교환 비율 (coinPerJump):
 *   Buy : 게임코인 N개 →  N / coinPerJump JUMP
 *   Sell: JUMP N개    →  N * coinPerJump 게임코인
 */
contract JumpAutoExchange {

    // ─────────────────────────────
    // TOKEN / ROLES
    // ─────────────────────────────
    IERC20  public jumpToken;
    address public owner;
    address public operator; // Cloud Function 어드민 지갑

    // ─────────────────────────────
    // SETTINGS
    // coinPerJump: 게임코인 몇 개 = JUMP 1개
    // 예: 100 → 게임코인 100 = JUMP 1개
    // ─────────────────────────────
    uint256 public coinPerJump;
    bool    public saleEnabled = true;

    // ─────────────────────────────
    // 구매 기록 (game coin → JUMP)
    // ─────────────────────────────
    struct Purchase {
        address buyer;
        uint256 gameCoinUsed;
        uint256 jumpAmount;
        uint256 timestamp;
    }
    Purchase[] private _purchases;
    mapping(address => uint256[]) private _userPurchaseIds;

    // ─────────────────────────────
    // 판매 기록 (JUMP → game coin)
    // ─────────────────────────────
    struct Sell {
        address seller;
        uint256 jumpAmount;
        uint256 gameCoinReceived;
        uint256 timestamp;
    }
    Sell[] private _sells;
    mapping(address => uint256[]) private _userSellIds;

    // ─────────────────────────────
    // EVENTS
    // ─────────────────────────────
    event JumpPurchased(
        address indexed buyer,
        uint256 gameCoinUsed,
        uint256 jumpAmount,
        uint256 timestamp
    );
    event JumpSold(
        address indexed seller,
        uint256 jumpAmount,
        uint256 gameCoinReceived,
        uint256 timestamp
    );
    event CoinRateChanged(uint256 newRate);
    event SaleStatusChanged(bool enabled);
    event JumpWithdrawn(address indexed to, uint256 amount);
    event OperatorChanged(address indexed newOperator);

    // ─────────────────────────────
    // MODIFIERS
    // ─────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "ONLY_OWNER");
        _;
    }
    modifier onlyOperator() {
        require(msg.sender == operator || msg.sender == owner, "ONLY_OPERATOR");
        _;
    }
    modifier whenEnabled() {
        require(saleEnabled, "SALE_DISABLED");
        _;
    }

    // ─────────────────────────────
    // CONSTRUCTOR
    // ─────────────────────────────
    constructor(
        address _jumpToken,
        address _operator,
        uint256 _coinPerJump
    ) {
        require(_jumpToken  != address(0), "INVALID_TOKEN");
        require(_operator   != address(0), "INVALID_OPERATOR");
        require(_coinPerJump > 0,          "INVALID_RATE");

        owner       = msg.sender;
        jumpToken   = IERC20(_jumpToken);
        operator    = _operator;
        coinPerJump = _coinPerJump;
    }

    // ─────────────────────────────
    // BUY: 게임코인 → JUMP
    //
    // Firebase에서 게임코인 검증·차감 완료 후 operator가 호출.
    // JUMP를 buyer 주소로 직접 전송.
    // ─────────────────────────────
    function purchaseJumpFor(
        address buyer,
        uint256 gameCoinAmount
    ) external onlyOperator whenEnabled {
        require(buyer != address(0), "INVALID_BUYER");
        require(gameCoinAmount > 0,  "ZERO_AMOUNT");

        uint256 jumpAmount = gameCoinAmount / coinPerJump;
        require(jumpAmount > 0, "INSUFFICIENT_COIN");
        require(
            jumpToken.balanceOf(address(this)) >= jumpAmount,
            "INSUFFICIENT_JUMP"
        );

        require(jumpToken.transfer(buyer, jumpAmount), "TRANSFER_FAILED");

        uint256 idx = _purchases.length;
        _purchases.push(Purchase({
            buyer:        buyer,
            gameCoinUsed: gameCoinAmount,
            jumpAmount:   jumpAmount,
            timestamp:    block.timestamp
        }));
        _userPurchaseIds[buyer].push(idx);

        emit JumpPurchased(buyer, gameCoinAmount, jumpAmount, block.timestamp);
    }

    // ─────────────────────────────
    // SELL: JUMP → 게임코인
    //
    // 1. Cloud Function이 유저 수탁 지갑으로 이 컨트랙트에 approve 처리
    // 2. operator가 이 함수 호출 → JUMP를 컨트랙트로 가져옴
    // 3. Cloud Function이 Firebase에 게임코인 지급
    //
    // gameCoinAmount = jumpAmount * coinPerJump (컨트랙트 자동 계산)
    // ─────────────────────────────
    function sellJumpForCoins(
        address seller,
        uint256 jumpAmount
    ) external onlyOperator whenEnabled returns (uint256 gameCoinAmount) {
        require(seller != address(0), "INVALID_SELLER");
        require(jumpAmount > 0,       "ZERO_AMOUNT");
        require(
            jumpToken.allowance(seller, address(this)) >= jumpAmount,
            "ALLOWANCE_TOO_LOW"
        );
        require(
            jumpToken.balanceOf(seller) >= jumpAmount,
            "INSUFFICIENT_JUMP"
        );

        gameCoinAmount = jumpAmount * coinPerJump;

        require(
            jumpToken.transferFrom(seller, address(this), jumpAmount),
            "TRANSFER_FAILED"
        );

        uint256 idx = _sells.length;
        _sells.push(Sell({
            seller:          seller,
            jumpAmount:      jumpAmount,
            gameCoinReceived: gameCoinAmount,
            timestamp:       block.timestamp
        }));
        _userSellIds[seller].push(idx);

        emit JumpSold(seller, jumpAmount, gameCoinAmount, block.timestamp);
    }

    // ─────────────────────────────
    // 관리자 기능
    // ─────────────────────────────

    function setCoinPerJump(uint256 newRate) external onlyOwner {
        require(newRate > 0, "INVALID_RATE");
        coinPerJump = newRate;
        emit CoinRateChanged(newRate);
    }

    function setSaleEnabled(bool enabled) external onlyOwner {
        saleEnabled = enabled;
        emit SaleStatusChanged(enabled);
    }

    function setOperator(address newOperator) external onlyOwner {
        require(newOperator != address(0), "INVALID_OPERATOR");
        operator = newOperator;
        emit OperatorChanged(newOperator);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "INVALID_OWNER");
        owner = newOwner;
    }

    function withdrawJump(uint256 amount) external onlyOwner {
        require(amount > 0, "ZERO_AMOUNT");
        require(
            jumpToken.balanceOf(address(this)) >= amount,
            "INSUFFICIENT_BALANCE"
        );
        require(jumpToken.transfer(owner, amount), "WITHDRAW_FAILED");
        emit JumpWithdrawn(owner, amount);
    }

    // ─────────────────────────────
    // VIEW FUNCTIONS
    // ─────────────────────────────

    /// 게임코인 N개로 받을 수 있는 JUMP 수량 미리보기
    function previewBuy(uint256 gameCoinAmount) external view returns (uint256) {
        if (coinPerJump == 0) return 0;
        return gameCoinAmount / coinPerJump;
    }

    /// JUMP N개를 팔면 받을 게임코인 수량 미리보기
    function previewSell(uint256 jumpAmount) external view returns (uint256) {
        return jumpAmount * coinPerJump;
    }

    function purchaseCount() external view returns (uint256) {
        return _purchases.length;
    }

    function sellCount() external view returns (uint256) {
        return _sells.length;
    }

    function getPurchase(uint256 index)
        external view
        returns (address buyer, uint256 gameCoinUsed, uint256 jumpAmount, uint256 timestamp)
    {
        Purchase storage p = _purchases[index];
        return (p.buyer, p.gameCoinUsed, p.jumpAmount, p.timestamp);
    }

    function getSell(uint256 index)
        external view
        returns (address seller, uint256 jumpAmount, uint256 gameCoinReceived, uint256 timestamp)
    {
        Sell storage s = _sells[index];
        return (s.seller, s.jumpAmount, s.gameCoinReceived, s.timestamp);
    }

    function getUserPurchaseIds(address user) external view returns (uint256[] memory) {
        return _userPurchaseIds[user];
    }

    function getUserSellIds(address user) external view returns (uint256[] memory) {
        return _userSellIds[user];
    }

    function contractJumpBalance() external view returns (uint256) {
        return jumpToken.balanceOf(address(this));
    }
}
