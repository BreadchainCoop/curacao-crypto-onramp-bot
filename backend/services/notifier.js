// Telegram notifier — sends a message to a user via the Bot API.
// Used by the webhook server to confirm a completed order out-of-band from the
// bot process. Reads TELEGRAM_BOT_TOKEN from env.

/**
 * @param {object} opts
 * @param {string} opts.botToken
 * @param {typeof fetch} [opts.fetchImpl] injectable for tests.
 */
function createTelegramNotifier({ botToken, fetchImpl = fetch }) {
  if (!botToken) {
    throw new Error('Telegram notifier requires botToken');
  }

  async function notify(chatId, text) {
    const resp = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!resp.ok) {
      throw new Error(`Telegram notify failed: HTTP ${resp.status}`);
    }
    return true;
  }

  return { notify };
}

function notifierFromEnv(env = process.env) {
  return createTelegramNotifier({ botToken: env.TELEGRAM_BOT_TOKEN });
}

module.exports = { createTelegramNotifier, notifierFromEnv };
