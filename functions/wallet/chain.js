// functions/wallet/chain.js
// ethers.js v6 – opBNB RPC 연결 + jumpPlatform / HEX 컨트랙트 핼퍼

'use strict';

const { ethers } = require('ethers');

// ────────────────────────────────────────────────
// 체인 설정 (opBNB Mainnet)
// ────────────────────────────────────────────────
const RPC_URL = process.env.OPBNB_RPC || 'https://opbnb-mainnet-rpc.bnbchain.org';

const ADDRESSES = {
  jumpToken:    '0xA3C35c52446C133b7211A743c6D47470D1385601',
  jumpBank:     '0x16752f8948ff2caA02e756c7C8fF0E04887A3a0E',
  jumpPlatform: '0xb071020eE2bA70F706Fb1310EEB5b41F61f1471F',
};

// ────────────────────────────────────────────────
// ABI (minimal – 우리가 호출하는 함수만)
// ────────────────────────────────────────────────
const PLATFORM_ABI = [
  // 가입
  'function register(address mentorAddress) external',

  // 관리자: 포인트 충전 (HEX transferFrom owner→contract + user.pointWei 증가)
  'function creditPoints(address user, uint256 amountWei, bytes32 ref, uint256 usdKrwSnapshotScaled) external',

  // 조합원: 상품 구매
  'function buy(uint256 productId) external',

  // 인출 (payableWei → HEX 전송)
  'function withdraw(uint256 amountWei) external',

  // 조회
  'function getMember(address user) external view returns (uint32 level, address mentor, uint256 pointWei, uint256 payableWei, uint64 joinAt, bool blocked)',
  'function isMember(address user) external view returns (bool)',
  'function getProduct(uint256 productId) external view returns (bool exists, address seller, uint256 priceWei, uint16 feeBps, bool active)',
  'function ownerHexAllowance() external view returns (uint256)',
  'function contractHexBalance() external view returns (uint256)',

  // 이벤트
  'event Registered(address indexed user, address indexed mentor, uint64 at)',
  'event PointCredited(address indexed user, uint256 amountWei, bytes32 indexed ref, uint256 usdKrwSnapshotScaled, uint64 at)',
  'event Purchased(address indexed buyer, uint256 indexed productId, address indexed seller, uint256 priceWei, uint256 sellerNetWei, uint256 mentorCutWei, uint256 platformFeeWei, uint64 at)',
];

const HEX_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function transfer(address to, uint256 amount) external returns (bool)',
];

// ────────────────────────────────────────────────
// 팩토리 함수
// ────────────────────────────────────────────────

function getProvider() {
  return new ethers.JsonRpcProvider(RPC_URL);
}

function getPlatformContract(signerOrProvider) {
  return new ethers.Contract(ADDRESSES.jumpPlatform, PLATFORM_ABI, signerOrProvider);
}

function getHexContract(signerOrProvider) {
  return new ethers.Contract(ADDRESSES.jumpToken, HEX_ABI, signerOrProvider);
}

/**
 * 복호화된 private key로 Wallet 복원
 */
function walletFromKey(privateKey, provider) {
  return new ethers.Wallet(privateKey, provider ?? getProvider());
}

/**
 * 관리자 지갑 (jumpPlatform.owner – creditPoints 호출 권한)
 * ADMIN_PRIVATE_KEY = Firebase Secret Manager에서 주입
 */
function getAdminWallet() {
  const key = process.env.ADMIN_PRIVATE_KEY;
  if (!key) throw new Error('[chain] ADMIN_PRIVATE_KEY Secret이 설정되지 않았습니다');
  return new ethers.Wallet(key, getProvider());
}

/**
 * 가스 추정 후 10% 여유분 추가
 */
async function estimateGasWithBuffer(contract, method, args) {
  const estimated = await contract[method].estimateGas(...args);
  return (estimated * BigInt(110)) / BigInt(100);
}

module.exports = {
  ADDRESSES,
  getProvider,
  getPlatformContract,
  getHexContract,
  walletFromKey,
  getAdminWallet,
  estimateGasWithBuffer,
};
