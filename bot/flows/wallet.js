// Wallet flow — the user brings their own address, or (if they have none) we
// pregenerate a Privy embedded wallet linked to their email. Because the wallet
// is owned by that email identity, the user can later log in to Privy with the
// email and control it — it's theirs, not app-custodied. (#7)

const { getAddress } = require('ethers');
const kb = require('../lib/keyboards');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Return the EIP-55 checksummed form of an address, or null if it isn't a valid
 * address. `ethers.getAddress` accepts all-lowercase input (and normalises it)
 * but REJECTS a mixed-case address whose checksum is wrong — catching typos that
 * a hex-only regex would wave through.
 */
function normalizeAddress(text) {
  try {
    return getAddress(String(text).trim());
  } catch {
    return null;
  }
}

/** True if `text` is a valid EVM address (checksum-aware). */
function isValidAddress(text) {
  return normalizeAddress(text) !== null;
}

function isValidEmail(text) {
  return EMAIL_RE.test(String(text).trim());
}

/** Save the wallet to Supabase (via the injected users service) so a returning
 *  user is recognised by telegram_id and can skip this step. Best-effort: a
 *  failure here must not block the user, so it's caught and logged. */
async function persistWallet(ctx, deps, address) {
  if (!deps.users || !ctx.from) return;
  try {
    await deps.users.saveWallet(ctx.from.id, address);
  } catch (err) {
    console.error('wallet save failed:', err.message);
  }
}

/** Returning user with a known address: confirm the destination before buying,
 *  and offer to change it. */
async function promptUseWallet(ctx) {
  await ctx.reply(
    `Your USDC will be sent to:\n${ctx.session.walletAddress}\n\nUse this address, or change it?`,
    { reply_markup: kb.useOrChangeWallet() }
  );
}

async function promptWallet(ctx) {
  ctx.session.flow = { name: 'wallet', step: 'awaiting_address' };
  await ctx.reply(
    'Where should we send your USDC?\n\n' +
      'Paste an EVM wallet address (0x…), or tap below and I’ll create one for you using your email.',
    { reply_markup: kb.createWallet() }
  );
}

/** Handle a text message while the wallet flow is awaiting a pasted address. */
async function handleAddress(ctx, deps = {}) {
  const addr = normalizeAddress(ctx.message.text);
  if (!addr) {
    await ctx.reply(
      "That doesn't look like a valid wallet address (0x + 40 hex characters, correct checksum). Try again, or /wallet_new."
    );
    return;
  }
  ctx.session.walletAddress = addr; // stored EIP-55 checksummed
  ctx.session.flow = null;
  await persistWallet(ctx, deps, addr);
  await ctx.reply(`✅ Wallet saved:\n${addr}\n\nReady when you are 👇`, { reply_markup: kb.buy() });
}

/** /wallet_new — begin email-based Privy wallet creation. */
async function startWalletCreation(ctx, deps = {}) {
  if (ctx.session.walletAddress) {
    await ctx.reply(`You already have a wallet:\n${ctx.session.walletAddress}`);
    return;
  }
  if (!deps.privy) {
    await ctx.reply('Automatic wallet creation isn’t configured. Please paste your own 0x address.');
    return;
  }
  ctx.session.flow = { name: 'wallet', step: 'awaiting_email' };
  await ctx.reply(
    'No wallet? No problem — I’ll create one that’s yours.\n\n' +
      'What’s your email? You’ll use it to access the wallet via Privy.'
  );
}

/** Handle a text message while the wallet flow is awaiting an email. */
async function handleEmail(ctx, deps = {}) {
  const email = String(ctx.message.text).trim();
  if (!isValidEmail(email)) {
    await ctx.reply('That doesn’t look like a valid email. Please send your email address.');
    return;
  }
  if (!deps.privy) {
    ctx.session.flow = { name: 'wallet', step: 'awaiting_address' };
    await ctx.reply('Wallet creation isn’t available right now. Please paste an existing 0x address.');
    return;
  }
  await ctx.reply('Creating your wallet… one moment.');
  try {
    const { address, userId } = await deps.privy.createUserWithWallet({ email });
    ctx.session.walletAddress = address;
    ctx.session.email = email;
    ctx.session.privyUserId = userId;
    ctx.session.flow = null;
    await persistWallet(ctx, deps, address);
    await ctx.reply(
      `✅ Wallet created and linked to ${email}:\n${address}\n\n` +
        'You can access it anytime by logging in to Privy with this email.\n\nReady when you are 👇',
      { reply_markup: kb.buy() }
    );
  } catch (err) {
    ctx.session.flow = { name: 'wallet', step: 'awaiting_address' };
    await ctx.reply(
      'Sorry — we couldn’t create your wallet right now. You can paste your own 0x address instead.'
    );
  }
}

module.exports = {
  promptWallet,
  promptUseWallet,
  handleAddress,
  startWalletCreation,
  handleEmail,
  isValidAddress,
  isValidEmail,
};
