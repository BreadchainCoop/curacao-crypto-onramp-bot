// Buy flow — quotes the price, then (eventually) generates a Sentoo payment link.
//
// #2: implements the amount → quote → confirm conversation using the FX logic
// from #9. Payment-link generation and order creation are stubbed.
// TODO(#6): generate a real Sentoo payment link on /confirm.
// TODO(#11): create a real order + drive status transitions.

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

  ctx.session.flow = { name: 'buy', step: 'awaiting_confirm', data: { usdcAmount: usdc } };
  await ctx.reply(formatQuote(quote), { parse_mode: 'HTML' });
}

async function confirm(ctx) {
  const flow = ctx.session.flow;
  if (!(flow && flow.name === 'buy' && flow.step === 'awaiting_confirm')) {
    await ctx.reply('Nothing to confirm right now. Send /buy to start an order.');
    return;
  }

  // TODO(#6/#5): create a Sentoo payment link and a real order record.
  const orderId = `stub_${Date.now()}`;
  ctx.session.pendingOrderId = orderId;
  ctx.session.flow = null;
  await ctx.reply(
    `🧾 Order <code>${orderId}</code> created for ${flow.data.usdcAmount} USDC.\n` +
      '💳 Payment link: <i>Sentoo integration in #6</i>\n\n' +
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
