// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title JumpDaoStockOption
 * @notice P2P 양도 가능한 스톡옵션 바우처 시스템
 *         현재 소유자 기준으로 권리행사 가능
 */
contract JumpDaoStockOption is Ownable {

    IERC20 public hexToken;
    IERC20 public jumpToken;
    address public jumpBank = 0x16752f8948ff2caA02e756c7C8fF0E04887A3a0E;

    uint256 public nextVoucherId = 1;

    struct OptionVoucher {
        uint256 id;
        address currentOwner;
        uint256 strikePrice;       // HEX wei per 1 JUMP (JUMP has 0 decimals)
        uint256 totalAmount;       // 총 행사 가능 JUMP 수량
        uint256 exercisedAmount;   // 이미 행사한 JUMP 수량
        uint256 purchaseDate;      // 발행 시각 (timestamp)
        uint256 maturityDate;      // 만기 시각 (timestamp)
        bool    active;
    }

    mapping(uint256 => OptionVoucher)  public vouchers;
    mapping(address => uint256[])      public userVoucherIds; // 소유한 적 있는 ID 목록

    // ── 이벤트 ────────────────────────────────────────────────────────────────
    event VoucherCreated(
        uint256 indexed voucherId,
        address indexed owner,
        uint256 strikePrice,
        uint256 totalAmount,
        uint256 maturityDate
    );
    event VoucherTransferred(
        uint256 indexed voucherId,
        address indexed from,
        address indexed to
    );
    event OptionExecuted(
        uint256 indexed voucherId,
        address indexed user,
        uint256 amount,
        uint256 hexPaid
    );

    constructor(address _hexToken, address _jumpToken) Ownable(msg.sender) {
        hexToken  = IERC20(_hexToken);
        jumpToken = IERC20(_jumpToken);
    }

    // ── 관리자: 바우처 생성 ──────────────────────────────────────────────────
    function createOptionVoucher(
        address _owner,
        uint256 _strikePrice,
        uint256 _totalAmount,
        uint256 _maturityDays
    ) external onlyOwner returns (uint256 voucherId) {
        require(_owner != address(0), "Invalid owner");
        require(_totalAmount > 0, "Amount must be > 0");

        voucherId = nextVoucherId++;
        uint256 maturity = block.timestamp + _maturityDays * 1 days;

        vouchers[voucherId] = OptionVoucher({
            id:               voucherId,
            currentOwner:     _owner,
            strikePrice:      _strikePrice,
            totalAmount:      _totalAmount,
            exercisedAmount:  0,
            purchaseDate:     block.timestamp,
            maturityDate:     maturity,
            active:           true
        });

        userVoucherIds[_owner].push(voucherId);

        // 바우처 발행 비용 HEX → JumpBank 자동 전송
        uint256 purchaseCost = _strikePrice * _totalAmount;
        if (purchaseCost > 0) {
            require(
                hexToken.transferFrom(msg.sender, jumpBank, purchaseCost),
                "HEX purchase transfer failed"
            );
        }

        emit VoucherCreated(voucherId, _owner, _strikePrice, _totalAmount, maturity);
    }

    // ── 바우처 양도 (P2P) ────────────────────────────────────────────────────
    function transferVoucher(uint256 _voucherId, address _to) external {
        require(_to != address(0), "Invalid address");
        OptionVoucher storage v = vouchers[_voucherId];
        require(v.active,                        "Inactive voucher");
        require(v.currentOwner == msg.sender,    "Not voucher owner");

        address prev = v.currentOwner;
        v.currentOwner = _to;
        userVoucherIds[_to].push(_voucherId);

        emit VoucherTransferred(_voucherId, prev, _to);
    }

    // ── 권리행사 ────────────────────────────────────────────────────────────
    function executeOption(uint256 _voucherId, uint256 _amount) external {
        OptionVoucher storage v = vouchers[_voucherId];
        require(v.active,                               "Inactive voucher");
        require(v.currentOwner == msg.sender,           "Not current owner");
        require(block.timestamp >= v.maturityDate,      "Not matured yet");

        uint256 remaining = v.totalAmount - v.exercisedAmount;
        require(_amount > 0 && _amount <= remaining,    "Invalid amount");

        uint256 hexCost = _amount * v.strikePrice;

        // HEX 유저 → JumpBank
        require(
            hexToken.transferFrom(msg.sender, jumpBank, hexCost),
            "HEX payment failed"
        );

        // JUMP 컨트랙트 → 유저
        require(
            jumpToken.transfer(msg.sender, _amount),
            "JUMP transfer failed"
        );

        v.exercisedAmount += _amount;
        if (v.exercisedAmount >= v.totalAmount) v.active = false;

        emit OptionExecuted(_voucherId, msg.sender, _amount, hexCost);
    }

    // ── View ────────────────────────────────────────────────────────────────
    function getVoucher(uint256 _voucherId)
        external view returns (OptionVoucher memory)
    {
        return vouchers[_voucherId];
    }

    function getUserVouchers(address _user)
        external view returns (uint256[] memory)
    {
        return userVoucherIds[_user];
    }

    function remainingAmount(uint256 _voucherId)
        external view returns (uint256)
    {
        OptionVoucher memory v = vouchers[_voucherId];
        return v.totalAmount - v.exercisedAmount;
    }

    function isMatured(uint256 _voucherId)
        external view returns (bool)
    {
        return block.timestamp >= vouchers[_voucherId].maturityDate;
    }

    // ── 관리자: JUMP 예치 / 인출 ─────────────────────────────────────────────
    function depositJumpToken(uint256 _amount) external onlyOwner {
        require(jumpToken.transferFrom(msg.sender, address(this), _amount), "Deposit failed");
    }

    function withdrawJumpToken(uint256 _amount) external onlyOwner {
        require(jumpToken.transfer(owner(), _amount), "Withdraw failed");
    }

    function setJumpBank(address _newBank) external onlyOwner {
        require(_newBank != address(0), "Invalid address");
        jumpBank = _newBank;
    }
}
