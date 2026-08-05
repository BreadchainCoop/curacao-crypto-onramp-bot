// Operator-only commands (Issue #10), gated on ADMIN_TELEGRAM_ID.
//
// Commands are silently ignored for anyone who isn't the admin. /refund requires
// an explicit confirmation step before it touches the contract.
//
// Injected deps (so the logic is testable without a contract or DB):
//   escrow: { balance() -> string USDC, refund(amountUsdc) -> txHash }
//   orders: { listRecent(limit) -> [{id,status,amountUsdc,amountXcg,createdAt}],
//             getById(id) -> order|null, markRefunded(id) -> boolean }

const kb = require('../lib/keyboards');

function isAdmin(ctx, adminId) {
  return adminId != null && ctx.from != null && String(ctx.from.id) === String(adminId);
}

/** Format an ISO timestamp as "YYYY-MM-DD HH:MM UTC" (stable, timezone-explicit). */
function formatDate(iso) {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function createAdminHandlers({ adminId, escrow, orders, chain = null, logger = console }) {
  // Wrap a handler so non-admins are silently ignored (no reply at all).
  const guard = (handler) => async (ctx) => {
    if (!isAdmin(ctx, adminId)) return;
    return handler(ctx);
  };

  const showMenu = guard(async (ctx) => {
    await ctx.reply('🛠 Admin menu — pick an action:', { reply_markup: kb.adminMenu() });
  });

  const escrowBalance = guard(async (ctx) => {
    try {
      const bal = await escrow.balance();
      const net = chain ? ` on ${chain.name}` : '';
      const link = chain && chain.explorer && chain.escrowAddress
        ? `\n${chain.explorer}/address/${chain.escrowAddress}`
        : '';
      await ctx.reply(`🏦 Escrow balance${net}: ${bal} USDC${link}`);
    } catch (err) {
      logger.error(`[admin] balance failed: ${err.message}`);
      await ctx.reply('Could not read the escrow balance right now. Please try again.');
    }
  });

  const listOrders = guard(async (ctx) => {
    const rows = await orders.listRecent(10);
    if (!rows.length) {
      await ctx.reply('No orders yet.');
      return;
    }
    const lines = rows.map(
      (o) =>
        `${o.id.slice(0, 8)} · ${o.amountUsdc} USDC · ${o.status}\n` +
        `   🕒 ${formatDate(o.createdAt)}`
    );
    await ctx.reply('Last 10 orders:\n' + lines.join('\n'));
  });

  const totalFees = guard(async (ctx) => {
    try {
      const { feeXcg, spreadXcg, count } = await orders.totalFees();
      await ctx.reply(
        `💰 Fees accrued across ${count} paid order(s):\n` +
          `• Platform fees: ${feeXcg.toFixed(2)} XCG\n` +
          `• FX spread: ${spreadXcg.toFixed(2)} XCG\n` +
          `• <b>Combined: ${(feeXcg + spreadXcg).toFixed(2)} XCG</b>`,
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      logger.error(`[admin] total fees failed: ${err.message}`);
      await ctx.reply('Could not compute total fees right now. Please try again.');
    }
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
    // Only a failed order can be refunded (one-shot, failed → refunded).
    if (order.status !== 'failed') {
      await ctx.reply(`Only failed orders can be refunded — order ${order.id} is currently "${order.status}".`);
      return;
    }
    ctx.session.adminRefund = { orderId: order.id, amountUsdc: order.amountUsdc };
    await ctx.reply(
      `⚠️ Refund order ${order.id} for ${order.amountUsdc} USDC? (status: ${order.status})`,
      { reply_markup: kb.refundConfirmCancel() }
    );
  });

  const refundConfirm = guard(async (ctx) => {
    const pending = ctx.session.adminRefund;
    if (!pending) {
      await ctx.reply('No refund pending. Start with /refund <order_id>.');
      return;
    }
    ctx.session.adminRefund = null; // consume the confirmation

    // Compare-and-set the DB transition (failed → refunded) BEFORE the on-chain
    // call. If the CAS doesn't claim the order, never touch the escrow — this is
    // what stops a repeated/any-status refund from draining the pool.
    let claimed;
    try {
      claimed = await orders.claimRefund(pending.orderId);
    } catch (dbErr) {
      logger.error(`[admin] refund claim DB error for ${pending.orderId}: ${dbErr.message}`);
      await ctx.reply('❌ Could not process the refund right now. Please try again.');
      return;
    }
    if (!claimed) {
      await ctx.reply("❌ This order can't be refunded — only a failed order that hasn't already been refunded can be.");
      return;
    }

    try {
      const txHash = await escrow.refund(pending.amountUsdc);
      await ctx.reply(`✅ Refunded ${pending.amountUsdc} USDC for order ${pending.orderId}.\nTx: ${txHash}`);
    } catch (err) {
      logger.error(`[admin] on-chain refund failed for ${pending.orderId}: ${err.message}`);
      try {
        await orders.revertRefund(pending.orderId);
      } catch (revErr) {
        logger.error(`[admin] refund revert failed for ${pending.orderId}: ${revErr.message}`);
      }
      await ctx.reply("❌ Refund couldn't be completed on-chain — reverted. Please try again.");
    }
  });

  const refundCancel = guard(async (ctx) => {
    ctx.session.adminRefund = null;
    await ctx.reply('Refund cancelled.');
  });

  return { showMenu, escrowBalance, listOrders, totalFees, refundStart, refundConfirm, refundCancel };
}

module.exports = { createAdminHandlers, isAdmin };
