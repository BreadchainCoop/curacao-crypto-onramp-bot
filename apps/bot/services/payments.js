// Payments service — turns a confirmed quote into a real order + Sentoo payment
// link. On /confirm the bot: upserts the user (with their payout wallet),
// creates a pending_payment order, asks Sentoo for a payment link, and stores
// the Sentoo transaction id on the order so the webhook (#5) can match it back.

const { sentooFromEnv } = require('./sentoo');

// Orders that are committed to draw USDC from the pooled escrow but have not yet
// been released. These are "reserved" against the escrow balance so concurrent
// orders can't oversell the pool. (complete = already released/deducted on-chain;
// failed/refunded/expired = no longer drawing.)
const OUTSTANDING_STATUSES = ['pending_payment', 'paid', 'releasing'];

// Supabase-backed persistence for the payment flow.
class SupabasePaymentsRepo {
  constructor(client) {
    this.client = client;
  }

  /** Sum of USDC committed to still-outstanding orders (pooled-liquidity reserve). */
  async sumOutstandingUsdc() {
    const { data, error } = await this.client
      .from('orders')
      .select('amount_usdc')
      .in('status', OUTSTANDING_STATUSES);
    if (error) throw error;
    return (data || []).reduce((sum, row) => sum + Number(row.amount_usdc), 0);
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

  async createOrder({ userId, amountXcg, amountUsdc, payoutWallet }) {
    const { data, error } = await this.client
      .from('orders')
      .insert({
        user_id: userId,
        amount_xcg: amountXcg,
        amount_usdc: amountUsdc,
        payout_wallet: payoutWallet, // pinned destination — release reads this
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
 * @param {object} deps.repo   { upsertUser, createOrder, setSentooTransaction, sumOutstandingUsdc }
 * @param {object} deps.sentoo { createPayment }
 * @param {() => Promise<number>} [deps.getEscrowBalanceUsdc] read-only escrow balance;
 *   when provided, a fail-closed liquidity pre-check gates every order.
 * @param {number} [deps.reserveBufferUsdc] safety margin kept unreserved (default 0)
 * @param {object} [deps.logger]
 */
function createPaymentsService({ repo, sentoo, getEscrowBalanceUsdc, reserveBufferUsdc = 0, logger = console }) {
  /**
   * Fail-closed liquidity guard. An order is only accepted if the escrow can
   * cover it AFTER reserving every other in-flight order plus a safety buffer.
   * If the balance can't be read, refuse — never take fiat we might not settle.
   * Skipped only when no balance reader is injected (legacy callers / tests).
   * @throws Error with code ESCROW_INSUFFICIENT or ESCROW_CHECK_FAILED
   */
  async function assertEscrowCanCover(usdcAmount) {
    if (!getEscrowBalanceUsdc) {
      logger.warn('[payments] no escrow balance reader wired — liquidity pre-check SKIPPED');
      return;
    }
    let balance;
    let reserved;
    try {
      balance = await getEscrowBalanceUsdc();
      reserved = await repo.sumOutstandingUsdc();
    } catch (err) {
      const e = new Error(`escrow liquidity check failed: ${err.message}`);
      e.code = 'ESCROW_CHECK_FAILED';
      throw e;
    }
    const available = balance - reserved - reserveBufferUsdc;
    if (available < usdcAmount) {
      const e = new Error(
        `insufficient escrow liquidity: need ${usdcAmount}, available ${available.toFixed(2)} ` +
          `(balance ${balance}, reserved ${reserved}, buffer ${reserveBufferUsdc})`
      );
      e.code = 'ESCROW_INSUFFICIENT';
      throw e;
    }
    logger.info(
      `[payments] liquidity ok: need ${usdcAmount}, available ${available.toFixed(2)} ` +
        `(balance ${balance}, reserved ${reserved}, buffer ${reserveBufferUsdc})`
    );
  }

  /**
   * Persist the order and create a Sentoo payment link for it.
   * @returns {Promise<{orderId: string, paymentUrl: string}>}
   */
  async function createForOrder({ usdcAmount, amountXcg, walletAddress, telegramId }) {
    // Gate BEFORE any order row or Sentoo link exists: a failed check leaves no
    // orphan order and the buyer is never charged for USDC we can't deliver.
    await assertEscrowCanCover(usdcAmount);

    const userId = await repo.upsertUser(telegramId, walletAddress);
    const orderId = await repo.createOrder({
      userId,
      amountXcg,
      amountUsdc: usdcAmount,
      payoutWallet: walletAddress, // pin the destination at create time
    });
    const { transactionId, paymentUrl } = await sentoo.createPayment({
      orderId,
      amountXcg,
      // Sentoo truncates the description to ~32 chars and strips diacritics.
      description: `Curacao on-ramp #${String(orderId).slice(0, 8)}`,
    });
    await repo.setSentooTransaction(orderId, transactionId);
    logger.info(`[payments] order ${orderId} -> sentoo tx ${transactionId}`);
    return { orderId, paymentUrl };
  }

  return { createForOrder };
}

function paymentsFromEnv(env = process.env) {
  const { createClient } = require('@supabase/supabase-js');
  const { activeChain } = require('@kambiox/chains');
  const { createEscrowBalanceReader } = require('./escrowBalance');

  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const chain = activeChain(env);
  // Read-only liquidity reader (no key). Only wired when the chain resolves an
  // escrow + RPC; otherwise the pre-check is skipped (with a warning).
  const getEscrowBalanceUsdc =
    chain.escrowAddress && chain.rpcUrl
      ? createEscrowBalanceReader({ rpcUrl: chain.rpcUrl, escrowAddress: chain.escrowAddress })
      : undefined;
  const reserveBufferUsdc = Number(env.ESCROW_RESERVE_BUFFER_USDC || 0);

  return createPaymentsService({
    repo: new SupabasePaymentsRepo(client),
    sentoo: sentooFromEnv(env),
    getEscrowBalanceUsdc,
    reserveBufferUsdc,
  });
}

module.exports = { createPaymentsService, SupabasePaymentsRepo, paymentsFromEnv, OUTSTANDING_STATUSES };
