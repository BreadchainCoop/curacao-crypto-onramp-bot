-- Append-only audit log of payout-wallet address changes.
-- When a user changes their saved wallet, the bot records the old and new
-- address here (keyed by telegram_id) so there is a trail of where funds could
-- have been sent. Rows are never updated or deleted.

create table if not exists wallet_address_history (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  old_address text,
  new_address text not null,
  changed_at timestamptz not null default now()
);

create index if not exists wallet_address_history_telegram_id_idx
  on wallet_address_history (telegram_id);

alter table wallet_address_history enable row level security;
