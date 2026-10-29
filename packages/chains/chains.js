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
  // ── Mainnets (REAL funds) — escrow/USDC addresses come from env per deploy,
  // NOT the shared testnet address. Use a fresh, isolated owner key. ──
  'arc-mainnet': {
    name: 'Arc',
    chainId: 5042,
    rpcUrl: 'https://rpc.mainnet.arc.io',
    explorer: 'https://explorer.arc.io',
    nativeSymbol: 'USDC', // Arc pays gas in USDC (no separate gas coin).
    mainnet: true,
    // Canonical Circle USDC on Arc (6-dec ERC-20 predeploy; same asset as the
    // native gas coin). Baked in so a stale global USDC_ADDRESS can't shadow it.
    knownUsdc: '0x3600000000000000000000000000000000000000',
  },
  'base-mainnet': {
    name: 'Base',
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    explorer: 'https://basescan.org',
    nativeSymbol: 'ETH',
    mainnet: true,
    knownUsdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // canonical Base USDC
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
  const perChainEscrow = env[`${envKey(key)}_ESCROW_ADDRESS`];
  const perChainUsdc = env[`${envKey(key)}_USDC_ADDRESS`];

  // Address resolution differs by network class:
  //   Testnets: per-chain override OR the shared global (all testnet escrows
  //             share one address, so the global fallback is convenient).
  //   Mainnets: per-chain override ONLY for the escrow (real funds — never
  //             inherit a testnet global), and per-chain override OR the baked
  //             canonical USDC for the token. This closes the .env-shadow bug
  //             where a stale global USDC_ADDRESS (testnet MockUSDC) silently
  //             pointed a mainnet chain at the wrong token.
  const escrowAddress = base.mainnet
    ? perChainEscrow
    : perChainEscrow || env.ESCROW_CONTRACT_ADDRESS;
  const usdcAddress = base.mainnet
    ? perChainUsdc || base.knownUsdc
    : perChainUsdc || env.USDC_ADDRESS;

  return {
    key,
    name: base.name,
    chainId: base.chainId,
    explorer: base.explorer,
    nativeSymbol: base.nativeSymbol,
    mainnet: !!base.mainnet,
    rpcUrl: env[`${envKey(key)}_RPC_URL`] || base.rpcUrl,
    escrowAddress,
    usdcAddress,
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
