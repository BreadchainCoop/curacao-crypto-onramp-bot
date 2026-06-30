// Buy flow — quotes the price, then (eventually) generates a Sentoo payment link.
//
// #2: implements the amount → quote → confirm conversation using the FX logic
// from #9. Payment-link generation and order creation are stubbed.
// TODO(#6): generate a real Sentoo payment link on /confirm.
// TODO(#11): create a real order + drive status transitions.

const crypto = require('crypto');
const { quoteUsdcPurchase, loadFxConfig } = require('../lib/fx');

async function startBuy(ctx) {
  ctx.session.flow = { name: 'buy', step: 'awaiting_amount' };
  await ctx.reply('How much USDC would you like to buy? Reply with an amount, e.g. 50');
}

/** Handle a text message while the buy flow is awaiting an amount. */
async function handleAmount(ctx) {
  const usdc = Number(String(ctx.message.text).trim());
  if (!Number.isFinite(usdc) || usdc <= 0) {
    await ctx.reply('Please send a positive number, e.g. 50');
    return;
  }

  let quote;
  try {
    quote = quoteUsdcPurchase(usdc, loadFxConfig());
  } catch {
    await ctx.reply('That amount is out of range — try a smaller one.');
    return;
  }

  ctx.session.flow = {
    name: 'buy',
    step: 'awaiting_confirm',
    data: { usdcAmount: usdc, totalXcg: quote.totalXcg },
  };
  await ctx.reply(formatQuote(quote), { parse_mode: 'HTML' });
}

/**
 * Confirm the order. With an injected `payments` service, creates a real Sentoo
 * payment link (carrying our internal order id as the reference) and sends it.
 * Without one (no keys configured yet), falls back to a placeholder.
 * @param {object} ctx
 * @param {{payments?: {createForOrder: (p: object) => Promise<{paymentUrl: string}>}}} [deps]
 */
async function confirm(ctx, deps = {}) {
  const flow = ctx.session.flow;
  if (!(flow && flow.name === 'buy' && flow.step === 'awaiting_confirm')) {
    await ctx.reply('Nothing to confirm right now. Send /buy to start an order.');
    return;
  }

  const { usdcAmount, totalXcg } = flow.data;
  ctx.session.flow = null;

  if (deps.payments) {
    try {
      const { orderId, paymentUrl } = await deps.payments.createForOrder({
        usdcAmount,
        amountXcg: totalXcg,
        walletAddress: ctx.session.walletAddress,
        telegramId: ctx.from && ctx.from.id,
      });
      ctx.session.pendingOrderId = orderId;
      await ctx.reply(
        `🧾 Order <code>${orderId}</code> — ${usdcAmount} USDC.\n` +
          `💳 Pay <b>${totalXcg.toFixed(2)} XCG</b> here:\n${paymentUrl}\n\n` +
          "You'll get a confirmation here once your payment is received.",
        { parse_mode: 'HTML' }
      );
    } catch (err) {
      await ctx.reply('Sorry — we could not create a payment link right now. Please try /buy again.');
    }
    return;
  }

  // No payments service wired (Sentoo/Supabase pending configuration — see #6).
  const orderId = crypto.randomUUID();
  ctx.session.pendingOrderId = orderId;
  await ctx.reply(
    `🧾 Order <code>${orderId}</code> created for ${usdcAmount} USDC.\n` +
      '💳 Payment link: <i>Sentoo integration pending configuration (#6)</i>\n\n' +
      "Once your payment is received, you'll get a confirmation here with the transaction hash.",
    { parse_mode: 'HTML' }
  );
}

async function cancel(ctx) {
  ctx.session.flow = null;
  await ctx.reply('Cancelled. Send /buy whenever you want to start again.');
}

/** Render a quote as an HTML message with spread and fee as separate lines. */
function formatQuote(q) {
  const f = (n) => n.toFixed(2);
  const lines = [
    `<b>Buy ${q.usdcAmount} USDC</b>`,
    `Subtotal (${q.pegRate} XCG/USDC): ${f(q.subtotalXcg)} XCG`,
    `FX spread (${q.spread.pct}%): ${f(q.spread.amountXcg)} XCG`,
  ];
  if (q.fee.enabled) {
    lines.push(`Fee (${q.fee.pct}%, min ${f(q.fee.flatMinXcg)}): ${f(q.fee.amountXcg)} XCG`);
  }
  lines.push(`<b>Total: ${f(q.totalXcg)} XCG</b>`);
  lines.push('');
  lines.push('Reply /confirm to get a payment link, or /cancel.');
  return lines.join('\n');
}

module.exports = { startBuy, handleAmount, confirm, cancel, formatQuote };
