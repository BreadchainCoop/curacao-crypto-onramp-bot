'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEscrowOperator } = require('../services/operator');

const BASE = 'https://backend.example.com';
const SECRET = 'ops-secret-123';

function fakeFetch(responder) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    return responder(url, opts);
  };
  return { fetchImpl, calls };
}

function jsonResponse(obj, ok = true, status = 200) {
  return { ok, status, json: async () => obj };
}

test('createEscrowOperator requires opsBaseUrl and opsSecret', () => {
  assert.throws(() => createEscrowOperator({ opsSecret: SECRET }), /opsBaseUrl/);
  assert.throws(() => createEscrowOperator({ opsBaseUrl: BASE }), /opsBaseUrl|opsSecret/);
});

test('balance() GETs the ops endpoint with the bearer token', async () => {
  const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ balance: '98190.0' }));
  const op = createEscrowOperator({ opsBaseUrl: BASE, opsSecret: SECRET, fetchImpl });

  const bal = await op.balance();

  assert.equal(bal, '98190.0');
  assert.equal(calls[0].url, `${BASE}/ops/escrow/balance`);
  assert.equal(calls[0].opts.headers.Authorization, `Bearer ${SECRET}`);
});

test('refund() POSTs the amount with the bearer token and returns txHash', async () => {
  const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ txHash: '0xrefundhash' }));
  const op = createEscrowOperator({ opsBaseUrl: BASE, opsSecret: SECRET, fetchImpl });

  const hash = await op.refund(5);

  assert.equal(hash, '0xrefundhash');
  assert.equal(calls[0].url, `${BASE}/ops/escrow/refund`);
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.Authorization, `Bearer ${SECRET}`);
  assert.deepEqual(JSON.parse(calls[0].opts.body), { amountUsdc: 5 });
});

test('balance() throws on a non-OK response', async () => {
  const { fetchImpl } = fakeFetch(() => jsonResponse({}, false, 502));
  const op = createEscrowOperator({ opsBaseUrl: BASE, opsSecret: SECRET, fetchImpl });
  await assert.rejects(() => op.balance(), /HTTP 502/);
});

test('refund() throws when the backend returns no txHash', async () => {
  const { fetchImpl } = fakeFetch(() => jsonResponse({}));
  const op = createEscrowOperator({ opsBaseUrl: BASE, opsSecret: SECRET, fetchImpl });
  await assert.rejects(() => op.refund(5), /no txHash/);
});

test('a trailing slash on the base URL is normalized', async () => {
  const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ balance: '1.0' }));
  const op = createEscrowOperator({ opsBaseUrl: `${BASE}/`, opsSecret: SECRET, fetchImpl });
  await op.balance();
  assert.equal(calls[0].url, `${BASE}/ops/escrow/balance`);
});
