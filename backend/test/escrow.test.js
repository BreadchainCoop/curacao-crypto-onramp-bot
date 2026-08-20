'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const ethers = require('ethers');

const {
  createEscrowService,
  createFakeSigner,
  escrowFromEnv,
} = require('../services/escrow');
const { createPrivyOperatorSigner } = require('../services/privyOperator');

const ESCROW = '0x05b9aD81666f3a245500FCFc4E0e13017BcFAcD4';
const RECIPIENT = '0x92c7940000000000000000000000000000013da8';
const iface = new ethers.Interface(['function release(address recipient, uint256 amount)']);

test('escrow service builds correct release calldata and returns the signer hash', async () => {
  const signer = createFakeSigner();
  const escrow = createEscrowService({ contractAddress: ESCROW, signer });

  const hash = await escrow.release(RECIPIENT, 100.5);

  assert.equal(signer.calls.length, 1);
  assert.equal(signer.calls[0].to, ESCROW);

  // Calldata must decode to release(recipient, 100.5 * 1e6).
  const decoded = iface.decodeFunctionData('release', signer.calls[0].data);
  assert.equal(decoded[0].toLowerCase(), RECIPIENT.toLowerCase());
  assert.equal(decoded[1], 100_500_000n); // 6 decimals
  assert.match(hash, /^0xfake/);
});

test('escrow service requires a contract address and a signer', () => {
  assert.throws(() => createEscrowService({ signer: createFakeSigner() }), /contractAddress/);
  assert.throws(() => createEscrowService({ contractAddress: ESCROW }), /signer/);
});

test('escrowFromEnv with ESCROW_SIGNER=fake needs no key and releases', async () => {
  const escrow = escrowFromEnv({
    CHAIN: 'base-sepolia',
    ESCROW_SIGNER: 'fake',
    ESCROW_CONTRACT_ADDRESS: ESCROW,
    // deliberately no ADMIN_WALLET_PRIVATE_KEY / no Privy creds
  });
  const hash = await escrow.release(RECIPIENT, 25);
  assert.match(hash, /^0xfake/);
});

test('privy operator signer sends the correct intent and returns the hash (fake client)', async () => {
  const sent = [];
  const fakePrivyClient = {
    wallets() {
      return {
        ethereum() {
          return {
            async sendTransaction(walletId, opts) {
              sent.push({ walletId, opts });
              return { hash: '0xabc123', caip2: opts.caip2 };
            },
          };
        },
      };
    },
  };

  const signer = createPrivyOperatorSigner({
    walletId: 'wallet-123',
    chainId: 84532,
    authorizationKey: 'p256-priv-key',
    privyClient: fakePrivyClient,
    // no rpcUrl -> no receipt wait, stays offline
  });

  const data = iface.encodeFunctionData('release', [RECIPIENT, 25_000_000n]);
  const hash = await signer.send({ to: ESCROW, data });

  assert.equal(hash, '0xabc123');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].walletId, 'wallet-123');
  assert.equal(sent[0].opts.caip2, 'eip155:84532');
  assert.equal(sent[0].opts.params.transaction.to, ESCROW);
  assert.equal(sent[0].opts.params.transaction.data, data);
  // The P-256 authorization key must be presented so Privy authorizes the op.
  assert.deepEqual(sent[0].opts.authorization_context, {
    authorization_private_keys: ['p256-priv-key'],
  });
});

test('privy operator signer throws if Privy returns no hash', async () => {
  const fakePrivyClient = {
    wallets: () => ({ ethereum: () => ({ sendTransaction: async () => ({}) }) }),
  };
  const signer = createPrivyOperatorSigner({
    walletId: 'w',
    chainId: 84532,
    privyClient: fakePrivyClient,
  });
  await assert.rejects(() => signer.send({ to: ESCROW, data: '0x' }), /no hash/);
});

test('privy operator signer validates required config', () => {
  assert.throws(() => createPrivyOperatorSigner({ chainId: 1, privyClient: {} }), /walletId/);
  assert.throws(
    () => createPrivyOperatorSigner({ walletId: 'w', privyClient: {} }),
    /chainId/
  );
});
