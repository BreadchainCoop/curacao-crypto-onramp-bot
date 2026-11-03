'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../index');
const { InMemoryOrdersRepository } = require('../services/orders');

const G_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const EVM_ADDRESS = '0x' + 'a'.repeat(40);

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

// Spin up the webhook app with a single paid order whose payout is `payout`,
// plus a base notifier and a Stellar notifier, both recording.
async function makeServer(payout) {
  const orders = new InMemoryOrdersRepository([
    {
      id: 'o1',
      status: 'pending_payment',
      amountUsdc: 15,
      amountXcg: 27.9,
      sentooTransactionId: 'tx_1',
      payoutWallet: payout,
      user: { telegramId: 42, walletAddress: payout },
    },
  ]);
  const escrow = { release: async () => 'txhash123' };
  const base = { name: 'base', calls: [], notify: async (chatId, text) => base.calls.push({ chatId, text }) };
  const stellar = { name: 'stellar', calls: [], notify: async (chatId, text) => stellar.calls.push({ chatId, text }) };
  const sentoo = { getTransactionStatus: async () => 'paid' };

  const app = createApp({
    sentoo,
    orders,
    escrow,
    notifier: base,
    notifierStellar: stellar,
    logger: silentLogger(),
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { server, port: server.address().port, base, stellar };
}

async function postWebhook(port) {
  return fetch(`http://127.0.0.1:${port}/webhook/sentoo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ transaction_id: 'tx_1' }),
  });
}

test('a Stellar (G…) order notifies via the STELLAR bot, not the Base bot', async () => {
  const { server, port, base, stellar } = await makeServer(G_ADDRESS);
  const res = await postWebhook(port);
  assert.equal(res.status, 200);
  // The completion receipt (and the earlier "paid" message) come from the Stellar bot.
  assert.ok(stellar.calls.length >= 1, 'stellar notifier should be used');
  assert.equal(base.calls.length, 0, 'base notifier must NOT be used for a G… order');
  server.close();
});

test('an EVM (0x) order still notifies via the Base bot', async () => {
  const { server, port, base, stellar } = await makeServer(EVM_ADDRESS);
  const res = await postWebhook(port);
  assert.equal(res.status, 200);
  assert.ok(base.calls.length >= 1, 'base notifier should be used');
  assert.equal(stellar.calls.length, 0, 'stellar notifier must NOT be used for a 0x order');
  server.close();
});
