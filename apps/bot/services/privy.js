// Privy server client — creates embedded wallets for users without one.
//
//   POST {baseUrl}/v1/wallets
//   Auth: Basic (app id : app secret) + header "privy-app-id"
//   Body: { chain_type: "ethereum", external_id: <telegram id> }
//   -> { id, address, chain_type, ... }
//
// The app secret is only ever used to build the Authorization header; it is
// never logged or returned. Callers should log the wallet address/id at most.

function createPrivyClient({
  appId,
  appSecret,
  baseUrl = 'https://api.privy.io',
  authBaseUrl = 'https://auth.privy.io/api',
  fetchImpl = fetch,
}) {
  if (!appId || !appSecret) {
    throw new Error('Privy client requires appId and appSecret');
  }
  const host = baseUrl.replace(/\/+$/, '');
  const authHost = authBaseUrl.replace(/\/+$/, '');
  const authHeader = 'Basic ' + Buffer.from(`${appId}:${appSecret}`).toString('base64');
  const jsonHeaders = {
    Authorization: authHeader,
    'privy-app-id': appId,
    'Content-Type': 'application/json',
  };

  /**
   * Create an embedded wallet linked to the user via `externalId`.
   * @param {{chainType?: string, externalId?: string, displayName?: string}} [params]
   * @returns {Promise<{id: string, address: string, chainType: string}>}
   */
  async function createWallet(params = {}) {
    const body = { chain_type: params.chainType || 'ethereum' };
    if (params.externalId) body.external_id = String(params.externalId); // URL-safe, ≤64 chars
    if (params.displayName) body.display_name = params.displayName;

    const resp = await fetchImpl(`${host}/v1/wallets`, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'privy-app-id': appId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      throw new Error(`Privy wallet creation failed: HTTP ${resp.status}`);
    }
    const data = await resp.json();
    if (!data || !data.address) {
      throw new Error('Privy wallet creation returned no address');
    }
    return { id: data.id, address: data.address, chainType: data.chain_type };
  }

  /**
   * Pregenerate a user + embedded EVM wallet linked to an email. Because the
   * wallet is owned by the email identity, the user can later log in to Privy
   * with that email and control it — it is theirs, not app-custodied.
   * Endpoint: POST {authBaseUrl}/v1/users.
   * @param {{email: string}} params
   * @returns {Promise<{userId: string, address: string}>}
   */
  async function createUserWithWallet({ email }) {
    const resp = await fetchImpl(`${authHost}/v1/users`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        linked_accounts: [{ type: 'email', address: email }],
        wallets: [{ chain_type: 'ethereum', wallet_index: 0 }],
      }),
    });
    if (!resp.ok) {
      throw new Error(`Privy user creation failed: HTTP ${resp.status}`);
    }
    const data = await resp.json();
    const wallets = (data.linked_accounts || []).filter((a) => a.type === 'wallet' && a.address);
    const wallet = wallets.find((a) => a.chain_type === 'ethereum') || wallets[0];
    if (!wallet) {
      throw new Error('Privy user creation returned no wallet');
    }
    return { userId: data.id, address: wallet.address };
  }

  return { createWallet, createUserWithWallet };
}

function privyFromEnv(env = process.env) {
  return createPrivyClient({
    appId: env.PRIVY_APP_ID,
    appSecret: env.PRIVY_APP_SECRET,
  });
}

module.exports = { createPrivyClient, privyFromEnv };
