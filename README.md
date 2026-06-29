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

## Security

- No secret keys, API keys, private keys, or tokens are ever stored in this repository
- All secrets are loaded from environment variables at runtime
- See `.env.example` for the full list of required variables (values are placeholders only)
- Admin wallet private key for contract interactions must be stored in a hardware wallet or secrets manager in production

## Status

> MVP in development. Currently running on testnet (Base Sepolia) and Sentoo sandbox.

## License

MIT — Bread Cooperative DAO LLC
