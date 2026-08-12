# Cura-Ramp — Deployed Escrow Contracts

The Cura-Ramp escrow (`Escrow.sol`, OpenZeppelin v5 — `Ownable` + `ReentrancyGuard` + `SafeERC20`) is deployed and live on the following networks. Each testnet deployment is self-contained: it holds **100,000 test USDC** and is fully functional for the deposit → release → refund flow.

| Network | Escrow contract | Explorer | Status |
|---|---|---|---|
| **Base Sepolia** (84532) | `0x05b9aD81666f3a245500FCFc4E0e13017BcFAcD4` | [view](https://sepolia.basescan.org/address/0x05b9aD81666f3a245500FCFc4E0e13017BcFAcD4) | 🟢 Live · seeded 100k USDC |
| **Arc testnet** (5042002, Circle) | `0x05b9aD81666f3a245500FCFc4E0e13017BcFAcD4` | [view](https://testnet.arcscan.app/address/0x05b9aD81666f3a245500FCFc4E0e13017BcFAcD4) | 🟢 Live · seeded 100k USDC |
| **Celo Sepolia** (11142220) | `0x05b9aD81666f3a245500FCFc4E0e13017BcFAcD4` | [view](https://sepolia.celoscan.io/address/0x05b9aD81666f3a245500FCFc4E0e13017BcFAcD4) | 🟢 Live · seeded 100k USDC |
| **Polygon Amoy** (80002) | `0x05b9aD81666f3a245500FCFc4E0e13017BcFAcD4` | [view](https://amoy.polygonscan.com/address/0x05b9aD81666f3a245500FCFc4E0e13017BcFAcD4) | 🟢 Live · seeded, end-to-end proven |

**Owner / operator:** `0xDc9be2a428557469097CE7e7aAeB9C65C280FC44` (testnet deployer — the only address permitted to call `release()` / `refund()`).

Notes:
- The escrow deploys to the **same address on every chain** (`0x05b9…FacD4`) — the deployer's first deployment on each network, so the CREATE address is identical.
- Testnets use a self-minted `MockUSDC` (`0xdf45…76e6`) so each deployment is immediately demonstrable without depending on external faucet liquidity.
- **Source verification** on each explorer is pending a (free) explorer API key — the contracts are live and their bytecode is on-chain; verified source is a fast follow.
- **Mainnet** (Base, Polygon, Celo) is a grant-funded milestone, gated on an independent audit + a multisig owner (rather than the current testnet key).

_Records are generated automatically into `contracts/deployments.json` on each deploy._

## Optional: Arc testnet with real Circle USDC

The Arc escrow above uses our self-minted `MockUSDC`. Arc is special, though: Circle exposes the **real testnet USDC** as a standard **ERC-20** at the system predeploy `0x3600000000000000000000000000000000000000` (6-decimal ERC-20 view; the native gas token is the same asset at 18 decimals). Because `Escrow.sol` is a generic 6-decimal ERC-20 escrow, it can hold that token **with no contract changes** — the only requirement is deploying an escrow whose immutable `token` is bound to that address.

To stand up an Arc escrow backed by real Circle USDC:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run deploy:arc-testnet-usdc
```

This runs the deploy **without** `USE_MOCK_USDC`, so it resolves USDC from `KNOWN_USDC[5042002]` = `0x3600…0000`. It produces a **new, separate** escrow address (bound to real USDC) — it does not touch the MockUSDC escrow or any other chain.

Then:
1. Get testnet USDC from [faucet.circle.com](https://faucet.circle.com/) to the deployer wallet (you also need native USDC there for **gas**).
2. Fund the new escrow: `transfer` USDC to its address, or `approve` + `deposit()`. Amounts are in 6-decimal units (100 USDC = `100000000`). The real-USDC path is **not** auto-seeded (only the MockUSDC path seeds).
3. Point config at it: set `ESCROW_CONTRACT_ADDRESS` (+ `USDC_ADDRESS=0x3600…0000`) for Arc, then `CHAIN=arc-testnet`.

⚠️ **Do not send real Arc USDC to the MockUSDC escrow** (`0x05b9…FacD4`) — its `token` is immutably MockUSDC, it has no sweep, and any other token sent there is unrecoverable. Only ever fund an escrow with the exact token it was deployed against.

## Switching networks for a demo

The bot and backend read the active chain from a single `CHAIN` env var (registry in `chains.js`). To demo on a different network:

```bash
# in .env
CHAIN=base-sepolia    # or celo-sepolia | arc-testnet | polygon-amoy
```

Then restart the bot (and the backend, if you're running it locally for the demo). The escrow/USDC addresses are shared across chains, so only the RPC changes. The admin **🏦 Escrow balance** action shows which network is active and links to that chain's explorer.

Per-chain RPC can be overridden with `<KEY>_RPC_URL`, e.g. `BASE_SEPOLIA_RPC_URL=...`.
