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
  // ── Stellar (Soroban) — NOT an EVM chain. The escrow is the KambioEscrow
  // Soroban contract (C...), addresses are StrKey (G.../C...), USDC has 7
  // decimals, and the owner keypair signs releases. Resolved into a distinctly
  // SHAPED object below (no chainId/rpcUrl/escrowAddress), so EVM code paths
  // that read those fields never accidentally treat Stellar as EVM. ──
  'stellar-testnet': {
    name: 'Stellar testnet',
    stellar: true,
    nativeSymbol: 'XLM',
    explorer: 'https://stellar.expert/explorer/testnet',
    sorobanRpc: 'https://soroban-testnet.stellar.org',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    usdcDecimals: 7, // Stellar USDC is 7-decimal (EVM USDC is 6)
    // Deployed KambioEscrow v0.2.0 + the Circle testnet USDC SAC it is bound to.
    // Baked in (like mainnet knownUsdc) so a stray env var can't shadow them;
    // still overridable per-chain for a redeploy (STELLAR_TESTNET_ESCROW_CONTRACT_ID).
    knownContractId: 'CCA2WYNWADCEH5ZZ36D7II5OCVZL3HTMIKDTOC74HEVHHJZONNT2AXR5',
    knownUsdcSac: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
    usdcIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
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
  // Stellar is a different custody/signing model (Soroban, StrKey, 7-dec USDC,
  // owner keypair). Return a distinctly shaped object — no chainId/rpcUrl/
  // escrowAddress — so EVM code can't mistake it for an EVM chain.
  if (base.stellar) {
    return {
      key,
      name: base.name,
      stellar: true,
      mainnet: !!base.mainnet,
      nativeSymbol: base.nativeSymbol,
      explorer: base.explorer,
      sorobanRpc: env[`${envKey(key)}_SOROBAN_RPC`] || base.sorobanRpc,
      horizonUrl: env[`${envKey(key)}_HORIZON_URL`] || base.horizonUrl,
      networkPassphrase: base.networkPassphrase,
      usdcDecimals: base.usdcDecimals,
      // Per-deploy overrides win; otherwise the baked-in known values.
      contractId: env[`${envKey(key)}_ESCROW_CONTRACT_ID`] || base.knownContractId,
      usdcSac: env[`${envKey(key)}_USDC_SAC`] || base.knownUsdcSac,
      usdcIssuer: base.usdcIssuer,
      // The escrow owner's secret (S...). Treated like ADMIN_WALLET_PRIVATE_KEY:
      // testnet-only, provided via env, never committed.
      operatorSecret: env.STELLAR_OPERATOR_SECRET,
    };
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

/** Explorer URL for the escrow on the active chain (or null if unknown).
 *  Stellar explorers use /contract/<C...>; EVM explorers use /address/<0x...>. */
function escrowUrl(chain) {
  if (chain.stellar) {
    return chain.explorer && chain.contractId
      ? `${chain.explorer}/contract/${chain.contractId}`
      : null;
  }
  return chain.explorer && chain.escrowAddress
    ? `${chain.explorer}/address/${chain.escrowAddress}`
    : null;
}

module.exports = { CHAINS, DEFAULT_CHAIN, activeChain, escrowUrl };
