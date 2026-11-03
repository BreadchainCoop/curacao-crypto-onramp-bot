// Wallet flow — the user brings their own address, or (if they have none) we
// pregenerate a Privy embedded wallet linked to their email. Because the wallet
// is owned by that email identity, the user can later log in to Privy with the
// email and control it — it's theirs, not app-custodied. (#7)

const { getAddress } = require('ethers');
const { activeChain } = require('@kambiox/chains');
const { isValidEd25519PublicKey } = require('../lib/strkey');
const kb = require('../lib/keyboards');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The active chain, resolved lazily and defensively — never throws in the bot. */
function currentChain() {
  try {
    return activeChain();
  } catch {
    return {};
  }
}

/** True when the active chain is Stellar (Soroban), not EVM. */
function isStellarChain(chain = currentChain()) {
  return !!(chain && chain.stellar);
}

/**
 * Normalise a pasted destination address for the ACTIVE chain, or return null
 * if it isn't valid.
 *   EVM:     EIP-55 checksummed via ethers.getAddress (rejects bad checksums).
 *   Stellar: a StrKey ed25519 account (G…), validated via the Stellar SDK,
 *            which is lazy-required so the EVM bot never loads it.
 */
function normalizeAddress(text, chain = currentChain()) {
  const t = String(text).trim();
  if (isStellarChain(chain)) {
    return isValidEd25519PublicKey(t) ? t : null;
  }
  try {
    return getAddress(t);
  } catch {
    return null;
  }
}

/** True if `text` is a valid address for the active chain. */
function isValidAddress(text, chain = currentChain()) {
  return normalizeAddress(text, chain) !== null;
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
  // On Stellar the user brings their own account — we don't create custodial
  // Stellar wallets (Privy wallets are EVM), so no "create for me" option.
  if (isStellarChain()) {
    await ctx.reply(
      'Where should we send your USDC?\n\n' +
        'Paste your Stellar wallet address (G…). It must already hold a USDC trustline, ' +
        'otherwise the transfer can’t land.'
    );
    return;
  }
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
    const hint = isStellarChain()
      ? "That doesn't look like a valid Stellar address (starts with G, 56 characters). Please paste your Stellar wallet address."
      : "That doesn't look like a valid wallet address (0x + 40 hex characters, correct checksum). Try again, or /wallet_new.";
    await ctx.reply(hint);
    return;
  }
  // Stellar: the wallet must trust the exact USDC we pay out (Circle testnet
  // issuer), or the release reverts AFTER payment. Check now and, if missing,
  // point the user to add the trustline instead of saving a dead-end wallet.
  if (deps.trustline) {
    let trusts;
    try {
      trusts = await deps.trustline.hasTrustline(addr);
    } catch (err) {
      // Don't hard-block on a Horizon hiccup — the backend release still guards
      // delivery; just log and let them proceed.
      console.error('trustline check failed:', err.message);
      trusts = true;
    }
    if (!trusts) {
      const issuer = deps.trustline.issuer;
      const link = deps.trustlineUrl ? `\n\n👉 Add it here: ${deps.trustlineUrl}` : '';
      await ctx.reply(
        'That wallet can’t receive USDC yet — it needs a trustline to ' +
          `USDC issued by Circle on testnet:\n<code>${issuer}</code>` +
          link +
          '\n\nAdd the trustline, then paste your address again.',
        { parse_mode: 'HTML' }
      );
      return;
    }
  }

  ctx.session.walletAddress = addr; // EIP-55 (EVM) or StrKey G… (Stellar)
  ctx.session.flow = null;
  await persistWallet(ctx, deps, addr);
  await ctx.reply(`✅ Wallet saved:\n${addr}\n\nReady when you are 👇`, { reply_markup: kb.buy() });
}

/** /wallet_new — begin email-based Privy wallet creation. */
async function startWalletCreation(ctx, deps = {}) {
  if (isStellarChain()) {
    // No custodial Stellar wallet creation — Privy wallets are EVM.
    await ctx.reply('Please paste your own Stellar address (G…) that holds a USDC trustline.');
    return;
  }
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
