// Orders repository — data access for the orders table (#3 schema).
//
// Interface (both implementations below satisfy it):
//   getBySentooTxId(txId) -> order | null
//   tryTransition(orderId, fromStatus, toStatus) -> boolean
//
// `tryTransition` is a compare-and-set: it only applies if the order is still in
// `fromStatus`, returning whether it changed anything. This gives the webhook
// handler idempotency without locks — a duplicate webhook loses the CAS race.
//
// order shape:
//   { id, status, amountUsdc, amountXcg,
//     user: { telegramId, walletAddress } }

class InMemoryOrdersRepository {
  /** @param {Array} orders seed rows (each with a `sentooTransactionId`). */
  constructor(orders = []) {
    this.byId = new Map(orders.map((o) => [o.id, o]));
    this.byTx = new Map(
      orders.filter((o) => o.sentooTransactionId).map((o) => [o.sentooTransactionId, o.id])
    );
  }

  async getBySentooTxId(txId) {
    const id = this.byTx.get(txId);
    return id ? this.byId.get(id) : null;
  }

  async tryTransition(orderId, fromStatus, toStatus) {
    const order = this.byId.get(orderId);
    if (!order || order.status !== fromStatus) return false;
    order.status = toStatus;
    return true;
  }
}

class SupabaseOrdersRepository {
  constructor(client) {
    this.client = client;
  }

  async getBySentooTxId(txId) {
    const { data, error } = await this.client
      .from('orders')
      .select('id, status, amount_usdc, amount_xcg, user:users(telegram_id, wallet_address)')
      .eq('sentoo_transaction_id', txId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      status: data.status,
      amountUsdc: Number(data.amount_usdc),
      amountXcg: Number(data.amount_xcg),
      user: {
        telegramId: data.user && data.user.telegram_id,
        walletAddress: data.user && data.user.wallet_address,
      },
    };
  }

  async tryTransition(orderId, fromStatus, toStatus) {
    // Conditional update: only rows still in `fromStatus` are changed.
    const { data, error } = await this.client
      .from('orders')
      .update({ status: toStatus })
      .eq('id', orderId)
      .eq('status', fromStatus)
      .select('id');
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  }
}

function ordersFromEnv(env = process.env) {
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  return new SupabaseOrdersRepository(client);
}

module.exports = { InMemoryOrdersRepository, SupabaseOrdersRepository, ordersFromEnv };
