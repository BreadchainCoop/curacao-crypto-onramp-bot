// POST /webhook/kyc
// Receives Synaps KYC result, updates user KYC status in DB
//
// Synaps authenticates the webhook with a `?secret=` query param (compared to
// SYNAPS_WEBHOOK_SECRET) and the payload carries no PII — only session_id +
// status. We map status -> users.kyc_status and never fetch/log document data.

const express = require('express');
const crypto = require('crypto');
const { mapWebhookStatus } = require('../services/synaps');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * @param {object} deps
 * @param {object} deps.users         { getByKycSessionId, setKycStatusBySessionId }
 * @param {string|null} [deps.webhookSecret]
 * @param {object} [deps.logger]
 */
function createKycWebhookRouter({ users, webhookSecret = null, logger = console }) {
  const router = express.Router();

  router.post('/', express.json(), async (req, res) => {
    if (webhookSecret && !safeEqual(req.query.secret ?? '', webhookSecret)) {
      return res.status(401).json({ error: 'invalid secret' });
    }

    const sessionId = req.body && req.body.session_id;
    const status = req.body && req.body.status;
    if (!sessionId || !status) {
      return res.status(400).json({ error: 'missing session_id or status' });
    }

    const mapped = mapWebhookStatus(status);
    // Only session_id + status are logged — both non-PII.
    if (!mapped) {
      logger.info(`[kyc] session ${sessionId} status=${status} (non-terminal)`);
      return res.status(200).json({ ok: true });
    }

    try {
      const updated = await users.setKycStatusBySessionId(sessionId, mapped);
      if (!updated) {
        logger.warn(`[kyc] no user for session ${sessionId}`);
      } else {
        logger.info(`[kyc] session ${sessionId} -> ${mapped}`);
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      logger.error(`[kyc] error for session ${sessionId}: ${err.message}`);
      return res.status(500).json({ error: 'internal error' });
    }
  });

  return router;
}

module.exports = { createKycWebhookRouter };
