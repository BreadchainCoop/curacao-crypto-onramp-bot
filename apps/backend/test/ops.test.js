'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../index');

const OPS_SECRET = 'ops-secret-123';

function silentLogger() {
  return { info() {}, warn() {}, error() {} };
}

async function makeServer({ refundThrows = false } = {}) {
  const calls = [];
  const escrow = {
    async balance() {
      calls.push({ fn: 'balance' });
      return '98190.0';
    },
    async refund(amountUsdc) {
      calls.push({ fn: 'refund', amountUsdc });
      if (refundThrows) throw new Error('signer boom (should not leak)');
      return '0xrefundhash';
    },
    async release() {},
  };
  const app = createApp({ escrow, opsSecret: OPS_SECRET, logger: silentLogger() });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { server, port: server.address().port, calls };
}

function opsFetch(port, path, { token = OPS_SECRET, method = 'GET', body } = {}) {
  const headers = {};
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  return fetch(`http://127.0.0.1:${port}/ops${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

test('ops routes reject a missing or wrong bearer token', async () => {
  const { server, port, calls } = await makeServer();
  const noToken = await opsFetch(port, '/escrow/balance', { token: null });
  assert.equal(noToken.status, 401);
  const wrong = await opsFetch(port, '/escrow/balance', { token: 'nope' });
  assert.equal(wrong.status, 401);
  assert.equal(calls.length, 0); // never reached the escrow
  server.close();
});

test('GET /ops/escrow/balance returns the escrow balance', async () => {
  const { server, port } = await makeServer();
  const res = await opsFetch(port, '/escrow/balance');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { balance: '98190.0' });
  server.close();
});

test('POST /ops/escrow/refund signs and returns the tx hash', async () => {
  const { server, port, calls } = await makeServer();
  const res = await opsFetch(port, '/escrow/refund', { method: 'POST', body: { amountUsdc: 5 } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { txHash: '0xrefundhash' });
  assert.deepEqual(calls.at(-1), { fn: 'refund', amountUsdc: 5 });
  server.close();
});

test('POST /ops/escrow/refund rejects a non-positive amount without signing', async () => {
  const { server, port, calls } = await makeServer();
  const res = await opsFetch(port, '/escrow/refund', { method: 'POST', body: { amountUsdc: 0 } });
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
  server.close();
});

test('POST /ops/escrow/refund does not leak the signer error', async () => {
  const { server, port } = await makeServer({ refundThrows: true });
  const res = await opsFetch(port, '/escrow/refund', { method: 'POST', body: { amountUsdc: 5 } });
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error, 'refund failed');
  assert.ok(!JSON.stringify(body).includes('boom'));
  server.close();
});

test('ops routes are not mounted without an opsSecret', async () => {
  const app = createApp({ escrow: { async balance() {}, async refund() {} }, logger: silentLogger() });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/ops/escrow/balance`, {
    headers: { Authorization: 'Bearer anything' },
  });
  assert.equal(res.status, 404);
  server.close();
});
