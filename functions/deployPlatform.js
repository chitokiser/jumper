/**
 * deployPlatform.js
 * 새 JumperPlatform 컨트랙트 배포 + 초기 설정 스크립트
 *
 * 실행:
 *   ADMIN_PRIVATE_KEY=0x...  node deployPlatform.js
 *
 * 완료 후 출력되는 새 컨트랙트 주소를 chain.js의 jumpPlatform 값에 기입.
 */
'use strict';

const { ethers } = require('ethers');

// ── 체인 설정 ─────────────────────────────────────────────────────────
const RPC_URL         = 'https://opbnb-mainnet-rpc.bnbchain.org';
const HEX_ADDRESS     = '0x41F2Ea9F4eF7c4E35ba1a8438fC80937eD4E5464'; // HEX 토큰
const JUMP_BANK_ADDR  = '0x16752f8948ff2caA02e756c7C8fF0E04887A3a0E'; // jumpBank

// ── 컨트랙트 바이트코드 + ABI ─────────────────────────────────────────
// Remix / Hardhat으로 jumpPlatform.sol 컴파일 후 아래 두 값을 채워넣으세요.
// Remix: Compile 탭 → ABI 복사, Bytecode → object 값 복사
const BYTECODE = process.env.BYTECODE || '';  // 0x로 시작하는 컴파일된 바이트코드
const ABI = [
  'constructor(address hexToken, address bootstrapMentor, address jumpBank)',

  // 관리자
  'function setParams(uint32 div_, uint16 mentorShareBps_, uint16 jackpotShareBps_, uint16 uplineReserveBps_, uint256 taxThresholdWei_) external',
  'function setJumpBank(address jb, bool callHook) external',
  'function setFx(uint256 krwPerHexScaled, uint256 usdPerHexScaled, uint256 vndPerHexScaled, uint32 scale) external',
  'function ownerDepositHex(uint256 amountWei) external',
  'function owner() external view returns (address)',

  // HEX approve
];

const HEX_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
];

async function main() {
  const privateKey = process.env.ADMIN_PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ ADMIN_PRIVATE_KEY 환경변수가 없습니다.');
    process.exit(1);
  }
  if (!BYTECODE) {
    console.error('❌ BYTECODE 환경변수가 없습니다.');
    console.error('   Remix에서 jumpPlatform.sol 컴파일 후 Bytecode > object 값을 BYTECODE 환경변수로 전달하세요.');
    console.error('   예: BYTECODE=0x608060... ADMIN_PRIVATE_KEY=0x... node deployPlatform.js');
    process.exit(1);
  }

  const provider  = new ethers.JsonRpcProvider(RPC_URL);
  const wallet    = new ethers.Wallet(privateKey, provider);
  const hexToken  = new ethers.Contract(HEX_ADDRESS, HEX_ABI, wallet);

  console.log('\n📋 배포 정보');
  console.log('  배포자(owner)  :', wallet.address);

  const bnbBal = await provider.getBalance(wallet.address);
  const hexBal = await hexToken.balanceOf(wallet.address);
  console.log('  BNB 잔액       :', ethers.formatEther(bnbBal), 'BNB');
  console.log('  HEX 잔액       :', ethers.formatEther(hexBal), 'HEX');
  console.log('  hexToken       :', HEX_ADDRESS);
  console.log('  bootstrapMentor:', wallet.address, '(배포자 = 부트스트랩 멘토)');
  console.log('  jumpBank       :', JUMP_BANK_ADDR);

  console.log('\n⚠️  5초 후 배포를 시작합니다... (중단: Ctrl+C)');
  await new Promise(r => setTimeout(r, 5000));

  // ── 1. 컨트랙트 배포 ───────────────────────────────────────────────
  console.log('\n🚀 [1/4] 컨트랙트 배포 중...');
  const factory  = new ethers.ContractFactory(ABI, BYTECODE, wallet);
  const contract = await factory.deploy(
    HEX_ADDRESS,     // hexToken
    wallet.address,  // bootstrapMentor (배포자)
    JUMP_BANK_ADDR,  // jumpBank
  );
  console.log('  트랜잭션 전송:', contract.deploymentTransaction().hash);
  await contract.waitForDeployment();
  const newAddr = await contract.getAddress();
  console.log('  ✅ 배포 완료!');
  console.log('  새 컨트랙트 주소:', newAddr);

  // ── 2. setParams (수수료 비율 설정) ───────────────────────────────
  console.log('\n⚙️  [2/4] setParams 설정 중...');
  // mentorShareBps=3000(30%) / jackpotShareBps=3000(30%) / uplineReserveBps=3000(30%) / tax=10%
  const tx2 = await contract.setParams(
    10,             // pointBaseDiv
    3000,           // mentorShareBps   30%
    3000,           // jackpotShareBps  30%
    3000,           // uplineReserveBps 30%
    ethers.parseEther('100'), // taxThresholdWei  100 HEX
  );
  await tx2.wait();
  console.log('  ✅ setParams 완료');

  // ── 3. HEX approve + ownerDepositHex ─────────────────────────────
  console.log('\n💰 [3/4] HEX approve → ownerDepositHex...');
  const depositAmount = ethers.parseEther('800'); // 800 HEX 충전 (조정 가능)
  const allowance = await hexToken.allowance(wallet.address, newAddr);
  if (allowance < depositAmount) {
    const approveTx = await hexToken.approve(newAddr, ethers.MaxUint256);
    await approveTx.wait();
    console.log('  ✅ approve 완료');
  }
  const depositTx = await contract.ownerDepositHex(depositAmount);
  await depositTx.wait();
  console.log('  ✅ ownerDepositHex', ethers.formatEther(depositAmount), 'HEX 충전 완료');

  // ── 4. approveHex.js용 — 관리자 → 플랫폼 approve ─────────────────
  // (adminCreditHex 호출 시 필요한 별도 approve는 approveHex.js에서 처리)

  // ── 결과 출력 ─────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('🎉 배포 완료! chain.js를 아래와 같이 업데이트하세요:');
  console.log('='.repeat(60));
  console.log(`\n  jumpPlatform: '${newAddr}',`);
  console.log('\n그리고 approveHex.js의 PLATFORM_ADDR도 동일하게 변경하세요.');
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('❌ 오류:', err.message);
  process.exit(1);
});
