# Sentoo webhook: authoritative re-fetch and CAS

## Problem

Sentoo webhook delivery cannot safely be treated as a payment authorization:

- the payload is an unsigned ping containing a transaction ID, not trusted
  payment status;
- deliveries may be duplicated or arrive after another process changed the
  order;
- status lookups are limited per transaction;
- returning the wrong acknowledgement causes unnecessary provider retries.

Without explicit concurrency control, duplicate paid events could release escrow
more than once.

## Solution

`backend/routes/sentoo.js` combines two independent safeguards:

1. **Authoritative re-fetch.** For an order still in `pending_payment`, request
   its status from the Sentoo API and map only the provider response to a local
   outcome. Never read payment status from the webhook body.
2. **Compare-and-set transition.** Claim the paid event with
   `tryTransition(orderId, pending_payment, paid)`. The Supabase implementation
   in `backend/services/orders.js` updates only a row whose current status still
   matches. A duplicate or racing handler loses that update and cannot release
   funds.

The handler then transitions `paid -> releasing -> complete`. A chain failure
moves `releasing -> failed` for operator recovery. Database triggers from
`supabase/migrations/0002_order_status_events.sql` append every successful state
change to the audit log.

## Invariants

- Validate the optional URL token with constant-time comparison.
- Fetch provider status only while the order is `pending_payment`.
- Never replace `tryTransition` with a blind status update.
- Release to the order's pinned `payout_wallet`; use the user's current wallet
  only for legacy rows.
- Notification failures do not interrupt money movement.
- Acknowledge handled, duplicate, unknown-transaction, and refund pings with
  success. Return an error for unexpected database/provider failures so Sentoo
  retries.

## Verification

`backend/test/sentoo-webhook.test.js` covers token rejection, graceful refund and
unknown-transaction acknowledgements, non-paid statuses, the successful release
path, duplicate idempotency, failed/expired payments, and chain release failure.

Run:

```bash
cd backend
npm test
```

For transition changes, also run `backend/test/order-status.test.js` and
`backend/test/expiry.test.js`.

## Limits

Sentoo does not provide an HMAC-authenticated status payload in this integration;
the API re-fetch is the trust anchor. The escrow remains pooled custody with
off-chain order accounting, so this pattern reduces duplicate processing but
does not remove operator trust or replace a contract audit.
