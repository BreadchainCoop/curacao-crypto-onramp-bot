// Escrow release, split into two layers so the SIGNING key can move off the host.
//
//   escrow service  -> builds the release() calldata (no key involved)
//   signer adapter  -> actually broadcasts the tx and returns a tx hash
//
// Adapters (chosen by ESCROW_SIGNER):
//   fake  -> records calls, returns a deterministic hash (CI / local, no chain)
//   raw   -> ethers Wallet holding ADMIN_WALLET_PRIVATE_KEY (legacy fallback)
//   privy -> Privy operator server wallet; key material is sharded in Privy's
//            MPC/TEE and never present on this host (see services/privyOperator.js)
//   circle-> Circle developer-controlled wallet; key in Circle's MPC/HSM, never
//            on this host. Supports Arc + Base (see services/circleOperator.js)
//
// The public interface (`release(recipient, amountUsdc) -> txHash`) is unchanged,
// so apps/backend/routes/sentoo.js and bot admin flows keep working across adapters.

// Minimal ABI — just the functions we call. Matches contracts/evm/src/Escrow.sol.
const ESCROW_ABI = [
  'function release(address recipient, uint256 amount)',
  'function refund(uint256 amount)',
  'function balance() view returns (uint256)',
];

// USDC has 6 decimals.
const USDC_DECIMALS = 6;

/**
 * Escrow service: turns a human-units release into calldata, then hands the
 * transaction to an injected signer. It never holds a private key itself.
 *
 * @param {object} opts
 * @param {string} opts.contractAddress   escrow address on the active chain
 * @param {object} opts.signer            { send({to, data}) -> Promise<txHash> }
 * @param {object} [opts.ethers]          injectable; defaults to require('ethers')
 */
function createEscrowService({ contractAddress, signer, rpcUrl, ethers }) {
  if (!contractAddress || !signer) {
    throw new Error('Escrow service requires contractAddress and a signer');
  }
  const lib = ethers ?? require('ethers');
  const iface = new lib.Interface(ESCROW_ABI);
  // Read-only provider for view calls (balance) — no key involved.
  const readContract = rpcUrl
    ? new lib.Contract(contractAddress, ESCROW_ABI, new lib.JsonRpcProvider(rpcUrl))
    : null;

  /** Release `amountUsdc` (human units, e.g. 100.5) to `recipient`. Returns tx hash. */
  async function release(recipient, amountUsdc) {
    const amount = lib.parseUnits(String(amountUsdc), USDC_DECIMALS);
    const data = iface.encodeFunctionData('release', [recipient, amount]);
    return signer.send({ to: contractAddress, data });
  }

  /** Owner-only treasury withdrawal of `amountUsdc` (pooled funds → owner). Returns tx hash. */
  async function refund(amountUsdc) {
    const amount = lib.parseUnits(String(amountUsdc), USDC_DECIMALS);
    const data = iface.encodeFunctionData('refund', [amount]);
    return signer.send({ to: contractAddress, data });
  }

  /** Escrow USDC balance in human units (view call; requires rpcUrl). */
  async function balance() {
    if (!readContract) throw new Error('Escrow balance requires rpcUrl');
    const raw = await readContract.balance();
    return lib.formatUnits(raw, USDC_DECIMALS);
  }

  return { release, refund, balance };
}

/**
 * Legacy signer: an ethers Wallet holding the raw admin key. Kept behind
 * ESCROW_SIGNER=raw so we can fall back during the Privy cutover; remove once
 * the Privy path is verified (do not run dual-path in prod — SECURITY.md #4).
 */
function createRawSigner({ rpcUrl, privateKey, ethers }) {
  if (!rpcUrl || !privateKey) {
    throw new Error('Raw signer requires rpcUrl and privateKey');
  }
  const lib = ethers ?? require('ethers');
  const provider = new lib.JsonRpcProvider(rpcUrl);
  const wallet = new lib.Wallet(privateKey, provider);

  async function send({ to, data }) {
    const tx = await wallet.sendTransaction({ to, data });
    const receipt = await tx.wait();
    return (receipt && receipt.hash) || tx.hash;
  }

  return { send };
}

/**
 * Test / offline signer: never touches a chain. Records every send and returns a
 * deterministic pseudo-hash so callers that log/store the hash still work.
 */
function createFakeSigner() {
  const calls = [];
  async function send({ to, data }) {
    calls.push({ to, data });
    const n = String(calls.length).padStart(2, '0');
    return `0xfake${n}${'0'.repeat(58)}`;
  }
  return { send, calls };
}

/**
 * Build the escrow service from env. ESCROW_SIGNER selects the adapter; when
 * unset it defaults to `raw` if an admin key is present, else `privy`.
 */
