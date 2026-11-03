'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createTrustlineChecker, trustlineCheckerFromChain } = require('../services/trustline');

const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const ADDR = 'GAFQASXPJNUU3UMDLPCVHHYSVK37BKLP4KSRJMKPUFWRBLYPQOHF5ZNA';

function fakeFetch(handler) {
  return async (url) => handler(url);
}
function resp(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

test('hasTrustline is true when the account trusts USDC:issuer', async () => {
  const checker = createTrustlineChecker({
    horizonUrl: 'https://horizon-testnet.stellar.org',
    issuer: ISSUER,
    fetchImpl: fakeFetch(() =>
      resp(200, { balances: [{ asset_type: 'native', balance: '100' }, { asset_code: 'USDC', asset_issuer: ISSUER, balance: '0' }] })
    ),
  });
  assert.equal(await checker.hasTrustline(ADDR), true);
});

test('hasTrustline is false when the only USDC is from a different issuer', async () => {
  const checker = createTrustlineChecker({
    horizonUrl: 'https://h',
    issuer: ISSUER,
    fetchImpl: fakeFetch(() =>
      resp(200, { balances: [{ asset_code: 'USDC', asset_issuer: 'GATALTGTWRONGISSUERxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', balance: '5' }] })
    ),
  });
  assert.equal(await checker.hasTrustline(ADDR), false);
});

test('hasTrustline is false for an unfunded account (404)', async () => {
  const checker = createTrustlineChecker({ horizonUrl: 'https://h', issuer: ISSUER, fetchImpl: fakeFetch(() => resp(404, {})) });
  assert.equal(await checker.hasTrustline(ADDR), false);
});

test('hasTrustline throws on an unexpected Horizon error', async () => {
  const checker = createTrustlineChecker({ horizonUrl: 'https://h', issuer: ISSUER, fetchImpl: fakeFetch(() => resp(500, {})) });
  await assert.rejects(() => checker.hasTrustline(ADDR), /HTTP 500/);
});

test('trustlineCheckerFromChain returns null for non-Stellar chains', () => {
  assert.equal(trustlineCheckerFromChain({ stellar: false }), null);
  assert.equal(trustlineCheckerFromChain({ stellar: true }), null); // missing horizon/issuer
  const c = trustlineCheckerFromChain({ stellar: true, horizonUrl: 'https://h', usdcIssuer: ISSUER });
  assert.equal(typeof c.hasTrustline, 'function');
  assert.equal(c.issuer, ISSUER);
});
