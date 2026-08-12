# Repository agent guide

This is the canonical instruction file for coding agents in this repository.
Host-specific files may import it, but must not duplicate or override it.

## Project posture

This repository implements a fiat-to-USDC on-ramp. Changes can affect payments,
KYC state, custody, payouts, and private keys. The current deployment posture is
testnet and provider sandbox only.

Use a plan-first workflow and require human review before merging changes to:

- payment webhooks or order transitions;
- KYC handling or retention;
- wallet selection, escrow, refunds, or signing;
- database migrations or RLS;
- deployment configuration, secrets, or any mainnet path.

Do not use unsupervised full-autonomy workflows for production or mainnet work.
An independent escrow audit, multisig or KMS-backed ownership, and regulatory
review remain outstanding. Do not describe those controls as implemented.

## Repository map

- `bot/`: Grammy bot, user/admin flows, in-memory session state, and service
  clients. It creates orders; admin refunds are initiated here.
- `backend/`: Express webhooks, order expiry, authoritative provider lookups,
  and escrow release.
- `contracts/`: Hardhat project containing the pooled-custody `Escrow.sol` and
  deployment scripts.
- `supabase/`: ordered Postgres migrations and the consolidated setup script.
- `chains.js`: shared chain registry used by the bot and backend.
- `render.yaml` and `docs/DEPLOY.md`: backend hosting and provider webhook setup.
- `SECURITY.md`: current safeguards and pre-mainnet gates.
- `docs/plans/` and `docs/solutions/`: accepted plans and compounded learnings
  when those artifacts exist.

The root package contains commitlint tooling, not a JavaScript workspace.
Install and test package dependencies in each package directory.

## Commands

Use Node.js 20, matching CI.

```bash
# Root commit tooling
npm ci
npm run commitlint -- --from origin/main --to HEAD --verbose

# Bot
cd bot
npm ci
npm test

# Backend
cd backend
npm ci
npm test

# Contracts
cd contracts
npm ci
npx hardhat test
npm run compile
```

Run the smallest relevant test set while iterating, then the full affected
package suite before handoff. Contract, money-path, and migration changes should
run all three suites when their behavior crosses package boundaries.

Use Conventional Commit subjects (`feat:`, `fix:`, `docs:`, `chore:`, and so
on). Never commit, push, deploy, or execute a mainnet script unless the user
explicitly requests it.

## Money-path invariants

### Sentoo webhooks

- Treat the webhook body as an unauthenticated ping containing a transaction ID.
  Never derive payment status or payout behavior from body-supplied status data.
- Re-fetch authoritative status through the Sentoo API before acting.
- Preserve constant-time comparison for the optional webhook URL token.
- Preserve Sentoo acknowledgement behavior: handled, duplicate, unknown, and
  refund events receive the expected successful acknowledgement; unexpected
  internal failures return an error so the provider retries.
- Status lookups are rate-limited per transaction. Keep the early acknowledgement
  for orders that are no longer `pending_payment`.
- Telegram notification failures must not abort or roll back the money flow.

### Orders and payouts

- Change order status through compare-and-set `tryTransition(id, from, to)`.
  Never replace it with an unconditional status update.
- `backend/domain/orderStatus.js` defines legal application states. When adding
  or changing a state, update its transition map, database CHECK constraints,
  audit behavior, user messages, and tests together.
- Preserve expiry/payment race safety: only the winning CAS operation acts or
  notifies.
- Release funds to the wallet pinned in `orders.payout_wallet` when the order was
  created. The user's mutable current wallet is only a legacy fallback.
- Preserve the existing refund ordering and failure recovery. Review both the
  database transition and chain transaction before changing it.
- The escrow is pooled custody with off-chain order accounting. Do not imply
  per-order balances are enforced on-chain.

## KYC and privacy

- Process only the Synaps session ID and terminal verification status.
- Never fetch Synaps document/step-detail endpoints and never store or log
  identity documents or document fields.
- Preserve constant-time webhook-secret comparison.
- Keep the Supabase service-role key server-side. Do not expose it to Telegram
  clients, browsers, logs, fixtures, or error messages.
- Treat formal CBCS/data-protection review and provider agreements as legal/ops
  gates, not completed engineering controls.

## Wallet, escrow, and key safety

- Preserve EIP-55 address validation and wallet-address history.
- Privy-created wallets belong to the user; do not introduce application
  custody accidentally.
- `Escrow.release` and `Escrow.refund` are owner-only pooled-fund operations.
  Changes require contract tests and explicit human review.
- Never hardcode or log private keys, provider secrets, tokens, RPC credentials,
  webhook secrets, or Supabase credentials.
- A raw `ADMIN_WALLET_PRIVATE_KEY` environment variable is testnet-only. Do not
  recommend it for mainnet.
- Do not run `deploy:base`, `deploy:polygon`, or `deploy:celo` without explicit
  human confirmation that audit, key-management, and compliance gates are met.

## Database rules

- Migrations are immutable after application. Add a new numerically ordered
  migration; do not edit an applied migration.
- Trust `supabase/migrations/` over summaries in `supabase/README.md` or
  `supabase/setup.sql` if they drift, and update consolidated documentation in
  the same change.
- RLS is enabled with no client policies, denying `anon` and `authenticated`;
  server-side service-role access bypasses RLS. New tables must preserve this
  deny-by-default posture unless a reviewed design explicitly changes it.
- Order statuses use CHECK constraints rather than a Postgres enum.
- Preserve the append-only order status event trigger.

## Testing and implementation style

- Bot and backend tests use Node's built-in `node:test`.
- Prefer dependency injection and fakes over live provider, database, RPC, or
  Telegram calls. Follow existing `createApp`, `createBot`, repository fake, and
  mocked-fetch patterns.
- Hardhat tests use Chai and OpenZeppelin-aware fixtures.
- Add regression tests for webhook acknowledgement/retry behavior, duplicate or
  out-of-order events, illegal/racing transitions, payout recipient selection,
  refund recovery, and secret sanitization whenever those paths change.
- Keep logs operationally useful but free of secrets and KYC data.

## Knowledge workflow

Before changing a sensitive path, read `SECURITY.md`, the relevant existing
tests, and any matching note in `docs/solutions/`. Put accepted implementation
plans in `docs/plans/`. After solving a reusable repository-specific problem,
capture the invariant and verification steps in `docs/solutions/`.
