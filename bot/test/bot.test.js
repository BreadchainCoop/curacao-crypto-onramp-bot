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

test('createBot builds a bot without connecting to Telegram', () => {
  const bot = createBot('123456:fake-token-for-tests');
  assert.ok(bot);
  assert.equal(typeof bot.handleUpdate, 'function');
});
