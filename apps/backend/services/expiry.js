// Order expiry (Issue #11) — cancels orders that never got paid.
//
// A pending_payment order older than the TTL is transitioned to 'expired' and
// the user is notified. Transitions go through the same compare-and-set the
// webhook uses, so an expiry that races a late payment loses cleanly.

const { ORDER_STATUS, messageForStatus } = require('../domain/orderStatus');

/**
 * Expire stale pending orders once.
 * @param {object} deps
 * @param {object} deps.orders   { findStalePending(cutoffIso), tryTransition }
 * @param {object} deps.notifier { notify(chatId, text) }
 * @param {number} deps.ttlMinutes
 * @param {() => number} [deps.now] injectable clock (ms)
 * @param {object} [deps.logger]
 * @returns {Promise<number>} how many orders were expired
 */
async function runExpiry({ orders, notifier, ttlMinutes, now = Date.now, logger = console }) {
  const cutoffIso = new Date(now() - ttlMinutes * 60_000).toISOString();
  const stale = await orders.findStalePending(cutoffIso);

  let expired = 0;
  for (const order of stale) {
    const applied = await orders.tryTransition(
      order.id,
      ORDER_STATUS.PENDING_PAYMENT,
      ORDER_STATUS.EXPIRED
    );
    if (!applied) continue; // a concurrent payment won the race
    expired += 1;
    try {
      await notifier.notify(order.user.telegramId, messageForStatus(ORDER_STATUS.EXPIRED));
    } catch (err) {
      logger.error(`[expiry] notify failed for order ${order.id}: ${err.message}`);
    }
  }
  if (expired > 0) logger.info(`[expiry] expired ${expired} stale order(s)`);
  return expired;
}

/**
 * A periodic sweeper around runExpiry. Call start()/stop().
 */
function createExpirySweeper({ orders, notifier, ttlMinutes = 30, intervalMs = 60_000, logger = console }) {
  let timer = null;
  async function tick() {
    try {
      await runExpiry({ orders, notifier, ttlMinutes, logger });
    } catch (err) {
      logger.error(`[expiry] sweep error: ${err.message}`);
    }
  }
  return {
    start() {
      if (!timer) {
        timer = setInterval(tick, intervalMs);
        if (timer.unref) timer.unref(); // don't keep the process alive
      }
      return this;
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      return this;
    },
    tick, // exposed for tests
  };
}

module.exports = { runExpiry, createExpirySweeper };
