const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminHandlers } = require('../flows/admin');

const ADMIN_ID = '42';

function mockCtx({ fromId = ADMIN_ID, match = '' } = {}) {
  const replies = [];
  return {
    from: { id: fromId },
    match,
    session: { adminRefund: null },
    reply: async (t) => replies.push(t),
    replies,
  };
}

function fakes() {
  const escrow = {
    refundCalls: [],
    balance: async () => '1000.00',
    refund: async (amt) => {
      escrow.refundCalls.push(amt);
      return '0xrefundhash';
    },
  };
  const orders = {
    rows: [
      { id: 'aaaaaaaa-1', status: 'complete', amountUsdc: 100, amountXcg: 186.55, createdAt: 'x' },
      { id: 'bbbbbbbb-2', status: 'failed', amountUsdc: 50, amountXcg: 93, createdAt: 'y' },
    ],
    listRecent: async () => orders.rows,
    getById: async (id) => orders.rows.find((o) => o.id === id) || null,
    refundedCalls: [],
    markRefunded: async (id) => {
      orders.refundedCalls.push(id);
      return true;
    },
  };
  return { escrow, orders };
}

function handlers(extra = {}) {
  const { escrow, orders } = fakes();
  const h = createAdminHandlers({ adminId: ADMIN_ID, escrow, orders, logger: silent(), ...extra });
  return { h, escrow, orders };
}

function silent() {
  return { info() {}, warn() {}, error() {} };
}

test('non-admin users are silently ignored (no reply)', async () => {
  const { h } = handlers();
  const ctx = mockCtx({ fromId: '999' });
  await h.escrowBalance(ctx);
  await h.listOrders(ctx);
  await h.refundStart(mockCtx({ fromId: '999', match: 'aaaaaaaa-1' }));
  assert.equal(ctx.replies.length, 0);
});

test('/escrow_balance shows the contract balance', async () => {
  const { h } = handlers();
  const ctx = mockCtx();
  await h.escrowBalance(ctx);
  assert.match(ctx.replies[0], /1000\.00 USDC/);
});

test('/orders lists recent orders with status', async () => {
  const { h } = handlers();
  const ctx = mockCtx();
  await h.listOrders(ctx);
  assert.match(ctx.replies[0], /aaaaaaaa/);
  assert.match(ctx.replies[0], /complete/);
  assert.match(ctx.replies[0], /failed/);
});

test('/refund requires a confirmation step before executing', async () => {
  const { h, escrow } = handlers();
  const ctx = mockCtx({ match: 'aaaaaaaa-1' });
  await h.refundStart(ctx);
  // No on-chain call yet — only a confirmation prompt + stashed pending refund.
  assert.equal(escrow.refundCalls.length, 0);
  assert.match(ctx.replies[0], /refund_confirm/i);
  assert.deepEqual(ctx.session.adminRefund, { orderId: 'aaaaaaaa-1', amountUsdc: 100 });
});

test('/refund_confirm executes the refund and marks the order refunded', async () => {
  const { h, escrow, orders } = handlers();
  const ctx = mockCtx({ match: 'aaaaaaaa-1' });
  await h.refundStart(ctx);
  await h.refundConfirm(ctx);
  assert.deepEqual(escrow.refundCalls, [100]);
  assert.deepEqual(orders.refundedCalls, ['aaaaaaaa-1']);
  assert.equal(ctx.session.adminRefund, null);
  assert.match(ctx.replies[1], /0xrefundhash/);
});

test('/refund_confirm with nothing pending does nothing on-chain', async () => {
  const { h, escrow } = handlers();
  const ctx = mockCtx();
  await h.refundConfirm(ctx);
  assert.equal(escrow.refundCalls.length, 0);
  assert.match(ctx.replies[0], /no refund pending/i);
});

test('/refund with an unknown order id does not stash a pending refund', async () => {
  const { h } = handlers();
  const ctx = mockCtx({ match: 'nope' });
  await h.refundStart(ctx);
  assert.match(ctx.replies[0], /not found/i);
  assert.equal(ctx.session.adminRefund, null);
});

test('/refund_cancel clears a pending refund', async () => {
  const { h, escrow } = handlers();
  const ctx = mockCtx({ match: 'aaaaaaaa-1' });
  await h.refundStart(ctx);
  await h.refundCancel(ctx);
  assert.equal(ctx.session.adminRefund, null);
  await h.refundConfirm(ctx);
  assert.equal(escrow.refundCalls.length, 0); // nothing to confirm after cancel
});
