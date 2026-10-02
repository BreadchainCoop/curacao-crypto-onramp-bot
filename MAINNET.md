# KambioX — Live Mainnet Addresses (canonical ledger)

**This file is the single source of truth for what is live on mainnet.** If an
address isn't listed here as live, do not fund it. Last verified on-chain:
**2026-10-02** (owner/token read directly from each escrow).

> Posture: this is a **bounded canary** (small float, MPC/KMS custody, no raw key
> owns funds). It is **not** audited production. See `SECURITY.md` and `AGENTS.md`
> for the pre-mainnet gates that remain open (independent audit, role split,
> Safe multisig). Keep floats small and pull them back between sessions.

---

## ✅ Live escrows

Each escrow is `Escrow.sol` (OZ v5 `Ownable` + `ReentrancyGuard` + `SafeERC20`),
owner-only `release()` / `refund()`. The **owner is the MPC/KMS operator wallet**
(the signer), never a raw key and never the deployer.

### Base mainnet — chainId 8453

| Role | Address | Notes |
|---|---|---|
| **Escrow** | [`0x05b9aD81666f3a245500FCFc4E0e13017BcFAcD4`](https://basescan.org/address/0x05b9aD81666f3a245500FCFc4E0e13017BcFAcD4) | holds the USDC float |
| **USDC (token)** | [`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`](https://basescan.org/address/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) | canonical Circle Base USDC |
| **Operator / owner (signer)** | [`0xE6297a77F388DBC4Aa3bcFA1a63a72E1E2371eD8`](https://basescan.org/address/0xE6297a77F388DBC4Aa3bcFA1a63a72E1E2371eD8) | **Privy** MPC server wallet; signs `release`/`refund`, pays gas (**ETH**) |
| **Deployer** | [`0xDc9be2a428557469097CE7e7aAeB9C65C280FC44`](https://basescan.org/address/0xDc9be2a428557469097CE7e7aAeB9C65C280FC44) | **gas-only**, owns nothing (used `ESCROW_OWNER` to hand ownership to the operator at deploy) |

- Backend signer: `ESCROW_SIGNER=privy` (`PRIVY_OPERATOR_*` creds in Render only).
- Gas is **ETH** — keep the operator topped up with a little ETH or releases fail.

### Arc mainnet — chainId 5042 (Circle)

| Role | Address | Notes |
|---|---|---|
| **Escrow** | [`0x0970462Cece33d425dBa716cbF4855bb4f44fCF5`](https://explorer.arc.io/address/0x0970462Cece33d425dBa716cbF4855bb4f44fCF5) | holds the USDC float |
| **USDC (token)** | [`0x3600000000000000000000000000000000000000`](https://explorer.arc.io/address/0x3600000000000000000000000000000000000000) | Arc USDC predeploy — see the Arc quirk below |
| **Operator / owner (signer)** | [`0x04Aa2bd43f63f913D9DBc8460e80d4f5F1853565`](https://explorer.arc.io/address/0x04Aa2bd43f63f913D9DBc8460e80d4f5F1853565) | **Circle** developer-controlled wallet; signs `release`/`refund`, pays gas (**USDC**) |
| **Deployer** | [`0x76DC174F243faCB10E2b015cF1De48F3B84f63e9`](https://explorer.arc.io/address/0x76DC174F243faCB10E2b015cF1De48F3B84f63e9) | **gas-only**, owns nothing; fresh throwaway, chosen to give Arc a *distinct* escrow address |

- Backend signer: `ESCROW_SIGNER=circle` (`CIRCLE_API_KEY` / `CIRCLE_ENTITY_SECRET` / `CIRCLE_WALLET_ID` in Render only; wallet IDs are not secrets but live with the creds, not in this repo).
- Proven live 2026-10-02: Circle signed a fund-in (tx `0xa6e5e88a…533756`) and a `release` (tx `0x8de0823f…e41497`) on Arc 5042.

---

## 🛑 Deprecated — DO NOT FUND, on ANY chain

**`0xdf4547092471a630d90f1A44521112C9aaC176e6`**

This is the original deployer's **nonce-0 CREATE address**, so it is the *same
string on every chain* — which is exactly why it's dangerous.

- **Base mainnet:** a broken escrow that bound its `token` to *itself* (a stale
  `.env` `USDC_ADDRESS` shadowed the real Base USDC at deploy) — permanently dead.
- **Arc mainnet:** an orphaned escrow, superseded by the fresh-address redeploy to
  `0x0970…fCF5` above.
- **Testnets:** this string is the self-minted `MockUSDC` **token**, not an escrow.

> `0x05b9…FacD4` is **NOT** deprecated — it is the live Base mainnet escrow (and
> the testnet escrows). Only `0xdf45…76e6` is dead.

---

## Key-safety invariants (do not break)

- **The operator (owner) is always an MPC/KMS wallet** (Privy on Base, Circle on
  Arc). The private key never lands on a host; the backend signs by API request.
- **Deployers are gas-only and own nothing.** Treat them as disposable/compromised.
- **The legacy `ADMIN_WALLET_PRIVATE_KEY` must never own mainnet funds.** It's a
  testnet-only raw signer.
- **Floats are small and recoverable:** the owner can `refund(amount)` to pull the
  float back to the operator between sessions. Keep idle exposure minimal.

---

## ⚠️ The Arc funding quirk (how to fund the Arc escrow)

On Arc, **USDC is both the native gas coin and the ERC-20 at `0x3600…`** — one
balance, two interfaces, no wrap/convert step.

- A normal wallet "send USDC" does a **native value transfer**. To an EOA that's
  fine; **to a contract (the escrow) it reverts** — the escrow has no payable
  `receive()`.
- To fund the escrow you **must use the ERC-20 rail**: call `transfer(escrow, amt)`
  on the token `0x3600…` (the tx's `to` should be `0x3600…`, not the escrow).
- Do **not** "fix" this by adding a payable `receive()` to `Escrow.sol` — that's an
  audit-gated custody change and would let native coin get stuck on non-Arc chains.

Easiest path: `backend/scripts/fund-escrow.js` funds via the Circle operator over
the ERC-20 rail. The operator must hold USDC for **both** the float transfer and
gas, so top up the operator EOA first (a plain native send to an EOA works).

---

## Config cheat-sheet (Render / `.env`)

Switching the live chain is a single `CHAIN` flip. Mainnet addresses come from
**per-chain overrides** (the shared globals are never used on mainnet — see
`chains.js`):

```bash
# Base mainnet
CHAIN=base-mainnet
ESCROW_SIGNER=privy
BASE_MAINNET_ESCROW_ADDRESS=0x05b9aD81666f3a245500FCFc4E0e13017BcFAcD4
# USDC is baked in chains.js (knownUsdc); override only for a bridged variant.

# Arc mainnet
CHAIN=arc-mainnet
ESCROW_SIGNER=circle
ARC_MAINNET_ESCROW_ADDRESS=0x0970462Cece33d425dBa716cbF4855bb4f44fCF5
# USDC baked as 0x3600…0000 in chains.js.
```

Keep the bot and backend on the **same** `CHAIN`.

---

_Generated deploy records live in `contracts/deployments.json`; testnet escrows
and the real-USDC-on-Arc-testnet path are documented in `contracts/DEPLOYMENTS.md`._
