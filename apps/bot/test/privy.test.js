const test = require('node:test');
const assert = require('node:assert/strict');
const { createPrivyClient } = require('../services/privy');

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
  return createPrivyClient({
    appId: 'app_1',
    appSecret: 'sec_1',
    baseUrl: 'https://api.privy.test/',
    fetchImpl,
  });
}

test('createWallet posts with Basic auth + privy-app-id and links the external id', async () => {
  const captured = {};
  const c = client(mockFetch({ body: { id: 'w_1', address: '0xWALLET', chain_type: 'ethereum' } }, captured));
  const res = await c.createWallet({ externalId: '42' });

  assert.equal(captured.url, 'https://api.privy.test/v1/wallets');
  assert.equal(captured.init.method, 'POST');
  const expectedAuth = 'Basic ' + Buffer.from('app_1:sec_1').toString('base64');
  assert.equal(captured.init.headers.Authorization, expectedAuth);
  assert.equal(captured.init.headers['privy-app-id'], 'app_1');
  assert.deepEqual(JSON.parse(captured.init.body), { chain_type: 'ethereum', external_id: '42' });

  assert.deepEqual(res, { id: 'w_1', address: '0xWALLET', chainType: 'ethereum' });
});

test('createWallet throws on a non-OK response', async () => {
  const c = client(mockFetch({ ok: false, status: 401, body: {} }, {}));
  await assert.rejects(() => c.createWallet({ externalId: '1' }), /HTTP 401/);
});

test('createWallet throws when no address is returned', async () => {
  const c = client(mockFetch({ body: { id: 'w', chain_type: 'ethereum' } }, {}));
  await assert.rejects(() => c.createWallet({ externalId: '1' }), /no address/);
});

test('the app secret never appears in an error message', async () => {
  const c = client(mockFetch({ ok: false, status: 500, body: {} }, {}));
  await assert.rejects(
    () => c.createWallet({ externalId: '1' }),
    (err) => !/sec_1/.test(err.message)
  );
});

test('createUserWithWallet pregenerates a wallet linked to an email', async () => {
  const captured = {};
  const c = createPrivyClient({
    appId: 'app_1',
    appSecret: 'sec_1',
    authBaseUrl: 'https://auth.privy.test/api',
    fetchImpl: mockFetch(
      {
        body: {
          id: 'did:privy:abc',
          linked_accounts: [
            { type: 'email', address: 'u@e.com' },
            { type: 'wallet', chain_type: 'ethereum', address: '0xPREGEN' },
          ],
        },
      },
      captured
    ),
  });
  const res = await c.createUserWithWallet({ email: 'u@e.com' });

  assert.equal(captured.url, 'https://auth.privy.test/api/v1/users');
  assert.equal(captured.init.headers['privy-app-id'], 'app_1');
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.linked_accounts, [{ type: 'email', address: 'u@e.com' }]);
  assert.equal(body.wallets[0].chain_type, 'ethereum');
  assert.deepEqual(res, { userId: 'did:privy:abc', address: '0xPREGEN' });
});
