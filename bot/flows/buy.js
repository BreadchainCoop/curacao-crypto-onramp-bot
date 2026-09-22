// Buy flow — quotes the price, then (eventually) generates a Sentoo payment link.
//
// #2: implements the amount → quote → confirm conversation using the FX logic
// from #9. Payment-link generation and order creation are stubbed.
// TODO(#6): generate a real Sentoo payment link on /confirm.
// TODO(#11): create a real order + drive status transitions.

const crypto = require('crypto');
const { quoteUsdcPurchase, loadFxConfig } = require('../lib/fx');
const kb = require('../lib/keyboards');

// Thousands-separated formatters for legibility (e.g. 25000 -> "25,000").
const fmtXcg = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtAmount = (n) => Number(n).toLocaleString('en-US');

// Per-order USDC bounds (override with BUY_MIN_USDC / BUY_MAX_USDC).
function buyLimits(env = process.env) {
  return {
    min: Number(env.BUY_MIN_USDC) || 10,
    max: Number(env.BUY_MAX_USDC) || 25000,
  };
}

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
  const { min, max } = buyLimits();
  if (usdc < min || usdc > max) {
    await ctx.reply(`Please choose an amount between ${fmtAmount(min)} and ${fmtAmount(max)} USDC.`);
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
  await ctx.reply(formatQuote(quote), { parse_mode: 'HTML', reply_markup: kb.confirmCancel() });
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
          `💳 Pay <b>${totalXcg.toFixed(2)} XCG</b> — tap below.\n\n` +
          "You'll get a confirmation here once your payment is received.",
        { parse_mode: 'HTML', reply_markup: kb.pay(paymentUrl) }
      );
    } catch (err) {
      await ctx.reply('Sorry — we could not create a payment link right now. Please try again.', {
        reply_markup: kb.buy(),
      });
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
  await ctx.reply('Cancelled — no charge. Start again whenever you like 👇', {
    reply_markup: kb.buy(),
  });
}

/** Render a quote as an HTML message with each margin component on its own line. */
function formatQuote(q) {
  const lines = [
    `<b>Buy ${fmtAmount(q.usdcAmount)} USDC</b>`,
    '',
    `Subtotal (${q.pegRate} XCG/USDC): ${fmtXcg(q.subtotalXcg)} XCG`,
  ];
  // Only show the spread when it is actually charged — when it is folded into the
  // service fee (spread 0), a "0%" line would just be noise.
  if (q.spread.amountXcg > 0) {
    lines.push(`FX spread (${q.spread.pct}%): ${fmtXcg(q.spread.amountXcg)} XCG`);
  }
  if (q.fee.enabled) {
    let note = `${q.fee.pct}%`;
    if (q.fee.capped) note += `, capped at ${fmtXcg(q.fee.maxXcg)}`;
    else if (q.fee.floored) note += `, min ${fmtXcg(q.fee.flatMinXcg)}`;
    lines.push(`Fee (${note}): ${fmtXcg(q.fee.amountXcg)} XCG`);
  }
  if (q.sentoo && q.sentoo.enabled && q.sentoo.amountXcg > 0) {
    // Blend of the capped base fee + the uncapped inter-bank fee, so show the
    // amount rather than a single percentage.
    lines.push(`Processing: ${fmtXcg(q.sentoo.amountXcg)} XCG`);
  }
  lines.push('━━━━━━━━━━━━━━━');
  lines.push(`💰 <b>You pay: ${fmtXcg(q.totalXcg)} XCG</b>`);
  lines.push(`🪙 <b>You receive: ${fmtAmount(q.usdcAmount)} USDC</b>`);
  lines.push('');
  lines.push('Confirm below to get your payment link — or cancel.');
  return lines.join('\n');
}

module.exports = { startBuy, handleAmount, confirm, cancel, formatQuote, buyLimits };
