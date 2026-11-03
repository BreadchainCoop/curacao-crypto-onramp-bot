'use strict';

// The Stellar wallet step must block a wallet that doesn't trust Circle's
// testnet USDC, and point the user to add it — before any payment is taken.
process.env.CHAIN = 'stellar-testnet'; // so G… addresses validate (isolated per test file)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const wallet = require('../flows/wallet');

const G_ADDRESS = 'GAFQASXPJNUU3UMDLPCVHHYSVK37BKLP4KSRJMKPUFWRBLYPQOHF5ZNA';
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const LINK = 'https://example.test/trustline.html';

function makeCtx() {
  const replies = [];
  return {
    replies,
    message: { text: G_ADDRESS },
    session: {},
    from: { id: 1 },
    reply: async (text, extra) => replies.push({ text, extra }),
  };
}

test('wallet with NO USDC trustline is rejected with the issuer + link, not saved', async () => {
  const ctx = makeCtx();
  await wallet.handleAddress(ctx, {
    trustline: { hasTrustline: async () => false, issuer: ISSUER },
    trustlineUrl: LINK,
  });
  assert.equal(ctx.session.walletAddress, undefined, 'must not save a wallet that can’t receive');
  assert.equal(ctx.replies.length, 1);
  assert.match(ctx.replies[0].text, /trustline/i);
  assert.match(ctx.replies[0].text, new RegExp(ISSUER));
  assert.match(ctx.replies[0].text, new RegExp(LINK.replace(/[.]/g, '\\.')));
});

test('wallet WITH the trustline is saved', async () => {
  const ctx = makeCtx();
  await wallet.handleAddress(ctx, {
    trustline: { hasTrustline: async () => true, issuer: ISSUER },
    trustlineUrl: LINK,
  });
  assert.equal(ctx.session.walletAddress, G_ADDRESS);
  assert.match(ctx.replies.at(-1).text, /saved/i);
});

test('a Horizon hiccup does not hard-block (fails open; backend still guards)', async () => {
  const ctx = makeCtx();
  await wallet.handleAddress(ctx, {
    trustline: {
      hasTrustline: async () => {
        throw new Error('horizon down');
      },
      issuer: ISSUER,
    },
    trustlineUrl: LINK,
  });
  assert.equal(ctx.session.walletAddress, G_ADDRESS, 'should save rather than block on a lookup error');
});
