'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../index');

async function withServer(deps, fn) {
  const app = createApp({ logger: { info() {}, warn() {}, error() {} }, ...deps });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    await fn(server.address().port);
  } finally {
    server.close();
  }
}

test('/return 302-redirects to the Telegram bot', async () => {
  await withServer({ telegramReturnUrl: 'https://t.me/Cura_ramp_bot' }, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/return`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), 'https://t.me/Cura_ramp_bot');
  });
});

test('/return/<status> (Sentoo appends a segment) still redirects to the bot', async () => {
  await withServer({ telegramReturnUrl: 'https://t.me/Cura_ramp_bot' }, async (port) => {
    for (const suffix of ['success', 'failed', 'cancelled']) {
      const r = await fetch(`http://127.0.0.1:${port}/return/${suffix}?x=1`, { redirect: 'manual' });
      assert.equal(r.status, 302, `/.../${suffix} should redirect`);
      assert.equal(r.headers.get('location'), 'https://t.me/Cura_ramp_bot');
    }
  });
});

test('/return falls back to the default bot URL when none is injected', async () => {
  await withServer({}, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/return/success`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), 'https://t.me/Cura_ramp_bot');
  });
});
