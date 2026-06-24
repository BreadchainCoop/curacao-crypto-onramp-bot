// Hardhat config — reads RPC_URL and ADMIN_WALLET_PRIVATE_KEY from .env
// Never hardcode keys here
const path = require('path');
// Load the repo-root .env regardless of where hardhat is invoked from
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: '0.8.24',
  networks: {
    'base-sepolia': {
      url: process.env.RPC_URL || '',
      accounts: process.env.ADMIN_WALLET_PRIVATE_KEY
        ? [process.env.ADMIN_WALLET_PRIVATE_KEY]
        : [],
    },
  },
};
