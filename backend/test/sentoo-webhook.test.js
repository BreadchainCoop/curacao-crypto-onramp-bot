const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../index');
const { InMemoryOrdersRepository } = require('../services/orders');

const WALLET = '0x' + 'a'.repeat(40);
const TOKEN = 'shared-url-token';

// Build a fresh app + recording fakes for each test, listening on a random port.
async function makeServer({ status = 'paid', releaseThrows = false } = {}) {
  const orders = new InMemoryOrdersRepository([
    {
      id: 'o1',
      status: 'pending_payment',
      amountUsdc: 100,
      amountXcg: 186.55,
      sentooTransactionId: 'tx_1',
      user: { telegramId: 42, walletAddress: WALLET },
    },
  ]);
  const escrow = {
    calls: [],
    release: async (recipient, amount) => {
      escrow.calls.push({ recipient, amount });
      if (releaseThrows) throw new Error('rpc down');
      return '0xdeadbeef';
    },
  };
  const notifier = {
    calls: [],
    notify: async (chatId, text) => notifier.calls.push({ chatId, text }),
  };
  const sentoo = { getTransactionStatus: async () => status };

  const app = createApp({ sentoo, orders, escrow, notifier, webhookToken: TOKEN, logger: silentLogger() });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  return { server, port, orders, escrow, notifier };
}

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

async function postWebhook(port, { token = TOKEN, body = { transaction_id: 'tx_1' } } = {}) {
  const qs = token === null ? '' : `?token=${encodeURIComponent(token)}`;
  return fetch(`http://127.0.0.1:${port}/webhook/sentoo${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
}

test('rejects a webhook with a missing/wrong URL token', async () => {
  const { server, port, escrow } = await makeServer();
  const res = await postWebhook(port, { token: 'wrong' });
  assert.equal(res.status, 401);
  assert.equal(escrow.calls.length, 0);
  server.close();
});

test('rejects a webhook with no transaction_id', async () => {
  const { server, port } = await makeServer();
  const res = await postWebhook(port, { body: {} });
  assert.equal(res.status, 400);
  server.close();
});

test('acks an unknown transaction_id without releasing', async () => {
  const { server, port, escrow } = await makeServer();
  const res = await postWebhook(port, { body: { transaction_id: 'tx_unknown' } });
  assert.equal(res.status, 200);
  assert.equal(escrow.calls.length, 0);
  server.close();
});

test('does not release when the re-fetched status is not paid', async () => {
  const { server, port, escrow, orders } = await makeServer({ status: 'issued' });
  const res = await postWebhook(port);
  assert.equal(res.status, 200);
  assert.equal(escrow.calls.length, 0);
  const order = await orders.getBySentooTxId('tx_1');
  assert.equal(order.status, 'pending_payment'); // untouched
  server.close();
});

test('happy path: releases USDC, completes the order, notifies the user', async () => {
  const { server, port, escrow, notifier, orders } = await makeServer({ status: 'paid' });
  const res = await postWebhook(port);
  assert.equal(res.status, 200);

  assert.equal(escrow.calls.length, 1);
  assert.deepEqual(escrow.calls[0], { recipient: WALLET, amount: 100 });

  const order = await orders.getBySentooTxId('tx_1');
  assert.equal(order.status, 'complete');

  assert.equal(notifier.calls.length, 1);
  assert.equal(notifier.calls[0].chatId, 42);
  assert.match(notifier.calls[0].text, /0xdeadbeef/);
  server.close();
});

test('idempotent: a duplicate webhook does not release twice', async () => {
  const { server, port, escrow, orders } = await makeServer({ status: 'paid' });
  await postWebhook(port);
  await postWebhook(port); // duplicate delivery
  assert.equal(escrow.calls.length, 1);
  const order = await orders.getBySentooTxId('tx_1');
  assert.equal(order.status, 'complete');
  server.close();
});

test('marks the order failed if escrow release throws', async () => {
  const { server, port, orders, notifier } = await makeServer({ status: 'paid', releaseThrows: true });
  const res = await postWebhook(port);
  assert.equal(res.status, 200);
  const order = await orders.getBySentooTxId('tx_1');
  assert.equal(order.status, 'failed');
  assert.equal(notifier.calls.length, 0); // no success message on failure
  server.close();
});
