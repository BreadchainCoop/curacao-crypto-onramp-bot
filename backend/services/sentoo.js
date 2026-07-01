// Sentoo REST API client.
//
// Based on the public reference integration (boncos-io/sentoo_directus_extension):
// auth is the `X-SENTOO-SECRET` header; status is read from
//   GET {baseUrl}/v1/payment/status/{merchantId}/{transactionId}
// returning `{ success: { message: <status>, data: ... } }`.
//
// TODO(#6): confirm against the authenticated Sentoo docs — exact paid-status
// string, the sandbox host, and amount units for payment creation.

// TODO(#6): confirm these exact status strings against the authenticated Sentoo
// docs. Matching is defensive; anything unrecognised maps to 'pending' so we
// never act on an ambiguous status.
const PAID_STATUSES = new Set(['paid', 'success', 'completed', 'complete']);
const FAILED_STATUSES = new Set(['failed', 'declined', 'error', 'cancelled', 'canceled', 'rejected']);
const EXPIRED_STATUSES = new Set(['expired', 'timeout', 'timed_out']);

/** Map a Sentoo status string to a payment outcome. */
function mapPaymentStatus(status) {
  const s = String(status).toLowerCase();
  if (PAID_STATUSES.has(s)) return 'paid';
  if (FAILED_STATUSES.has(s)) return 'failed';
  if (EXPIRED_STATUSES.has(s)) return 'expired';
  return 'pending';
}

/** True if a Sentoo status string means the payment succeeded. */
function isPaidStatus(status) {
  return status != null && mapPaymentStatus(status) === 'paid';
}

/**
 * @param {object} opts
 * @param {string} opts.baseUrl   API host, no trailing /v1 (client appends it).
 * @param {string} opts.merchantId
 * @param {string} opts.secret    sent as X-SENTOO-SECRET.
 * @param {typeof fetch} [opts.fetchImpl] injectable for tests.
 */
function createSentooClient({ baseUrl, merchantId, secret, defaultCurrency = 'XCG', defaultReturnUrl, fetchImpl = fetch }) {
  if (!baseUrl || !merchantId || !secret) {
    throw new Error('Sentoo client requires baseUrl, merchantId, and secret');
  }
  const host = baseUrl.replace(/\/+$/, '');

  /**
   * Create a Sentoo payment transaction and return the hosted payment URL.
   *
   * The webhook ("Payment status URL") is configured in the Sentoo merchant
   * portal, not per-transaction; `returnUrl` here is the browser redirect after
   * payment. We carry our internal order id in the description and return URL so
   * the payment is traceable both ways; the webhook then matches on the Sentoo
   * transaction id we store on the order.
   *
   * @param {object} p
   * @param {string} p.orderId      our internal order id (the reference)
   * @param {number} p.amountXcg    amount in XCG (decimal guilders)
   * @param {string} p.description
   * @param {string} [p.currency]
   * @param {string} [p.returnUrl]
   * @param {string} [p.customer]   optional customer reference
   * @param {string} [p.expiresAt]  optional expiry (Sentoo format)
   * @returns {Promise<{transactionId: string, paymentUrl: string, qrCode: string}>}
   */
  async function createPayment({ orderId, amountXcg, description, currency, returnUrl, customer, expiresAt }) {
    // TODO(#6): confirm amount units against the authenticated docs. Sentoo's
    // amount is an integer; we send minor units (XCG cents).
    const amountMinor = Math.round(Number(amountXcg) * 100);
    const params = new URLSearchParams({
      sentoo_merchant: merchantId,
      sentoo_amount: String(amountMinor),
      sentoo_description: description ?? `Order ${orderId}`,
      sentoo_currency: currency ?? defaultCurrency,
      sentoo_return_url: returnUrl ?? defaultReturnUrl ?? '',
    });
    if (orderId) params.append('sentoo_reference', orderId);
    if (customer) params.append('sentoo_customer', customer);
    if (expiresAt) params.append('sentoo_expires', expiresAt);

    const resp = await fetchImpl(`${host}/v1/payment/new`, {
      method: 'POST',
      headers: {
        'X-SENTOO-SECRET': secret,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });
    if (!resp.ok) {
      throw new Error(`Sentoo payment creation failed: HTTP ${resp.status}`);
    }
    const body = await resp.json();
    const success = body && body.success;
    if (!success || !success.data || !success.data.url) {
      throw new Error('Sentoo payment creation returned an unexpected response');
    }
    return {
      transactionId: success.message,
      paymentUrl: success.data.url,
      qrCode: success.data.qr_code,
    };
  }

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

  return { createPayment, getTransactionStatus };
}

function sentooFromEnv(env = process.env) {
  return createSentooClient({
    baseUrl: env.SENTOO_BASE_URL,
    merchantId: env.SENTOO_MERCHANT_ID,
    secret: env.SENTOO_API_KEY,
    defaultReturnUrl: env.SENTOO_RETURN_URL,
  });
}

module.exports = { createSentooClient, sentooFromEnv, isPaidStatus, mapPaymentStatus, PAID_STATUSES };
