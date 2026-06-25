-- Curaçao Crypto On-Ramp — initial schema (Issue #3)
--
-- Tables: users, orders. Apply via the Supabase SQL editor or the Supabase CLI
-- (`supabase db push`). All access is server-side using the service-role key,
-- which bypasses RLS; RLS is enabled with no policies so the anon/authenticated
-- roles are denied by default. See supabase/README.md.

create extension if not exists pgcrypto; -- gen_random_uuid()

-- Keep updated_at fresh on every UPDATE.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── users ──────────────────────────────────────────────
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  telegram_id   bigint not null unique,
  kyc_status    text   not null default 'none'
                  check (kyc_status in ('none', 'pending', 'approved', 'rejected')),
  wallet_address text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger users_set_updated_at
  before update on users
  for each row execute function set_updated_at();

-- ─── orders ─────────────────────────────────────────────
-- Order status uses a CHECK constraint (not a Postgres ENUM type) so #11 can
-- extend it (e.g. add 'expired') with a simple constraint swap, no ALTER TYPE.
create table if not exists orders (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references users (id) on delete restrict,
  amount_xcg            numeric(18, 2) not null check (amount_xcg > 0),
  amount_usdc           numeric(18, 6) not null check (amount_usdc > 0),
  sentoo_transaction_id text unique,
  status                text not null default 'pending_payment'
                          check (status in (
                            'pending_payment', 'paid', 'releasing',
                            'complete', 'failed', 'refunded'
                          )),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists orders_user_id_idx on orders (user_id);
create index if not exists orders_status_idx  on orders (status);

create trigger orders_set_updated_at
  before update on orders
  for each row execute function set_updated_at();

-- ─── Row-Level Security ─────────────────────────────────
-- Enabling RLS with NO policies denies all access to the anon/authenticated
-- roles. The backend connects with the service-role key, which has BYPASSRLS,
-- so it retains full access. Add narrowly-scoped policies later only if any
-- client-side access is ever required.
alter table users  enable row level security;
alter table orders enable row level security;
