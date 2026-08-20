#!/usr/bin/env node
// Attach a Privy wallet POLICY to the operator server wallet so it can only send
// transactions to the escrow contract — defense in depth on top of MPC custody.
//
// Even if the backend's request credentials leak, a stolen key can only trigger
// txs that satisfy this policy (to == escrow), i.e. release/refund on the escrow
// itself — never a transfer of funds anywhere else. On-chain caps/pause (#33)
// add the next layer.
//
// Default action is DENY; the single rule ALLOWs eth_sendTransaction only when
// the `to` address equals the escrow. (release and refund both target escrow.)
//
// Run once, locally, with the operator credentials in your environment (same as
// the smoke test — keep them out of files):
//
//   cd backend
//   read -s "PRIVY_OPERATOR_APP_SECRET?App secret: "; echo
//   read -s "PRIVY_OPERATOR_AUTHORIZATION_KEY?Auth key: "; echo
//   export PRIVY_OPERATOR_APP_SECRET PRIVY_OPERATOR_AUTHORIZATION_KEY
//   ESCROW_CONTRACT_ADDRESS=0x05b9aD81666f3a245500FCFc4E0e13017BcFAcD4 \
//     PRIVY_OPERATOR_APP_ID=... PRIVY_OPERATOR_WALLET_ID=... \
//     node scripts/setup-operator-policy.js
//
// Prints the policy id. Re-running creates a NEW policy; only one policy is
// enforced per wallet, so the latest attach wins.

'use strict';

async function main() {
  const appId = process.env.PRIVY_OPERATOR_APP_ID;
  const appSecret = process.env.PRIVY_OPERATOR_APP_SECRET;
  const authorizationKey = process.env.PRIVY_OPERATOR_AUTHORIZATION_KEY;
  const walletId = process.env.PRIVY_OPERATOR_WALLET_ID;
  const escrow = process.env.ESCROW_CONTRACT_ADDRESS;

  for (const [k, v] of Object.entries({
    PRIVY_OPERATOR_APP_ID: appId,
    PRIVY_OPERATOR_APP_SECRET: appSecret,
    PRIVY_OPERATOR_AUTHORIZATION_KEY: authorizationKey,
    PRIVY_OPERATOR_WALLET_ID: walletId,
    ESCROW_CONTRACT_ADDRESS: escrow,
  })) {
    if (!v) {
      console.error(`Missing ${k}`);
      process.exit(1);
    }
  }

  const { PrivyClient } = require('@privy-io/node');
  const privy = new PrivyClient({ appId, appSecret });
  const authContext = { authorization_private_keys: [authorizationKey] };

  console.log('Creating policy: ALLOW eth_sendTransaction only to escrow', escrow);
  const policy = await privy.policies().create({
    chain_type: 'ethereum',
    name: 'cura-ramp-operator-escrow-only',
    version: '1.0',
    rules: [
      {
        name: 'allow-escrow-only',
        method: 'eth_sendTransaction',
        action: 'ALLOW',
        conditions: [
          {
            field_source: 'ethereum_transaction',
            field: 'to',
            operator: 'eq',
            value: escrow,
          },
        ],
      },
    ],
  });
  console.log('  policy id:', policy.id);

  console.log('Attaching policy to wallet', walletId);
  await privy.wallets().update(walletId, {
    policy_ids: [policy.id],
    authorization_context: authContext,
  });

  console.log('\n✅ Policy attached. The operator wallet can now only send to the escrow.');
  console.log('   Verify with the smoke test (release to escrow succeeds), and note that a');
  console.log('   send to any other address will now be denied by Privy.');
}

main().catch((err) => {
  console.error('\nsetup-operator-policy failed:', err.message);
  process.exit(1);
});
