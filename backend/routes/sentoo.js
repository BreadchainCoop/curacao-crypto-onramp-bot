// POST /webhook/sentoo
// Verifies Sentoo webhook signature, triggers escrow release on payment success
//
// Sentoo's webhook is a *ping* carrying only `transaction_id`; it is NOT a signed
// payload. We never trust the body — instead we re-fetch the authoritative status
// from the Sentoo API (X-SENTOO-SECRET) and act on that. An optional shared token
// in the webhook URL (?token=…) adds a cheap layer against random POSTs.

const express = require('express');
const crypto = require('crypto');
const { isPaidStatus } = require('../services/sentoo');
const { ORDER_STATUS, messageForStatus } = require('../domain/orderStatus');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Notifications must never break the money flow — a Telegram hiccup is logged,
// not thrown.
async function safeNotify(notifier, logger, chatId, status, ctx) {
  const text = messageForStatus(status, ctx);
  if (!text) return;
  try {
    await notifier.notify(chatId, text);
  } catch (err) {
    logger.error(`[sentoo] notify (${status}) failed for chat ${chatId}: ${err.message}`);
  }
}

/**
 * @param {object} deps
 * @param {object} deps.sentoo    { getTransactionStatus(txId) }
 * @param {object} deps.orders    { getBySentooTxId, tryTransition }
 * @param {object} deps.escrow    { release(recipient, amountUsdc) -> txHash }
 * @param {object} deps.notifier  { notify(chatId, text) }
 * @param {string|null} [deps.webhookToken] optional shared URL token
 * @param {object} [deps.logger]  defaults to console
 */
function createSentooWebhookRouter({ sentoo, orders, escrow, notifier, webhookToken = null, logger = console }) {
  const router = express.Router();

  router.post('/', express.urlencoded({ extended: false }), async (req, res) => {
    // Optional shared-secret token (our own, in the webhook URL) — not a Sentoo HMAC.
    if (webhookToken && !safeEqual(req.query.token ?? '', webhookToken)) {
      return res.status(401).json({ error: 'invalid token' });
    }

    const txId = req.body && req.body.transaction_id;
    if (!txId) {
      return res.status(400).json({ error: 'missing transaction_id' });
    }

    try {
      const order = await orders.getBySentooTxId(txId);
      if (!order) {
        logger.warn(`[sentoo] unknown transaction_id ${txId}`);
        return res.status(200).json({ ok: true }); // ack; nothing to do
      }

      // Trust anchor: re-fetch authoritative status; never trust the webhook body.
      const status = await sentoo.getTransactionStatus(txId);
      if (!isPaidStatus(status)) {
        logger.info(`[sentoo] tx ${txId} status=${status} (not paid) order=${order.id}`);
        return res.status(200).json({ ok: true });
      }

      // Idempotent claim: only one webhook may move pending_payment -> paid.
      const claimed = await orders.tryTransition(
        order.id,
        ORDER_STATUS.PENDING_PAYMENT,
        ORDER_STATUS.PAID
      );
      if (!claimed) {
        logger.info(`[sentoo] order ${order.id} already processed (status=${order.status})`);
        return res.status(200).json({ ok: true });
      }
      await safeNotify(notifier, logger, order.user.telegramId, ORDER_STATUS.PAID);

      await orders.tryTransition(order.id, ORDER_STATUS.PAID, ORDER_STATUS.RELEASING);
      try {
        const txHash = await escrow.release(order.user.walletAddress, order.amountUsdc);
        await orders.tryTransition(order.id, ORDER_STATUS.RELEASING, ORDER_STATUS.COMPLETE);
        await safeNotify(notifier, logger, order.user.telegramId, ORDER_STATUS.COMPLETE, {
          amountUsdc: order.amountUsdc,
          txHash,
        });
        logger.info(`[sentoo] order ${order.id} complete tx=${txHash}`);
      } catch (releaseErr) {
        await orders.tryTransition(order.id, ORDER_STATUS.RELEASING, ORDER_STATUS.FAILED);
        await safeNotify(notifier, logger, order.user.telegramId, ORDER_STATUS.FAILED);
        logger.error(`[sentoo] release failed for order ${order.id}: ${releaseErr.message}`);
        // Operator handles failed orders (#10 refund/retry).
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      // Unexpected (DB/Sentoo) error — return 500 so Sentoo retries later.
      logger.error(`[sentoo] webhook error for tx ${txId}: ${err.message}`);
      return res.status(500).json({ error: 'internal error' });
    }
  });

  return router;
}

module.exports = { createSentooWebhookRouter };
