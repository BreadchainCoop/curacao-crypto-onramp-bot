// Reusable inline keyboards — one definition per action, shared across the flows
// so button labels and callback_data stay consistent. Each returns a `reply_markup`
// value: pass as `ctx.reply(text, { reply_markup: kb.buy() })`.

/** Primary CTA: start (or restart) a purchase. */
function buy() {
  return { inline_keyboard: [[{ text: '🪙 Buy USDC', callback_data: 'start_buy' }]] };
}

/** Full menu for /start, /help, /status: Buy (primary) + Status + Help. */
function menu() {
  return {
    inline_keyboard: [
      [{ text: '🪙 Buy USDC', callback_data: 'start_buy' }],
      [
        { text: '📊 Status', callback_data: 'show_status' },
        { text: '❓ Help', callback_data: 'show_help' },
      ],
    ],
  };
}

/** Shown under a price quote: confirm to get a payment link, or cancel. */
function confirmCancel() {
  return {
    inline_keyboard: [
      [
        { text: '✅ Confirm', callback_data: 'confirm_order' },
        { text: '✖️ Cancel', callback_data: 'cancel_order' },
      ],
    ],
  };
}

/** Shown to a returning user with a known payout address: keep it, or change it. */
function useOrChangeWallet() {
  return {
    inline_keyboard: [
      [
        { text: '✅ Use this address', callback_data: 'use_wallet' },
        { text: '✏️ Change', callback_data: 'change_wallet' },
      ],
    ],
  };
}

/** A URL button that opens the Sentoo payment page directly. */
function pay(url) {
  return { inline_keyboard: [[{ text: '💳 Pay now', url }]] };
}

/** Offer to auto-create a wallet (Privy) instead of pasting an address. */
function createWallet() {
  return { inline_keyboard: [[{ text: '✨ Create a wallet for me', callback_data: 'create_wallet' }]] };
}

/** Admin-only menu of operator actions. */
function adminMenu() {
  return {
    inline_keyboard: [
      [{ text: '🏦 Escrow balance', callback_data: 'admin_balance' }],
      [{ text: '📋 Recent orders', callback_data: 'admin_orders' }],
      [{ text: '💰 Total fees', callback_data: 'admin_fees' }],
    ],
  };
}

/** Admin-only: confirm or abort a pending refund. */
function refundConfirmCancel() {
  return {
    inline_keyboard: [
      [
        { text: '✅ Confirm refund', callback_data: 'refund_confirm' },
        { text: '✖️ Cancel', callback_data: 'refund_cancel' },
      ],
    ],
  };
}

module.exports = { buy, menu, adminMenu, confirmCancel, pay, createWallet, useOrChangeWallet, refundConfirmCancel };
