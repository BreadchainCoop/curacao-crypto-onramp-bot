// Telegram bot entry point
// Uses Grammy: https://grammy.dev
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { Bot, session } = require('grammy');
const { initialSession, resolveBuyGate } = require('./state/session');
const { startKyc } = require('./flows/kyc');
const wallet = require('./flows/wallet');
const buy = require('./flows/buy');
const kb = require('./lib/keyboards');
const { createRateLimiter } = require('./lib/rateLimit');
const { createAdminHandlers } = require('./flows/admin');

const WELCOME =
  '👋 Welcome to the Curaçao Crypto On-Ramp.\n\n' +
  'Buy USDC with a local bank transfer (XCG) via Sentoo.\n\n' +
  'Tap a button below to get started.';

const HELP =
  'Commands:\n' +
  '/buy — start a purchase (KYC + wallet required first)\n' +
  '/status — show your current state\n' +
  '/cancel — cancel the current step\n' +
  '/help — show this help';

// After a Sentoo payment, the user returns via a /start <status> deep link.
// Show a fitting message (visual only — the real result comes from the webhook).
// Message shown when the user returns from Sentoo via the /start <status> deep
// link. Returns null for anything that isn't a payment-return status, so a
// genuine /start still shows the welcome menu.
const FAILED_STATUSES = new Set(['failed', 'rejected', 'cancelled', 'canceled']);

function startPayloadMessage(payload) {
  const s = String(payload || '').trim().toLowerCase();
  if (!s) return null; // genuine /start (no deep-link payload) → welcome menu
  switch (s) {
    case 'success':
    case 'paid':
    case 'complete':
    case 'completed':
    case 'done':
    case 'ok':
      return "✅ Payment received! We're processing it and releasing your USDC now — your receipt will land here in a moment.";
    case 'pending':
    case 'issued':
      return '⏳ Payment is being processed — waiting for your bank to confirm. You’ll get an update here the moment it clears.';
    case 'failed':
    case 'rejected':
    case 'cancelled':
    case 'canceled':
      return "❌ That payment didn't complete — no charge was made.";
    default:
      // Any other non-empty payload still means a return from Sentoo, not a
      // fresh start — show a processing message rather than the welcome menu.
      return "⏳ Thanks — we're processing your payment. You'll get a confirmation and receipt here shortly.";
  }
}

function renderStatus(s) {
  return [
    'Your status:',
    `• KYC: ${s.kycStatus}`,
    `• Wallet: ${s.walletAddress ?? 'not set'}`,
    `• Pending order: ${s.pendingOrderId ?? 'none'}`,
  ].join('\n');
}

/**
 * Build a fully-wired bot. Pure factory — constructs and configures the bot but
 * does NOT connect to Telegram, so it is safe to import in tests.
 */
