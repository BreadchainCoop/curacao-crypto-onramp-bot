// Per-user session state: kyc_status, wallet_address, pending_order_id.
//
// In #2 this lives in Grammy's in-memory session store (resets on restart).
// TODO(#3): back this with Supabase so state survives restarts and is shared
// between the bot and the backend webhook server.

const KycStatus = Object.freeze({
  NONE: 'none',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

/** Fresh session for a new user. */
function initialSession() {
  return {
    kycStatus: KycStatus.NONE,
    walletAddress: null,
    pendingOrderId: null,
    // Transient flow cursor: null, or { name: 'wallet'|'buy', step, data }.
    flow: null,
  };
}

/**
 * Pure gate for the /buy command: given the session, decide the next step.
 * KYC must be approved, then a wallet must exist, before a purchase can start.
 *
 * @param {object} session
 * @returns {{action: 'kyc'|'wallet'|'buy', reason?: string}}
 */
function resolveBuyGate(session) {
  if (session.kycStatus !== KycStatus.APPROVED) {
    return { action: 'kyc', reason: `kyc_status=${session.kycStatus}` };
  }
  if (!session.walletAddress) {
    return { action: 'wallet', reason: 'no_wallet' };
  }
  return { action: 'buy' };
}

module.exports = { KycStatus, initialSession, resolveBuyGate };
