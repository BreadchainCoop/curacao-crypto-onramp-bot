'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SupabaseAdminOrders,
  ordersAdminFromEnv,
  escrowOperatorFromEnv,
} = require('../services/operator');

// A chainable Supabase query stub: every builder method returns the builder, and
// the builder is thenable/awaitable, resolving to a preset { data, error }.
function fakeClient(result) {
  const builder = {
    from() { return builder; },
    select() { return builder; },
    order() { return builder; },
    limit() { return builder; },
    eq() { return builder; },
    in() { return builder; },
    update() { return builder; },
    maybeSingle() { return Promise.resolve(result); },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return builder;
}

test('listRecent maps rows to the admin shape', async () => {
  const orders = new SupabaseAdminOrders(
    fakeClient({
      data: [{ id: 'abcdef12', status: 'complete', amount_usdc: '5', amount_xcg: '9.1', created_at: '2026-08-19T00:00:00Z' }],
      error: null,
    })
  );
  const rows = await orders.listRecent(10);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    id: 'abcdef12',
    status: 'complete',
    amountUsdc: 5,
    amountXcg: 9.1,
    createdAt: '2026-08-19T00:00:00Z',
  });
});

test('getById returns null when the order is missing', async () => {
  const orders = new SupabaseAdminOrders(fakeClient({ data: null, error: null }));
  assert.equal(await orders.getById('nope'), null);
});

test('getById maps a found order', async () => {
  const orders = new SupabaseAdminOrders(
    fakeClient({ data: { id: 'x', status: 'failed', amount_usdc: '25' }, error: null })
  );
  assert.deepEqual(await orders.getById('x'), { id: 'x', status: 'failed', amountUsdc: 25 });
});

test('claimRefund returns true only when the CAS updates a row', async () => {
  const claimed = new SupabaseAdminOrders(fakeClient({ data: [{ id: 'x' }], error: null }));
  assert.equal(await claimed.claimRefund('x'), true);
  const notClaimed = new SupabaseAdminOrders(fakeClient({ data: [], error: null }));
  assert.equal(await notClaimed.claimRefund('x'), false);
});

test('claimRefund throws on a DB error', async () => {
  const orders = new SupabaseAdminOrders(fakeClient({ data: null, error: new Error('db down') }));
  await assert.rejects(() => orders.claimRefund('x'), /db down/);
});

test('revertRefund resolves without throwing on success', async () => {
  const orders = new SupabaseAdminOrders(fakeClient({ error: null }));
  await orders.revertRefund('x'); // should not throw
});

test('totalFees aggregates fee and spread across paid orders', async () => {
  const orders = new SupabaseAdminOrders(
    fakeClient({
      data: [{ amount_usdc: '10', amount_xcg: '20', status: 'complete' }],
      error: null,
    })
  );
  const { feeXcg, spreadXcg, count } = await orders.totalFees();
  assert.equal(count, 1);
  assert.ok(feeXcg >= 0);
  assert.ok(spreadXcg >= 0);
});

test('ordersAdminFromEnv builds a SupabaseAdminOrders from env', () => {
  const orders = ordersAdminFromEnv({ SUPABASE_URL: 'http://localhost', SUPABASE_SERVICE_ROLE_KEY: 'k' });
  assert.ok(orders instanceof SupabaseAdminOrders);
});

test('escrowOperatorFromEnv builds an ops client from env', async () => {
  const op = escrowOperatorFromEnv({ OPS_API_URL: 'http://backend', OPS_API_SECRET: 's' });
  assert.equal(typeof op.balance, 'function');
  assert.equal(typeof op.refund, 'function');
});
