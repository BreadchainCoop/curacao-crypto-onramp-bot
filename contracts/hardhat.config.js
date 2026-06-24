// Hardhat config — reads RPC_URL and ADMIN_WALLET_PRIVATE_KEY from .env
// Never hardcode keys here
const path = require('path');
// Load the repo-root .env regardless of where hardhat is invoked from
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('@nomicfoundation/hardhat-toolbox');

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: './src',
    tests: './test',
  },
  networks: {
    'base-sepolia': {
      url: process.env.RPC_URL || '',
      chainId: 84532,
      accounts: process.env.ADMIN_WALLET_PRIVATE_KEY
        ? [process.env.ADMIN_WALLET_PRIVATE_KEY]
        : [],
    },
  },
  etherscan: {
    // Basescan verification key (single multichain key works on Etherscan v2).
    apiKey: process.env.BASESCAN_API_KEY || '',
    customChains: [
      {
        network: 'base-sepolia',
        chainId: 84532,
        urls: {
          apiURL: 'https://api-sepolia.basescan.org/api',
          browserURL: 'https://sepolia.basescan.org',
        },
      },
    ],
  },
};
