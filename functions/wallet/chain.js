// functions/wallet/chain.js
// ethers.js v6 – opBNB RPC 연결 + jumpPlatform / HEX 컨트랙트 핼퍼

'use strict';

const { ethers } = require('ethers');

// ────────────────────────────────────────────────
// 체인 설정 (opBNB Mainnet)
// ────────────────────────────────────────────────
const RPC_URL = process.env.OPBNB_RPC || 'https://opbnb-mainnet-rpc.bnbchain.org';

const ADDRESSES = {
  jumpToken:    '0x41F2Ea9F4eF7c4E35ba1a8438fC80937eD4E5464',
  jumpBank:     '0x16752f8948ff2caA02e756c7C8fF0E04887A3a0E',
  jumpPlatform: '0xc609562D5dB60A83C441BeD0E29d81fbF2497DE0',
};

// ────────────────────────────────────────────────
// ABI (minimal – 우리가 호출하는 함수만)
// ────────────────────────────────────────────────
const PLATFORM_ABI = [
  // 가입
  'function register(address mentorAddr) external',

  // 관리자: KRW 입금 후 HEX 지급 (transfer to user)
  'function adminCreditHex(address user, uint256 hexWei, bytes32 ref) external',

  // 조회: 멤버 정보 (public mapping auto-getter)
  'function members(address) external view returns (uint32 level, address mentor, uint256 exp, uint256 points, bool blocked)',

  // 조회: HEX 잔액 + 온체인 FX 환산 (display-only)
  'function getUserValueScaled(address user) external view returns (uint256 hexBalWei, uint256 krwValueScaled, uint256 usdValueScaled, uint256 vndValueScaled, uint32 scale)',

  // 조회: 레벨업 필요 EXP
  'function requiredExpForNextLevel(address user) external view returns (uint256)',

  // 조회: 공개 파라미터
  'function pointBaseDiv() external view returns (uint32)',
  'function fxKrwPerHexScaled() external view returns (uint256)',
  'function fxUsdPerHexScaled() external view returns (uint256)',
  'function fxVndPerHexScaled() external view returns (uint256)',
  'function fxScale() external view returns (uint32)',
  'function taxAccWei() external view returns (uint256)',
  'function mentorShareBps() external view returns (uint16)',
  'function taxThresholdWei() external view returns (uint256)',

  // 유저 액션
  'function convertPointsToHex(uint256 pointsWei) external',
  'function mentorWithdrawPoints(uint256 pointsWei) external',
  'function requestLevelUp() external',
  'function payMerchantHex(uint256 merchantId, uint256 amountWei) external',
  'function registerMerchant(string calldata metadataURI) external returns (uint256 merchantId)',

  // 관리자 액션
  'function ownerDepositHex(uint256 amountWei) external',
  'function ownerWithdrawHex(address to, uint256 amountWei) external',
  'function manualFlushTax(uint256 maxAmountWei) external',
  'function setFx(uint256 krwPerHexScaled, uint256 usdPerHexScaled, uint256 vndPerHexScaled, uint32 scale) external',
  'function adminUpdateMerchantFee(uint256 merchantId, uint16 feeBps) external',
  'function setParams(uint32 div_, uint16 mentorShareBps_, uint256 taxThresholdWei_) external',
  'function adminSetLevel(address user, uint32 level_) external',
  'function adminSetBlocked(address user, bool blocked_) external',
  'function adminChangeMentor(address user, address newMentor) external',

  // 가맹점 조회 (public mapping auto-getter)
  'function merchants(uint256) external view returns (address ownerAddr, uint16 feeBps, bool active, string metadataURI, bool exists)',

  // 이벤트
  'event Registered(address indexed user, address indexed mentor)',
  'event AdminCreditHex(address indexed user, uint256 hexWei, bytes32 indexed ref)',
  'event MerchantRegistered(uint256 indexed merchantId, address indexed ownerAddr)',
  'event PaidHex(address indexed buyer, uint256 indexed merchantId, uint256 amountWei, uint256 feeWei, uint256 expGain)',
  'event PointsConverted(address indexed user, uint256 pointsWei, uint256 hexWei)',
  'event TaxFlush(address indexed to, uint256 amountWei, bool ok)',
  'event FxUpdated(uint256 krwPerHexScaled, uint256 usdPerHexScaled, uint256 vndPerHexScaled, uint32 fxScale)',
];

const HEX_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
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
