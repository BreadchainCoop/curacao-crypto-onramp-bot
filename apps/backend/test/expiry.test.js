const test = require('node:test');
const assert = require('node:assert/strict');
const { runExpiry } = require('../services/expiry');
const { InMemoryOrdersRepository } = require('../services/orders');

const NOW = Date.parse('2026-06-24T12:00:00Z');
const minsAgo = (m) => new Date(NOW - m * 60_000).toISOString();

function fakeNotifier() {
  const calls = [];
  return { calls, notify: async (chatId, text) => calls.push({ chatId, text }) };
}

function seed() {
  return new InMemoryOrdersRepository([
    { id: 'stale', status: 'pending_payment', amountUsdc: 10, amountXcg: 18, createdAt: minsAgo(31), sentooTransactionId: 't_stale', user: { telegramId: 1, walletAddress: '0x' + '1'.repeat(40) } },
    { id: 'fresh', status: 'pending_payment', amountUsdc: 10, amountXcg: 18, createdAt: minsAgo(5), sentooTransactionId: 't_fresh', user: { telegramId: 2, walletAddress: '0x' + '2'.repeat(40) } },
    { id: 'paid', status: 'paid', amountUsdc: 10, amountXcg: 18, createdAt: minsAgo(60), sentooTransactionId: 't_paid', user: { telegramId: 3, walletAddress: '0x' + '3'.repeat(40) } },
  ]);
}

test('expires only stale pending orders and notifies their users', async () => {
  const orders = seed();
  const notifier = fakeNotifier();
  const count = await runExpiry({ orders, notifier, ttlMinutes: 30, now: () => NOW, logger: silent() });

  assert.equal(count, 1);
  assert.equal((await orders.getBySentooTxId('t_stale')).status, 'expired');
  assert.equal((await orders.getBySentooTxId('t_fresh')).status, 'pending_payment'); // too recent
  assert.equal((await orders.getBySentooTxId('t_paid')).status, 'paid'); // not pending

  assert.equal(notifier.calls.length, 1);
  assert.equal(notifier.calls[0].chatId, 1);
  assert.match(notifier.calls[0].text, /expired/i);
});

test('is idempotent — a second sweep expires nothing', async () => {
  const orders = seed();
  const notifier = fakeNotifier();
  await runExpiry({ orders, notifier, ttlMinutes: 30, now: () => NOW, logger: silent() });
  const second = await runExpiry({ orders, notifier, ttlMinutes: 30, now: () => NOW, logger: silent() });

  assert.equal(second, 0);
  assert.equal(notifier.calls.length, 1); // no duplicate notification
});

function silent() {
  return { info() {}, warn() {}, error() {} };
}
