# Curaçao Crypto On-Ramp Bot

A Telegram bot that lets users in Curaçao, Aruba, and Bonaire buy USDC stablecoins using local bank transfers via [Sentoo](https://sentoo.io). Built by [Bread Cooperative DAO LLC](https://breadcooperative.com).

## How it works

1. User starts the bot on Telegram
2. KYC verification (Synaps sandbox)
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
| Smart contract | Solidity (Hardhat) — deployed on Base Sepolia testnet |
| Wallet creation | Privy embedded wallets |
| KYC | Synaps |
| Payment rail | Sentoo REST API (sandbox) |
| RPC | Alchemy (Base Sepolia) |
| Database | Supabase (Postgres) |
| Hosting | Render (backend) — see [docs/DEPLOY.md](docs/DEPLOY.md) |

## Monorepo structure

```
curacao-crypto-onramp-bot/
├── /.agents/skills    ← Shared CE, domain, and stack skills
├── /.github/workflows  ← CI (commitlint on PRs)
├── /bot              ← Telegram bot logic
│   ├── index.js
│   ├── flows/
│   │   ├── kyc.js
│   │   ├── wallet.js
│   │   └── buy.js
│   └── state/
│       └── session.js
├── /backend          ← Webhook server + service integrations
│   ├── index.js
│   ├── routes/
│   │   ├── sentoo.js
│   │   └── kyc.js
│   └── services/
│       ├── escrow.js
│       └── privy.js
├── /contracts        ← Solidity escrow contract
│   ├── src/
│   │   ├── Escrow.sol
│   │   └── mocks/
│   │       └── MockUSDC.sol   ← test-only ERC20
│   ├── test/
│   │   └── Escrow.test.js
│   ├── hardhat.config.js
│   └── scripts/
│       └── deploy.js
├── /supabase         ← Database schema (migrations)
│   └── migrations/
│       └── 0001_init.sql
├── commitlint.config.js
├── package.json      ← root tooling (commitlint)
├── AGENTS.md         ← Canonical contributor/agent guidance
├── CLAUDE.md         ← Thin Claude Code import of AGENTS.md
├── .env.example
├── .gitignore
└── README.md
```

## Environment variables

Copy `.env.example` to `.env` and fill in your values. **Never commit `.env` to this repository.**

See `.env.example` for all required variables.

## Getting started

```bash
# Install dependencies (run in /bot and /backend separately)
npm install

# Deploy contract to Base Sepolia
cd contracts
npx hardhat run scripts/deploy.js --network base-sepolia

# Start the backend webhook server
cd backend
node index.js

# Start the Telegram bot
cd bot
node index.js
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

## Commit messages

This repo uses [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `chore:`). GitHub Actions runs [commitlint](https://commitlint.js.org/) on pull requests and fails if any commit in the PR range does not match.

To check locally after installing root tooling:

```bash
npm install
npx commitlint --from origin/main --to HEAD --verbose
```

## Security

- No secret keys, API keys, private keys, or tokens are ever stored in this repository
- All secrets are loaded from environment variables at runtime
- See `.env.example` for the full list of required variables (values are placeholders only)
- Admin wallet private key for contract interactions must be stored in a hardware wallet or secrets manager in production

## Status

> MVP in development. Currently running on testnet (Base Sepolia) and Sentoo sandbox.

## License

MIT — Bread Cooperative DAO LLC
