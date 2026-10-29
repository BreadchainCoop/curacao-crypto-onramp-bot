// Synaps KYC client.
//
// Based on the official Go SDK (synaps-io/synaps-go):
//   POST {baseUrl}/session/init  header "Api-Key", body { alias?, metadata? }
//     -> { session_id, sandbox }
// The webhook is authenticated by a `?secret=` query param (SYNAPS_WEBHOOK_SECRET)
// and carries NO PII — just { session_id, status, ... }. We act on `status`
// alone and never call the step-detail endpoints (which return document data),
// so no KYC document data is ever fetched, stored, or logged here.

// Maps a Synaps webhook status to our users.kyc_status, or null if the status is
// non-terminal (still pending / needs (re)submission / reset).
function mapWebhookStatus(status) {
  switch (String(status).toUpperCase()) {
    case 'APPROVED':
      return 'approved';
    case 'REJECTED':
      return 'rejected';
    default:
      return null;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.baseUrl   Synaps individual API base (no trailing slash needed).
 * @param {string} opts.apiKey    sent as the Api-Key header.
 * @param {string} [opts.verifyUrl] hosted verification page base.
 * @param {typeof fetch} [opts.fetchImpl]
 */
function createSynapsClient({ baseUrl, apiKey, verifyUrl = 'https://verify.synaps.io/', fetchImpl = fetch }) {
  if (!baseUrl || !apiKey) {
    throw new Error('Synaps client requires baseUrl and apiKey');
  }
  const host = baseUrl.replace(/\/+$/, '');

  /**
   * Create a verification session and return the link to send the user.
   * @param {{alias?: string, metadata?: object}} [params]
   * @returns {Promise<{sessionId: string, sandbox: boolean, verificationUrl: string}>}
   */
  async function createSession(params = {}) {
    const resp = await fetchImpl(`${host}/session/init`, {
      method: 'POST',
      headers: { 'Api-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias: params.alias, metadata: params.metadata }),
    });
    if (!resp.ok) {
      throw new Error(`Synaps session init failed: HTTP ${resp.status}`);
    }
    const body = await resp.json();
    if (!body || !body.session_id) {
      throw new Error('Synaps session init returned no session_id');
    }
    return {
      sessionId: body.session_id,
      sandbox: Boolean(body.sandbox),
      verificationUrl: `${verifyUrl.replace(/\/+$/, '')}/?session_id=${encodeURIComponent(body.session_id)}`,
    };
  }

  return { createSession };
}

function synapsFromEnv(env = process.env) {
  return createSynapsClient({
    baseUrl: env.SYNAPS_BASE_URL,
    apiKey: env.SYNAPS_API_KEY,
    verifyUrl: env.SYNAPS_VERIFY_URL || 'https://verify.synaps.io/',
  });
}

module.exports = { createSynapsClient, synapsFromEnv, mapWebhookStatus };
