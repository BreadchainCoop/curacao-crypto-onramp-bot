const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentsService } = require('../services/payments');
const { createSentooClient } = require('../services/sentoo');

function silent() {
  return { info() {}, warn() {}, error() {} };
}

test('createForOrder upserts the user, creates the order, calls Sentoo, stores the tx id', async () => {
  const calls = {};
  const repo = {
    upsertUser: async (telegramId, walletAddress) => {
      calls.upsertUser = { telegramId, walletAddress };
      return 'user-1';
    },
    createOrder: async (o) => {
      calls.createOrder = o;
      return 'order-1';
    },
    setSentooTransaction: async (orderId, transactionId) => {
      calls.setTx = { orderId, transactionId };
    },
  };
  const sentoo = {
    createPayment: async (p) => {
      calls.createPayment = p;
      return { transactionId: 'stx-1', paymentUrl: 'https://pay/abc' };
    },
  };

  const svc = createPaymentsService({ repo, sentoo, logger: silent() });
  const res = await svc.createForOrder({
    usdcAmount: 100,
    amountXcg: 186.55,
    walletAddress: '0xWALLET',
    telegramId: 7,
  });

  assert.deepEqual(calls.upsertUser, { telegramId: 7, walletAddress: '0xWALLET' });
  assert.deepEqual(calls.createOrder, { userId: 'user-1', amountXcg: 186.55, amountUsdc: 100 });
  assert.equal(calls.createPayment.orderId, 'order-1'); // reference == db order id
  assert.equal(calls.createPayment.amountXcg, 186.55);
  assert.deepEqual(calls.setTx, { orderId: 'order-1', transactionId: 'stx-1' });
  assert.deepEqual(res, { orderId: 'order-1', paymentUrl: 'https://pay/abc' });
});

test('the bot Sentoo client posts amount in minor units with the order reference', async () => {
  const captured = {};
  const fetchImpl = async (url, init) => {
    captured.url = url;
    captured.init = init;
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: { message: 'tx_1', data: { url: 'https://pay/1', qr_code: 'q' } } }),
    };
  };
  const client = createSentooClient({
    baseUrl: 'https://api.sentoo.test/',
    merchantId: 'm1',
    secret: 'sek',
    fetchImpl,
  });
  const res = await client.createPayment({ orderId: 'order-1', amountXcg: 186.55, description: 'x' });

  assert.equal(captured.url, 'https://api.sentoo.test/v1/payment/new');
  assert.equal(captured.init.headers['X-SENTOO-SECRET'], 'sek');
  assert.equal(captured.init.body.get('sentoo_amount'), '18655'); // cents
  assert.equal(captured.init.body.get('sentoo_reference'), 'order-1');
  assert.deepEqual(res, { transactionId: 'tx_1', paymentUrl: 'https://pay/1', qrCode: 'q' });
});
