/**
 * migrateHex.js
 * 구 jumpPlatform 컨트랙트에서 HEX를 인출한다.
 *
 * 사용법:
 *   ADMIN_PRIVATE_KEY=0x...  node migrateHex.js
 *
 * 옵션:
 *   TO=0x신규컨트랙트주소   → 인출 목적지 (미지정 시 관리자 지갑 자신)
 *   AMOUNT=123.45           → 인출할 HEX 수량 (미지정 시 전체 잔액)
 *
 * 예시 — 신규 컨트랙트로 전량 이전:
 *   ADMIN_PRIVATE_KEY=0x... TO=0xNewPlatformAddress node migrateHex.js
 */
'use strict';

const { ethers } = require('ethers');

// ── 체인 설정 ────────────────────────────────────────────────────────
const RPC_URL        = 'https://opbnb-mainnet-rpc.bnbchain.org';
const OLD_PLATFORM   = '0x4d83A7764428fd1c116062aBb60c329E0E29f490';
const HEX_ADDRESS    = '0x41F2Ea9F4eF7c4E35ba1a8438fC80937eD4E5464'; // HEX 토큰 (18 decimals)

// ── ABI (필요한 함수만) ───────────────────────────────────────────────
const PLATFORM_ABI = [
  'function ownerWithdrawHex(address to, uint256 amountWei) external',
  'function owner() external view returns (address)',
  'function taxAccWei() external view returns (uint256)',
];

const HEX_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
];

async function main() {
  // ── 환경변수 ──────────────────────────────────────────────────────
  const privateKey = process.env.ADMIN_PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ ADMIN_PRIVATE_KEY 환경변수가 없습니다.');
    console.error('   ADMIN_PRIVATE_KEY=0x... node migrateHex.js');
    process.exit(1);
  }

  const provider  = new ethers.JsonRpcProvider(RPC_URL);
  const wallet    = new ethers.Wallet(privateKey, provider);
  const platform  = new ethers.Contract(OLD_PLATFORM, PLATFORM_ABI, wallet);
  const hexToken  = new ethers.Contract(HEX_ADDRESS, HEX_ABI, provider);

  // ── 사전 확인 ─────────────────────────────────────────────────────
  console.log('\n📋 사전 확인');
  console.log('  관리자 지갑 :', wallet.address);

  const bnbBal = await provider.getBalance(wallet.address);
  console.log('  BNB 잔액    :', ethers.formatEther(bnbBal), 'BNB');

  const contractOwner = await platform.owner();
  console.log('  컨트랙트 owner:', contractOwner);

  if (contractOwner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error('❌ 이 지갑은 컨트랙트 owner가 아닙니다.');
    console.error('   owner:', contractOwner);
    console.error('   지갑 :', wallet.address);
    process.exit(1);
  }

  const contractHexBal = await hexToken.balanceOf(OLD_PLATFORM);
  const taxAcc         = await platform.taxAccWei();

  console.log('\n💰 컨트랙트 잔액');
  console.log('  HEX 총 잔액 :', ethers.formatEther(contractHexBal), 'HEX');
  console.log('  taxAccWei   :', ethers.formatEther(taxAcc), 'HEX  ← 세금 누적분 (포함 인출)');

  if (contractHexBal === 0n) {
    console.log('\n✅ 인출할 HEX 잔액이 없습니다. (이미 비어 있음)');
    return;
  }

  // ── 목적지 & 금액 결정 ───────────────────────────────────────────
  const toAddr = process.env.TO
    ? ethers.getAddress(process.env.TO)   // 신규 컨트랙트 주소
    : wallet.address;                     // 기본: 관리자 지갑 자신

  const amountWei = process.env.AMOUNT
    ? ethers.parseEther(process.env.AMOUNT)
    : contractHexBal; // 기본: 전체 잔액

  console.log('\n🚀 인출 정보');
  console.log('  목적지  :', toAddr);
  console.log('  인출량  :', ethers.formatEther(amountWei), 'HEX');

  if (amountWei > contractHexBal) {
    console.error('❌ 인출량이 컨트랙트 잔액을 초과합니다.');
    process.exit(1);
  }

  // ── 실행 확인 ─────────────────────────────────────────────────────
  console.log('\n⚠️  ownerWithdrawHex 트랜잭션을 전송합니다.');
  console.log('   5초 후 실행... (중단: Ctrl+C)');
  await new Promise(r => setTimeout(r, 5000));

  const tx = await platform.ownerWithdrawHex(toAddr, amountWei);
  console.log('\n📤 트랜잭션 전송:', tx.hash);
  console.log('   확인 대기 중...');

  const receipt = await tx.wait();

  console.log('\n✅ 인출 완료!');
  console.log('   txHash :', receipt.hash);
  console.log('   Block  :', receipt.blockNumber);
  console.log('   Gas    :', receipt.gasUsed.toString());

  // ── 잔액 재확인 ───────────────────────────────────────────────────
  const afterBal = await hexToken.balanceOf(OLD_PLATFORM);
  const destBal  = await hexToken.balanceOf(toAddr);
  console.log('\n📊 인출 후 잔액');
  console.log('  구 컨트랙트 :', ethers.formatEther(afterBal), 'HEX');
  console.log('  목적지      :', ethers.formatEther(destBal), 'HEX');
}

main().catch((err) => {
  console.error('❌ 오류:', err.message);
  process.exit(1);
});
