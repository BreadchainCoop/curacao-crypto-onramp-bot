// Network registry for the on-ramp.
//
// Switch the active chain with the CHAIN env var (default: polygon-amoy), then
// restart the bot/backend. All of our testnet escrows share the SAME contract
// and MockUSDC address, so switching chains is effectively switching the RPC —
// the escrow/USDC addresses and admin key are read from env and shared.
//
// Per-chain RPC can be overridden with <KEY>_RPC_URL, e.g. BASE_SEPOLIA_RPC_URL.

const CHAINS = {
  'polygon-amoy': {
    name: 'Polygon Amoy',
    chainId: 80002,
    rpcUrl: 'https://polygon-amoy-bor-rpc.publicnode.com',
    explorer: 'https://amoy.polygonscan.com',
    nativeSymbol: 'POL',
  },
  'base-sepolia': {
    name: 'Base Sepolia',
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    explorer: 'https://sepolia.basescan.org',
    nativeSymbol: 'ETH',
  },
  'celo-sepolia': {
    name: 'Celo Sepolia',
    chainId: 11142220,
    rpcUrl: 'https://forno.celo-sepolia.celo-testnet.org',
    explorer: 'https://sepolia.celoscan.io',
    nativeSymbol: 'CELO',
  },
  'arc-testnet': {
    name: 'Arc testnet',
    chainId: 5042002,
    rpcUrl: 'https://rpc.testnet.arc.network',
    explorer: 'https://testnet.arcscan.app',
    nativeSymbol: 'USDC',
  },
};

const DEFAULT_CHAIN = 'polygon-amoy';

const envKey = (chainKey) => chainKey.toUpperCase().replace(/-/g, '_'); // base-sepolia -> BASE_SEPOLIA

/**
 * Resolve the active chain from CHAIN (default polygon-amoy). Deliberately does
 * NOT fall back to a shared RPC_URL — each chain uses its dedicated
 * <KEY>_RPC_URL override or its public default, so an RPC for one chain can
 * never leak onto another.
 */
function activeChain(env = process.env) {
  const key = (env.CHAIN || DEFAULT_CHAIN).trim();
  const base = CHAINS[key];
  if (!base) {
    throw new Error(`Unknown CHAIN "${key}". Options: ${Object.keys(CHAINS).join(', ')}`);
  }
  return {
    key,
    name: base.name,
    chainId: base.chainId,
    explorer: base.explorer,
    nativeSymbol: base.nativeSymbol,
    rpcUrl: env[`${envKey(key)}_RPC_URL`] || base.rpcUrl,
    // Shared across our deployments (same address on every chain).
    escrowAddress: env.ESCROW_CONTRACT_ADDRESS,
    usdcAddress: env.USDC_ADDRESS,
    privateKey: env.ADMIN_WALLET_PRIVATE_KEY,
  };
}

/** Explorer URL for the escrow on the active chain (or null if unknown). */
function escrowUrl(chain) {
  return chain.explorer && chain.escrowAddress
    ? `${chain.explorer}/address/${chain.escrowAddress}`
    : null;
}

module.exports = { CHAINS, DEFAULT_CHAIN, activeChain, escrowUrl };
