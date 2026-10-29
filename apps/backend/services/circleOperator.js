// Circle Programmable Wallets operator signer (ESCROW_SIGNER=circle).
//
// Implements the escrow signer interface { send({to, data}) -> txHash } using a
// Circle developer-controlled wallet. The blockchain key stays in Circle's
// MPC/HSM and is never present on this host; the entity secret (the per-request
// credential) authorizes signing. Works on any Circle-supported EVM chain —
// notably BASE and ARC (Circle-native).
//
// Env (backend only):
//   CIRCLE_API_KEY         Circle production API key
//   CIRCLE_ENTITY_SECRET   32-byte entity secret (ciphertext registered once)
//   CIRCLE_WALLET_ID       the operator wallet to sign from
//   CIRCLE_FEE_LEVEL       LOW | MEDIUM | HIGH (default MEDIUM)
'use strict';

// chainId -> Circle blockchain enum. Arc pays gas in USDC but is a normal EVM
// chain to Circle; the escrow moves the 6-decimal ERC-20 USDC either way.
const CIRCLE_CHAIN = {
  5042: 'ARC',
  8453: 'BASE',
  5042002: 'ARC-TESTNET',
  84532: 'BASE-SEPOLIA',
};

function circleBlockchain(chainId) {
  const b = CIRCLE_CHAIN[Number(chainId)];
  if (!b) {
    throw new Error(`Circle signer: no blockchain mapping for chainId ${chainId}`);
  }
  return b;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TERMINAL_FAIL = new Set(['FAILED', 'DENIED', 'CANCELLED']);

/**
 * Build a Circle operator signer.
 *
 * @param {object} opts
 * @param {object} opts.client            Circle dev-controlled wallets client (injectable for tests)
 * @param {string} opts.walletId          operator wallet id
 * @param {string} opts.blockchain        Circle enum, e.g. "ARC"
 * @param {string} [opts.feeLevel]        LOW|MEDIUM|HIGH (default MEDIUM)
 * @param {number} [opts.pollIntervalMs]  state poll interval (default 2000)
 * @param {number} [opts.maxWaitMs]       give up after this long (default 120000)
 * @returns {{ send: (tx: {to:string,data:string}) => Promise<string> }}
 */
function createCircleOperatorSigner({
  client,
  walletId,
  blockchain,
  feeLevel = 'MEDIUM',
  pollIntervalMs = 2000,
  maxWaitMs = 120000,
}) {
  if (!client) throw new Error('Circle operator signer requires a client');
  if (!walletId) throw new Error('Circle operator signer requires CIRCLE_WALLET_ID');
  if (!blockchain) throw new Error('Circle operator signer requires a blockchain');

  async function send({ to, data }) {
    // Submit the escrow call (release/refund) as a raw-calldata contract execution.
    const res = await client.createContractExecutionTransaction({
      walletId,
      blockchain,
      contractAddress: to,
      callData: data,
      fee: { type: 'level', config: { feeLevel } },
    });
    const id = res && res.data && res.data.id;
    if (!id) throw new Error('Circle createContractExecutionTransaction returned no id');

    // Circle transactions are an async state machine; the tx hash is available at
    // the SENT state or later. Poll until we have a hash or it terminally fails.
    const deadline = Date.now() + maxWaitMs;
    for (;;) {
      const tr = await client.getTransaction({ id });
      const t = (tr && tr.data && tr.data.transaction) || {};
      if (t.txHash) return t.txHash;
      if (TERMINAL_FAIL.has(t.state)) {
        throw new Error(
          `Circle tx ${id} ${t.state}${t.errorReason ? ': ' + t.errorReason : ''}`,
        );
      }
      if (Date.now() > deadline) {
        throw new Error(`Circle tx ${id} produced no hash within ${maxWaitMs}ms (state ${t.state || 'unknown'})`);
      }
      await sleep(pollIntervalMs);
    }
  }

  return { send };
}

/** Build the Circle signer from env + the active chain (for the blockchain enum). */
function circleOperatorSignerFromEnv(env, chain) {
  const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');
  const client = initiateDeveloperControlledWalletsClient({
    apiKey: env.CIRCLE_API_KEY,
    entitySecret: env.CIRCLE_ENTITY_SECRET,
  });
  return createCircleOperatorSigner({
    client,
    walletId: env.CIRCLE_WALLET_ID,
    blockchain: circleBlockchain(chain.chainId),
    feeLevel: env.CIRCLE_FEE_LEVEL || 'MEDIUM',
  });
}

module.exports = { createCircleOperatorSigner, circleOperatorSignerFromEnv, circleBlockchain };
