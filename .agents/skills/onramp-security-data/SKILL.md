---
name: onramp-security-data
description: Guides KYC, secrets, Supabase migrations, RLS, deployment, and mainnet-readiness changes. Use when work touches sensitive data, credentials, schema, infrastructure, or production controls.
license: MIT
---

# On-ramp security and data

Read `AGENTS.md` and `SECURITY.md` before changing these paths. Distinguish
implemented safeguards from pre-mainnet work that remains outstanding.

## KYC and privacy

- Accept only Synaps session IDs and status values in this system.
- Do not fetch, persist, or log identity documents or document fields.
- Preserve constant-time webhook-secret comparison.
- Inspect `backend/routes/kyc.js`, `backend/services/synaps.js`,
  `backend/services/users.js`, and the matching tests.
- Treat compliance approval and processor agreements as legal/operations gates,
  not code assertions.

## Secrets and keys

- Use environment variables at runtime and placeholders in `.env.example`.
- Never log keys, tokens, webhook secrets, provider credentials, or RPC URLs
  containing credentials.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-side.
- A raw admin private key is testnet-only. Mainnet requires reviewed multisig or
  KMS-backed ownership plus the remaining `SECURITY.md` gates.

## Database and deployment

- Add a numerically ordered migration; do not rewrite an applied migration.
- Keep RLS enabled and deny client roles by default unless a reviewed design
  explicitly introduces policies.
- Keep order constraints and the append-only status audit synchronized with
  application behavior.
- Reconcile `supabase/setup.sql`, summaries, and deploy documentation when schema
  or configuration changes.
- Confirm chain selection through `chains.js`; never infer a safe network from
  an RPC URL or contract address alone.
- Do not deploy or alter external services without explicit user authorization.

## Verification

Use fake services and sanitized errors in tests. Run affected KYC/provider tests,
database checks, and deployment/config validation without contacting live
providers or production infrastructure.
