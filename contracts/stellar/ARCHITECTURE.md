# KambioX architecture

KambioX is an XCG (Caribbean guilder) to USDC on-ramp for Curaçao. People pay from
their bank account through Sentoo and receive USDC from a pooled escrow. This
document describes the system as it runs today (Telegram bot, Sentoo sandbox, EVM
escrow on testnets plus a capped mainnet canary) and the Stellar rebuild that this
directory holds (KambioEscrow, Soroban). Sections marked **PLANNED** are grant scope:
nothing in them is live.

Every section ends with the files it was checked against (paths from the repo root),
so a reader can confirm the diagram still matches the code. Diagrams are Mermaid and
render on GitHub.

Related: [`../../SECURITY.md`](../../SECURITY.md) (safeguards and pre-mainnet gates),
[`../../AGENTS.md`](../../AGENTS.md) (money-path invariants),
[`../../docs/stellar/TESTNET.md`](../../docs/stellar/TESTNET.md) (escrow runbook).

## 1. Scope and posture

- **Live today.** Telegram bot (`t.me/Cura_ramp_bot`), Sentoo sandbox payments, `Escrow.sol`
  on EVM testnets, and a capped mainnet canary on Base and Arc. Testnet and provider-sandbox
  posture: no public launch before CBCS sandbox admission.
- **This directory.** KambioEscrow v0.2.0, the minimal Soroban escrow: `deposit`, owner-only
  `release` and `withdraw`, `balance`, `owner`, `token`. Testnet only. Per-order and daily caps,
  pause, per-order refund and a multisig admin are Tranche 1 of the SCF Build (section 11).
- **Custody model.** Pooled custody with off-chain order accounting. One USDC float serves many
  small orders; the contract has no per-order ledger. Orders, limits and reconciliation live in
  Postgres.
- **Not done, and not claimed.** Independent escrow audit, multisig or KMS-backed ownership,
  and regulatory review are outstanding.

Verified against: `contracts/stellar/escrow/src/lib.rs`, `contracts/stellar/AGENTS.md`,
`MAINNET.md`, `SECURITY.md`.

## 2. System context and data flow

What crosses each boundary. The bot never holds a signing key; the backend never receives
KYC documents; the Supabase service-role key stays server-side.

```mermaid
flowchart LR
  U["User on Telegram"]
  B["Bot<br/>apps/bot (Grammy, long polling)"]
  BE["Backend<br/>apps/backend (Express)"]
  DB[("Supabase Postgres<br/>users, orders, status events")]
  S["Sentoo<br/>XCG bank rail"]
  P["Privy<br/>embedded wallets"]
  K["KYC provider<br/>(webhook only today)"]
  E["Escrow contract<br/>pooled USDC"]
  T["Telegram Bot API"]

  U -->|"/buy, amount, wallet"| B
  B -->|"user, order, wallet history"| DB
  B -->|"create payment: order id, XCG cents"| S
  B -->|"create wallet: email"| P
  B -->|"balance()"| E
  U -->|"pays in banking app"| S
  S -->|"webhook ping: transaction_id"| BE
  K -->|"webhook: session id, status"| BE
  BE -->|"status lookup (authoritative)"| S
  BE -->|"compare-and-set status"| DB
  BE -->|"release(recipient, amount)"| E
  BE -->|"order messages, receipt link"| T
  T --> U
```

Verified against: `apps/bot/index.js:73-235`, `apps/bot/services/payments.js:117-138`,
`apps/bot/services/privy.js:67-86`, `apps/backend/index.js:15-76`,
`apps/backend/routes/sentoo.js:65-166`, `apps/backend/routes/kyc.js:27-57`,
`apps/backend/services/notifier.js:15-25`.

## 3. Deployment

```mermaid
flowchart TB
  subgraph Render
    BE["backend web service<br/>webhooks, /ops, expiry sweeper"]
    BOT["bot background worker<br/>long polling, in-memory session"]
  end
  subgraph Supabase
    DB[("Postgres<br/>RLS on, no client policies<br/>service role only")]
  end
  subgraph Netlify
    L["landing page (static export)"]
  end
  subgraph Chains["Chain registry (packages/chains)"]
    EVM["Escrow.sol<br/>Base Sepolia, Arc, Celo, Polygon testnets<br/>capped canary on Base and Arc mainnet"]
    STL["KambioEscrow<br/>Stellar testnet (contracts/stellar)"]
  end

  BOT --> DB
  BE --> DB
  BOT -.->|"balance() read"| EVM
  BE -->|"release / refund via signer<br/>(raw key, Privy operator or Circle wallet)"| EVM
  BE -.->|"PLANNED: Stellar signer (Tranche 1)"| STL
```

