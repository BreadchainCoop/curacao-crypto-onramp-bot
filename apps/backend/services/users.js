// Users repository — data access for the users table (#3 schema + #8 kyc_session_id).
//
// Interface:
//   getByKycSessionId(sessionId) -> user | null
//   setKycStatusBySessionId(sessionId, status) -> boolean (whether a row matched)

class InMemoryUsersRepository {
  /** @param {Array} users seed rows (each may have a `kycSessionId`). */
  constructor(users = []) {
    this.users = users;
  }

  async getByKycSessionId(sessionId) {
    return this.users.find((u) => u.kycSessionId === sessionId) || null;
  }

  async setKycStatusBySessionId(sessionId, status) {
    const user = this.users.find((u) => u.kycSessionId === sessionId);
    if (!user) return false;
    user.kycStatus = status;
    return true;
  }
}

class SupabaseUsersRepository {
  constructor(client) {
    this.client = client;
  }

  async getByKycSessionId(sessionId) {
    const { data, error } = await this.client
      .from('users')
      .select('id, telegram_id, kyc_status')
      .eq('kyc_session_id', sessionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { id: data.id, telegramId: data.telegram_id, kycStatus: data.kyc_status };
  }

  async setKycStatusBySessionId(sessionId, status) {
    const { data, error } = await this.client
      .from('users')
      .update({ kyc_status: status })
      .eq('kyc_session_id', sessionId)
      .select('id');
    if (error) throw error;
    return Array.isArray(data) && data.length > 0;
  }
}

function usersFromEnv(env = process.env) {
  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  return new SupabaseUsersRepository(client);
}

module.exports = { InMemoryUsersRepository, SupabaseUsersRepository, usersFromEnv };
