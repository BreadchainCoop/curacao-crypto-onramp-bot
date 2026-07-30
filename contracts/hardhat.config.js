// Hardhat config — multi-chain deploy for Escrow.sol.
//
// Keys/RPCs come from the repo-root .env; never hardcode a private key here.
// Each network has its OWN RPC env var (with a working public default) so they
// never collide. The single ADMIN_WALLET_PRIVATE_KEY deploys on every chain —
// on testnets it just needs gas from that chain's faucet.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('@nomicfoundation/hardhat-toolbox');

const accounts = process.env.ADMIN_WALLET_PRIVATE_KEY
  ? [process.env.ADMIN_WALLET_PRIVATE_KEY]
  : [];

module.exports = {
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  paths: { sources: './src', tests: './test' },
  networks: {
    // ── Testnets (free — fund the deployer from each faucet) ──────────
    'base-sepolia': {
      url: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
      chainId: 84532,
      accounts,
    },
    'polygon-amoy': {
      url: process.env.POLYGON_AMOY_RPC_URL || 'https://polygon-amoy-bor-rpc.publicnode.com',
      chainId: 80002,
      accounts,
    },
    // Celo's current testnet (Alfajores is being sunset). Native token: CELO.
    'celo-sepolia': {
      url: process.env.CELO_SEPOLIA_RPC_URL || 'https://forno.celo-sepolia.celo-testnet.org',
      chainId: 11142220,
      accounts,
    },
    // Circle Arc testnet — USDC is the native gas token. Faucet: faucet.circle.com.
    'arc-testnet': {
      url: process.env.ARC_TESTNET_RPC_URL || 'https://rpc.testnet.arc.network',
      chainId: 5042002,
      accounts,
    },
    // ── Mainnets (real gas — deploy when grant-funded, after audit + multisig) ──
    base: {
      url: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      chainId: 8453,
      accounts,
    },
    polygon: {
      url: process.env.POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com',
      chainId: 137,
      accounts,
    },
    celo: {
      url: process.env.CELO_RPC_URL || 'https://forno.celo.org',
      chainId: 42220,
      accounts,
    },
    // Arc mainnet: add once Circle launches it (~summer 2026) — set ARC_RPC_URL
    // and ARC_CHAIN_ID, then copy this block with those values.
  },
  etherscan: {
    // Free API keys: basescan.org, polygonscan.com, celoscan.io. Optional —
    // Sourcify (below) verifies without keys as a fallback.
    apiKey: {
      'base-sepolia': process.env.BASESCAN_API_KEY || '',
      base: process.env.BASESCAN_API_KEY || '',
      'polygon-amoy': process.env.POLYGONSCAN_API_KEY || '',
      polygon: process.env.POLYGONSCAN_API_KEY || '',
      'celo-sepolia': process.env.CELOSCAN_API_KEY || '',
      celo: process.env.CELOSCAN_API_KEY || '',
    },
    customChains: [
      { network: 'base-sepolia', chainId: 84532, urls: { apiURL: 'https://api-sepolia.basescan.org/api', browserURL: 'https://sepolia.basescan.org' } },
      { network: 'base', chainId: 8453, urls: { apiURL: 'https://api.basescan.org/api', browserURL: 'https://basescan.org' } },
      { network: 'polygon-amoy', chainId: 80002, urls: { apiURL: 'https://api-amoy.polygonscan.com/api', browserURL: 'https://amoy.polygonscan.com' } },
      { network: 'polygon', chainId: 137, urls: { apiURL: 'https://api.polygonscan.com/api', browserURL: 'https://polygonscan.com' } },
      { network: 'celo-sepolia', chainId: 11142220, urls: { apiURL: 'https://api-sepolia.celoscan.io/api', browserURL: 'https://sepolia.celoscan.io' } },
      { network: 'celo', chainId: 42220, urls: { apiURL: 'https://api.celoscan.io/api', browserURL: 'https://celoscan.io' } },
    ],
  },
  // Keyless verification fallback (works for Arc and any chain Sourcify supports).
  sourcify: { enabled: true },
};
