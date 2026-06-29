-- Combined database setup for the Curaçao Crypto On-Ramp Bot.
-- Convenience file: runs migrations 0001 + 0002 + 0003 in order.
-- Paste this whole file into the Supabase SQL editor on a fresh project.

-- ============================================================
-- migrations/0001_init.sql
-- ============================================================
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

-- ============================================================
-- migrations/0002_order_status_events.sql
-- ============================================================
-- Curaçao Crypto On-Ramp — order state machine (Issue #11)
--
-- Adds the 'expired' status and a DB-enforced, append-only audit log of every
-- order status change (so "all transitions are logged with timestamps" holds no
-- matter which process makes the change).

-- 1) Extend the order status set with 'expired'.
alter table orders drop constraint orders_status_check;
alter table orders add constraint orders_status_check
  check (status in (
    'pending_payment', 'paid', 'releasing',
    'complete', 'failed', 'refunded', 'expired'
  ));

-- 2) Append-only audit log of status transitions.
create table if not exists order_status_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders (id) on delete cascade,
  from_status text,                 -- null for the initial status on insert
  to_status   text not null,
  created_at  timestamptz not null default now()
);

create index if not exists order_status_events_order_id_idx
  on order_status_events (order_id, created_at);

-- 3) Log the initial status and every subsequent change automatically.
create or replace function log_order_status_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into order_status_events (order_id, from_status, to_status)
      values (new.id, null, new.status);
  elsif new.status is distinct from old.status then
    insert into order_status_events (order_id, from_status, to_status)
      values (new.id, old.status, new.status);
  end if;
  return new;
end;
$$;

create trigger orders_log_status_after_insert
  after insert on orders
  for each row execute function log_order_status_change();

create trigger orders_log_status_after_update
  after update on orders
  for each row execute function log_order_status_change();

-- Same RLS posture as the rest of the schema: locked to anon/authenticated;
-- the service-role key bypasses RLS.
alter table order_status_events enable row level security;

-- ============================================================
-- migrations/0003_users_kyc_session.sql
-- ============================================================
-- Curaçao Crypto On-Ramp — link users to their Synaps KYC session (Issue #8)
--
-- The Synaps webhook reports results by session_id (and carries no PII), so we
-- store the session id on the user to match the webhook back to the right row.

alter table users add column if not exists kyc_session_id text;

create unique index if not exists users_kyc_session_id_key
  on users (kyc_session_id);
