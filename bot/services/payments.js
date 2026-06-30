// Payments service — turns a confirmed quote into a real order + Sentoo payment
// link. On /confirm the bot: upserts the user (with their payout wallet),
// creates a pending_payment order, asks Sentoo for a payment link, and stores
// the Sentoo transaction id on the order so the webhook (#5) can match it back.

const { sentooFromEnv } = require('./sentoo');

// Supabase-backed persistence for the payment flow.
class SupabasePaymentsRepo {
  constructor(client) {
    this.client = client;
  }

  /** Insert or update the user by telegram_id, recording their payout wallet. */
  async upsertUser(telegramId, walletAddress) {
    const { data, error } = await this.client
      .from('users')
      .upsert({ telegram_id: telegramId, wallet_address: walletAddress }, { onConflict: 'telegram_id' })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  }

  async createOrder({ userId, amountXcg, amountUsdc }) {
    const { data, error } = await this.client
      .from('orders')
      .insert({
        user_id: userId,
        amount_xcg: amountXcg,
        amount_usdc: amountUsdc,
        status: 'pending_payment',
      })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  }

  async setSentooTransaction(orderId, transactionId) {
    const { error } = await this.client
      .from('orders')
      .update({ sentoo_transaction_id: transactionId })
      .eq('id', orderId);
    if (error) throw error;
  }
}

/**
 * @param {object} deps
 * @param {object} deps.repo   { upsertUser, createOrder, setSentooTransaction }
 * @param {object} deps.sentoo { createPayment }
 * @param {object} [deps.logger]
 */
function createPaymentsService({ repo, sentoo, logger = console }) {
  /**
   * Persist the order and create a Sentoo payment link for it.
   * @returns {Promise<{orderId: string, paymentUrl: string}>}
   */
  async function createForOrder({ usdcAmount, amountXcg, walletAddress, telegramId }) {
    const userId = await repo.upsertUser(telegramId, walletAddress);
    const orderId = await repo.createOrder({ userId, amountXcg, amountUsdc: usdcAmount });
    const { transactionId, paymentUrl } = await sentoo.createPayment({
      orderId,
      amountXcg,
      description: `On-ramp order ${orderId}`,
    });
    await repo.setSentooTransaction(orderId, transactionId);
    logger.info(`[payments] order ${orderId} -> sentoo tx ${transactionId}`);
    return { orderId, paymentUrl };
  }

  return { createForOrder };
}

function paymentsFromEnv(env = process.env) {
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  return createPaymentsService({ repo: new SupabasePaymentsRepo(client), sentoo: sentooFromEnv(env) });
}

module.exports = { createPaymentsService, SupabasePaymentsRepo, paymentsFromEnv };
