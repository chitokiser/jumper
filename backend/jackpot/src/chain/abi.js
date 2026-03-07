export const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function decimals() view returns (uint8)",
];

// jumpPlatform.sol의 실제 이벤트: payMerchantHex() 호출 시 emit PaidHex(...)
export const PAYMENT_EVENT_ABI = [
  "event PaidHex(address indexed buyer, uint256 indexed merchantId, uint256 amountWei, uint256 feeWei, uint256 expGain)",
];
