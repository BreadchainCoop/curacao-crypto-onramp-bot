// Users service — remember a user's payout wallet by telegram_id so a returning
// user doesn't have to paste their address again after a bot restart or in a new
// session. Backed by the same Supabase `users` table the payments flow upserts.

function createUsersService({ client }) {
  /** Return the saved wallet address for a telegram_id, or null if none. */
  async function getWalletByTelegramId(telegramId) {
    const { data, error } = await client
      .from('users')
      .select('wallet_address')
      .eq('telegram_id', telegramId)
      .maybeSingle();
    if (error) throw error;
    return (data && data.wallet_address) || null;
  }

  /** Insert or update the user's wallet address, keyed by telegram_id. When the
   *  address changes, first append an audit row (old → new) to
   *  wallet_address_history. The audit write is best-effort — if it fails (e.g.
   *  the table isn't migrated yet) the wallet update still proceeds. */
  async function saveWallet(telegramId, walletAddress) {
    const existing = await getWalletByTelegramId(telegramId);
    if (existing && existing !== walletAddress) {
      try {
        const { error } = await client
          .from('wallet_address_history')
          .insert({ telegram_id: telegramId, old_address: existing, new_address: walletAddress });
        if (error) throw error;
      } catch (err) {
        console.error('wallet history log failed:', err.message);
      }
    }
    const { error } = await client
      .from('users')
      .upsert({ telegram_id: telegramId, wallet_address: walletAddress }, { onConflict: 'telegram_id' });
    if (error) throw error;
  }

  return { getWalletByTelegramId, saveWallet };
}

function usersFromEnv(env = process.env) {
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  return createUsersService({ client });
}

module.exports = { createUsersService, usersFromEnv };
