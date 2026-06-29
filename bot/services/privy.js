// Privy server client — creates embedded wallets for users without one.
//
//   POST {baseUrl}/v1/wallets
//   Auth: Basic (app id : app secret) + header "privy-app-id"
//   Body: { chain_type: "ethereum", external_id: <telegram id> }
//   -> { id, address, chain_type, ... }
//
// The app secret is only ever used to build the Authorization header; it is
// never logged or returned. Callers should log the wallet address/id at most.

function createPrivyClient({ appId, appSecret, baseUrl = 'https://api.privy.io', fetchImpl = fetch }) {
  if (!appId || !appSecret) {
    throw new Error('Privy client requires appId and appSecret');
  }
  const host = baseUrl.replace(/\/+$/, '');
  const authHeader = 'Basic ' + Buffer.from(`${appId}:${appSecret}`).toString('base64');

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

  return { createWallet };
}

function privyFromEnv(env = process.env) {
  return createPrivyClient({
    appId: env.PRIVY_APP_ID,
    appSecret: env.PRIVY_APP_SECRET,
  });
}

module.exports = { createPrivyClient, privyFromEnv };
