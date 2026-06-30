// Telegram bot entry point
// Uses Grammy: https://grammy.dev
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { Bot, session } = require('grammy');
const { initialSession, resolveBuyGate } = require('./state/session');
const { startKyc } = require('./flows/kyc');
const wallet = require('./flows/wallet');
const buy = require('./flows/buy');
const { createAdminHandlers } = require('./flows/admin');

const WELCOME =
  '👋 Welcome to the Curaçao Crypto On-Ramp.\n\n' +
  'Buy USDC with a local bank transfer (XCG) via Sentoo.\n\n' +
  'Commands:\n' +
  '/buy — start a purchase\n' +
  '/status — your verification, wallet, and pending order\n' +
  '/help — show this help';

const HELP =
  'Commands:\n' +
  '/buy — start a purchase (KYC + wallet required first)\n' +
  '/status — show your current state\n' +
  '/cancel — cancel the current step\n' +
  '/help — show this help';

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

  bot.command('start', (ctx) => ctx.reply(WELCOME));
  bot.command('help', (ctx) => ctx.reply(HELP));
  bot.command('status', (ctx) => ctx.reply(renderStatus(ctx.session)));

  // Operator-only commands (Issue #10) — registered only when admin deps are
  // provided. Handlers silently ignore non-admin users.
  if (opts.admin) {
    const admin = createAdminHandlers(opts.admin);
    bot.command('escrow_balance', admin.escrowBalance);
    bot.command('orders', admin.listOrders);
    bot.command('refund', admin.refundStart);
    bot.command('refund_confirm', admin.refundConfirm);
    bot.command('refund_cancel', admin.refundCancel);
  }

  bot.command('buy', async (ctx) => {
    const gate = resolveBuyGate(ctx.session, { requireKyc });
    if (gate.action === 'kyc') return startKyc(ctx, { kyc: opts.kyc });
    if (gate.action === 'wallet') return wallet.promptWallet(ctx);
    return buy.startBuy(ctx);
  });

  bot.command('confirm', (ctx) => buy.confirm(ctx, { payments: opts.payments }));
  bot.command('cancel', (ctx) => buy.cancel(ctx));

  bot.command('wallet_new', (ctx) => wallet.startWalletCreation(ctx, { privy: opts.privy }));

  // Route free-text input to whatever flow the user is currently in.
  bot.on('message:text', async (ctx) => {
    const flow = ctx.session.flow;
    if (flow && flow.name === 'wallet' && flow.step === 'awaiting_address') {
      return wallet.handleAddress(ctx);
    }
    if (flow && flow.name === 'wallet' && flow.step === 'awaiting_email') {
      return wallet.handleEmail(ctx, { privy: opts.privy });
    }
    if (flow && flow.name === 'buy' && flow.step === 'awaiting_amount') {
      return buy.handleAmount(ctx);
    }
    return ctx.reply('Send /help to see what I can do, or /buy to get started.');
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
  // Wire operator commands only if an admin is configured.
  let admin = null;
  const adminId = process.env.ADMIN_TELEGRAM_ID;
  if (adminId) {
    const { escrowOperatorFromEnv, ordersAdminFromEnv } = require('./services/operator');
    admin = { adminId, escrow: escrowOperatorFromEnv(), orders: ordersAdminFromEnv() };
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

  const bot = createBot(token, { admin, privy, requireKyc, payments });
  bot.start({
    onStart: (me) => console.log(`Bot @${me.username} is running.`),
  });
}

module.exports = { createBot, renderStatus, WELCOME, HELP };

if (require.main === module) {
  startFromEnv();
}