Verified against: `render.yaml`, `netlify.toml`, `packages/chains/chains.js:10-109`,
`apps/backend/services/escrow.js:111-133`, `supabase/migrations/0001_init.sql:66-67`.

## 4. Order pipeline

From amount to USDC in the wallet. The liquidity check runs before any order row or payment
link exists, so a buyer is never charged for USDC the float cannot deliver.

```mermaid
flowchart LR
  A["amount in USDC"] --> LIM{"10 ≤ amount ≤ 25,000?"}
  LIM -->|no| A
  LIM -->|yes| Q["quote in XCG<br/>peg 1.82<br/>fee 3%, min 0.50, max 182 XCG<br/>Sentoo pass-through"]
  Q --> C["user confirms"]
  C --> LIQ{"balance − outstanding − buffer<br/>≥ amount?"}
  LIQ -->|no| X1["no order row<br/>ESCROW_INSUFFICIENT"]
  LIQ -->|yes| O["order row: pending_payment<br/>payout_wallet pinned"]
  O --> SL["Sentoo payment link"]
  SL --> PAY["user pays"]
  PAY --> W["webhook ping<br/>transaction_id only"]
  W --> F["re-fetch status<br/>from Sentoo API"]
  F -->|paid| CAS["CAS pending_payment → paid<br/>then paid → releasing"]
  F -->|failed| X2["failed"]
  F -->|expired| X3["expired"]
  CAS --> R["escrow.release(payout_wallet, amount)"]
  R -->|"tx confirmed"| D["complete<br/>Telegram receipt with explorer link"]
  R -->|error| X4["failed<br/>operator refund path"]
```

Verified against: `apps/bot/flows/buy.js:16-115`, `apps/bot/lib/fx.js:24-48,135-221`,
`apps/bot/services/payments.js:83-138`, `apps/backend/routes/sentoo.js:84-159`.

## 5. Order lifecycle

Every status change is a compare-and-set update (`UPDATE … WHERE id = ? AND status = from`),
and a trigger appends each change to `order_status_events`. Only the winning CAS acts or
notifies, which is what makes the payment/expiry race safe.

```mermaid
stateDiagram-v2
  [*] --> pending_payment: bot creates the order
  pending_payment --> paid: webhook, Sentoo API says paid
  pending_payment --> failed: Sentoo API says failed
  pending_payment --> expired: Sentoo API says expired, or sweeper after TTL
  paid --> releasing: backend claims the release
  releasing --> complete: release tx confirmed
  releasing --> failed: release error
  failed --> refunded: admin refund (bot CAS)
  refunded --> failed: compensating revert if the chain refund fails
  complete --> [*]
  refunded --> [*]
  expired --> [*]
```

Notes: `paid → failed` is legal in the map but no code path takes it today. `refunded → failed`
is a compensating update made by the bot outside the map. The release tx hash is sent to the
user and logged; it is not stored on the order yet (Tranche 1 adds `chain` and `release_tx_hash`).

Verified against: `apps/backend/domain/orderStatus.js:21-32`, `apps/backend/services/orders.js:74-84`,
`apps/bot/services/operator.js:114-133`, `supabase/migrations/0002_order_status_events.sql`.

## 6. Workflows

### 6.1 Onboarding and wallet

```mermaid
sequenceDiagram
  actor U as User
  participant B as Bot
  participant DB as Supabase
  participant P as Privy

  U->>B: /start, then Buy
  B->>DB: wallet for telegram_id
  DB-->>B: wallet or none
  alt KYC required and not approved
    B-->>U: KYC placeholder message
    Note over B: No KYC client is wired today (KYC_REQUIRED=false on Render).<br/>Sumsub via SEP-12 is Tranche 2.
  else no wallet yet
    B-->>U: paste an address or create one
    alt paste
      U->>B: 0x address
      B->>B: EIP-55 checksum (ethers.getAddress)
    else create
      U->>B: email
      B->>P: POST /api/v1/users (users app)
      P-->>B: wallet address
    end
    B->>DB: wallet_address_history row, users upsert
  end
  B-->>U: amount prompt
```

