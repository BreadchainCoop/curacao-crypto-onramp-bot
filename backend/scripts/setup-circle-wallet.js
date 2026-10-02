#!/usr/bin/env node
// One-shot: create a Circle developer-controlled wallet SET + EOA operator wallet.
//
// The blockchain key is generated and held inside Circle's MPC/HSM — it never
// touches this host. The entity secret (your credential) authorizes the request.
// Run ONCE, locally, in YOUR terminal with the operator credentials in the env:
//
//   CIRCLE_API_KEY=... CIRCLE_ENTITY_SECRET=... node scripts/setup-circle-wallet.js
//
// Optional:
//   CIRCLE_BLOCKCHAIN=ARC          default ARC (ARC | BASE | ARC-TESTNET | BASE-SEPOLIA)
//   CIRCLE_WALLET_SET_NAME=...     default "kambiox-operator"
//
// Prints the wallet set id, the wallet id, and the address. The ADDRESS is the
// escrow owner + release signer; the WALLET ID goes in CIRCLE_WALLET_ID. The
// same EOA address works on every EVM chain, so it owns the Arc AND Base escrows.
// Share only the address + wallet id; keep the API key + entity secret private.
'use strict';

async function main() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) {
    console.error('Missing CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET in the environment.');
    process.exit(1);
  }
  const blockchain = process.env.CIRCLE_BLOCKCHAIN || 'ARC';
  const name = process.env.CIRCLE_WALLET_SET_NAME || 'kambiox-operator';

  const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');
  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

  console.log(`Creating wallet set "${name}"…`);
  const setRes = await client.createWalletSet({ name });
  const walletSetId = setRes.data.walletSet.id;
  console.log('  walletSetId:', walletSetId);

  console.log(`Creating 1 EOA wallet on ${blockchain}…`);
  const wRes = await client.createWallets({
    walletSetId,
    blockchains: [blockchain],
    count: 1,
    accountType: 'EOA',
  });
  const wallet = wRes.data.wallets[0];

  console.log('\n✅ Wallet created.');
  console.log('  address   :', wallet.address, '  (escrow owner + signer; same address on every EVM chain)');
  console.log('  walletId  :', wallet.id);
  console.log('  blockchain:', wallet.blockchain);
  console.log('\n=== backend env ===');
  console.log('ESCROW_SIGNER=circle');
  console.log(`CIRCLE_WALLET_ID=${wallet.id}`);
  console.log('CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET = (your secrets)');
}

main().catch((err) => {
  const detail = (err && err.response && err.response.data) || (err && err.message) || err;
  console.error('\nsetup-circle-wallet failed:', detail);
  process.exit(1);
});
