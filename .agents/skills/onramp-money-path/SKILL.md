---
name: onramp-money-path
description: Guides changes to Sentoo payment webhooks, order states, expiry, payouts, escrow release, and refunds. Use whenever work can affect whether, when, or where USDC moves.
license: MIT
---

# On-ramp money path

Read `AGENTS.md` first. Treat this as a map to the source-of-truth code, not a
replacement for it.

## Trace the flow

1. Order creation pins the payout recipient:
   - `bot/services/payments.js`
   - `supabase/migrations/0005_orders_payout_wallet.sql`
2. Sentoo sends a transaction ID ping; the backend re-fetches authoritative
   status:
   - `backend/routes/sentoo.js`
   - `backend/services/sentoo.js`
3. Compare-and-set transitions claim each step:
   - `backend/services/orders.js`
   - `backend/domain/orderStatus.js`
4. The backend releases escrow to the pinned wallet:
   - `backend/services/escrow.js`
   - `contracts/src/Escrow.sol`
5. Failed orders may be refunded through the admin flow:
   - `bot/flows/admin.js`
   - `bot/services/operator.js`

## Change checklist

- Never trust payment status from webhook input; re-fetch it from Sentoo.
- Preserve successful acknowledgements for duplicates and handled events, and
  retryable errors for unexpected internal failures.
- Keep every status mutation conditional on the expected prior state.
- Update the application transition map, database constraints/audit behavior,
  notifications, and tests together when states change.
- Release to `orders.payout_wallet`; do not substitute a mutable user wallet.
- Preserve notification isolation and refund failure recovery.
- Treat contract owner operations and all mainnet commands as human-reviewed.

## Verification

Run the focused backend webhook, state, and expiry tests; bot payment/admin tests;
and Hardhat escrow tests when their corresponding behavior changes. Include
duplicate, out-of-order, race, chain-failure, and recipient-selection cases.
