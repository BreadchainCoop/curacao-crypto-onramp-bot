// Minimal Sentoo client for the bot — payment-link creation only.
// Mirrors backend/services/sentoo.js createPayment (the backend also does the
// webhook status re-fetch). TODO: extract a shared package.

function createSentooClient({ baseUrl, merchantId, secret, defaultCurrency = 'XCG', defaultReturnUrl, fetchImpl = fetch }) {
  if (!baseUrl || !merchantId || !secret) {
    throw new Error('Sentoo client requires baseUrl, merchantId, and secret');
  }
  const host = baseUrl.replace(/\/+$/, '');

  async function createPayment({ orderId, amountXcg, description, currency, returnUrl }) {
    // TODO(#6): confirm amount units. Sentoo's amount is an integer; we send
    // minor units (XCG cents).
    const amountMinor = Math.round(Number(amountXcg) * 100);
    const params = new URLSearchParams({
      sentoo_merchant: merchantId,
      sentoo_amount: String(amountMinor),
      sentoo_description: description ?? `Order ${orderId}`,
      sentoo_currency: currency ?? defaultCurrency,
      sentoo_return_url: returnUrl ?? defaultReturnUrl ?? '',
    });
    if (orderId) params.append('sentoo_reference', orderId);

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

  return { createPayment };
}

function sentooFromEnv(env = process.env) {
  return createSentooClient({
    baseUrl: env.SENTOO_BASE_URL,
    merchantId: env.SENTOO_MERCHANT_ID,
    secret: env.SENTOO_API_KEY,
    defaultReturnUrl: env.SENTOO_RETURN_URL,
  });
}

module.exports = { createSentooClient, sentooFromEnv };