Verified against: `apps/bot/index.js:99-110,171-211`, `apps/bot/flows/kyc.js:14-55`,
`apps/bot/flows/wallet.js:17-127`, `apps/bot/services/users.js:7-37`, `apps/bot/state/session.js:39-47`.

### 6.2 Buy and payout, happy path

```mermaid
sequenceDiagram
  actor U as User
  participant B as Bot
  participant DB as Supabase
  participant S as Sentoo
  participant BE as Backend
  participant E as Escrow
  participant T as Telegram

  U->>B: amount, confirm quote
  B->>E: balance()
  B->>DB: sum outstanding (pending_payment, paid, releasing)
  B->>DB: insert order pending_payment, payout_wallet pinned
  B->>S: POST /v1/payment/new (order id, XCG cents)
  S-->>B: transaction_id, payment URL
  B->>DB: set sentoo_transaction_id
  B-->>U: Pay now link
  U->>S: pays in banking app
  S->>BE: POST /webhook/sentoo (transaction_id)
  BE->>DB: order by transaction_id
  BE->>S: GET /v1/payment/status/{merchant}/{tx}
  S-->>BE: paid
  BE->>DB: CAS pending_payment → paid
  BE->>T: Payment received
  BE->>DB: CAS paid → releasing
  BE->>E: release(payout_wallet, amount) via signer
  E-->>BE: tx hash
  BE->>DB: CAS releasing → complete
  BE->>T: receipt with explorer link
  BE-->>S: 200 OK
```

Verified against: `apps/bot/services/payments.js:117-138`, `apps/bot/services/sentoo.js:25-60`,
`apps/backend/routes/sentoo.js:98-159`, `apps/backend/services/sentoo.js:119-130`,
`apps/backend/services/escrow.js:48-91`.

### 6.3 Payment failure and the expiry race

The webhook body is treated as an unauthenticated ping. Status comes only from the Sentoo API,
and the fetch happens only while the order is still `pending_payment`, which keeps the handler
under Sentoo's per-transaction lookup limit and makes duplicate or out-of-order webhooks harmless.

```mermaid
sequenceDiagram
  participant S as Sentoo
  participant BE as Backend webhook
  participant X as Expiry sweeper
  participant DB as Supabase
  participant T as Telegram

  par webhook
    S->>BE: ping (transaction_id)
    BE->>DB: order by transaction_id
    BE->>S: status lookup
    S-->>BE: expired
    BE->>DB: CAS pending_payment → expired
    DB-->>BE: 1 row or 0 rows
  and sweeper, every EXPIRY_SWEEP_MS
    X->>DB: pending_payment older than ORDER_TTL_MINUTES
    X->>DB: CAS pending_payment → expired
    DB-->>X: 1 row or 0 rows
  end
  Note over BE,X: exactly one CAS wins, and only the winner notifies
  BE->>T: expired message (if winner)
  X->>T: expired message (if winner)
```

Acknowledgement rules: handled, duplicate, unknown-transaction and refund webhooks get 200;
missing `transaction_id` gets 400; an unexpected internal error returns 500 so Sentoo retries.
A Telegram failure never aborts or rolls back the money flow.

Verified against: `apps/backend/routes/sentoo.js:65-166`, `apps/backend/services/expiry.js:19-71`,
`apps/backend/services/orders.js:86-102`, `docs/solutions/sentoo-webhook-refetch-and-cas.md`.

### 6.4 Admin refund

The on-chain refund returns pooled USDC to the operator treasury (the escrow owner), not to the
buyer. Any fiat refund to the buyer is handled outside the system.

```mermaid
sequenceDiagram
  actor A as Admin (Telegram)
  participant B as Bot
  participant DB as Supabase
  participant BE as Backend /ops
  participant E as Escrow

  A->>B: /refund order-id
  B->>DB: order (must be failed)
  B-->>A: confirm keyboard
  A->>B: confirm
  B->>DB: CAS failed → refunded
  B->>BE: POST /ops/escrow/refund (Bearer OPS_API_SECRET)
  BE->>E: refund(amount) to owner
  alt tx ok
    E-->>BE: tx hash
    BE-->>B: 200, tx hash
    B-->>A: refund sent, tx hash
  else tx fails
    BE-->>B: 502
    B->>DB: CAS refunded → failed (revert)
    B-->>A: refund failed, order back to failed
  end
```