function createBot(token, opts = {}) {
  const bot = new Bot(token);
  bot.use(session({ initial: initialSession }));

  // KYC gate can be turned off while Synaps is parked (MVP).
  const requireKyc = opts.requireKyc !== false;

  // Wrap an inline-button action: acknowledge the tap and remove the buttons from
  // the originating message (so it can't be tapped twice), then run the handler.
  const onTap = (handler) => async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => {});
    return handler(ctx);
  };

  // True only for the configured operator. Used to show an admin button in the menu.
  const isAdminUser = (ctx) =>
    opts.admin && ctx.from && String(ctx.from.id) === String(opts.admin.adminId);

  // The main menu, with a "🛠 Admin" row appended for the operator.
  const menuFor = (ctx) => {
    const m = kb.menu();
    if (isAdminUser(ctx)) m.inline_keyboard.push([{ text: '🛠 Admin', callback_data: 'admin_menu' }]);
    return m;
  };

  bot.command('start', (ctx) => {
    // Returning from a Sentoo payment? Telegram delivers the status as the
    // /start payload — show it instead of the welcome menu.
    const payload = String(ctx.match || '').trim();
    if (payload) console.log(`[start] deep-link payload: ${JSON.stringify(payload)}`);
    const statusMsg = startPayloadMessage(payload);
    if (statusMsg) {
      const failed = FAILED_STATUSES.has(payload.toLowerCase());
      return ctx.reply(statusMsg, failed ? { reply_markup: kb.buy() } : undefined);
    }
    return ctx.reply(WELCOME, { reply_markup: menuFor(ctx) });
  });
  bot.command('help', (ctx) => ctx.reply(HELP, { reply_markup: menuFor(ctx) }));
  bot.command('status', (ctx) => ctx.reply(renderStatus(ctx.session), { reply_markup: menuFor(ctx) }));

  // Navigational buttons (Status/Help): acknowledge and re-show info + menu.
  // Unlike actions, these do NOT strip the menu — the user may tap again.
  bot.callbackQuery('show_status', async (ctx) => {
    await ctx.answerCallbackQuery();
    return ctx.reply(renderStatus(ctx.session), { reply_markup: menuFor(ctx) });
  });
  bot.callbackQuery('show_help', async (ctx) => {
    await ctx.answerCallbackQuery();
    return ctx.reply(HELP, { reply_markup: menuFor(ctx) });
  });

  // Operator-only commands (Issue #10) — registered only when admin deps are
  // provided. Handlers silently ignore non-admin users.
  if (opts.admin) {
    const admin = createAdminHandlers(opts.admin);
    bot.command('escrow_balance', admin.escrowBalance);
    bot.command('orders', admin.listOrders);
    bot.command('refund', admin.refundStart);
    bot.command('refund_confirm', admin.refundConfirm);
    bot.command('refund_cancel', admin.refundCancel);
    // Inline buttons on the refund preview (same guarded handlers).
    bot.callbackQuery('refund_confirm', onTap((ctx) => admin.refundConfirm(ctx)));
    bot.callbackQuery('refund_cancel', onTap((ctx) => admin.refundCancel(ctx)));

    // Admin menu (button entry point). The '🛠 Admin' button opens it; the
    // action buttons re-use the guarded handlers.
    bot.command('admin', admin.showMenu);
    bot.callbackQuery('admin_menu', async (ctx) => {
      await ctx.answerCallbackQuery();
      return admin.showMenu(ctx);
    });
    bot.callbackQuery('admin_balance', async (ctx) => {
      await ctx.answerCallbackQuery();
      return admin.escrowBalance(ctx);
    });
    bot.callbackQuery('admin_orders', async (ctx) => {
      await ctx.answerCallbackQuery();
      return admin.listOrders(ctx);
    });
    bot.callbackQuery('admin_fees', async (ctx) => {
      await ctx.answerCallbackQuery();
      return admin.totalFees(ctx);
    });
  }

  // Per-user rate limiting for the sensitive actions (buy / wallet create).
  const limiter = createRateLimiter({ windowMs: 60_000, max: 8 });
  const tooFast = async (ctx, action) => {
    const id = ctx.from && ctx.from.id;
    if (id && !limiter.allow(`${action}:${id}`)) {
      await ctx.reply("You're going a bit fast — please wait a moment and try again.");
      return true;
    }
    return false;
  };

  // Shared entry to the buy flow, gating on KYC → wallet → buy.
  const beginBuy = async (ctx) => {
    if (await tooFast(ctx, 'buy')) return;
    // Returning user? Rehydrate their saved wallet from Supabase so they skip
    // the wallet step even in a fresh session (e.g. after a bot restart).
    if (!ctx.session.walletAddress && opts.users && ctx.from) {
      try {
        const saved = await opts.users.getWalletByTelegramId(ctx.from.id);
        if (saved) ctx.session.walletAddress = saved;
      } catch (err) {
        console.error('wallet lookup failed:', err.message);
      }
    }
    const gate = resolveBuyGate(ctx.session, { requireKyc });
    if (gate.action === 'kyc') return startKyc(ctx, { kyc: opts.kyc });
    if (gate.action === 'wallet') return wallet.promptWallet(ctx);
    // Wallet known → confirm the destination (and offer to change) before buying.
    return wallet.promptUseWallet(ctx);
  };

  bot.command('buy', (ctx) => beginBuy(ctx));
  bot.command('confirm', (ctx) => buy.confirm(ctx, { payments: opts.payments }));
  bot.command('cancel', (ctx) => buy.cancel(ctx));

  // Inline-button actions for the buy flow (onTap defined above).
  bot.callbackQuery('start_buy', onTap((ctx) => beginBuy(ctx)));
  bot.callbackQuery('use_wallet', onTap((ctx) => buy.startBuy(ctx)));
  bot.callbackQuery('change_wallet', onTap((ctx) => wallet.promptWallet(ctx)));
  bot.callbackQuery('confirm_order', onTap((ctx) => buy.confirm(ctx, { payments: opts.payments })));
  bot.callbackQuery('cancel_order', onTap((ctx) => buy.cancel(ctx)));
  bot.callbackQuery(
    'create_wallet',
    onTap(async (ctx) => {
      if (await tooFast(ctx, 'wallet')) return;
      return wallet.startWalletCreation(ctx, { privy: opts.privy });
    })
  );

  bot.command('wallet_new', async (ctx) => {
    if (await tooFast(ctx, 'wallet')) return;
    return wallet.startWalletCreation(ctx, { privy: opts.privy });
  });

  // Route free-text input to whatever flow the user is currently in.
  bot.on('message:text', async (ctx) => {
    const flow = ctx.session.flow;
    if (flow && flow.name === 'wallet' && flow.step === 'awaiting_address') {
      return wallet.handleAddress(ctx, { users: opts.users });
    }
    if (flow && flow.name === 'wallet' && flow.step === 'awaiting_email') {
      return wallet.handleEmail(ctx, { privy: opts.privy, users: opts.users });
    }
    if (flow && flow.name === 'buy' && flow.step === 'awaiting_amount') {
      return buy.handleAmount(ctx);
    }
    return ctx.reply('Not sure what that means. Tap below to get started, or /help.', {
      reply_markup: kb.buy(),
    });
  });

  bot.catch((err) => {
    console.error('Bot error while handling an update:', err.error ?? err);
  });

  return bot;
}

