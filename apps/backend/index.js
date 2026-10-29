// Express webhook server entry point
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const express = require('express');
const rateLimit = require('express-rate-limit');
const { createSentooWebhookRouter } = require('./routes/sentoo');
const { createKycWebhookRouter } = require('./routes/kyc');
const { createOpsRouter } = require('./routes/ops');

/**
 * Build the Express app from injected dependencies. Pure — no env access, no
 * listening — so it is easy to test with fakes.
 */
function createApp(deps = {}) {
  const app = express();
  // Behind Railway's proxy; trust one hop so rate limiting keys on the real IP.
  app.set('trust proxy', 1);
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Post-payment landing. Sentoo appends a status segment to the configured
  // return URL (e.g. .../return/success), which breaks a bare Telegram deep link
  // (https://t.me/<bot>/success is an invalid username). So Sentoo points here
  // and we send the buyer back into the Telegram bot regardless of the suffix.
  //
  // A plain 302 to https://t.me/<bot> only reaches Telegram's WEB landing page
  // ("Open in Telegram"), not the chat. So we serve a tiny page that opens the
  // app directly via the tg:// deep link, with the https link as a tap fallback.
  const telegramHttpsUrl = deps.telegramReturnUrl || 'https://t.me/Cura_ramp_bot';
  const botUsername = deps.telegramBotUsername || telegramHttpsUrl.split('/').filter(Boolean).pop() || 'Cura_ramp_bot';
  const tgDeepLink = `tg://resolve?domain=${botUsername}`;
  app.get(/^\/return(?:\/.*)?$/, (_req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8').send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>Returning to Telegram…</title>` +
        `<script>location.replace(${JSON.stringify(tgDeepLink)});` +
        `setTimeout(function(){location.href=${JSON.stringify(telegramHttpsUrl)};},1200);</script>` +
        `<meta http-equiv="refresh" content="1;url=${telegramHttpsUrl}">` +
        `</head><body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 20px">` +
        `<p style="font-size:18px">Opening Telegram…</p>` +
        `<p><a href="${telegramHttpsUrl}" style="display:inline-block;padding:14px 22px;` +
        `background:#229ED9;color:#fff;border-radius:10px;text-decoration:none;font-size:16px">` +
        `Return to the bot</a></p></body></html>`
    );
  });

  // Rate-limit the webhook endpoints to blunt abuse/DoS (#13). Generous by
  // default so legitimate provider bursts pass; configurable for tests.
  const limiter = rateLimit({
    windowMs: (deps.rateLimit && deps.rateLimit.windowMs) || 60_000,
    max: (deps.rateLimit && deps.rateLimit.max) || 120,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/webhook', limiter);

  // Operator API for the bot's admin actions (#18). Only mounted when a secret
  // and escrow signer are configured; the bot authenticates with OPS_API_SECRET.
  if (deps.opsSecret && deps.escrow) {
    app.use('/ops', createOpsRouter({ escrow: deps.escrow, opsSecret: deps.opsSecret, logger: deps.logger }));
  }

  app.use('/webhook/sentoo', createSentooWebhookRouter(deps));
  if (deps.users) {
    app.use(
      '/webhook/kyc',
      createKycWebhookRouter({
        users: deps.users,
        webhookSecret: deps.kycWebhookSecret,
        logger: deps.logger,
      })
    );
  }
  return app;
}

function startFromEnv() {
  const { sentooFromEnv } = require('./services/sentoo');
  const { ordersFromEnv } = require('./services/orders');
  const { escrowFromEnv } = require('./services/escrow');
  const { notifierFromEnv } = require('./services/notifier');
  const { usersFromEnv } = require('./services/users');
  const { activeChain } = require('@kambiox/chains');

  const deps = {
    sentoo: sentooFromEnv(),
    orders: ordersFromEnv(),
    escrow: escrowFromEnv(),
    notifier: notifierFromEnv(),
    users: usersFromEnv(),
    telegramReturnUrl: process.env.TELEGRAM_RETURN_URL || 'https://t.me/Cura_ramp_bot',
    telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || null,
    webhookToken: process.env.SENTOO_WEBHOOK_SECRET || null,
    kycWebhookSecret: process.env.SYNAPS_WEBHOOK_SECRET || null,
    opsSecret: process.env.OPS_API_SECRET || null,
    // Receipt link uses the active chain's explorer (falls back to an override).
    explorerTxBase: process.env.EXPLORER_TX_BASE_URL || `${activeChain().explorer}/tx/`,
    rateLimit: {
      windowMs: Number(process.env.WEBHOOK_RATE_WINDOW_MS) || 60_000,
      max: Number(process.env.WEBHOOK_RATE_MAX) || 120,
    },
  };

  const app = createApp(deps);
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`Webhook server listening on :${port}`));

  // Expire orders that never got paid (Issue #11).
  const { createExpirySweeper } = require('./services/expiry');
  createExpirySweeper({
    orders: deps.orders,
    notifier: deps.notifier,
    ttlMinutes: Number(process.env.ORDER_TTL_MINUTES) || 30,
    intervalMs: Number(process.env.EXPIRY_SWEEP_MS) || 60_000,
  }).start();
}

module.exports = { createApp };

if (require.main === module) {
  startFromEnv();
}
