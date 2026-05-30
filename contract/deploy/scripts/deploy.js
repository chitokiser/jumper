const hre = require("hardhat");
const { ethers } = hre;

// opBNB Mainnet 토큰 주소
const HEX_TOKEN  = "0x41F2Ea9F4eF7c4E35ba1a8438fC80937eD4E5464"; // HEX (18 dec)
const JUMP_TOKEN = "0xA3C35c52446C133b7211A743c6D47470D1385601"; // JUMP (0 dec)

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("BNB Balance:", ethers.formatEther(balance), "BNB");

  console.log("\nDeploying JumpDaoStockOption...");
  const Factory  = await ethers.getContractFactory("JumpDaoStockOption");
  const contract = await Factory.deploy(HEX_TOKEN, JUMP_TOKEN);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("\n✅ JumpDaoStockOption deployed to:", address);
  console.log("🔗 Explorer: https://opbnb.bscscan.com/address/" + address);
  console.log("\n📋 Constructor args:");
  console.log("  hexToken :", HEX_TOKEN);
  console.log("  jumpToken:", JUMP_TOKEN);
  console.log("  jumpBank :", "0x16752f8948ff2caA02e756c7C8fF0E04887A3a0E");
}

main().catch(e => { console.error(e); process.exit(1); });
