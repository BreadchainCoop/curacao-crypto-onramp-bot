// Order state machine (Issue #11) — the single source of truth for order
// statuses, the legal transitions between them, and the user-facing message for
// each state change.
//
//   pending_payment ──▶ paid ──▶ releasing ──▶ complete
//        │                │           │
//        │                └──────────▶└──▶ failed ──▶ refunded
//        └──▶ expired

const ORDER_STATUS = Object.freeze({
  PENDING_PAYMENT: 'pending_payment',
  PAID: 'paid',
  RELEASING: 'releasing',
  COMPLETE: 'complete',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  EXPIRED: 'expired',
});

// Legal transitions: from-status -> allowed to-statuses.
const TRANSITIONS = Object.freeze({
  pending_payment: ['paid', 'expired'],
  paid: ['releasing', 'failed'],
  releasing: ['complete', 'failed'],
  complete: [],
  failed: ['refunded'],
  refunded: [],
  expired: [],
});

// States from which nothing further happens.
const TERMINAL = new Set(['complete', 'refunded', 'expired']);

/** True if `from -> to` is a legal transition. */
function canTransition(from, to) {
  const allowed = TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

function isTerminal(status) {
  return TERMINAL.has(status);
}

/**
 * The message to send the user when an order reaches `status`, or null if that
 * state has no user-facing notification.
 * @param {string} status
 * @param {{amountUsdc?: number, txHash?: string}} [ctx]
 */
function messageForStatus(status, ctx = {}) {
  switch (status) {
    case ORDER_STATUS.PAID:
      return '💸 Payment received — releasing your USDC now…';
    case ORDER_STATUS.COMPLETE:
      return `✅ ${ctx.amountUsdc} USDC sent to your wallet.\nTransaction: ${ctx.txHash}`;
    case ORDER_STATUS.FAILED:
      return '⚠️ We hit a problem releasing your USDC. Our team has been notified and will sort it out.';
    case ORDER_STATUS.EXPIRED:
      return '⌛ Your order expired because we didn’t receive payment in time. Send /buy to start again.';
    default:
      return null;
  }
}

module.exports = { ORDER_STATUS, TRANSITIONS, TERMINAL, canTransition, isTerminal, messageForStatus };
