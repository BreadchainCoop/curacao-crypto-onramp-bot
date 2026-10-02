#!/usr/bin/env node
// Smoke test: prove an MPC operator wallet (Privy or Circle) can sign a real
// Escrow `release` — i.e. the MPC signer path works end to end, no raw key on
// the host.
//
// It reads the SAME env the backend uses (escrowFromEnv → ESCROW_SIGNER → the
// matching MPC adapter), releases a small amount of USDC from the escrow to a
// recipient, and prints the escrow balance before/after + the tx hash.
//
// Requires (in env / .env):
//   CHAIN=base-sepolia | base-mainnet | arc-mainnet | …
//   ESCROW_CONTRACT_ADDRESS (or the per-chain <CHAIN>_ESCROW_ADDRESS override)
//   USDC_ADDRESS            (or the per-chain <CHAIN>_USDC_ADDRESS override)
//   ESCROW_SIGNER=privy     + PRIVY_OPERATOR_APP_ID / _APP_SECRET / _AUTHORIZATION_KEY / _WALLET_ID
//   — or —
//   ESCROW_SIGNER=circle    + CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET / CIRCLE_WALLET_ID
//
// Optional:
//   SMOKE_RECIPIENT=0x…   (default: the operator wallet itself)
//   SMOKE_AMOUNT=1        (USDC, human units; default 1)
//
// Usage:
//   cd backend && node --env-file=../.env scripts/smoke-release.js
//   (or export the vars yourself, then: node scripts/smoke-release.js)

'use strict';

const path = require('path');
const ethers = require(path.join(__dirname, '../node_modules/ethers'));
const { escrowFromEnv } = require('../services/escrow');
const { activeChain } = require('../../chains');

async function main() {
  const chain = activeChain();
  const recipient = process.env.SMOKE_RECIPIENT || process.env.ESCROW_OPERATOR_ADDRESS;
  const amount = process.env.SMOKE_AMOUNT || '1';

  if (!recipient) {
    console.error('Set SMOKE_RECIPIENT (or ESCROW_OPERATOR_ADDRESS) to a payout address.');
    process.exit(1);
  }
  const signerMode = (process.env.ESCROW_SIGNER || '').toLowerCase();
  const MPC_SIGNERS = ['privy', 'circle'];
  if (!MPC_SIGNERS.includes(signerMode)) {
    console.error(`ESCROW_SIGNER is "${process.env.ESCROW_SIGNER}" — set it to one of: ${MPC_SIGNERS.join(', ')} (an MPC signer) for this test.`);
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
  const usdc = new ethers.Contract(
    chain.usdcAddress,
    ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'],
    provider
  );
  const dec = await usdc.decimals();
  const before = await usdc.balanceOf(chain.escrowAddress);

  console.log(`\n${signerMode} operator release smoke test`);
  console.log('  chain        :', chain.name, `(${chain.chainId})`);
  console.log('  escrow       :', chain.escrowAddress);
  console.log('  recipient    :', recipient);
  console.log('  amount       :', amount, 'USDC');
  console.log('  escrow before:', ethers.formatUnits(before, dec), 'USDC');

  const escrow = escrowFromEnv(); // ESCROW_SIGNER → the matching MPC adapter
  console.log(`\n  requesting ${signerMode} to sign release…`);
  const txHash = await escrow.release(recipient, amount);
  console.log('  tx:', txHash);
  console.log('  explorer:', `${chain.explorer}/tx/${txHash}`);

  const after = await usdc.balanceOf(chain.escrowAddress);
  console.log('  escrow after :', ethers.formatUnits(after, dec), 'USDC');

  const delta = before - after;
  console.log('  released     :', ethers.formatUnits(delta, dec), 'USDC');
  if (delta <= 0n) {
    console.error('\n✗ Escrow balance did not decrease — release did not settle as expected.');
    process.exit(1);
  }
  console.log(`\n✅ ${signerMode} operator signed a real release. MPC signer path works.`);
}

main().catch((err) => {
  console.error('\nsmoke-release failed:', err.message);
  process.exit(1);
});
