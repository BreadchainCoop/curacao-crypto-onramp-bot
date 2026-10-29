# Launching & testing the Stellar escrow on testnet

The Soroban escrow lives in `contracts/stellar` (a Cargo workspace outside the
pnpm workspace). Its rules are in `contracts/stellar/AGENTS.md`; the system diagrams
are in `contracts/stellar/ARCHITECTURE.md`.

End-to-end: deploy the Soroban escrow to **testnet**, bind it to **USDC**, fund it,
and prove a release. Everything here is testnet — no real funds.

## Live deployment (testnet)

KambioEscrow v0.2.0, deployed on **2026-10-30** from the attested release build and proven
end to end (deposit → owner-only release), bound to real Circle testnet USDC.

| Item | Value |
| --- | --- |
| Escrow contract | `CCA2WYNWADCEH5ZZ36D7II5OCVZL3HTMIKDTOC74HEVHHJZONNT2AXR5` |
| Wasm hash (sha256) | `d0516bf3b5867a563ce1f12f5a33fee812fbd3976eb95baaa2f07b92058d856f` (on-chain, confirmed with `stellar contract fetch`, equals the release asset) |
| Built from | commit `fdc49c2`, git tag `stellar-escrow-v0.2.0`, path `contracts/stellar`, package `escrow` |
| Attested release | `stellar-escrow-v0.2.0_contracts_stellar_escrow_pkg0.2.0_cli28.1.0`, asset `escrow_v0.2.0.wasm`; `gh attestation verify` passes with `--signer-repo stellar-expert/soroban-build-workflow` |
| Contract meta | `name: KambioEscrow`, `source_repo: github:BreadchainCoop/curacao-crypto-onramp-bot`, soroban-sdk 29.0.1, built with stellar-cli 28.1.0 |
| Owner / operator | `GBSU6Q7LPCCLENKZZYNVM5C6A55MECOPBHUE6IGPC5WWLTJOJPM2M5GX` |
| USDC issuer (Circle testnet) | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| USDC token (SAC) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| StellarExpert source validation | `status: unverified` at the time of writing (StellarExpert matches the on-chain wasm hash against the GitHub attestation asynchronously; re-check the explorer page) ([explorer page](https://stellar.expert/explorer/testnet/contract/CCA2WYNWADCEH5ZZ36D7II5OCVZL3HTMIKDTOC74HEVHHJZONNT2AXR5)) |
| Deploy CLI | `stellar-cli 26.1.0` against a protocol 29 testnet |

Proof transactions:

- Deploy (attested wasm): `d07468110a983073e42ded05d8df8e5ff5ec4a361fdcdd97cfefe323c6a56e49`
- Operator buys 10 USDC on the testnet SDEX with XLM (`stellar tx new path-payment-strict-receive`): `327c92d908fd40cd598d45f3ed9bc61ca6d5b6200beab77c3f12b2c2a8648b92`
- Deposit 10 USDC: `22cae5908b26bfa047041e1d0163f80ca9dd3d7ebe6ca9f1ed717d5fbb552127`
- Release 1 USDC → `GCGL7HNDXA4RBKHDBOBFRM2RC2VQSK7ISB4PRPCEOBL5SAXGKNT46N6Q`: `fd861a36c91faf5ad57b7123be91a300059699a90b25128fe610572f800b45bb`

After: escrow `balance()` = `90000000` (9 USDC), recipient holds 1 USDC. Both accounts
hold a USDC trustline (`stellar tx new change-trust --line USDC:GBBD47…`); the release would
fail without one.

### Previous deployments

- `CAKKY5WKDXZRQVGD2UR72AV4FMZOS7EW3UGRET4CMQSX3QMWQTNEALJT`: v0.1.0 of the old
  `stellar-stablecoin-onramp-bot` repo (commit `0a88113`, SDK 22, public `init`, `refund`),
  source-verified on StellarExpert, deployed 2026-10-21. Different interface; the current
  client cannot call it.
- `CBGXBSIUEJYWDUA5UJNTP37NOEZN2FYNIOTME5S6N5LJWCPRTVRP5BL3`: the first, unverified local build.

## 0. Prerequisites

```bash
# Rust + the Soroban wasm target
rustup target add wasm32v1-none
# Stellar CLI (provides `stellar contract …`)
cargo install --locked stellar-cli --version 26.1.0
stellar --version
```

## 1. A funded testnet identity (pays fees)

```bash
# Create a CLI identity and fund it from Friendbot (testnet faucet).
stellar keys generate operator --network testnet --fund
stellar keys address operator        # G... (this is the escrow OWNER/operator)
```

`--fund` asks Friendbot for test XLM. Re-run `stellar keys fund operator --network testnet` if the balance runs low.

## 2. Resolve the testnet USDC token (SAC) address

Soroban moves tokens through a **Stellar Asset Contract (SAC)**, not the issuer
account. Two options:

**A. Circle testnet USDC (realistic).** The classic asset is
`USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (verify against
Circle's current testnet issuer). Get its SAC id:

```bash
stellar contract id asset \
  --asset USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 \
  --network testnet
# -> C... (the USDC SAC address). If it isn't deployed yet on testnet:
#   stellar contract asset deploy --asset USDC:<issuer> --source operator --network testnet
```

To actually hold Circle testnet USDC you need a **trustline** to the issuer and a
faucet/anchor to send you some.

**B. Your own test token (fastest for dev).** Issue a throwaway asset you control
and mint freely — same `token` interface, no faucet needed:

```bash
stellar keys generate issuer --network testnet --fund
stellar contract asset deploy --asset TUSDC:$(stellar keys address issuer) \
  --source issuer --network testnet                 # -> C... (test USDC SAC)
```

Use this SAC id as `TOKEN` below for a self-contained test.

## 3. Build & deploy the escrow (owner + token)

The constructor binds the owner and token inside the deploy transaction, so there
is no separate init call for anyone to front-run. For a source-verified deploy,
use the attested release wasm instead of a local build (§6).

```bash
cd contracts/stellar
make build          # -> target/wasm32v1-none/release/escrow.wasm
stellar contract deploy \
  --wasm target/wasm32v1-none/release/escrow.wasm \
  --source operator \
  --network testnet \
  --alias escrow \
  -- \
  --owner $(stellar keys address operator) \
  --token <USDC_SAC_ID>
# prints the contract id (C...). The --alias stores it for later `--id escrow`.
# confirm:
stellar contract invoke --id escrow --source operator --network testnet -- owner
stellar contract invoke --id escrow --source operator --network testnet -- balance
```

## 4. Fund the escrow with test USDC

⚠️ **Decimals:** Stellar USDC has **7 decimals**. 1 USDC = `10_000_000` in the
`i128` amount. Keep this consistent with the backend quote math.

Option B (your own token) — mint straight to the escrow:

```bash
stellar contract invoke --id <USDC_SAC_ID> --source issuer --network testnet \
  -- mint --to <ESCROW_CONTRACT_ID> --amount 100000000   # 10 USDC
stellar contract invoke --id escrow --source operator --network testnet -- balance
```

## 5. Prove a release

⚠️ **Trustline:** a classic-asset recipient G-address must have a **USDC
trustline** or the transfer fails. (Contract addresses and SAC-native balances
don't need one; a user's wallet does.) The bot must enforce/surface this before
releasing to a user.

```bash
# recipient with a trustline + (for Circle USDC) created account
stellar contract invoke --id escrow --source operator --network testnet \
  -- release --recipient <G..._or_C...> --amount 10000000   # 1 USDC
```

A successful `release` is signed by the **operator** (owner `require_auth`) — this
is exactly the path the backend will drive with the operator key / KMS.

## 6. Deploy an attested release (source-verified wasm)

StellarExpert marks a contract **source-verified** when it finds a GitHub build
attestation for the on-chain wasm hash, produced by
[`stellar-expert/soroban-build-workflow`](https://github.com/stellar-expert/soroban-build-workflow).
That works on testnet: the pre-review `CAKKY5WK…` above shows `status: verified`.

- The contract's `name` and `repo` metadata (`contractmeta!`) are labels, not a
  verification. The workflow injects `source_repo`, the key StellarExpert uses to
  link the wasm to this repo and commit.
- **One-time repo prerequisite (admin):** Settings → Actions → General → Workflow
  permissions must allow the `id-token`, `contents` and `attestations` writes that
  `release-stellar.yml` declares, or the attestation step fails.
- Pushing a tag `stellar-escrow-v<version>` (the workspace version in
  `contracts/stellar/Cargo.toml`) runs `.github/workflows/release-stellar.yml`.
  It runs the stellar contracts CI, then the build workflow, which builds an
  optimized wasm, publishes it as a GitHub release and attests it.
  The release is published under its own tag,
  `stellar-escrow-v<version>_contracts_stellar_escrow_pkg<version>_cli<cli>`, with the
  asset `escrow_v<version>.wasm`.
- Check the downloaded wasm against the attestation, then deploy that file instead
  of a local build:

```bash
gh attestation verify escrow_v<version>.wasm --repo BreadchainCoop/curacao-crypto-onramp-bot \
  --signer-repo stellar-expert/soroban-build-workflow   # the reusable workflow signs
stellar contract deploy --wasm escrow_v<version>.wasm --source operator --network testnet \
  --alias escrow -- --owner $(stellar keys address operator) --token <USDC_SAC_ID>
```

- The release is built with `--optimize` and the workflow's stellar-cli (28.1.0),
  so its hash differs from a local `make build`.

## Notes for the backend port

- **Release signer** = the operator account (`require_auth` on `release`/`withdraw`).
  Testnet can use a raw secret key; mainnet needs KMS/MPC or multisig.
- **Trustline + account existence** are release preconditions for user wallets —
  check before taking payment (ties into the liquidity pre-check).
- **7-decimal** amounts end to end.

## Sources

- Stellar docs — [Deploy to Testnet](https://developers.stellar.org/docs/build/smart-contracts/getting-started/deploy-to-testnet)
- Stellar docs — [Deploy the Stellar Asset Contract for a Stellar asset](https://developers.stellar.org/docs/build/guides/cli/deploy-stellar-asset-contract)
- Circle — [USDC on Stellar (precision & addressing)](https://developers.circle.com/cctp/quickstarts/transfer-usdc-stellar-arc)
