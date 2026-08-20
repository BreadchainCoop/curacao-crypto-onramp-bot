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
//
// The public interface (`release(recipient, amountUsdc) -> txHash`) is unchanged,
// so backend/routes/sentoo.js and bot admin flows keep working across adapters.

// Minimal ABI — just the function we call. Matches contracts/src/Escrow.sol.
const ESCROW_ABI = ['function release(address recipient, uint256 amount)'];

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
function createEscrowService({ contractAddress, signer, ethers }) {
  if (!contractAddress || !signer) {
    throw new Error('Escrow service requires contractAddress and a signer');
  }
  const lib = ethers ?? require('ethers');
  const iface = new lib.Interface(ESCROW_ABI);

  /** Release `amountUsdc` (human units, e.g. 100.5) to `recipient`. Returns tx hash. */
  async function release(recipient, amountUsdc) {
    const amount = lib.parseUnits(String(amountUsdc), USDC_DECIMALS);
    const data = iface.encodeFunctionData('release', [recipient, amount]);
    return signer.send({ to: contractAddress, data });
  }

  return { release };
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
  const { activeChain } = require('../../chains');
  const chain = activeChain(env);

  const mode = (env.ESCROW_SIGNER || (chain.privateKey ? 'raw' : 'privy')).toLowerCase();

  let signer;
  if (mode === 'fake') {
    signer = createFakeSigner();
  } else if (mode === 'raw') {
    signer = createRawSigner({ rpcUrl: chain.rpcUrl, privateKey: chain.privateKey });
  } else if (mode === 'privy') {
    const { privyOperatorSignerFromEnv } = require('./privyOperator');
    signer = privyOperatorSignerFromEnv(env, chain);
  } else {
    throw new Error(`Unknown ESCROW_SIGNER "${mode}". Options: fake, raw, privy`);
  }

  return createEscrowService({ contractAddress: chain.escrowAddress, signer });
}

module.exports = {
  createEscrowService,
  createRawSigner,
  createFakeSigner,
  escrowFromEnv,
  ESCROW_ABI,
};
