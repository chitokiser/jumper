// functions/wallet/chain.js
// ethers.js v6 – opBNB RPC 연결 + jumpPlatform / HEX 컨트랙트 핼퍼

'use strict';

const { ethers } = require('ethers');

// ────────────────────────────────────────────────
// 체인 설정 (opBNB Mainnet)
// ────────────────────────────────────────────────
const RPC_URL = process.env.OPBNB_RPC || 'https://opbnb-mainnet-rpc.bnbchain.org';

const ADDRESSES = {
  jumpToken:    '0x41F2Ea9F4eF7c4E35ba1a8438fC80937eD4E5464',  // HEX (플랫폼 포인트 토큰, 18 decimals)
  jumpJump:     '0xA3C35c52446C133b7211A743c6D47470D1385601',  // JUMP 거래 토큰 (0 decimals)
  jumpBank:     '0x16752f8948ff2caA02e756c7C8fF0E04887A3a0E',  // 거래소 컨트랙트
  jumpTreasury: '0xe1f4cDc794D22C23fa47E768dD86Ad09aeEb0312',  // 거버넌스
  jumpPlatform: '0x4d83A7764428fd1c116062aBb60c329E0E29f490',
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
  'function jackpotAccWei() external view returns (uint256)',
  'function uplineReserveWei() external view returns (uint256)',
  'function mentorShareBps() external view returns (uint16)',
  'function jackpotShareBps() external view returns (uint16)',
  'function uplineReserveBps() external view returns (uint16)',
  'function taxThresholdWei() external view returns (uint256)',
  'function owner() external view returns (address)',
  'function pendingOwner() external view returns (address)',
  'function solvencyReserve() external view returns (uint256 tax, uint256 jackpot, uint256 uplineReserve, uint256 reserved, uint256 contractBal, bool solvent)',

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
  'function setParams(uint32 div_, uint16 mentorShareBps_, uint16 jackpotShareBps_, uint16 uplineReserveBps_, uint256 taxThresholdWei_) external',
  'function adminSetLevel(address user, uint32 level_) external',
  'function adminSetBlocked(address user, bool blocked_) external',
  'function adminChangeMentor(address user, address newMentor) external',
  'function setJumpBank(address jb, bool callHook) external',
  'function transferOwnership(address newOwner) external',
  'function acceptOwnership() external',

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
  'event JackpotPointsAwarded(address indexed user, uint256 pointsWei, uint256 rand)',
  'event OwnershipTransferStarted(address indexed from, address indexed to)',
  'event OwnershipTransferred(address indexed from, address indexed to)',
];

const HEX_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

// JUMP 토큰 ABI (ERC20, 0 decimals)
const JUMP_TOKEN_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function totalSupply() external view returns (uint256)',
];

// jumpBank ABI (거래소 + 스테이킹 + 배당)
const JUMP_BANK_ABI = [
  // 거래
  'function buy(uint256 amount, uint256 maxPay) external',
  'function sell(uint256 amount) external',
  // 스테이킹
  'function stake(uint256 amount) external',
  'function withdraw() external',
  // 배당
  'function claimDividend() external',
  'function pendingDividend(address who) external view returns (uint256)',
  // 조회
  'function price() external view returns (uint256)',
  'function totalStaked() external view returns (uint256)',
  'function act() external view returns (uint8)',
  'function rate() external view returns (uint8)',
  'function hexBalance() external view returns (uint256)',
  'function tokenInventory() external view returns (uint256)',
  'function circulatingSupply() external view returns (uint256)',
  'function user(address who) external view returns (uint256 totalAllow, uint256 totalBuy, uint256 depo, uint256 stakingTime, uint256 lastClaim)',
  'function myDashboard(address who) external view returns (uint256 myActualQty, uint256 currentPriceWei, uint256 myMarketCapWei, uint256 myAvgBuyPriceWei, int256 myPnlWei, int256 myRoiBps_)',
  'function autoStakeBps() external view returns (uint16)',
  'function chartLength() external view returns (uint256)',
  'function chartAt(uint256 idx) external view returns (uint256)',
  'function effectiveStaked() external view returns (uint256)',
  'function divisor() external view returns (uint256)',
  // 이벤트
  'event Bought(address indexed who, uint256 amount, uint256 payHexWei, uint256 autoStaked, uint256 received)',
  'event Sold(address indexed who, uint256 amount, uint256 recvHexWei, uint256 feeHexWei)',
  'event Staked(address indexed who, uint256 amount)',
  'event Withdrawn(address indexed who, uint256 amount)',
  'event DividendClaimed(address indexed who, uint256 payHexWei)',
];