Verified against: `apps/bot/flows/admin.js:80-139`, `apps/bot/services/operator.js:23-33,114-133`,
`apps/backend/routes/ops.js:33-65`, `contracts/evm/src/Escrow.sol:57-63`.

### 6.5 Float funding and access control

```mermaid
sequenceDiagram
  participant O as Operator (Circle wallet or raw key)
  participant USDC as USDC token
  participant E as Escrow
  participant BE as Backend signer

  O->>USDC: transfer(escrow, amount)
  Note over E: balance() = token.balanceOf(escrow)<br/>no per-order ledger on chain
  BE->>E: release(recipient, amount) or refund(amount)
  Note over E: owner-only, non-reentrant
  Note over BE: Privy operator policy: only eth_sendTransaction with to == escrow
```

Verified against: `apps/backend/scripts/fund-escrow.js:58-72`, `contracts/evm/src/Escrow.sol:40-68`,
`apps/backend/scripts/setup-operator-policy.js:54-80`.

## 7. Data model

```mermaid
erDiagram
  USERS ||--o{ ORDERS : places
  USERS {
    uuid id PK
    bigint telegram_id UK
    text kyc_status
    text wallet_address
    text kyc_session_id UK
    timestamptz created_at
    timestamptz updated_at
  }
  ORDERS ||--o{ ORDER_STATUS_EVENTS : logs
  ORDERS {
    uuid id PK
    uuid user_id FK
    numeric amount_xcg
    numeric amount_usdc
    text sentoo_transaction_id UK
    text status
    text payout_wallet
    timestamptz created_at
    timestamptz updated_at
  }
  ORDER_STATUS_EVENTS {
    uuid id PK
    uuid order_id FK
    text from_status
    text to_status
    timestamptz created_at
  }
  WALLET_ADDRESS_HISTORY {
    uuid id PK
    bigint telegram_id
    text old_address
    text new_address
    timestamptz changed_at
  }
```

- `orders.status` is a CHECK constraint over `pending_payment, paid, releasing, complete,
  failed, refunded, expired` (no Postgres enum).
- `order_status_events` is filled by an AFTER INSERT/UPDATE trigger whenever the status changes.
- RLS is enabled on every table with no client policies: `anon` and `authenticated` are denied,
  the server-side service role bypasses it.
- `users.kyc_status` and `users.kyc_session_id` are the only KYC data stored. No documents, ever.

Verified against: `supabase/migrations/0001_init.sql`, `0002_order_status_events.sql`,
`0003_users_kyc_session.sql`, `0004_wallet_address_history.sql`, `0005_orders_payout_wallet.sql`.

## 8. Delivery pipeline

```mermaid
flowchart LR
  PR["pull request"] --> CL["commitlint"]
  CL --> JS["bot, backend, EVM<br/>node:test coverage gates<br/>lines ≥ 80%"]
  CL --> ST["contracts/stellar CI<br/>fmt, clippy, cargo-audit,<br/>stellar contract build, llvm-cov ≥ 90%"]
  JS --> M["merge to main<br/>(human review)"]
  ST --> M
  M --> TAG["tag stellar-escrow-v*"]
  TAG --> REL["release-stellar.yml<br/>stellar-expert/soroban-build-workflow"]
  REL --> ART["GitHub release:<br/>optimized wasm, sha256,<br/>build attestation, source_repo meta"]
  ART --> VER["gh attestation verify"]
  VER --> DEP["stellar contract deploy<br/>from the release wasm"]
  DEP --> SE["StellarExpert:<br/>source-verified contract"]
```

The deployed wasm must be the release artifact: a local `make build` uses a different CLI
version and hashes differently, so it cannot be source-verified.

Verified against: `.github/workflows/ci.yml`, `.github/workflows/contracts-stellar.yml`,
`.github/workflows/release-stellar.yml`, `docs/stellar/TESTNET.md` (section 6).

## 9. Stellar target (PLANNED, SCF Build scope)

Nothing in this section is live. It shows where each grant deliverable plugs in.

