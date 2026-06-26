// Operator-only commands (Issue #10), gated on ADMIN_TELEGRAM_ID.
//
// Commands are silently ignored for anyone who isn't the admin. /refund requires
// an explicit confirmation step before it touches the contract.
//
// Injected deps (so the logic is testable without a contract or DB):
//   escrow: { balance() -> string USDC, refund(amountUsdc) -> txHash }
//   orders: { listRecent(limit) -> [{id,status,amountUsdc,amountXcg,createdAt}],
//             getById(id) -> order|null, markRefunded(id) -> boolean }

function isAdmin(ctx, adminId) {
  return adminId != null && ctx.from != null && String(ctx.from.id) === String(adminId);
}

function createAdminHandlers({ adminId, escrow, orders, logger = console }) {
  // Wrap a handler so non-admins are silently ignored (no reply at all).
  const guard = (handler) => async (ctx) => {
    if (!isAdmin(ctx, adminId)) return;
    return handler(ctx);
  };

  const escrowBalance = guard(async (ctx) => {
    try {
      const bal = await escrow.balance();
      await ctx.reply(`🏦 Escrow balance: ${bal} USDC`);
    } catch (err) {
      logger.error(`[admin] balance failed: ${err.message}`);
      await ctx.reply(`Could not read escrow balance: ${err.message}`);
    }
  });

  const listOrders = guard(async (ctx) => {
    const rows = await orders.listRecent(10);
    if (!rows.length) {
      await ctx.reply('No orders yet.');
      return;
    }
    const lines = rows.map(
      (o) => `${o.id.slice(0, 8)} · ${o.amountUsdc} USDC · ${o.status}`
    );
    await ctx.reply('Last 10 orders:\n' + lines.join('\n'));
  });

  const refundStart = guard(async (ctx) => {
    const orderId = String(ctx.match || '').trim();
    if (!orderId) {
      await ctx.reply('Usage: /refund <order_id>');
      return;
    }
    const order = await orders.getById(orderId);
    if (!order) {
      await ctx.reply(`Order ${orderId} not found.`);
      return;
    }
    ctx.session.adminRefund = { orderId: order.id, amountUsdc: order.amountUsdc };
    await ctx.reply(
      `⚠️ Refund order ${order.id} for ${order.amountUsdc} USDC? (status: ${order.status})\n` +
        'Send /refund_confirm to execute, or /refund_cancel to abort.'
    );
  });

  const refundConfirm = guard(async (ctx) => {
    const pending = ctx.session.adminRefund;
    if (!pending) {
      await ctx.reply('No refund pending. Start with /refund <order_id>.');
      return;
    }
    ctx.session.adminRefund = null; // consume the confirmation
    try {
      const txHash = await escrow.refund(pending.amountUsdc);
      try {
        await orders.markRefunded(pending.orderId);
      } catch (dbErr) {
        logger.error(`[admin] order ${pending.orderId} refunded on-chain but DB update failed: ${dbErr.message}`);
      }
      await ctx.reply(
        `✅ Refunded ${pending.amountUsdc} USDC for order ${pending.orderId}.\nTransaction: ${txHash}`
      );
    } catch (err) {
      logger.error(`[admin] refund failed for order ${pending.orderId}: ${err.message}`);
      await ctx.reply(`❌ Refund failed: ${err.message}`);
    }
  });

  const refundCancel = guard(async (ctx) => {
    ctx.session.adminRefund = null;
    await ctx.reply('Refund cancelled.');
  });

  return { escrowBalance, listOrders, refundStart, refundConfirm, refundCancel };
}

module.exports = { createAdminHandlers, isAdmin };
