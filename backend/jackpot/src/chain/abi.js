export const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function decimals() view returns (uint8)",
];

// NOTE: Replace with actual payment event signature from your existing contract.
// Must keep contract untouched, only read events.
export const PAYMENT_EVENT_ABI = [
  "event PaymentSettled(bytes32 indexed merchantId, address indexed user, uint256 paymentAmount, uint256 feeAmount)",
];
