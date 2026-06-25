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
