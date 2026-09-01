// deploy-ethers.js — ethers.js 직접 배포 (Hardhat 없이)
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const PRIVATE_KEY = process.env.ADMIN_PK;
const RPC_URL     = 'https://opbnb-mainnet-rpc.bnbchain.org';
const HEX_TOKEN   = '0x41F2Ea9F4eF7c4E35ba1a8438fC80937eD4E5464';
const JUMP_TOKEN  = '0xA3C35c52446C133b7211A743c6D47470D1385601';

async function main() {
  if (!PRIVATE_KEY) { console.error('ADMIN_PK env var required'); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log('Deployer:', wallet.address);
  const balance = await provider.getBalance(wallet.address);
  console.log('BNB Balance:', ethers.formatEther(balance), 'BNB\n');

  const artifactPath = path.join(__dirname, '../artifacts/contracts/K-Culture AllianceStockOption.sol/K-Culture AllianceStockOption.json');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  const factory  = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  console.log('Deploying K-Culture AllianceStockOption...');
  const contract = await factory.deploy(HEX_TOKEN, JUMP_TOKEN);
  console.log('Tx hash:', contract.deploymentTransaction()?.hash);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log('\n✅ Deployed:', address);
  console.log('🔗 https://opbnb.bscscan.com/address/' + address);
  console.log('\nCONTRACT_ADDRESS=' + address);
}

main().catch(e => { console.error(e.message); process.exit(1); });