function escrowFromEnv(env = process.env) {
  const { activeChain } = require('@kambiox/chains');
  const chain = activeChain(env);

  // Stellar is not an EVM chain: it has its own release service (Soroban invoke
  // signed by the owner keypair), with the same release/refund/balance interface.
  // ESCROW_SIGNER does not apply — custody is the owner secret.
  if (chain.stellar) {
    const { stellarEscrowFromChain } = require('./stellarEscrow');
    return stellarEscrowFromChain(chain);
  }

  const mode = (env.ESCROW_SIGNER || (chain.privateKey ? 'raw' : 'privy')).toLowerCase();

  let signer;
  if (mode === 'fake') {
    signer = createFakeSigner();
  } else if (mode === 'raw') {
    signer = createRawSigner({ rpcUrl: chain.rpcUrl, privateKey: chain.privateKey });
  } else if (mode === 'privy') {
    const { privyOperatorSignerFromEnv } = require('./privyOperator');
    signer = privyOperatorSignerFromEnv(env, chain);
  } else if (mode === 'circle') {
    const { circleOperatorSignerFromEnv } = require('./circleOperator');
    signer = circleOperatorSignerFromEnv(env, chain);
  } else {
    throw new Error(`Unknown ESCROW_SIGNER "${mode}". Options: fake, raw, privy, circle`);
  }

  return createEscrowService({ contractAddress: chain.escrowAddress, signer, rpcUrl: chain.rpcUrl });
}

/** Loose check: does this payout recipient look like a Stellar account (G…)?
 *  Used only to ROUTE a release to the right chain — the address was fully
 *  validated when the order was created. */
function looksLikeStellarAddress(recipient) {
  return typeof recipient === 'string' && /^G[A-Z2-7]{55}$/.test(recipient.trim());
}

/**
 * Multi-chain release router for the SHARED backend. One Sentoo webhook serves
 * orders from both the EVM bot and the Stellar bot, so the release target is
 * chosen PER ORDER by the payout address:
 *   G… (Stellar account)  -> the Soroban escrow (stellarEscrow)
 *   0x… (EVM address)     -> the configured EVM escrow (escrowFromEnv / CHAIN)
 * so Base orders keep releasing on Base and Stellar orders release on Stellar.
 *
 * The EVM escrow is built from CHAIN (base-sepolia on the shared backend). The
 * Stellar escrow is built only when STELLAR_OPERATOR_SECRET is set; a Stellar
 * payout with no Stellar signer configured fails loudly rather than mis-routing
 * to the EVM escrow. Exposes the same { release, refund, balance } interface.
 */
/** Route releases between an EVM escrow and a Stellar escrow by payout address.
 *  Takes the two services so it is trivially unit-testable with fakes. */
function createRoutingEscrowService({ evm, stellar }) {
  return {
    async release(recipient, amountUsdc) {
      if (looksLikeStellarAddress(recipient)) {
        if (!stellar) {
          throw new Error(
            'Stellar payout requested but STELLAR_OPERATOR_SECRET is not configured on this backend'
          );
        }
        return stellar.release(recipient, amountUsdc);
      }
      return evm.release(recipient, amountUsdc);
    },
    // Admin treasury ops have no recipient to route on — default to the EVM escrow.
    async refund(amountUsdc) {
      return evm.refund(amountUsdc);
    },
    async balance() {
      return evm.balance();
    },
  };
}

function routingEscrowFromEnv(env = process.env) {
  const evm = escrowFromEnv(env);

  let stellar = null;
  if (env.STELLAR_OPERATOR_SECRET) {
    try {
      const { activeChain } = require('@kambiox/chains');
      const stellarChain = activeChain({ ...env, CHAIN: env.STELLAR_CHAIN || 'stellar-testnet' });
      const { stellarEscrowFromChain } = require('./stellarEscrow');
      stellar = stellarEscrowFromChain(stellarChain);
    } catch (err) {
      // A malformed secret / bad Stellar config must NEVER take down the whole
      // backend (which would also stop EVM/Base releases). Leave Stellar
      // unconfigured — a Stellar payout then fails cleanly, per order, while the
      // EVM path keeps working.
      console.error(`[escrow] Stellar escrow NOT configured (releases to G… will fail): ${err.message}`);
      stellar = null;
    }
  }

  return createRoutingEscrowService({ evm, stellar });
}

module.exports = {
  createEscrowService,
  createRawSigner,
  createFakeSigner,
  escrowFromEnv,
  createRoutingEscrowService,
  routingEscrowFromEnv,
  looksLikeStellarAddress,
  ESCROW_ABI,
};
