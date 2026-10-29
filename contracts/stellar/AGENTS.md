# AGENTS.md — contracts/stellar

The Soroban escrow for the Stellar rebuild of the ramp: `escrow/` is KambioEscrow, the pooled-custody USDC escrow (Rust, Soroban), with its tests. Applies inside `contracts/stellar`; the root `AGENTS.md` still applies. This is a Cargo workspace outside the pnpm workspace, so use `make`/`cargo` here, not turbo. Posture is **testnet + provider sandbox only**. Runbook: `docs/stellar/TESTNET.md`.

## Commands

```bash
cd contracts/stellar
make test                        # cargo test
make build                       # stellar contract build -> target/wasm32v1-none/release/escrow.wasm
make fmt                         # cargo fmt --all
cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings   # CI lint gate
cargo audit && cargo llvm-cov --locked --fail-under-lines 90   # CI audit + coverage gate
make deploy SOURCE=<identity> OWNER=<G…> TOKEN=<C…>   # testnet only, only when asked
git tag stellar-escrow-v<ver> && git push origin stellar-escrow-v<ver>   # attested release wasm, only when asked
```

## Hard Rules

**Commits.** One line, `<type>(<scope>): <imperative summary>`, under 72 chars, no body unless asked. Never add `Co-Authored-By` or any AI attribution to commits or PRs. Never commit, push, deploy or run a mainnet script unless asked.

**Plan first, human review before merge.** Applies to the escrow (release, withdraw, signing), deploy config, secrets, and any mainnet path. No unsupervised autonomy on mainnet work.

**Don't claim what isn't done.** The contract audit, KMS/MPC custody and regulatory review are outstanding. Never describe them as done.

**Soroban toolchain.** `soroban-sdk = "=29.0.1"`, once, in `[workspace.dependencies]`; edition 2021; `wasm32v1-none`; the workspace release profile as is (`overflow-checks = true`). Build with `stellar contract build`, never plain `cargo build`. Rust is pinned in `rust-toolchain.toml` and stellar-cli `26.1.0` in CI; bump them together.

**Escrow shape.** Pooled custody with off-chain order accounting: never imply per-order balances on-chain. One-time setup goes in `__constructor`, never a public `init`. `release` and `withdraw` are owner-only: load the owner from storage and `require_auth` it. No upgrade entry point; a new version is a new deploy, drained with `withdraw`.

**Amounts.** `i128` in USDC's 7 decimals (1 USDC = `10_000_000`). Reject non-positive amounts and check the pool balance before any transfer, each with a typed `Error`, never `unwrap` or `panic!`.

**Events.** Every state-changing entry point emits a `#[contractevent]`, and a test asserts it.

**Contract tests.** Cover deposit, release, withdraw, insufficient balance and owner auth. Every `require_auth` gets two tests: the exact `env.auths()` tree, and a wrong signer failing with `Error(Auth, InvalidAction)`. Assert errors as `Err(Ok(Error::X))`. Run `make test` and `make build` before handoff.

**Doc comments.** `///` on every entry point, two lines at most. The module doc is one line of what.

**Keys.** The escrow owner is the backend operator account (ed25519); the bot never holds a signing key. A raw secret key is testnet-only; mainnet needs KMS/MPC or a multisig, and never recommend a raw key for it. Never hardcode, log or commit a secret key, provider secret or RPC credential. Pass `stellar` CLI identities by name, never a raw secret.

When corrected, add a rule here.
