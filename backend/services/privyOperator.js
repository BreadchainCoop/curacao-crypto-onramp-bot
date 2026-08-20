// Privy operator server wallet — the escrow `release` signer where THIS HOST
// NEVER HOLDS THE KEY.
//
// The escrow signing key is generated and sharded inside Privy's MPC/TEE
// infrastructure; it is never reconstructed whole, here or anywhere. What this
// process holds is only *request* credentials:
//
//   PRIVY_OPERATOR_APP_ID / _APP_SECRET   -> authenticate to the operator app
//   PRIVY_OPERATOR_AUTHORIZATION_KEY      -> P-256 key that authorizes a wallet op
//   PRIVY_OPERATOR_WALLET_ID              -> which server wallet to use
//
// Stealing these lets an attacker *ask* Privy to sign — bounded by Privy wallet
// policies (allowlist escrow + release) and on-chain caps (Escrow v2) — but it
// does NOT hand them the key to drain funds elsewhere or persist past a rotation.
//
// This is a SEPARATE Privy app from the bot's users app (buyer wallets). Operator
// credentials must never live on the bot host. See docs/plans/privy-operator-custody.md.
//
// Secrets are only ever passed into the Privy client; never log them.

/**
 * @param {object} opts
 * @param {string} opts.appId               PRIVY_OPERATOR_APP_ID
 * @param {string} opts.appSecret           PRIVY_OPERATOR_APP_SECRET
 * @param {string} opts.authorizationKey    PRIVY_OPERATOR_AUTHORIZATION_KEY (P-256 private key)
 * @param {string} opts.walletId            PRIVY_OPERATOR_WALLET_ID
 * @param {number} opts.chainId             numeric chain id (e.g. 84532 for Base Sepolia)
 * @param {string} [opts.rpcUrl]            if set, the signer waits for the receipt here
 * @param {object} [opts.privyClient]       injectable Privy client (tests bypass the SDK)
 * @param {object} [opts.ethers]            injectable; defaults to require('ethers')
 */
function createPrivyOperatorSigner({
  appId,
  appSecret,
  authorizationKey,
  walletId,
  chainId,
  rpcUrl,
  privyClient,
  ethers,
}) {
  if (!walletId) throw new Error('Privy operator signer requires walletId');
  if (!chainId) throw new Error('Privy operator signer requires chainId');

  const client = privyClient || buildPrivyClient({ appId, appSecret });
  const caip2 = `eip155:${chainId}`;

  // The P-256 authorization key is presented per-request (verified against
  // @privy-io/node 0.29: AuthorizationConfig.authorization_private_keys). Without
  // it, Privy rejects the wallet operation.
  if (!privyClient && !authorizationKey) {
    throw new Error('Privy operator signer requires an authorization key');
  }
  const authContext = authorizationKey
    ? { authorization_private_keys: [authorizationKey] }
    : undefined;

  // Optional receipt wait so the caller's "COMPLETE" still means "mined",
  // matching the raw signer's tx.wait() semantics.
  const lib = ethers ?? require('ethers');
  const provider = rpcUrl ? new lib.JsonRpcProvider(rpcUrl) : null;

  async function send({ to, data }) {
    // Privy holds the sharded key and signs inside its enclave; we only send intent.
    const result = await client
      .wallets()
      .ethereum()
      .sendTransaction(walletId, {
        caip2,
        params: { transaction: { to, data } },
        ...(authContext ? { authorization_context: authContext } : {}),
      });

    const hash = result && result.hash;
    if (!hash) throw new Error('Privy operator sendTransaction returned no hash');

    if (provider) await provider.waitForTransaction(hash);
    return hash;
  }

  return { send };
}

/** Construct the @privy-io/node client with the operator app credentials. */
function buildPrivyClient({ appId, appSecret }) {
  if (!appId || !appSecret) {
    throw new Error('Privy operator signer requires appId and appSecret');
  }
  const { PrivyClient } = require('@privy-io/node');
  return new PrivyClient({ appId, appSecret });
}

/** Build the operator signer from env + the active chain (for chainId/rpc). */
function privyOperatorSignerFromEnv(env = process.env, chain) {
  const { activeChain } = require('../../chains');
  const c = chain || activeChain(env);
  return createPrivyOperatorSigner({
    appId: env.PRIVY_OPERATOR_APP_ID,
    appSecret: env.PRIVY_OPERATOR_APP_SECRET,
    authorizationKey: env.PRIVY_OPERATOR_AUTHORIZATION_KEY,
    walletId: env.PRIVY_OPERATOR_WALLET_ID,
    chainId: c.chainId,
    rpcUrl: c.rpcUrl,
  });
}

module.exports = { createPrivyOperatorSigner, privyOperatorSignerFromEnv, buildPrivyClient };