function startFromEnv() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  // Wire operator commands only if an admin is configured AND the backend ops API
  // is reachable (#18 — the bot holds no chain key; refunds go via the backend).
  let admin = null;
  const adminId = process.env.ADMIN_TELEGRAM_ID;
  if (adminId && process.env.OPS_API_URL && process.env.OPS_API_SECRET) {
    const { escrowOperatorFromEnv, ordersAdminFromEnv } = require('./services/operator');
    const { activeChain } = require('../chains');
    admin = { adminId, escrow: escrowOperatorFromEnv(), orders: ordersAdminFromEnv(), chain: activeChain() };
  } else if (adminId) {
    console.warn('OPS_API_URL/OPS_API_SECRET not set — operator commands disabled (bot signs nothing).');
  } else {
    console.warn('ADMIN_TELEGRAM_ID not set — operator commands are disabled.');
  }

  // Privy embedded-wallet creation (no DB dependency — stores on the session).
  let privy = null;
  if (process.env.PRIVY_APP_ID && process.env.PRIVY_APP_SECRET) {
    const { privyFromEnv } = require('./services/privy');
    privy = privyFromEnv();
  } else {
    console.warn('PRIVY_APP_ID/PRIVY_APP_SECRET not set — /wallet_new will ask for an address.');
  }

  // KYC is required unless explicitly disabled (Synaps parked for the MVP).
  const requireKyc = process.env.KYC_REQUIRED !== 'false';
  if (!requireKyc) console.warn('KYC_REQUIRED=false — /buy skips KYC (MVP mode).');

  // Payment-link creation on /confirm needs Sentoo + Supabase; otherwise /confirm
  // falls back to a placeholder.
  let payments = null;
  if (
    process.env.SENTOO_API_KEY &&
    process.env.SENTOO_MERCHANT_ID &&
    process.env.SENTOO_BASE_URL &&
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    const { paymentsFromEnv } = require('./services/payments');
    payments = paymentsFromEnv();
  } else {
    console.warn('Sentoo/Supabase not fully configured — /confirm uses a placeholder.');
  }

  // Remember users' wallets across sessions/restarts (Supabase-only, independent
  // of Sentoo). Lets a returning user skip the wallet step on /buy.
  let users = null;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { usersFromEnv } = require('./services/users');
    users = usersFromEnv();
  } else {
    console.warn('Supabase not configured — wallets are not remembered across restarts.');
  }

  const bot = createBot(token, { admin, privy, requireKyc, payments, users });
  bot.start({
    onStart: (me) => console.log(`Bot @${me.username} is running.`),
  });
}

module.exports = { createBot, renderStatus, WELCOME, HELP };

if (require.main === module) {
  startFromEnv();
}
