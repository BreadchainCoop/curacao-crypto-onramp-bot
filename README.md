# Curaçao Crypto On-Ramp Bot

A Telegram bot that lets users in Curaçao, Aruba, and Bonaire buy USDC stablecoins using local bank transfers via [Sentoo](https://sentoo.io). Operated by **Stigmergy Two B.V.** Multi-chain (EVM), with the escrow now migrating to **Stellar** (Soroban).

## How it works

1. User starts the bot on Telegram
2. KYC verification (Sumsub)
3. User provides or receives a wallet address (via Privy if none exists)
4. Bot generates a Sentoo payment link in XCG/ANG
5. User pays via their local banking app
6. Sentoo fires a webhook on payment confirmation
7. Smart contract escrow releases USDC to the user's wallet
8. Bot confirms with a transaction hash

## Stack

| Layer | Technology |
|---|---|
| Bot | Node.js + Grammy (Telegram Bot API) |
| Backend / Webhooks | Express.js |
| Smart contract | Solidity (Hardhat) on EVM testnets (`contracts/evm`); escrow migrating to Soroban (Rust) on **Stellar** (`contracts/stellar`) |
| Wallet creation | Privy embedded wallets |
| KYC | **Sumsub** |
| Payment rail | Sentoo REST API (sandbox) |
| RPC | Alchemy (EVM) · Soroban RPC (Stellar) |
| Database | Supabase (Postgres) |
| Hosting | Render (backend) — see [docs/DEPLOY.md](docs/DEPLOY.md); Netlify (landing page) |

## Monorepo structure

pnpm workspace + Turborepo. JavaScript packages are `@kambiox/*`; the Stellar
contracts are a Cargo workspace outside the pnpm workspace.

```
curacao-crypto-onramp-bot/
├── apps/
│   ├── backend/        ← @kambiox/backend: Express webhooks + ops API (Render web)
│   ├── bot/            ← @kambiox/bot: Telegram bot (Render worker)
│   └── landing/        ← KambioX landing page (static, Netlify)
├── packages/
│   └── chains/         ← @kambiox/chains: chain registry shared by bot + backend
├── contracts/
│   ├── evm/            ← @kambiox/contracts-evm: Solidity Escrow.sol (Hardhat)
│   └── stellar/        ← Soroban escrow (Rust): escrow/, Makefile, AGENTS.md
├── supabase/           ← Database schema (migrations)
├── docs/               ← DEPLOY.md, plans/, solutions/, stellar/TESTNET.md
├── .agents/skills/     ← Shared CE, domain, and stack skills
├── .github/workflows/  ← ci.yml (commitlint + coverage), contracts-stellar.yml, release-stellar.yml
├── pnpm-workspace.yaml · turbo.json · package.json (root tooling)
├── render.yaml · netlify.toml
├── AGENTS.md           ← Canonical contributor/agent guidance
└── CLAUDE.md           ← Thin Claude Code import of AGENTS.md
```

## Environment variables

Each app has its own example file: copy `apps/backend/.env.example`,
`apps/bot/.env.example` and `contracts/evm/.env.example` to `.env` next to it
and fill in your values. **Never commit a `.env`.**

## Getting started

```bash
# Node 22+. pnpm comes from the packageManager field (corepack or `npm i -g pnpm`).
pnpm install

# Tests and the CI coverage gate
pnpm test
pnpm test:coverage

# Deploy the EVM contract to Base Sepolia
cd contracts/evm
npx hardhat run scripts/deploy.js --network base-sepolia

# Start the backend webhook server / the Telegram bot
pnpm start:backend
pnpm start:bot

# Stellar escrow (Rust): see contracts/stellar/AGENTS.md and docs/stellar/TESTNET.md
cd contracts/stellar && make test
```

## Agents and Compound Engineering

[`AGENTS.md`](AGENTS.md) is the canonical guidance for contributors and coding
agents. Shared skills live in [`.agents/skills/`](.agents/skills/) so Cursor,
Codex, Copilot, and compatible hosts receive the same repository-owned baseline.
`CLAUDE.md` imports the canonical guidance for Claude Code.

The lightweight workflow is:

1. `ce-brainstorm` — settle outcomes and scope
2. `ce-plan` — produce a reviewable implementation sequence
3. `ce-work` — implement approved units with focused checks
4. `ce-simplify-code` — remove avoidable complexity without changing behavior
5. `ce-code-review` — review correctness, security, and tests
6. `ce-compound` — preserve reusable learnings in `docs/solutions/`

The repo also includes focused on-ramp and language skills plus the official,
pinned Supabase Postgres best-practices skill. Accepted substantial plans belong
in [`docs/plans/`](docs/plans/).

Local CE preferences are optional:

```bash
cp .compound-engineering/config.local.example.yaml \
  .compound-engineering/config.local.yaml
```

The full [Compound Engineering plugin](https://github.com/EveryInc/compound-engineering-plugin)
is optional advanced tooling; it supplements rather than replaces the checked-in
guidance. Agent autonomy does not override human review for payments, KYC,
custody, migrations, secrets, deployment, or mainnet work. See
[`SECURITY.md`](SECURITY.md).

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on pull requests with Node 22:

1. **commitlint** — Conventional Commits for every commit in the PR range
2. **coverage** (after commitlint) — `pnpm turbo run test:coverage` for backend, bot and contracts/evm

`contracts-stellar.yml` runs on changes under `contracts/stellar/` (fmt, clippy,
`cargo audit`, `stellar contract build`, `cargo llvm-cov` ≥ 90% lines), and
`release-stellar.yml` builds an attested wasm on `stellar-escrow-v*` tags.

Coverage floors (CI hard-fail):

| Package | Gate | Exclusions |
|---|---|---|
| apps/backend / apps/bot | lines 80%, functions 70%, branches 70% | `index.js`, `test/**` |
| contracts/evm | `Escrow.sol` lines 80% | `mocks/` (via `.solcover.js`) |
| contracts/stellar | lines 90% | — |

If branch protection still requires the old `Commitlint / commitlint` check, update it to the new `CI / …` job names after this workflow lands.

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `chore:`). GitHub Actions runs [commitlint](https://commitlint.js.org/) on pull requests and fails if any commit in the PR range does not match.

To check locally after installing root tooling:

```bash
pnpm install
pnpm exec commitlint --from origin/main --to HEAD --verbose
```

Coverage locally (Node 22+):

```bash
pnpm test:coverage
```

## Security

- No secret keys, API keys, private keys, or tokens are ever stored in this repository
- All secrets are loaded from environment variables at runtime
- See each app's `.env.example` for its required variables (values are placeholders only)
- Admin wallet private key for contract interactions must be stored in a hardware wallet or secrets manager in production

## Status

> MVP in development. Live on EVM testnets (Base Sepolia, Arc, Celo, Polygon); the escrow is now migrating to **Stellar** (Soroban). Sentoo sandbox.

## License

MIT — Stigmergy Two B.V.
