#!/usr/bin/env node
// Transfer Escrow ownership (OZ Ownable) to a new owner — e.g. the Privy operator
// wallet, so it can call release() on-chain. IRREVERSIBLE, so this DRY-RUNS by
// default and only broadcasts when CONFIRM=yes.
//
// After this, the new owner (the Privy operator server wallet) is the only
// address that can release/refund on this escrow. The old admin key can no longer
// move funds here. On this legacy single-owner Escrow that also means the operator
// can refund; the releaser/owner split is Escrow v2 (#32/#33).
//
// Usage (Base Sepolia example):
//   RPC_URL=https://sepolia.base.org \
//   ESCROW_ADDRESS=0x05b9aD81666f3a245500FCFc4E0e13017BcFAcD4 \
//   NEW_OWNER=0xcd6A4F2c0196c27381256aeF72D059C1FBc6Bc0c \
//   ADMIN_WALLET_PRIVATE_KEY=<current owner key> \
//   CONFIRM=yes \
//   node scripts/transfer-ownership.js
//
// Without CONFIRM=yes it prints what it WOULD do and exits (no tx sent).

'use strict';

const path = require('path');
// Reuse ethers from the backend workspace (contracts may not have it standalone).
const ethers = require(path.join(__dirname, '../../backend/node_modules/ethers'));

const ABI = [
  'function owner() view returns (address)',
  'function transferOwnership(address newOwner)',
];

async function main() {
  const rpcUrl = process.env.RPC_URL;
  const escrowAddress = process.env.ESCROW_ADDRESS;
  const newOwner = process.env.NEW_OWNER;
  const adminKey = process.env.ADMIN_WALLET_PRIVATE_KEY;
  const confirm = process.env.CONFIRM === 'yes';

  for (const [k, v] of Object.entries({ RPC_URL: rpcUrl, ESCROW_ADDRESS: escrowAddress, NEW_OWNER: newOwner, ADMIN_WALLET_PRIVATE_KEY: adminKey })) {
    if (!v) {
      console.error(`Missing ${k}`);
      process.exit(1);
    }
  }
  if (!ethers.isAddress(newOwner)) {
    console.error(`NEW_OWNER is not a valid address: ${newOwner}`);
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(adminKey, provider);
  const escrow = new ethers.Contract(escrowAddress, ABI, wallet);

  const net = await provider.getNetwork();
  const currentOwner = await escrow.owner();

  console.log('\nEscrow transferOwnership');
  console.log('  chainId       :', net.chainId.toString());
  console.log('  escrow        :', escrowAddress);
  console.log('  current owner :', currentOwner);
  console.log('  signer (you)  :', wallet.address);
  console.log('  new owner     :', newOwner);

  if (currentOwner.toLowerCase() === newOwner.toLowerCase()) {
    console.log('\n✔ Already owned by NEW_OWNER — nothing to do.');
    return;
  }
  if (currentOwner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error('\n✗ The signer is NOT the current owner; transferOwnership would revert.');
    process.exit(1);
  }

  if (!confirm) {
    console.log('\nDRY RUN — no transaction sent. Re-run with CONFIRM=yes to execute.');
    return;
  }

  console.log('\nSending transferOwnership…');
  const tx = await escrow.transferOwnership(newOwner);
  console.log('  tx:', tx.hash);
  await tx.wait();
  const after = await escrow.owner();
  console.log('  owner now:', after);
  if (after.toLowerCase() !== newOwner.toLowerCase()) {
    console.error('✗ Owner did not update as expected.');
    process.exit(1);
  }
  console.log('\n✅ Ownership transferred.');
}

main().catch((err) => {
  console.error('transferOwnership failed:', err.message);
  process.exit(1);
});
