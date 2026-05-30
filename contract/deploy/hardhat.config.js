require("@nomicfoundation/hardhat-ethers");

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    opbnb: {
      url:      "https://opbnb-mainnet-rpc.bnbchain.org",
      chainId:  204,
      accounts: [process.env.ADMIN_PK],
    },
  },
};
