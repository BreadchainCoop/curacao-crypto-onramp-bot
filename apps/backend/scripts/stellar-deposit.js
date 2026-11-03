#!/usr/bin/env node
'use strict';

// Fund the Stellar KambioEscrow with testnet USDC from the OPERATOR account.
//
//   STELLAR_OPERATOR_SECRET=S... node scripts/stellar-deposit.js <amountUsdc>
//
// Run it in YOUR OWN terminal — the secret is read from the environment and
// never printed. It calls the escrow's `deposit(from, amount)`, which pulls
// `amount` USDC (7-dec) from the operator into the escrow pool, then prints the
// new on-chain balance. The operator must already hold the USDC (fund it at
// faucet.circle.com → Stellar testnet) and a little XLM for fees.
//
// Config comes from packages/chains (stellar-testnet): the contract id and the
// USDC SAC. Override with STELLAR_TESTNET_ESCROW_CONTRACT_ID / _SOROBAN_RPC.

const S = require('@stellar/stellar-sdk');
const { activeChain } = require('@kambiox/chains');

async function main() {
  const amountStr = process.argv[2];
  const secret = process.env.STELLAR_OPERATOR_SECRET;
  if (!secret) throw new Error('Set STELLAR_OPERATOR_SECRET in your environment');
  if (!amountStr || !/^\d+(\.\d{1,7})?$/.test(amountStr)) {
    throw new Error('Usage: node scripts/stellar-deposit.js <amountUsdc>  (e.g. 20)');
  }

  const chain = activeChain({ ...process.env, CHAIN: 'stellar-testnet' });
  const server = new S.rpc.Server(chain.sorobanRpc);
  const kp = S.Keypair.fromSecret(secret);
  const contract = new S.Contract(chain.contractId);

  // 7-decimal i128 base units, no float error.
  const [whole, frac = ''] = amountStr.split('.');
  const base = BigInt(whole + frac.padEnd(7, '0'));

  console.log(`Depositing ${amountStr} USDC from ${kp.publicKey()} into ${chain.contractId} ...`);

  const account = await server.getAccount(kp.publicKey());
  let tx = new S.TransactionBuilder(account, {
    fee: S.BASE_FEE,
    networkPassphrase: chain.networkPassphrase,
  })
    .addOperation(
      contract.call(
        'deposit',
        new S.Address(kp.publicKey()).toScVal(),
        S.nativeToScVal(base, { type: 'i128' })
      )
    )
    .setTimeout(60)
    .build();

  tx = await server.prepareTransaction(tx);
  tx.sign(kp);
  const sent = await server.sendTransaction(tx);
  if (sent.status === 'ERROR') {
    throw new Error(`submit failed: ${JSON.stringify(sent.errorResult)}`);
  }
  let got;
  for (let i = 0; i < 30; i += 1) {
    got = await server.getTransaction(sent.hash);
    if (got.status !== 'NOT_FOUND') break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (got.status !== 'SUCCESS') throw new Error(`deposit failed on-chain (status ${got.status}, tx ${sent.hash})`);
  console.log(`deposit tx: ${sent.hash}`);

  // Read back the pooled balance.
  const bAcct = await server.getAccount(kp.publicKey());
  const bTx = new S.TransactionBuilder(bAcct, { fee: S.BASE_FEE, networkPassphrase: chain.networkPassphrase })
    .addOperation(contract.call('balance'))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(bTx);
  const bal = S.scValToNative(sim.result.retval);
  console.log(`escrow balance now: ${Number(bal) / 1e7} USDC`);
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
