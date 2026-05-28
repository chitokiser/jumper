require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY || '';

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: './contracts',   // contracts/ + ../contract/ 모두 포함
  },
  networks: {
    opbnb: {
      url: 'https://opbnb-mainnet-rpc.bnbchain.org',
      chainId: 204,
      accounts: ADMIN_PRIVATE_KEY ? [ADMIN_PRIVATE_KEY] : [],
      gasPrice: 1000000000, // 1 gwei
    },
  },
};