```mermaid
flowchart LR
  subgraph Buyers
    BOT["Telegram bot<br/>Privy Stellar wallet,<br/>sponsored USDC trustline"]
    W["any Stellar wallet<br/>via SEP-24"]
  end
  subgraph Anchor["Anchor Platform (Tranche 2)"]
    SEP["SEP-1 toml, SEP-10 auth,<br/>SEP-12 KYC (Sumsub),<br/>SEP-24 deposit"]
  end
  BE["Backend<br/>Sentoo confirm, CAS,<br/>Stellar operator signer"]
  subgraph Contract["KambioEscrow v1 (Tranche 1)"]
    KE["SAC USDC float<br/>release within per-order and daily caps<br/>refund, pause<br/>admin = multisig account, operator = hot key"]
  end
  S["Sentoo<br/>XCG bank rail"]
  BR["Bridge (Tranche 2)<br/>USD wire → Stellar USDC"]

  BOT -->|"order, XCG payment"| S
  W -->|"deposit request"| SEP
  SEP -->|"quote + Sentoo page"| S
  S -->|"webhook ping"| BE
  BE -->|"release(recipient, amount)"| KE
  KE -->|"USDC"| BOT
  KE -->|"USDC"| W
  BR -->|"deposit(float)"| KE
```

### 9.1 SEP-24 deposit from a third-party wallet (PLANNED)

```mermaid
sequenceDiagram
  participant W as Stellar wallet
  participant AP as Anchor Platform
  participant KYC as Sumsub
  participant BE as Backend
  participant S as Sentoo
  participant KE as KambioEscrow

  W->>AP: SEP-10 challenge, signed
  AP-->>W: JWT
  W->>AP: SEP-12 customer (fields only)
  AP->>KYC: verification
  KYC-->>AP: approved
  W->>AP: SEP-24 deposit (XCG → USDC)
  AP-->>W: interactive URL
  W->>BE: quote, confirm
  BE->>S: create payment
  S-->>W: payment page
  W->>S: pays in banking app
  S->>BE: webhook ping
  BE->>S: status lookup
  S-->>BE: paid
  BE->>KE: release(account, amount)
  BE->>AP: transaction completed
  AP-->>W: status: completed
```

Verified against: the SCF abstract (integration description) and `docs/stellar/TESTNET.md`
(notes for the backend port). No code yet.

## 10. Trust boundaries and invariants

| Boundary | Rule | Where it is enforced |
|---|---|---|
| Sentoo webhook | Body is an unauthenticated ping. Status comes from the Sentoo API only. Optional URL token compared in constant time | `apps/backend/routes/sentoo.js:18-22,98` |
| Order status | Compare-and-set `tryTransition(id, from, to)`, never an unconditional update | `apps/backend/services/orders.js:74-84` |
| Payout recipient | The wallet pinned in `orders.payout_wallet` at order creation; the user's current wallet only as a legacy fallback | `apps/backend/routes/sentoo.js:140-143` |
| Liquidity | No order row or payment link unless `balance − outstanding − buffer ≥ amount` | `apps/bot/services/payments.js:83-121` |
| Escrow | Pooled custody, owner-only `release`/`refund` (EVM) and `release`/`withdraw` (Stellar) | `contracts/evm/src/Escrow.sol`, `contracts/stellar/escrow/src/lib.rs` |
| Signing | Backend only; raw key is testnet-only, Privy or Circle MPC wallet otherwise; policy restricts `to == escrow` | `apps/backend/services/escrow.js:111-133`, `apps/backend/scripts/setup-operator-policy.js` |
| KYC data | Session id and terminal status only; no document endpoints, no document fields in logs or DB | `apps/backend/routes/kyc.js`, `supabase/migrations/0003_users_kyc_session.sql` |
| Database | RLS on, no client policies; service role server-side only | `supabase/migrations/0001_init.sql:66-67` |
| Notifications | Telegram failures never abort or roll back the money flow | `apps/backend/routes/sentoo.js:26-38` |

## 11. SCF Build tranches

Deliverables for the Integration Track submission (Anchor Platform, Bridge, Privy). SCF pays
10% on acceptance, then 20% / 30% / 40% against tranches 1 to 3; each tranche form is due
within 90 days of the previous payment, and the project runs at most 6 months. The shares
below are of each tranche, so the sheet can be filled from them. Audit, legal and entity costs
are outside the budget by SCF rules (the audit goes through the SCF Audit Bank).

### Tranche 1, MVP, months 1-2 (20% of the award)

"KambioEscrow v1 and the bot on Stellar testnet."

