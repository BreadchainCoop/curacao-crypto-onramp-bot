const test = require('node:test');
const assert = require('node:assert/strict');
const { initialSession } = require('../state/session');
const wallet = require('../flows/wallet');

function mockCtx(session, fromId = 7) {
  const replies = [];
  return {
    session,
    from: { id: fromId },
    reply: async (t) => replies.push(String(t)),
    replies,
  };
}

test('createWallet with Privy stores the new address and links the telegram id', async () => {
  const s = initialSession();
  const ctx = mockCtx(s);
  const privy = {
    calls: [],
    createWallet: async (p) => {
      privy.calls.push(p);
      return { address: '0xNEWWALLET', id: 'w1' };
    },
  };
  await wallet.createWallet(ctx, { privy });

  assert.equal(privy.calls[0].externalId, '7'); // linked to telegram id
  assert.equal(s.walletAddress, '0xNEWWALLET');
  assert.match(ctx.replies[0], /0xNEWWALLET/);
});

test('createWallet without Privy falls back to asking for an address', async () => {
  const s = initialSession();
  const ctx = mockCtx(s);
  await wallet.createWallet(ctx);
  assert.equal(s.walletAddress, null);
  assert.match(ctx.replies[0], /paste your own/i);
});

test('createWallet does nothing if the user already has a wallet', async () => {
  const s = initialSession();
  s.walletAddress = '0xEXISTING';
  const ctx = mockCtx(s);
  const privy = { createWallet: async () => { throw new Error('should not be called'); } };
  await wallet.createWallet(ctx, { privy });
  assert.equal(s.walletAddress, '0xEXISTING');
  assert.match(ctx.replies[0], /already have a wallet/i);
});

test('createWallet keeps the address unset if Privy fails', async () => {
  const s = initialSession();
  const ctx = mockCtx(s);
  const privy = { createWallet: async () => { throw new Error('privy down'); } };
  await wallet.createWallet(ctx, { privy });
  assert.equal(s.walletAddress, null);
  assert.match(ctx.replies[0], /could not create/i);
});
