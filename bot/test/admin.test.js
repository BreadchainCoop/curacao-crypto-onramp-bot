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
    totalFees: async () => ({ feeXcg: 182.5, spreadXcg: 273, count: 3 }),
    getById: async (id) => orders.rows.find((o) => o.id === id) || null,
    // CAS: only failed -> refunded, one-shot.
    claimRefund: async (id) => {
      const o = orders.rows.find((r) => r.id === id);
      if (o && o.status === 'failed') {
        o.status = 'refunded';
        return true;
      }
      return false;
    },
    revertRefund: async (id) => {
      const o = orders.rows.find((r) => r.id === id);
      if (o && o.status === 'refunded') o.status = 'failed';
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

test('total fees reports platform fees, spread and combined in XCG', async () => {
  const { h } = handlers();
  const ctx = mockCtx();
  await h.totalFees(ctx);
  assert.match(ctx.replies[0], /182\.50 XCG/); // platform fees
  assert.match(ctx.replies[0], /273\.00 XCG/); // spread
  assert.match(ctx.replies[0], /455\.50 XCG/); // combined
});

test('total fees is admin-gated (ignored for non-admins)', async () => {
  const { h } = handlers();
  const ctx = mockCtx({ fromId: '999' });
  await h.totalFees(ctx);
  assert.equal(ctx.replies.length, 0);
});

test('/refund on a failed order stashes a pending refund (no chain call yet)', async () => {
  const { h, escrow } = handlers();
  const ctx = mockCtx({ match: 'bbbbbbbb-2' }); // failed
  await h.refundStart(ctx);
  assert.equal(escrow.refundCalls.length, 0);
  assert.match(ctx.replies[0], /Refund order .* USDC\?/i);
  assert.deepEqual(ctx.session.adminRefund, { orderId: 'bbbbbbbb-2', amountUsdc: 50 });
});

test('/refund is rejected for a non-failed order (no stash, no chain)', async () => {
  const { h, escrow } = handlers();
  const ctx = mockCtx({ match: 'aaaaaaaa-1' }); // complete
  await h.refundStart(ctx);
  assert.equal(escrow.refundCalls.length, 0);
  assert.equal(ctx.session.adminRefund, null);
  assert.match(ctx.replies[0], /only failed orders/i);
});

test('/refund_confirm CAS-claims failed -> refunded, then calls the chain', async () => {
  const { h, escrow, orders } = handlers();
  const ctx = mockCtx({ match: 'bbbbbbbb-2' });
  await h.refundStart(ctx);
  await h.refundConfirm(ctx);
  assert.deepEqual(escrow.refundCalls, [50]);
  assert.equal(orders.rows.find((o) => o.id === 'bbbbbbbb-2').status, 'refunded');
  assert.equal(ctx.session.adminRefund, null);
  assert.match(ctx.replies[1], /0xrefundhash/);
});

test('/refund_confirm never touches the chain if the CAS claim fails', async () => {
  const { h, escrow, orders } = handlers();
  orders.claimRefund = async () => false; // simulate already-refunded / race
  const ctx = mockCtx();
  ctx.session.adminRefund = { orderId: 'bbbbbbbb-2', amountUsdc: 50 };
  await h.refundConfirm(ctx);
  assert.equal(escrow.refundCalls.length, 0);
  assert.match(ctx.replies[0], /can't be refunded/i);
});

test('/refund_confirm reverts the claim if the on-chain refund throws', async () => {
  const { h, escrow, orders } = handlers();
  escrow.refund = async () => {
    throw new Error('rpc boom https://secret-rpc.example/key');
  };
  const ctx = mockCtx({ match: 'bbbbbbbb-2' });
  await h.refundStart(ctx);
  await h.refundConfirm(ctx);
  assert.equal(orders.rows.find((o) => o.id === 'bbbbbbbb-2').status, 'failed'); // reverted
  assert.doesNotMatch(ctx.replies[1], /secret-rpc/); // no raw error leaked
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
  const ctx = mockCtx({ match: 'bbbbbbbb-2' });
  await h.refundStart(ctx);
  await h.refundCancel(ctx);
  assert.equal(ctx.session.adminRefund, null);
  await h.refundConfirm(ctx);
  assert.equal(escrow.refundCalls.length, 0); // nothing to confirm after cancel
});
