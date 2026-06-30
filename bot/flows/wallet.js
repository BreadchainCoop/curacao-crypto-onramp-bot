// Wallet flow — the user brings their own address, or (if they have none) we
// pregenerate a Privy embedded wallet linked to their email. Because the wallet
// is owned by that email identity, the user can later log in to Privy with the
// email and control it — it's theirs, not app-custodied. (#7)

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True if `text` is a well-formed EVM (0x…40 hex) address. */
function isValidAddress(text) {
  return ADDRESS_RE.test(String(text).trim());
}

function isValidEmail(text) {
  return EMAIL_RE.test(String(text).trim());
}

async function promptWallet(ctx) {
  ctx.session.flow = { name: 'wallet', step: 'awaiting_address' };
  await ctx.reply(
    'Where should we send your USDC?\n\n' +
      'Paste an EVM wallet address (0x…), or send /wallet_new and I’ll create one ' +
      'for you using your email.'
  );
}

/** Handle a text message while the wallet flow is awaiting a pasted address. */
async function handleAddress(ctx) {
  const addr = String(ctx.message.text).trim();
  if (!isValidAddress(addr)) {
    await ctx.reply(
      "That doesn't look like a wallet address. It should start with 0x and be 42 characters long. Try again, or /wallet_new."
    );
    return;
  }
  ctx.session.walletAddress = addr;
  ctx.session.flow = null;
  await ctx.reply(`✅ Wallet saved:\n${addr}\n\nSend /buy to continue.`);
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
    await ctx.reply(
      `✅ Wallet created and linked to ${email}:\n${address}\n\n` +
        'You can access it anytime by logging in to Privy with this email.\n\nSend /buy to continue.'
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
  handleAddress,
  startWalletCreation,
  handleEmail,
  isValidAddress,
  isValidEmail,
};
