// Express webhook server entry point
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const { createSentooWebhookRouter } = require('./routes/sentoo');

/**
 * Build the Express app from injected dependencies. Pure — no env access, no
 * listening — so it is easy to test with fakes.
 */
function createApp(deps) {
  const app = express();
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/webhook/sentoo', createSentooWebhookRouter(deps));
  // TODO(#8): app.use('/webhook/kyc', createKycWebhookRouter(...))
  return app;
}

function startFromEnv() {
  const { sentooFromEnv } = require('./services/sentoo');
  const { ordersFromEnv } = require('./services/orders');
  const { escrowFromEnv } = require('./services/escrow');
  const { notifierFromEnv } = require('./services/notifier');

  const deps = {
    sentoo: sentooFromEnv(),
    orders: ordersFromEnv(),
    escrow: escrowFromEnv(),
    notifier: notifierFromEnv(),
    webhookToken: process.env.SENTOO_WEBHOOK_SECRET || null,
  };

  const app = createApp(deps);
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`Webhook server listening on :${port}`));
}

module.exports = { createApp };

if (require.main === module) {
  startFromEnv();
}
