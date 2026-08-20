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

## 4. 🟡 Admin wallet uses a hardware wallet or secrets manager

**Backend escrow signing now uses a Privy operator server wallet (MPC).** The
release path in `backend/services/escrow.js` goes through a signer seam
(`ESCROW_SIGNER=fake|raw|privy`); with `privy`, the escrow signing key is sharded
in Privy's MPC/TEE and never present on the host — the backend holds only request
credentials (`PRIVY_OPERATOR_APP_ID/_APP_SECRET/_AUTHORIZATION_KEY/_WALLET_ID`).
Verified on Base Sepolia (operator wallet is the escrow owner; a real `release`
was signed by Privy). See `docs/plans/privy-operator-custody.md` (Unit A1, #22).

**Set `ESCROW_SIGNER=privy` in production and do NOT set `ADMIN_WALLET_PRIVATE_KEY`
on the backend** — the raw key path (`raw`) is a local fallback only.

**The bot holds no chain key (#18 done).** `bot/services/operator.js` is now an
HTTP client to the backend ops API (`/ops/escrow/*`, bearer `OPS_API_SECRET`);
admin balance/refund are signed by the backend via Privy. The refund CAS/ordering
invariant stays in `bot/flows/admin.js`.

**Outstanding before mainnet:** (a) #32/#33 — Escrow v2 role split so the operator
can only `release` (bounded by caps/pause), with a Safe as committee/owner (#23);
(b) a Privy wallet policy allowlisting the escrow contract + `release`; (c) #19 —
least-privilege bot DB role (admin refund CAS still runs on the bot's Supabase
service-role access).

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
