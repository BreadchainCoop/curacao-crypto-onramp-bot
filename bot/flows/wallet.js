// Wallet flow — asks the user for an address or creates one via Privy.
//
// #2: skeleton — prompts for an EVM address and stores it on the session.
// TODO(#7): /wallet_new should create a Privy embedded wallet for the user.

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** True if `text` is a well-formed EVM (0x…40 hex) address. */
function isValidAddress(text) {
  return ADDRESS_RE.test(String(text).trim());
}

async function promptWallet(ctx) {
  ctx.session.flow = { name: 'wallet', step: 'awaiting_address' };
  await ctx.reply(
    'Where should we send your USDC?\n\n' +
      'Paste an EVM wallet address (0x…), or send /wallet_new to have one created for you.'
  );
}

/** Handle a text message while the wallet flow is awaiting an address. */
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

module.exports = { promptWallet, handleAddress, isValidAddress };
