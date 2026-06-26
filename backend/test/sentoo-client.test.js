const test = require('node:test');
const assert = require('node:assert/strict');
const { createSentooClient, isPaidStatus } = require('../services/sentoo');

// Capture the request and return a canned Sentoo response.
function mockFetch(response, captured) {
  return async (url, init) => {
    captured.url = url;
    captured.init = init;
    return {
      ok: response.ok !== false,
      status: response.status ?? 200,
      json: async () => response.body,
    };
  };
}

function client(fetchImpl) {
  return createSentooClient({
    baseUrl: 'https://api.sentoo.test/',
    merchantId: 'merchant_1',
    secret: 'sek_test',
    defaultReturnUrl: 'https://t.me/the_bot',
    fetchImpl,
  });
}

test('createPayment posts the right shape and returns the payment URL', async () => {
  const captured = {};
  const c = client(
    mockFetch(
      { body: { success: { message: 'sentoo_tx_99', data: { url: 'https://pay.sentoo.test/abc', qr_code: 'data:img' } } } },
      captured
    )
  );

  const res = await c.createPayment({
    orderId: 'order-abc',
    amountXcg: 186.55,
    description: 'On-ramp order order-abc',
  });

  // endpoint + auth + content type
  assert.equal(captured.url, 'https://api.sentoo.test/v1/payment/new');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['X-SENTOO-SECRET'], 'sek_test');
  assert.equal(captured.init.headers['Content-Type'], 'application/x-www-form-urlencoded');

  // body fields
  const body = captured.init.body; // URLSearchParams
  assert.equal(body.get('sentoo_merchant'), 'merchant_1');
  assert.equal(body.get('sentoo_amount'), '18655'); // minor units (cents)
  assert.equal(body.get('sentoo_currency'), 'XCG');
  assert.equal(body.get('sentoo_return_url'), 'https://t.me/the_bot');
  // internal order id travels as the reference
  assert.equal(body.get('sentoo_reference'), 'order-abc');

  // parsed result
  assert.deepEqual(res, {
    transactionId: 'sentoo_tx_99',
    paymentUrl: 'https://pay.sentoo.test/abc',
    qrCode: 'data:img',
  });
});

test('createPayment throws on a non-OK response', async () => {
  const c = client(mockFetch({ ok: false, status: 401, body: {} }, {}));
  await assert.rejects(() => c.createPayment({ orderId: 'o', amountXcg: 10, description: 'x' }), /HTTP 401/);
});

test('createPayment throws on a malformed success body', async () => {
  const c = client(mockFetch({ body: { success: { message: 'tx', data: {} } } }, {}));
  await assert.rejects(() => c.createPayment({ orderId: 'o', amountXcg: 10, description: 'x' }), /unexpected response/);
});

test('getTransactionStatus reads success.message', async () => {
  const captured = {};
  const c = client(mockFetch({ body: { success: { message: 'paid', data: {} } } }, captured));
  const status = await c.getTransactionStatus('tx_1');
  assert.equal(status, 'paid');
  assert.equal(captured.url, 'https://api.sentoo.test/v1/payment/status/merchant_1/tx_1');
  assert.equal(captured.init.headers['X-SENTOO-SECRET'], 'sek_test');
});

test('isPaidStatus recognises paid variants only', () => {
  assert.ok(isPaidStatus('paid'));
  assert.ok(isPaidStatus('SUCCESS'));
  assert.equal(isPaidStatus('issued'), false);
  assert.equal(isPaidStatus(null), false);
});
