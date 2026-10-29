// Operator services for the bot's admin commands (Issue #10, #18).
//
// The bot holds NO chain key (#18 / Unit A2): escrow balance/refund go through
// the backend's authenticated ops API, and the BACKEND signs on-chain via the
// Privy operator wallet. This file is now a thin HTTP client plus the Supabase
// admin orders view (which stays on the bot until #19).

// ─── Escrow operator (balance + refund via backend ops API) ──
function createEscrowOperator({ opsBaseUrl, opsSecret, fetchImpl = fetch }) {
  if (!opsBaseUrl || !opsSecret) {
    throw new Error('Escrow operator requires opsBaseUrl and opsSecret');
  }
  const base = opsBaseUrl.replace(/\/+$/, '');
  const authHeader = { Authorization: `Bearer ${opsSecret}` };

  return {
    async balance() {
      const resp = await fetchImpl(`${base}/ops/escrow/balance`, { headers: authHeader });
      if (!resp.ok) throw new Error(`ops balance failed: HTTP ${resp.status}`);
      const data = await resp.json();
      return data.balance;
    },
    async refund(amountUsdc) {
      const resp = await fetchImpl(`${base}/ops/escrow/refund`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountUsdc }),
      });
      if (!resp.ok) throw new Error(`ops refund failed: HTTP ${resp.status}`);
      const data = await resp.json();
      if (!data.txHash) throw new Error('ops refund returned no txHash');
      return data.txHash;
    },
  };
}

function escrowOperatorFromEnv(env = process.env) {
  return createEscrowOperator({
    opsBaseUrl: env.OPS_API_URL,
    opsSecret: env.OPS_API_SECRET,
  });
}

// ─── Admin orders view ──────────────────────────────────
class SupabaseAdminOrders {
  constructor(client) {
    this.client = client;
  }

  async listRecent(limit = 10) {
    const { data, error } = await this.client
      .from('orders')
      .select('id, status, amount_usdc, amount_xcg, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data || []).map((d) => ({
      id: d.id,
      status: d.status,
      amountUsdc: Number(d.amount_usdc),
      amountXcg: Number(d.amount_xcg),
      createdAt: d.created_at,
    }));
  }

  async getById(id) {
    const { data, error } = await this.client
      .from('orders')
      .select('id, status, amount_usdc')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { id: data.id, status: data.status, amountUsdc: Number(data.amount_usdc) };
  }

  /**
   * Total platform fees (and FX spread) accrued across orders where payment was
   * received (paid / releasing / complete). The per-order fee is reconstructed
   * from the stored total: fee = amount_xcg − subtotal − spread, with
   * subtotal = amount_usdc × peg and spread = subtotal × spreadPct. This stays
   * accurate across fee-percentage changes because amount_xcg recorded the real
   * amount charged; only peg and spread are assumed constant.
   */
  async totalFees() {
    const { loadFxConfig } = require('../lib/fx');
    const { pegRate, spreadPct } = loadFxConfig();
    const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
    const { data, error } = await this.client
      .from('orders')
      .select('amount_usdc, amount_xcg, status')
      .in('status', ['paid', 'releasing', 'complete']);
    if (error) throw error;
    let feeXcg = 0;
    let spreadXcg = 0;
    let count = 0;
    for (const o of data || []) {
      const subtotal = round2(Number(o.amount_usdc) * pegRate);
      const spread = round2(subtotal * (spreadPct / 100));
      const fee = round2(Number(o.amount_xcg) - subtotal - spread);
      feeXcg += Math.max(fee, 0);
      spreadXcg += spread;
      count += 1;
    }
    return { feeXcg: round2(feeXcg), spreadXcg: round2(spreadXcg), count };
  }

  /**
   * Claim an order for refund via a compare-and-set: transition failed → refunded
   * and report whether THIS call made the change. Returns false if the order is
   * not `failed` (e.g. complete, pending, or already refunded), so a refund can
   * never be repeated or applied to a non-failed order.
   */
  async claimRefund(id) {
    const { data, error } = await this.client
      .from('orders')
      .update({ status: 'refunded' })
      .eq('id', id)
      .eq('status', 'failed')
      .select('id');
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  }

  /** Undo a refund claim (refunded → failed) if the on-chain step didn't go through. */
  async revertRefund(id) {
    const { error } = await this.client
      .from('orders')
      .update({ status: 'failed' })
      .eq('id', id)
      .eq('status', 'refunded');
    if (error) throw error;
  }
}

function ordersAdminFromEnv(env = process.env) {
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  return new SupabaseAdminOrders(client);
}

module.exports = {
  createEscrowOperator,
  escrowOperatorFromEnv,
  SupabaseAdminOrders,
  ordersAdminFromEnv,
};