// CoopMall 컨트랙트 (폐쇄 전용몰)
const COOP_MALL_ADDRESS = '0x421Bb7Ba86c8cafA181F85C9907B864B85bEF49A';

const COOP_MALL_ABI = [
  // 상태 조회
  'function getUserInfo(address addr) external view returns (bool eligible, bool member, address mentor, uint256 points)',
  'function membershipFeeHex() external view returns (uint256)',
  'function mentorRewardBps() external view returns (uint16)',
  'function contractHexBalance() external view returns (uint256)',
  'function contractJumpBalance() external view returns (uint256)',
  'function jumpPrice() external view returns (uint256)',
  'function withdrawableHex() external view returns (uint256)',
  'function totalPoints() external view returns (uint256)',
  // 유저 액션
  'function joinMall() external',
  'function pay(uint256 hexAmount) external',
  'function convertPoints(uint256 pts) external',
  // 관리자 액션
  'function grantEligibility(address user, address mentor) external',
  'function setMembershipFee(uint256 feeWei) external',
  'function setMentorRewardBps(uint16 bps) external',
  'function withdrawHex(uint256 amount) external',
  'function withdrawJump(uint256 amount) external',
  // 바우처 — 관리자 액션
  'function createVoucherTemplate(uint256 hexPrice, uint16 burnFeeBps, string calldata description, string calldata usagePlace, string calldata imageURI) external returns (uint256)',
  'function setVoucherBurnFee(uint256 templateId, uint16 burnFeeBps) external',
  'function setVoucherTemplateActive(uint256 templateId, bool active) external',
  // 바우처 — 유저 액션
  'function buyVoucher(uint256 templateId) external returns (uint256)',
  'function transferVoucher(uint256 voucherId, address to) external',
  'function burnVoucher(uint256 voucherId) external',
  // 바우처 — 조회
  'function voucherTemplateCount() external view returns (uint256)',
  'function voucherCount() external view returns (uint256)',
  'function totalVoucherReserve() external view returns (uint256)',
  'function voucherTemplates(uint256) external view returns (uint256 hexPrice, uint16 burnFeeBps, bool active, string memory description, string memory usagePlace, string memory imageURI)',
  'function vouchers(uint256) external view returns (uint256 templateId, address owner, bool burned)',
  'function getVouchersByOwner(address owner_) external view returns (uint256[] memory)',
  'function getVoucherInfo(uint256 voucherId) external view returns (uint256 templateId, address vOwner, bool burned, uint256 hexPrice, uint16 burnFeeBps, bool templateActive, string memory description, string memory usagePlace, string memory imageURI)',
  // 이벤트
  'event EligibilityGranted(address indexed user, address indexed mentor)',
  'event MemberJoined(address indexed user, uint256 feeHex, uint256 jumpGiven)',
  'event Paid(address indexed buyer, uint256 hexAmount, uint256 mentorPoints)',
  'event PointsConverted(address indexed user, uint256 pts, uint256 upperBonus)',
  'event VoucherTemplateCreated(uint256 indexed templateId, uint256 hexPrice, uint16 burnFeeBps)',
  'event VoucherBought(uint256 indexed voucherId, uint256 indexed templateId, address indexed buyer)',
  'event VoucherTransferred(uint256 indexed voucherId, address indexed from, address indexed to)',
  'event VoucherBurned(uint256 indexed voucherId, address indexed owner, uint256 hexReturned, uint256 feeKept)',
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

function getJumpTokenContract(signerOrProvider) {
  return new ethers.Contract(ADDRESSES.jumpJump, JUMP_TOKEN_ABI, signerOrProvider);
}

function getJumpBankContract(signerOrProvider) {
  return new ethers.Contract(ADDRESSES.jumpBank, JUMP_BANK_ABI, signerOrProvider);
}

function getCoopMallContract(signerOrProvider) {
  return new ethers.Contract(COOP_MALL_ADDRESS, COOP_MALL_ABI, signerOrProvider);
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
  COOP_MALL_ADDRESS,
  getProvider,
  getPlatformContract,
  getHexContract,
  getJumpTokenContract,
  getJumpBankContract,
  getCoopMallContract,
  walletFromKey,
  getAdminWallet,
  estimateGasWithBuffer,
};
