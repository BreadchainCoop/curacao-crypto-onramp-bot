// Operator services for the bot's admin commands (Issue #10).
//
// NOTE: this duplicates a little of backend/services (escrow + orders) because the
// bot and backend are separate processes. TODO: extract a shared package so the
// contract/DB wiring lives in one place.

// ─── Escrow operator (balance + refund) ─────────────────
const ESCROW_OPERATOR_ABI = [
  'function balance() view returns (uint256)',
  'function refund(uint256 amount)',
];
const USDC_DECIMALS = 6;

function createEscrowOperator({ rpcUrl, privateKey, contractAddress, ethers }) {
  if (!rpcUrl || !privateKey || !contractAddress) {
    throw new Error('Escrow operator requires rpcUrl, privateKey, and contractAddress');
  }
  const lib = ethers ?? require('ethers');
  const provider = new lib.JsonRpcProvider(rpcUrl);
  const wallet = new lib.Wallet(privateKey, provider);
  const contract = new lib.Contract(contractAddress, ESCROW_OPERATOR_ABI, wallet);

  return {
    async balance() {
      const raw = await contract.balance();
      return lib.formatUnits(raw, USDC_DECIMALS);
    },
    async refund(amountUsdc) {
      const tx = await contract.refund(lib.parseUnits(String(amountUsdc), USDC_DECIMALS));
      const receipt = await tx.wait();
      return (receipt && receipt.hash) || tx.hash;
    },
  };
}

function escrowOperatorFromEnv(env = process.env) {
  const { activeChain } = require('../../chains');
  const chain = activeChain(env);
  return createEscrowOperator({
    rpcUrl: chain.rpcUrl,
    privateKey: chain.privateKey,
    contractAddress: chain.escrowAddress,
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

  async markRefunded(id) {
    const { data, error } = await this.client
      .from('orders')
      .update({ status: 'refunded' })
      .eq('id', id)
      .select('id');
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
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
