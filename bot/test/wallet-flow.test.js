const test = require('node:test');
const assert = require('node:assert/strict');
const { initialSession } = require('../state/session');
const wallet = require('../flows/wallet');

function mockCtx(session, text, fromId = 7) {
  const replies = [];
  return {
    session,
    from: { id: fromId },
    message: { text },
    reply: async (t) => replies.push(String(t)),
    replies,
  };
}

test('startWalletCreation asks for email when Privy is configured', async () => {
  const s = initialSession();
  const ctx = mockCtx(s);
  await wallet.startWalletCreation(ctx, { privy: { createUserWithWallet: async () => ({}) } });
  assert.equal(s.flow.step, 'awaiting_email');
  assert.match(ctx.replies[0], /email/i);
});

test('startWalletCreation without Privy tells the user to paste an address', async () => {
  const s = initialSession();
  const ctx = mockCtx(s);
  await wallet.startWalletCreation(ctx);
  assert.match(ctx.replies[0], /paste your own/i);
});

test('startWalletCreation no-ops if a wallet already exists', async () => {
  const s = initialSession();
  s.walletAddress = '0xEXISTING';
  const ctx = mockCtx(s);
  await wallet.startWalletCreation(ctx, { privy: {} });
  assert.match(ctx.replies[0], /already have a wallet/i);
});

test('handleEmail pregenerates a Privy wallet linked to the email', async () => {
  const s = initialSession();
  s.flow = { name: 'wallet', step: 'awaiting_email' };
  const ctx = mockCtx(s, 'user@example.com');
  const privy = {
    calls: [],
    createUserWithWallet: async (p) => {
      privy.calls.push(p);
      return { address: '0xNEWWALLET', userId: 'did:privy:1' };
    },
  };
  await wallet.handleEmail(ctx, { privy });

  assert.equal(privy.calls[0].email, 'user@example.com');
  assert.equal(s.walletAddress, '0xNEWWALLET');
  assert.equal(s.email, 'user@example.com');
  assert.equal(s.privyUserId, 'did:privy:1');
  assert.match(ctx.replies.at(-1), /0xNEWWALLET/);
});

test('handleEmail rejects an invalid email and does not call Privy', async () => {
  const s = initialSession();
  s.flow = { name: 'wallet', step: 'awaiting_email' };
  const ctx = mockCtx(s, 'not-an-email');
  const privy = { createUserWithWallet: async () => { throw new Error('should not be called'); } };
  await wallet.handleEmail(ctx, { privy });
  assert.equal(s.walletAddress, null);
  assert.match(ctx.replies[0], /valid email/i);
});

test('handleEmail falls back to paste if Privy fails', async () => {
  const s = initialSession();
  s.flow = { name: 'wallet', step: 'awaiting_email' };
  const ctx = mockCtx(s, 'user@example.com');
  const privy = { createUserWithWallet: async () => { throw new Error('privy down'); } };
  await wallet.handleEmail(ctx, { privy });
  assert.equal(s.walletAddress, null);
  assert.equal(s.flow.step, 'awaiting_address');
  assert.match(ctx.replies.at(-1), /paste your own/i);
});

test('handleAddress still accepts a pasted address', async () => {
  const s = initialSession();
  s.flow = { name: 'wallet', step: 'awaiting_address' };
  const addr = '0x' + 'a'.repeat(40);
  const ctx = mockCtx(s, addr);
  await wallet.handleAddress(ctx);
  assert.equal(s.walletAddress, addr);
  assert.equal(s.flow, null);
});
