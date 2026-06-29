// Express webhook server entry point
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const rateLimit = require('express-rate-limit');
const { createSentooWebhookRouter } = require('./routes/sentoo');
const { createKycWebhookRouter } = require('./routes/kyc');

/**
 * Build the Express app from injected dependencies. Pure — no env access, no
 * listening — so it is easy to test with fakes.
 */
function createApp(deps = {}) {
  const app = express();
  // Behind Railway's proxy; trust one hop so rate limiting keys on the real IP.
  app.set('trust proxy', 1);
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Rate-limit the webhook endpoints to blunt abuse/DoS (#13). Generous by
  // default so legitimate provider bursts pass; configurable for tests.
  const limiter = rateLimit({
    windowMs: (deps.rateLimit && deps.rateLimit.windowMs) || 60_000,
    max: (deps.rateLimit && deps.rateLimit.max) || 120,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/webhook', limiter);

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

  const deps = {
    sentoo: sentooFromEnv(),
    orders: ordersFromEnv(),
    escrow: escrowFromEnv(),
    notifier: notifierFromEnv(),
    users: usersFromEnv(),
    webhookToken: process.env.SENTOO_WEBHOOK_SECRET || null,
    kycWebhookSecret: process.env.SYNAPS_WEBHOOK_SECRET || null,
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
