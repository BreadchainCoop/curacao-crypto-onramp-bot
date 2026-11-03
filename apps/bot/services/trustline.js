'use strict';

// Checks whether a Stellar account trusts a SPECIFIC asset (USDC from Circle's
// testnet issuer) via a read-only Horizon GET. No SDK, no key. Used so the bot
// can tell a user up front that their wallet can't receive the payout — and must
// add the trustline — instead of taking a payment the escrow can't deliver (the
// release reverts with TrustlineMissing otherwise).

/**
 * @param {object} opts
 * @param {string} opts.horizonUrl   e.g. https://horizon-testnet.stellar.org
 * @param {string} opts.issuer       the asset issuer (G…) that must be trusted
 * @param {string} [opts.assetCode='USDC']
 * @param {typeof fetch} [opts.fetchImpl] injectable for tests
 */
function createTrustlineChecker({ horizonUrl, issuer, assetCode = 'USDC', fetchImpl = fetch }) {
  if (!horizonUrl || !issuer) {
    throw new Error('Trustline checker requires horizonUrl and issuer');
  }
  const base = horizonUrl.replace(/\/+$/, '');

  /** True if `address` holds a trustline to assetCode:issuer. An unfunded
   *  account (404) has no trustlines → false. */
  async function hasTrustline(address) {
    const resp = await fetchImpl(`${base}/accounts/${encodeURIComponent(address)}`);
    if (resp.status === 404) return false; // account not created yet → no trustline
    if (!resp.ok) {
      throw new Error(`Horizon account lookup failed: HTTP ${resp.status}`);
    }
    const body = await resp.json();
    const balances = (body && body.balances) || [];
    return balances.some((b) => b.asset_code === assetCode && b.asset_issuer === issuer);
  }

  return { hasTrustline, assetCode, issuer };
}

/** Build the checker from a resolved Stellar chain (null for non-Stellar chains
 *  or if the chain is missing the horizon/issuer config). */
function trustlineCheckerFromChain(chain, { fetchImpl } = {}) {
  if (!chain || !chain.stellar || !chain.horizonUrl || !chain.usdcIssuer) return null;
  return createTrustlineChecker({
    horizonUrl: chain.horizonUrl,
    issuer: chain.usdcIssuer,
    fetchImpl,
  });
}

module.exports = { createTrustlineChecker, trustlineCheckerFromChain };
