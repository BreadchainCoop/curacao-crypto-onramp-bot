#!/usr/bin/env node
// Fund the active chain's escrow with USDC *through the Circle operator wallet*.
//
// Why this exists: on Arc, USDC is the native gas coin AND an ERC-20 at the
// 0x3600… predeploy. A normal wallet (Rabby) sends it the *native* way, which
// reverts when the recipient is a contract with no payable receive() — exactly
// what the escrow is. Funding an escrow must go over the ERC-20 rail
// (token.transfer(escrow, amount)), which this script does via the Circle
// operator (a signer we already know works on Arc).
//
// Flow: operator wallet -> USDC.transfer(escrow, amount). The operator must
// therefore hold enough USDC to cover BOTH this transfer and gas. On Arc,
// top the operator EOA up first with a plain (native) send — that succeeds
// because the operator is an EOA, not a contract.
//
// Requires (same env as the backend / smoke test):
//   CHAIN=arc-mainnet            (or any chain whose escrow you want to fund)
//   ESCROW_SIGNER=circle
//   CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET / CIRCLE_WALLET_ID
// Optional:
//   FUND_AMOUNT=5                (USDC, human units; default 5)
//
// Usage (standalone terminal with your Circle creds):
//   cd backend && node --env-file=../.env scripts/fund-escrow.js
//   (or export the vars yourself first)

'use strict';

const path = require('path');
const ethers = require(path.join(__dirname, '../node_modules/ethers'));
const { activeChain } = require('../../chains');
const { circleOperatorSignerFromEnv } = require('../services/circleOperator');

const USDC_DECIMALS = 6;

async function main() {
  const chain = activeChain();
  const amount = process.env.FUND_AMOUNT || '5';

  const signerMode = (process.env.ESCROW_SIGNER || '').toLowerCase();
  if (signerMode !== 'circle') {
    console.error(`ESCROW_SIGNER is "${process.env.ESCROW_SIGNER}" — set it to "circle" for this funding script.`);
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
  const usdc = new ethers.Contract(
    chain.usdcAddress,
    [
      'function balanceOf(address) view returns (uint256)',
      'function decimals() view returns (uint8)',
      'function transfer(address to, uint256 amount)',
    ],
    provider
  );
  const dec = await usdc.decimals();
  const escrowBefore = await usdc.balanceOf(chain.escrowAddress);
  const raw = ethers.parseUnits(String(amount), USDC_DECIMALS);
  const data = new ethers.Interface([
    'function transfer(address to, uint256 amount)',
  ]).encodeFunctionData('transfer', [chain.escrowAddress, raw]);

  console.log('\nFund escrow via Circle operator (ERC-20 transfer)');
  console.log('  chain        :', chain.name, `(${chain.chainId})`);
  console.log('  token (USDC) :', chain.usdcAddress);
  console.log('  escrow       :', chain.escrowAddress);
  console.log('  amount       :', amount, 'USDC');
  console.log('  escrow before:', ethers.formatUnits(escrowBefore, dec), 'USDC');

  const signer = circleOperatorSignerFromEnv(process.env, chain);
  console.log('\n  requesting circle to sign token.transfer(escrow, amount)…');
  // send a contract call TO the USDC token (not the escrow): operator -> USDC.transfer(escrow, amt)
  const txHash = await signer.send({ to: chain.usdcAddress, data });
  console.log('  tx:', txHash);
  console.log('  explorer:', `${chain.explorer}/tx/${txHash}`);

  const escrowAfter = await usdc.balanceOf(chain.escrowAddress);
  console.log('  escrow after :', ethers.formatUnits(escrowAfter, dec), 'USDC');

  const delta = escrowAfter - escrowBefore;
  if (delta <= 0n) {
    console.error('\n✗ Escrow balance did not increase — funding did not settle as expected.');
    process.exit(1);
  }
  console.log('  credited     :', ethers.formatUnits(delta, dec), 'USDC');
  console.log('\n✅ Escrow funded over the ERC-20 rail. Ready for the release smoke test.');
}

main().catch((err) => {
  console.error('\nfund-escrow failed:', err.message);
  process.exit(1);
});
