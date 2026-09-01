// scripts/deploy.js
// JumpAutoExchange 컨트랙트 opBNB Mainnet 배포

const { ethers } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deployer:', deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('BNB Balance:', ethers.formatEther(balance), 'BNB');

  if (balance === 0n) {
    throw new Error('BNB 잔액이 없습니다. gas fee용 BNB를 충전하세요.');
  }

  // ── 생성자 인자 ──────────────────────────────────
  const JUMP_TOKEN   = '0xA3C35c52446C133b7211A743c6D47470D1385601'; // JUMP 포인트 (0 decimals)
  const OPERATOR     = deployer.address;                              // 어드민 지갑 = operator
  const COIN_PER_JUMP = 100n;                                         // 게임코인 100개 = JUMP 1개
  // ─────────────────────────────────────────────────

  console.log('\n배포 파라미터:');
  console.log('  jumpToken  :', JUMP_TOKEN);
  console.log('  operator   :', OPERATOR);
  console.log('  coinPerJump:', COIN_PER_JUMP.toString());

  const Factory = await ethers.getContractFactory('JumpAutoExchange');
  console.log('\n컨트랙트 배포 중...');
  const contract = await Factory.deploy(JUMP_TOKEN, OPERATOR, COIN_PER_JUMP);
  await contract.waitForDeployment();

  const addr = await contract.getAddress();
  console.log('\n✅ 배포 완료!');
  console.log('  컨트랙트 주소:', addr);
  console.log('  TxHash       :', contract.deploymentTransaction().hash);
  console.log('\n다음 명령어로 Firebase Secret 등록:');
  console.log(`  firebase functions:secrets:set JUMP_AUTO_EXCHANGE_ADDRESS`);
  console.log(`  입력값: ${addr}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
