# Supabase

Database schema for the on-ramp (Issue #3). Two tables: `users` and `orders`.

## Schema

`users`
| column | type | notes |
|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` |
| `telegram_id` | bigint | unique, not null |
| `kyc_status` | text | `none` \| `pending` \| `approved` \| `rejected` (default `none`) |
| `wallet_address` | text | nullable until set |
| `created_at` / `updated_at` | timestamptz | `updated_at` auto-maintained by trigger |

`orders`
| column | type | notes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK → `users.id`, `on delete restrict` |
| `amount_xcg` | numeric(18,2) | `> 0` |
| `amount_usdc` | numeric(18,6) | `> 0` |
| `sentoo_transaction_id` | text | unique, nullable |
| `status` | text | `pending_payment` \| `paid` \| `releasing` \| `complete` \| `failed` \| `refunded` (default `pending_payment`) |
| `created_at` / `updated_at` | timestamptz | `updated_at` auto-maintained by trigger |

The `status` values are enforced with a `CHECK` constraint (not a Postgres `ENUM`
type) so [#11](../../../issues/11) can extend them (e.g. add `expired`) without an
`ALTER TYPE`.

## Applying the migration

**Option A — Supabase SQL editor:** paste `migrations/0001_init.sql` and run.

**Option B — Supabase CLI:**
```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

## Security

- **Row-Level Security is enabled on both tables with no policies**, which denies
  all access to the `anon` and `authenticated` roles by default.
- The backend connects with the **service-role key** (`SUPABASE_SERVICE_ROLE_KEY`),
  which has `BYPASSRLS`, so server-side code retains full access.
- Connection details come **only** from environment variables — see
  `.env.example` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
  Never commit real keys.

> Add narrowly-scoped RLS policies only if direct client-side access is ever
> required. For this bot, all DB access is server-side.
