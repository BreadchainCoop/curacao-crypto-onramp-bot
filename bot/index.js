// Telegram bot entry point
// Uses Grammy: https://grammy.dev
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { Bot, session } = require('grammy');
const { initialSession, resolveBuyGate } = require('./state/session');
const { startKyc } = require('./flows/kyc');
const wallet = require('./flows/wallet');
const buy = require('./flows/buy');

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
function createBot(token) {
  const bot = new Bot(token);
  bot.use(session({ initial: initialSession }));

  bot.command('start', (ctx) => ctx.reply(WELCOME));
  bot.command('help', (ctx) => ctx.reply(HELP));
  bot.command('status', (ctx) => ctx.reply(renderStatus(ctx.session)));

  bot.command('buy', async (ctx) => {
    const gate = resolveBuyGate(ctx.session);
    if (gate.action === 'kyc') return startKyc(ctx);
    if (gate.action === 'wallet') return wallet.promptWallet(ctx);
    return buy.startBuy(ctx);
  });

  bot.command('confirm', (ctx) => buy.confirm(ctx));
  bot.command('cancel', (ctx) => buy.cancel(ctx));

  // TODO(#7): create a Privy embedded wallet instead of asking for an address.
  bot.command('wallet_new', (ctx) =>
    ctx.reply('Automatic wallet creation is coming soon (Privy, #7). For now, paste your own 0x address.')
  );

  // Route free-text input to whatever flow the user is currently in.
  bot.on('message:text', async (ctx) => {
    const flow = ctx.session.flow;
    if (flow && flow.name === 'wallet' && flow.step === 'awaiting_address') {
      return wallet.handleAddress(ctx);
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
  const bot = createBot(token);
  bot.start({
    onStart: (me) => console.log(`Bot @${me.username} is running.`),
  });
}

module.exports = { createBot, renderStatus, WELCOME, HELP };

if (require.main === module) {
  startFromEnv();
}
