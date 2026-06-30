const test = require('node:test');
const assert = require('node:assert/strict');

const { KycStatus, initialSession, resolveBuyGate } = require('../state/session');
const wallet = require('../flows/wallet');
const buy = require('../flows/buy');
const { createBot, renderStatus } = require('../index');

// Minimal stand-in for a Grammy context: just what the flow handlers touch.
function mockCtx(session, text) {
  const replies = [];
  return {
    session,
    message: { text },
    reply: async (t, opts) => {
      replies.push({ text: t, opts });
    },
    replies,
  };
}

test('a fresh session starts un-verified, wallet-less, and idle', () => {
  const s = initialSession();
  assert.equal(s.kycStatus, KycStatus.NONE);
  assert.equal(s.walletAddress, null);
  assert.equal(s.pendingOrderId, null);
  assert.equal(s.flow, null);
});

test('resolveBuyGate gates /buy behind KYC, then wallet', () => {
  const base = initialSession();
  assert.equal(resolveBuyGate(base).action, 'kyc');

  const pending = { ...base, kycStatus: KycStatus.PENDING };
  assert.equal(resolveBuyGate(pending).action, 'kyc');

  const approvedNoWallet = { ...base, kycStatus: KycStatus.APPROVED };
  assert.equal(resolveBuyGate(approvedNoWallet).action, 'wallet');

  const ready = { ...approvedNoWallet, walletAddress: '0x' + '1'.repeat(40) };
  assert.equal(resolveBuyGate(ready).action, 'buy');
});

test('resolveBuyGate can skip KYC when requireKyc is false', () => {
  const fresh = initialSession(); // kycStatus none, no wallet
  // With KYC required (default), an un-verified user is gated at kyc.
  assert.equal(resolveBuyGate(fresh).action, 'kyc');
  // With KYC disabled, it falls straight through to the wallet step.
  assert.equal(resolveBuyGate(fresh, { requireKyc: false }).action, 'wallet');
  // And once a wallet exists, straight to buy.
  const withWallet = { ...fresh, walletAddress: '0x' + '1'.repeat(40) };
  assert.equal(resolveBuyGate(withWallet, { requireKyc: false }).action, 'buy');
});

test('wallet address validation', () => {
  assert.equal(wallet.isValidAddress('0x' + 'a'.repeat(40)), true);
  assert.equal(wallet.isValidAddress('0x123'), false);
  assert.equal(wallet.isValidAddress('not-an-address'), false);
});

test('handleAddress stores a valid wallet and clears the flow', async () => {
  const s = initialSession();
  s.flow = { name: 'wallet', step: 'awaiting_address' };
  const addr = '0x' + 'a'.repeat(40);
  const ctx = mockCtx(s, addr);
  await wallet.handleAddress(ctx);
  assert.equal(s.walletAddress, addr);
  assert.equal(s.flow, null);
  assert.match(ctx.replies[0].text, /saved/i);
});

test('handleAddress rejects a bad wallet and keeps the flow open', async () => {
  const s = initialSession();
  s.flow = { name: 'wallet', step: 'awaiting_address' };
  const ctx = mockCtx(s, 'nope');
  await wallet.handleAddress(ctx);
  assert.equal(s.walletAddress, null);
  assert.equal(s.flow.step, 'awaiting_address');
});

test('buy.handleAmount quotes a valid amount and advances to confirm', async () => {
  const s = initialSession();
  s.flow = { name: 'buy', step: 'awaiting_amount' };
  const ctx = mockCtx(s, '100');
  await buy.handleAmount(ctx);
  assert.equal(s.flow.step, 'awaiting_confirm');
  assert.equal(s.flow.data.usdcAmount, 100);
  assert.match(ctx.replies[0].text, /Total:/);
});

test('buy.handleAmount rejects a non-numeric amount', async () => {
  const s = initialSession();
  s.flow = { name: 'buy', step: 'awaiting_amount' };
  const ctx = mockCtx(s, 'abc');
  await buy.handleAmount(ctx);
  assert.equal(s.flow.step, 'awaiting_amount'); // unchanged
  assert.match(ctx.replies[0].text, /positive number/i);
});

test('buy.confirm creates a pending order from a confirmable flow', async () => {
  const s = initialSession();
  s.flow = { name: 'buy', step: 'awaiting_confirm', data: { usdcAmount: 50 } };
  const ctx = mockCtx(s, '/confirm');
  await buy.confirm(ctx);
  assert.ok(s.pendingOrderId);
  assert.equal(s.flow, null);
});

test('renderStatus reflects the session', () => {
  const s = initialSession();
  assert.match(renderStatus(s), /KYC: none/);
  s.walletAddress = '0x' + 'b'.repeat(40);
  assert.match(renderStatus(s), /0xbbbb/i);
});

test('buy.confirm with a payments service sends the Sentoo link and records the order id', async () => {
  const s = initialSession();
  s.walletAddress = '0x' + 'a'.repeat(40);
  s.flow = { name: 'buy', step: 'awaiting_confirm', data: { usdcAmount: 100, totalXcg: 186.55 } };
  const ctx = mockCtx(s, '/confirm');
  ctx.from = { id: 7 };
  const payments = {
    calls: [],
    createForOrder: async (p) => {
      payments.calls.push(p);
      return { orderId: 'order-99', paymentUrl: 'https://pay.test/xyz' };
    },
  };
  await buy.confirm(ctx, { payments });

  assert.equal(payments.calls.length, 1);
  assert.equal(payments.calls[0].amountXcg, 186.55);
  assert.equal(payments.calls[0].usdcAmount, 100);
  assert.equal(payments.calls[0].walletAddress, s.walletAddress);
  assert.equal(payments.calls[0].telegramId, 7);
  assert.equal(s.pendingOrderId, 'order-99'); // the DB-issued order id
  assert.match(ctx.replies[0].text, /pay\.test\/xyz/);
});

test('buy.confirm does not record an order if payment creation fails', async () => {
  const s = initialSession();
  s.flow = { name: 'buy', step: 'awaiting_confirm', data: { usdcAmount: 100, totalXcg: 186.55 } };
  const ctx = mockCtx(s, '/confirm');
  ctx.from = { id: 7 };
  const payments = { createForOrder: async () => { throw new Error('sentoo down'); } };
  await buy.confirm(ctx, { payments });

  assert.equal(s.pendingOrderId, null);
  assert.match(ctx.replies[0].text, /could not create/i);
});

test('createBot builds a bot without connecting to Telegram', () => {
  const bot = createBot('123456:fake-token-for-tests');
  assert.ok(bot);
  assert.equal(typeof bot.handleUpdate, 'function');
});
