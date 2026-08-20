#!/usr/bin/env node
// One-shot setup for the Privy OPERATOR server wallet (escrow release signer).
//
// It (1) generates a P-256 authorization keypair, (2) creates a server wallet in
// your operator app owned by that key, then prints the values you need. The
// blockchain key stays sharded in Privy's MPC — this only creates the wallet and
// the authorization key that lets THIS backend request signatures.
//
// Run once, locally, with the operator app credentials in your environment:
//
//   PRIVY_OPERATOR_APP_ID=... PRIVY_OPERATOR_APP_SECRET=... \
//     node scripts/setup-operator-wallet.js
//
// Then copy the printed values into .env (local) and Render (backend):
//   PRIVY_OPERATOR_AUTHORIZATION_KEY = <printed private key>   (SECRET)
//   PRIVY_OPERATOR_WALLET_ID         = <printed wallet id>     (public)
//   ESCROW_OPERATOR_ADDRESS          = <printed address>       (public, goes on-chain)
//
// The authorization PRIVATE key is shown ONCE here — Privy does not store it.
// Save it now; if you lose it, generate a new key and re-own the wallet.

'use strict';

async function main() {
  const appId = process.env.PRIVY_OPERATOR_APP_ID;
  const appSecret = process.env.PRIVY_OPERATOR_APP_SECRET;
  if (!appId || !appSecret) {
    console.error(
      'Missing PRIVY_OPERATOR_APP_ID / PRIVY_OPERATOR_APP_SECRET in the environment.'
    );
    process.exit(1);
  }

  const { PrivyClient, generateP256KeyPair } = require('@privy-io/node');
  const privy = new PrivyClient({ appId, appSecret });

  // 1) Authorization keypair — the wallet's owner/controller (NOT the chain key).
  const keypair = await generateP256KeyPair(); // { publicKey, privateKey } (base64)

  // 2) Server wallet owned by that key.
  const wallet = await privy.wallets().create({
    chain_type: 'ethereum',
    owner: { public_key: keypair.publicKey },
  });

  console.log('\n✅ Operator wallet created.\n');
  console.log('Put these in .env (local) and Render (backend host only):\n');
  console.log('# --- SECRET: store securely, never commit ---');
  console.log(`PRIVY_OPERATOR_AUTHORIZATION_KEY=${keypair.privateKey}`);
  console.log('\n# --- public config ---');
  console.log(`PRIVY_OPERATOR_WALLET_ID=${wallet.id}`);
  console.log(`ESCROW_OPERATOR_ADDRESS=${wallet.address}`);
  console.log(`\n(authorization public key, for reference: ${keypair.publicKey})`);
  console.log(
    '\nNext: fund',
    wallet.address,
    'with Base Sepolia ETH, then transfer escrow ownership to it.\n'
  );
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
