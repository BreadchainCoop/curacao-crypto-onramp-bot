// Sentoo REST API client.
//
// Based on the public reference integration (boncos-io/sentoo_directus_extension):
// auth is the `X-SENTOO-SECRET` header; status is read from
//   GET {baseUrl}/v1/payment/status/{merchantId}/{transactionId}
// returning `{ success: { message: <status>, data: ... } }`.
//
// TODO(#6): confirm against the authenticated Sentoo docs — exact paid-status
// string, the sandbox host, and amount units for payment creation.

const PAID_STATUSES = new Set(['paid', 'success', 'completed', 'complete']);

/** True if a Sentoo status string means the payment succeeded. */
function isPaidStatus(status) {
  return status != null && PAID_STATUSES.has(String(status).toLowerCase());
}

/**
 * @param {object} opts
 * @param {string} opts.baseUrl   API host, no trailing /v1 (client appends it).
 * @param {string} opts.merchantId
 * @param {string} opts.secret    sent as X-SENTOO-SECRET.
 * @param {typeof fetch} [opts.fetchImpl] injectable for tests.
 */
function createSentooClient({ baseUrl, merchantId, secret, fetchImpl = fetch }) {
  if (!baseUrl || !merchantId || !secret) {
    throw new Error('Sentoo client requires baseUrl, merchantId, and secret');
  }
  const host = baseUrl.replace(/\/+$/, '');

  /** Authoritative status re-fetch — the trust anchor for the webhook. */
  async function getTransactionStatus(transactionId) {
    const url = `${host}/v1/payment/status/${merchantId}/${encodeURIComponent(transactionId)}`;
    const resp = await fetchImpl(url, {
      method: 'GET',
      headers: { 'X-SENTOO-SECRET': secret },
    });
    if (!resp.ok) {
      throw new Error(`Sentoo status fetch failed: HTTP ${resp.status}`);
    }
    const body = await resp.json();
    return body && body.success ? body.success.message : null;
  }

  return { getTransactionStatus };
}

function sentooFromEnv(env = process.env) {
  return createSentooClient({
    baseUrl: env.SENTOO_BASE_URL,
    merchantId: env.SENTOO_MERCHANT_ID,
    secret: env.SENTOO_API_KEY,
  });
}

module.exports = { createSentooClient, sentooFromEnv, isPaidStatus, PAID_STATUSES };
