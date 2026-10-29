// POST /ops/escrow/refund, GET /ops/escrow/balance
//
// Server-to-server operator API for the bot's admin actions. The bot no longer
// holds any chain key (#18 / Unit A2): admin balance/refund call this API, and
// the BACKEND signs the on-chain refund via the escrow signer (Privy operator).
//
// Auth is a shared bearer secret (OPS_API_SECRET), compared in constant time.
// This is NOT a user-facing route — only the bot process calls it.
//
// The refund CAS/ordering invariant (only failed→refunded, DB claim before the
// chain call, revert on chain failure) stays in the BOT (bot/flows/admin.js);
// this endpoint only performs the signed on-chain refund it is asked for.

const express = require('express');
const crypto = require('crypto');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/**
 * @param {object} deps
 * @param {object} deps.escrow      { refund(amountUsdc) -> txHash, balance() -> string }
 * @param {string} deps.opsSecret   shared bearer secret
 * @param {object} [deps.logger]
 */
function createOpsRouter({ escrow, opsSecret, logger = console }) {
  const router = express.Router();

  // Bearer-token gate on every ops route.
  router.use((req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!opsSecret || !safeEqual(token, opsSecret)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    next();
  });

  router.get('/escrow/balance', async (_req, res) => {
    try {
      const balance = await escrow.balance();
      return res.json({ balance });
    } catch (err) {
      logger.error(`[ops] balance failed: ${err.message}`);
      return res.status(502).json({ error: 'balance unavailable' });
    }
  });

  router.post('/escrow/refund', express.json(), async (req, res) => {
    const amountUsdc = req.body && req.body.amountUsdc;
    if (amountUsdc == null || !(Number(amountUsdc) > 0)) {
      return res.status(400).json({ error: 'amountUsdc must be a positive number' });
    }
    try {
      const txHash = await escrow.refund(amountUsdc);
      logger.info(`[ops] refund ${amountUsdc} USDC tx=${txHash}`);
      return res.json({ txHash });
    } catch (err) {
      // Never leak the raw signer/RPC error to the caller.
      logger.error(`[ops] refund failed: ${err.message}`);
      return res.status(502).json({ error: 'refund failed' });
    }
  });

  return router;
}

module.exports = { createOpsRouter };
