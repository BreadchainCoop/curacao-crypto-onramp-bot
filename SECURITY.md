# Security Audit Checklist (Issue #13)

Pre-mainnet / pre-live security review for the Curaçao Crypto On-Ramp Bot.

**Current posture:** MVP on **testnet (Base Sepolia) + sandbox** only. This
document reviews each checklist item against the code as it stands and lists
what remains **outstanding before any mainnet or real-fiat use**.

Legend: ✅ done · ⚠️ partial / testnet-only · ❌ outstanding · 📋 legal/ops gate

---

## 1. ⚠️ Escrow.sol reviewed by a second developer or auditor

Internal review done; an **independent audit is still required before mainnet.**

Reviewed — [`contracts/src/Escrow.sol`](contracts/src/Escrow.sol):
- Uses OpenZeppelin `Ownable`, `ReentrancyGuard`, and `SafeERC20`.
- `release()` and `refund()` are `onlyOwner` and `nonReentrant`; the only external
  calls are ERC-20 transfers via `SafeERC20`.
- Checks precede effects: zero-address / zero-amount / insufficient-balance are
  validated before any transfer; events are emitted after.
- Owner (admin wallet) is set at deploy from env — never hardcoded.

Findings to weigh before mainnet:
- **Single-key owner.** `release`/`refund` trust one private key. Use a
  multisig (e.g. Safe) or an MPC/KMS-backed signer for mainnet — see item 4.
- **Pooled custody.** The contract holds a USDC pool with no per-order accounting
  on-chain; correct payouts depend on the backend. Acceptable for the MVP model,
  but document the operator-trust assumption.
- **No pause / no upgrade.** Consider a pause switch for incident response.
- `refund()` only returns funds to `owner()` (by design).

**Outstanding:** independent third-party audit; decide on multisig + pause.

## 2. ✅ All webhook endpoints verify before processing

- `POST /webhook/sentoo` ([routes/sentoo.js](backend/routes/sentoo.js)) — verifies
  an optional `?token=` URL secret (constant-time) **and**, crucially, never trusts
  the webhook body: it re-fetches authoritative status from the Sentoo API
  (`X-SENTOO-SECRET`) before acting. Idempotent via compare-and-set transitions.
- `POST /webhook/kyc` ([routes/kyc.js](backend/routes/kyc.js)) — verifies the
  `?secret=` query param (constant-time) against `SYNAPS_WEBHOOK_SECRET` and 401s
  on mismatch.

Both providers authenticate webhooks with a **URL secret / status re-fetch, not an
HMAC** — confirmed from each provider's own SDK, not assumed. Constant-time
comparison (`crypto.timingSafeEqual`) is used for both secrets.

## 3. ✅ No secrets, private keys, or API keys in git history

Verified:
```
git log --all -p | grep -iE 'private_key|api_key|secret|token|0x[0-9a-fA-F]{64}'
```
Only placeholders and documentation/comment references appear — no real values.
`.env` has **never** been tracked and is blocked by `.gitignore`; `.env.example`
contains placeholder values only. Re-run this scan before any public release or
key rotation.

## 4. ❌ Admin wallet uses a hardware wallet or secrets manager

**Testnet-only today.** `ADMIN_WALLET_PRIVATE_KEY` is a plain env var, read by
`backend/services/escrow.js` and `bot/services/operator.js` at runtime (never
hardcoded, never logged). This is acceptable for Base Sepolia but **must not be
used on mainnet.**

**Outstanding before mainnet:** move the owner key to a hardware wallet, a cloud
KMS/secrets manager, or a multisig; remove the raw private key from the runtime
env entirely.

## 5. ✅ Rate limiting on webhook endpoints

`express-rate-limit` is applied to all `/webhook/*` routes in
[backend/index.js](backend/index.js) (default 120 req/min/IP, configurable via
`WEBHOOK_RATE_MAX` / `WEBHOOK_RATE_WINDOW_MS`). `trust proxy` is set so the limiter
keys on the real client IP behind Railway's proxy. Covered by an automated test
(429 past the cap).

## 6. ⚠️ KYC data handling reviewed (CBCS / local compliance)

**Engineering review done; formal compliance review outstanding.**

By design, no KYC document data ever enters this system:
- The Synaps webhook ([routes/kyc.js](backend/routes/kyc.js)) carries **no PII** —
  only `session_id` + `status`. We act on `status` alone.
- We **never** call the Synaps step-detail endpoints that return document fields,
  so identity documents are never fetched, stored, or logged.
- Logs include only `session_id` + `status`; only the user's `kyc_status`
  (`approved`/`rejected`/…) is persisted.
- Database access is server-side only; RLS is enabled on all tables with no
  policies (anon/authenticated denied), service-role key bypasses RLS.

**Outstanding:** formal CBCS / local data-protection review (retention, lawful
basis, data-subject rights, processor agreement with Synaps).

## 7. 📋 Regulatory check: CFTE license or equivalent

**Non-engineering gate — outstanding.** Operating a fiat→crypto on-ramp for
residents of Curaçao/the Dutch Caribbean requires appropriate authorization under
CBCS oversight (and AML/CFT obligations). This must be resolved with legal counsel
**before handling any real customer funds.** Not a code change.

---

## Secrets management (summary)

- All secrets are loaded from environment variables at runtime; none are hardcoded.
- `.env` is gitignored and has never been committed; `.env.example` is placeholders.
- Provider secrets (`SENTOO_API_KEY`, `SYNAPS_API_KEY`, `PRIVY_APP_SECRET`,
  `ADMIN_WALLET_PRIVATE_KEY`, Supabase keys) are used only to build auth headers /
  signers and are never logged.
- Supabase: RLS enabled on every table; the service-role key is server-side only.

## Before flipping to mainnet / live, in order

1. Independent audit of `Escrow.sol` (item 1).
2. Move the admin/owner key to a multisig or KMS (item 4).
3. Complete the CBCS regulatory + KYC-compliance review (items 6–7).
4. Re-run the git-history secret scan and rotate any key ever exposed (item 3).
