// scripts/deployCoopMall.js
// CoopMall v4 — opBNB Mainnet 배포

const { ethers } = require('hardhat');

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deployer:', deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log('BNB Balance:', ethers.formatEther(balance), 'BNB');

  if (balance === 0n) {
    throw new Error('BNB 잔액이 없습니다. gas fee용 BNB를 충전하세요.');
  }

  // ── 생성자 인자 ──────────────────────────────────────
  const Point_TOKEN  = '0x41F2Ea9F4eF7c4E35ba1a8438fC80937eD4E5464'; // Point 플랫폼 포인트 포인트 (18 decimals)
  const JUMP_TOKEN = '0xA3C35c52446C133b7211A743c6D47470D1385601'; // JUMP 거래 포인트 (0 decimals)
  const JUMP_BANK  = '0x16752f8948ff2caA02e756c7C8fF0E04887A3a0E'; // JumpBank 거래소 컨트랙트
  // ─────────────────────────────────────────────────────

  console.log('\n배포 파라미터:');
  console.log('  hexToken  :', Point_TOKEN);
  console.log('  jumpToken :', JUMP_TOKEN);
  console.log('  jumpBank  :', JUMP_BANK);

  // ── 배포할 컨트랙트를 contract/ 폴더에서 로드 ────────
  const Factory = await ethers.getContractFactory('CoopMall');
  console.log('\nCoopMall v4 배포 중...');
  const contract = await Factory.deploy(Point_TOKEN, JUMP_TOKEN, JUMP_BANK);
  await contract.waitForDeployment();

  const addr = await contract.getAddress();
  console.log('\n✅ 배포 완료!');
  console.log('  컨트랙트 주소 :', addr);
  console.log('  TxHash        :', contract.deploymentTransaction().hash);
  console.log('\n▶ 다음 단계:');
  console.log('  1. coop.html / functions/handlers/coop.js 에서 컨트랙트 주소 업데이트');
  console.log('  2. Firebase Secret 등록:');
  console.log(`       firebase functions:secrets:set COOP_MALL_ADDRESS`);
  console.log(`       입력값: ${addr}`);
  console.log('  3. 관리자 지갑에서 JUMP 포인트 충전 (joinMall JUMP 지급용)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
