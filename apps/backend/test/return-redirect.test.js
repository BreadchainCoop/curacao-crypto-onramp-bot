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

test('/return serves a page that opens the Telegram app (tg://) with an https fallback', async () => {
  await withServer({ telegramReturnUrl: 'https://t.me/Cura_ramp_bot' }, async (port) => {
    const r = await fetch(`http://127.0.0.1:${port}/return`);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /tg:\/\/resolve\?domain=Cura_ramp_bot/); // opens the app at the bot
    assert.match(html, /https:\/\/t\.me\/Cura_ramp_bot/); // web fallback link
  });
});

test('/return/<status> (Sentoo appends a segment) still serves the open-app page', async () => {
  await withServer({ telegramReturnUrl: 'https://t.me/Cura_ramp_bot' }, async (port) => {
    for (const suffix of ['success', 'failed', 'cancelled']) {
      const r = await fetch(`http://127.0.0.1:${port}/return/${suffix}?x=1`);
      assert.equal(r.status, 200, `/.../${suffix} should serve the page`);
      const html = await r.text();
      assert.match(html, /tg:\/\/resolve\?domain=Cura_ramp_bot/);
    }
  });
});

test('bot username is derived from the https return url (or TELEGRAM_BOT_USERNAME)', async () => {
  await withServer({ telegramReturnUrl: 'https://t.me/Some_other_bot' }, async (port) => {
    const html = await (await fetch(`http://127.0.0.1:${port}/return`)).text();
    assert.match(html, /tg:\/\/resolve\?domain=Some_other_bot/);
    assert.match(html, /https:\/\/t\.me\/Some_other_bot/);
  });
  await withServer({ telegramBotUsername: 'Explicit_bot' }, async (port) => {
    const html = await (await fetch(`http://127.0.0.1:${port}/return`)).text();
    assert.match(html, /tg:\/\/resolve\?domain=Explicit_bot/);
  });
});

test('/return falls back to the default bot when nothing is injected', async () => {
  await withServer({}, async (port) => {
    const html = await (await fetch(`http://127.0.0.1:${port}/return/success`)).text();
    assert.match(html, /tg:\/\/resolve\?domain=Cura_ramp_bot/);
  });
});
