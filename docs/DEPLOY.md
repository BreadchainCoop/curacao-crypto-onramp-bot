# Deploy guide (Issue #12)

Hosting model for the MVP:

| Piece | Where | Why |
|---|---|---|
| **Backend** (`/backend`) webhook server | **Render** (free web service) | Needs a public always-on HTTPS URL for Sentoo/Synaps webhooks |
| **Database** | **Supabase** | Postgres + RLS |
| **Bot** (`/bot`) | **Your machine** (for now) | grammy long-polling; Render workers aren't free. Host it later for launch |

> Render's free web service **sleeps after ~15 min idle** (slow first request).
> Fine for sandbox/testnet — Sentoo and Synaps both retry webhooks. Same steps
> work on Railway/Fly if you outgrow it.

---

## 1. Supabase (database)

1. Create a Supabase project.
2. In the SQL editor, run the migrations in order:
   `supabase/migrations/0001_init.sql`, `0002_…`, `0003_…`.
3. Copy the project URL + **service-role** key (Settings → API).

## 2. Render (backend)

1. Push this repo to GitHub (the blueprint lives at `render.yaml`).
2. Render dashboard → **New → Blueprint** → connect this repo. Render reads
   `render.yaml` and creates the `curacao-onramp-backend` web service.
3. Set the env var values it prompts for (the `sync: false` keys):

   | Var | Value |
   |---|---|
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | from step 1 |
   | `TELEGRAM_BOT_TOKEN` | from @BotFather |
   | `SENTOO_API_KEY`, `SENTOO_MERCHANT_ID`, `SENTOO_WEBHOOK_SECRET` | Sentoo merchant portal |
   | `SYNAPS_WEBHOOK_SECRET` | Synaps manager |
   | `RPC_URL` | Alchemy (chosen chain) |
   | `ADMIN_WALLET_PRIVATE_KEY` | funded deployer/owner wallet |
   | `ESCROW_CONTRACT_ADDRESS` | from the contract deploy |

4. Deploy. Confirm health: open `https://<your-app>.onrender.com/health` → `{"ok":true}`.
5. **Auto-deploy** is on: every push to `main` redeploys.

## 3. Point the providers at the backend

With your Render URL (e.g. `https://curacao-onramp-backend.onrender.com`):

- **Sentoo** merchant portal → *Payment status URL*:
  `https://<app>.onrender.com/webhook/sentoo?token=<SENTOO_WEBHOOK_SECRET>`
- **Synaps** manager → webhook URL:
  `https://<app>.onrender.com/webhook/kyc?secret=<SYNAPS_WEBHOOK_SECRET>`

The `?token=` / `?secret=` are how each webhook is authenticated (see SECURITY.md).

## 4. Run the bot (locally, for now)

```bash
cd bot
cp ../.env.example ../.env   # fill in the bot's vars
node index.js
```
The bot needs its own vars: `TELEGRAM_BOT_TOKEN`, `PRIVY_APP_ID`/`PRIVY_APP_SECRET`,
`SYNAPS_API_KEY` + `SYNAPS_BASE_URL`/`SYNAPS_VERIFY_URL`, `SENTOO_*`, `SUPABASE_*`,
`ADMIN_TELEGRAM_ID`, `FX_*`. When you launch, host the bot the same way (a paid
Render worker, a small VPS, etc.).

---

## Before mainnet / real fiat

See [SECURITY.md](../SECURITY.md): independent Escrow audit, move the admin key
off a plain env var (multisig/KMS), and complete the CBCS regulatory + KYC
compliance reviews.