| ID | Deliverable | Stellar component | Evidence | Share of T1 |
|---|---|---|---|---|
| 1.1 | KambioEscrow v1 on testnet: `release`, per-order `refund`, per-order cap, daily cap, `pause`/`unpause`, admin rotation. Roles: `admin` = multisig account (protocol-enforced signer weights) for pause, caps, withdraw and rotation; `operator` = hot key for `release` within caps. Event on every state change, ≥ 90% line coverage, attested release, StellarExpert-verified | Soroban, Stellar Asset Contract (USDC) | contract ID, release tag, CI run, explorer link | 50% |
| 1.2 | Backend Stellar release path: `stellar-testnet` in `packages/chains`, Stellar signer adapter in the backend escrow service, migration adding `orders.chain` and `orders.release_tx_hash`, explorer links in notifications | Soroban RPC, operator account | Sentoo sandbox payment → USDC in a Stellar testnet wallet, tx hash, recorded demo | 25% |
| 1.3 | Privy Stellar wallets in the bot with a sponsored USDC trustline (sponsor account, sponsored reserves, change trust) | Privy (Integration List) | new user from `/start` to a funded wallet on testnet | 15% |
| 1.4 | Runbook v2 and this document's Stellar section marked live | docs | merged docs | 10% |

### Tranche 2, Testnet, months 3-4 (30% of the award)

"Any Stellar wallet buys USDC with XCG."

| ID | Deliverable | Stellar component | Evidence | Share of T2 |
|---|---|---|---|---|
| 2.1 | Anchor Platform on testnet: SEP-1 `stellar.toml` on the KambioX domain, SEP-10 auth, SEP-12 KYC through the Sumsub callback, SEP-24 interactive deposit reusing the existing quote and Sentoo page, release to the SEP-10 account | Anchor Platform (Integration List) | SDF anchor validator pass for SEP-1/10/12/24; deposit from a third-party wallet (Lobstr, Beans or Freighter) recorded | 45% |
| 2.2 | Bridge refill: business account, USD wire → Stellar USDC → `deposit` into KambioEscrow; treasury reconciliation job (Bridge transfers vs on-chain deposits); XCG → USD → Bridge runbook | Bridge (Integration List) | sandbox transfer landing in the escrow, reconciliation report | 15% |
| 2.3 | Threat model and monitoring: STRIDE document; alerts on escrow balance vs outstanding orders, daily cap usage, pause state and failed releases; on-chain event ingestion feeding reconciliation; Audit Bank application submitted | Soroban events, RPC | documents in the repo, alert screenshots, Audit Bank confirmation | 25% |
| 2.4 | Narrow user testing in Curaçao: 20-30 testers on testnet through the bot and a SEP-24 wallet, feedback report | bot, Anchor Platform | tester log and report | 15% |

### Tranche 3, Mainnet, months 5-6 (40% of the award)

"Capped mainnet inside the CBCS sandbox."

| ID | Deliverable | Stellar component | Evidence | Share of T3 |
|---|---|---|---|---|
| 3.1 | KambioEscrow on mainnet, attested and verified, admin multisig live, caps at the sandbox figures, pause drill run, audit findings fixed | Soroban mainnet | contract ID, multisig account, drill log | 30% |
| 3.2 | Anchor Platform on mainnet with Circle USDC, Sumsub production KYC | Anchor Platform | `stellar.toml` live, mainnet deposit from a third-party wallet | 25% |
| 3.3 | First production float through Bridge, treasury runbook executed | Bridge | funding transaction into the escrow | 10% |
| 3.4 | Committed on-chain metric (Integration Track gate): at least 100 completed orders and 50 distinct recipient accounts released on mainnet within the tranche window | Soroban mainnet | explorer query over release events | 20% |
| 3.5 | Public docs: SEP-24 integrator guide, final architecture, monitoring dashboards | docs | merged docs, dashboard links | 15% |

Dependency stated up front: tranche 3 needs CBCS sandbox admission. If admission slips past
month 6, the fallback is a team-and-tester-only mainnet canary under caps (as on Base and Arc
today), with the 3.4 metric measured on that canary.

Mapping to the abstract: 1.1 to 1.3 are "Months 1-2", 2.1 to 2.3 are "Months 3-4",
3.1 to 3.4 are "Months 5-6". 2.4 uses the Integration Track allowance for narrow user testing.
