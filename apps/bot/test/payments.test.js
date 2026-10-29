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
  assert.deepEqual(calls.createOrder, { userId: 'user-1', amountXcg: 186.55, amountUsdc: 100, payoutWallet: '0xWALLET' });
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
  assert.equal(captured.init.body.get('sentoo_reference'), null); // no such field
  assert.deepEqual(res, { transactionId: 'tx_1', paymentUrl: 'https://pay/1', qrCode: 'q' });
});

// ── Escrow liquidity pre-check (fail-closed, reservation + buffer) ──

function liquidityHarness({ balance, outstanding, buffer = 0, failRead = false }) {
  const calls = { created: false, sentoo: false };
  const repo = {
    upsertUser: async () => { calls.created = true; return 'user-1'; },
    createOrder: async () => { calls.created = true; return 'order-1'; },
    setSentooTransaction: async () => {},
    sumOutstandingUsdc: async () => outstanding,
  };
  const sentoo = { createPayment: async () => { calls.sentoo = true; return { transactionId: 'stx', paymentUrl: 'https://pay/x' }; } };
  const getEscrowBalanceUsdc = async () => {
    if (failRead) throw new Error('rpc down');
    return balance;
  };
  const svc = createPaymentsService({ repo, sentoo, getEscrowBalanceUsdc, reserveBufferUsdc: buffer, logger: silent() });
  return { svc, calls };
}

const order = (usdc = 100) => ({ usdcAmount: usdc, amountXcg: usdc * 1.89, walletAddress: '0xW', telegramId: 1 });

test('liquidity: proceeds when balance covers order after reserve + buffer', async () => {
  const { svc, calls } = liquidityHarness({ balance: 1000, outstanding: 850, buffer: 10 });
  // available = 1000 - 850 - 10 = 140 >= 100
  const res = await svc.createForOrder(order(100));
  assert.equal(res.orderId, 'order-1');
  assert.ok(calls.created && calls.sentoo);
});

test('liquidity: refuses (ESCROW_INSUFFICIENT) and creates NO order/link when reserve leaves too little', async () => {
  const { svc, calls } = liquidityHarness({ balance: 1000, outstanding: 950, buffer: 10 });
  // available = 1000 - 950 - 10 = 40 < 100
  await assert.rejects(() => svc.createForOrder(order(100)), (e) => e.code === 'ESCROW_INSUFFICIENT');
  assert.equal(calls.created, false, 'no order row created');
  assert.equal(calls.sentoo, false, 'no Sentoo link minted');
});

test('liquidity: buffer alone can block an otherwise-coverable order', async () => {
  const { svc } = liquidityHarness({ balance: 100, outstanding: 0, buffer: 25 });
  // available = 100 - 0 - 25 = 75 < 100
  await assert.rejects(() => svc.createForOrder(order(100)), (e) => e.code === 'ESCROW_INSUFFICIENT');
});

test('liquidity: FAILS CLOSED (ESCROW_CHECK_FAILED) when the balance read throws — no order taken', async () => {
  const { svc, calls } = liquidityHarness({ balance: 1000, outstanding: 0, failRead: true });
  await assert.rejects(() => svc.createForOrder(order(10)), (e) => e.code === 'ESCROW_CHECK_FAILED');
  assert.equal(calls.created, false);
  assert.equal(calls.sentoo, false);
});

test('liquidity: pre-check is skipped (legacy) when no balance reader is injected', async () => {
  const calls = { created: false };
  const repo = {
    upsertUser: async () => { calls.created = true; return 'u'; },
    createOrder: async () => 'o',
    setSentooTransaction: async () => {},
    sumOutstandingUsdc: async () => { throw new Error('should not be called'); },
  };
  const sentoo = { createPayment: async () => ({ transactionId: 't', paymentUrl: 'https://p' }) };
  const svc = createPaymentsService({ repo, sentoo, logger: silent() });
  const res = await svc.createForOrder(order(100));
  assert.equal(res.orderId, 'o');
  assert.ok(calls.created);
});
