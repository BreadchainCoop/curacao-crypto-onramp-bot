const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../index');
const { InMemoryUsersRepository } = require('../services/users');

test('webhook endpoints are rate limited (429 after the cap)', async () => {
  const app = createApp({
    users: new InMemoryUsersRepository([]),
    kycWebhookSecret: 'secret',
    rateLimit: { windowMs: 60_000, max: 2 },
    logger: { info() {}, warn() {}, error() {} },
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;

  // Wrong secret -> 401, but the request still counts against the limiter.
  const hit = () =>
    fetch(`http://127.0.0.1:${port}/webhook/kyc?secret=wrong`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 's', status: 'APPROVED' }),
    });

  const r1 = await hit();
  const r2 = await hit();
  const r3 = await hit();

  assert.equal(r1.status, 401);
  assert.equal(r2.status, 401);
  assert.equal(r3.status, 429); // limiter kicks in past the cap
  server.close();
});
