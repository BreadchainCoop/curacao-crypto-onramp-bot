const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ORDER_STATUS,
  canTransition,
  isTerminal,
  messageForStatus,
} = require('../domain/orderStatus');

test('allows the happy-path transitions', () => {
  assert.ok(canTransition('pending_payment', 'paid'));
  assert.ok(canTransition('pending_payment', 'failed')); // Sentoo-reported payment failure
  assert.ok(canTransition('paid', 'releasing'));
  assert.ok(canTransition('releasing', 'complete'));
  assert.ok(canTransition('pending_payment', 'expired'));
  assert.ok(canTransition('paid', 'failed'));
  assert.ok(canTransition('releasing', 'failed'));
  assert.ok(canTransition('failed', 'refunded'));
});

test('rejects illegal transitions', () => {
  assert.equal(canTransition('pending_payment', 'complete'), false);
  assert.equal(canTransition('complete', 'paid'), false);
  assert.equal(canTransition('expired', 'paid'), false);
  assert.equal(canTransition('paid', 'expired'), false);
  assert.equal(canTransition('unknown', 'paid'), false);
});

test('marks terminal states', () => {
  assert.ok(isTerminal('complete'));
  assert.ok(isTerminal('expired'));
  assert.ok(isTerminal('refunded'));
  assert.equal(isTerminal('pending_payment'), false);
  assert.equal(isTerminal('releasing'), false);
});

test('produces user messages only for notifiable states', () => {
  assert.match(messageForStatus(ORDER_STATUS.PAID), /received/i);
  assert.match(
    messageForStatus(ORDER_STATUS.COMPLETE, { amountUsdc: 100, txHash: '0xabc' }),
    /100 USDC.*0xabc/s
  );
  assert.match(messageForStatus(ORDER_STATUS.FAILED), /problem|notified/i);
  assert.match(messageForStatus(ORDER_STATUS.EXPIRED), /expired/i);
  // No message for intermediate / non-notifiable states.
  assert.equal(messageForStatus(ORDER_STATUS.RELEASING), null);
  assert.equal(messageForStatus(ORDER_STATUS.PENDING_PAYMENT), null);
});
