const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../index');
const { InMemoryUsersRepository } = require('../services/users');

const SECRET = 'synaps-webhook-secret';

async function makeServer() {
  const users = new InMemoryUsersRepository([
    { id: 'u1', telegramId: 7, kycStatus: 'pending', kycSessionId: 'sess_1' },
  ]);
  const app = createApp({
    users,
    kycWebhookSecret: SECRET,
    logger: { info() {}, warn() {}, error() {} },
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return { server, port: server.address().port, users };
}

async function postKyc(port, { secret = SECRET, body = { session_id: 'sess_1', status: 'APPROVED' } } = {}) {
  const qs = secret === null ? '' : `?secret=${encodeURIComponent(secret)}`;
  return fetch(`http://127.0.0.1:${port}/webhook/kyc${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('rejects a webhook with a wrong secret', async () => {
  const { server, port, users } = await makeServer();
  const res = await postKyc(port, { secret: 'nope' });
  assert.equal(res.status, 401);
  assert.equal((await users.getByKycSessionId('sess_1')).kycStatus, 'pending'); // untouched
  server.close();
});

test('APPROVED flips the user to approved', async () => {
  const { server, port, users } = await makeServer();
  const res = await postKyc(port, { body: { session_id: 'sess_1', status: 'APPROVED' } });
  assert.equal(res.status, 200);
  assert.equal((await users.getByKycSessionId('sess_1')).kycStatus, 'approved');
  server.close();
});

test('REJECTED flips the user to rejected', async () => {
  const { server, port, users } = await makeServer();
  await postKyc(port, { body: { session_id: 'sess_1', status: 'REJECTED' } });
  assert.equal((await users.getByKycSessionId('sess_1')).kycStatus, 'rejected');
  server.close();
});

test('a non-terminal status leaves the user pending', async () => {
  const { server, port, users } = await makeServer();
  const res = await postKyc(port, { body: { session_id: 'sess_1', status: 'PENDING_VERIFICATION' } });
  assert.equal(res.status, 200);
  assert.equal((await users.getByKycSessionId('sess_1')).kycStatus, 'pending');
  server.close();
});

test('missing fields are rejected with 400', async () => {
  const { server, port } = await makeServer();
  const res = await postKyc(port, { body: { status: 'APPROVED' } });
  assert.equal(res.status, 400);
  server.close();
});

test('an unknown session is acked without error', async () => {
  const { server, port } = await makeServer();
  const res = await postKyc(port, { body: { session_id: 'sess_unknown', status: 'APPROVED' } });
  assert.equal(res.status, 200);
  server.close();
});
