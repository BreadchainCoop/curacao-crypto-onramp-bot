const test = require('node:test');
const assert = require('node:assert/strict');
const { createSynapsClient, mapWebhookStatus } = require('../services/synaps');

function mockFetch(response, captured) {
  return async (url, init) => {
    captured.url = url;
    captured.init = init;
    return {
      ok: response.ok !== false,
      status: response.status ?? 200,
      json: async () => response.body,
    };
  };
}

function client(fetchImpl) {
  return createSynapsClient({
    baseUrl: 'https://individual-api.synaps.test/v3/',
    apiKey: 'syn_test',
    verifyUrl: 'https://verify.synaps.test/',
    fetchImpl,
  });
}

test('createSession posts to /session/init with the Api-Key header', async () => {
  const captured = {};
  const c = client(mockFetch({ body: { session_id: 'sess_123', sandbox: true } }, captured));
  const res = await c.createSession({ alias: 'tg-42' });

  assert.equal(captured.url, 'https://individual-api.synaps.test/v3/session/init');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['Api-Key'], 'syn_test');
  assert.deepEqual(JSON.parse(captured.init.body), { alias: 'tg-42' });

  assert.equal(res.sessionId, 'sess_123');
  assert.equal(res.sandbox, true);
  assert.equal(res.verificationUrl, 'https://verify.synaps.test/?session_id=sess_123');
});

test('createSession throws on a non-OK response', async () => {
  const c = client(mockFetch({ ok: false, status: 403, body: {} }, {}));
  await assert.rejects(() => c.createSession({}), /HTTP 403/);
});

test('createSession throws when no session_id comes back', async () => {
  const c = client(mockFetch({ body: { sandbox: false } }, {}));
  await assert.rejects(() => c.createSession({}), /no session_id/);
});

test('mapWebhookStatus maps only terminal states', () => {
  assert.equal(mapWebhookStatus('APPROVED'), 'approved');
  assert.equal(mapWebhookStatus('REJECTED'), 'rejected');
  assert.equal(mapWebhookStatus('PENDING_VERIFICATION'), null);
  assert.equal(mapWebhookStatus('SUBMISSION_REQUIRED'), null);
  assert.equal(mapWebhookStatus('RESET'), null);
});
