'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createRoutingEscrowService,
  routingEscrowFromEnv,
  looksLikeStellarAddress,
} = require('../services/escrow');

// A complete-enough EVM env so the EVM escrow builds without a real key.
const BASE_ENV = {
  CHAIN: 'base-sepolia',
  ESCROW_SIGNER: 'fake',
  ESCROW_CONTRACT_ADDRESS: '0x05b9aD81666f3a245500FCFc4E0e13017BcFAcD4',
  USDC_ADDRESS: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

const G_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const EVM_ADDRESS = '0x92c7940000000000000000000000000000013da8';

function recorder(hashPrefix) {
  const calls = [];
  return {
    calls,
    async release(recipient, amountUsdc) {
      calls.push({ recipient, amountUsdc });
      return `${hashPrefix}_${recipient.slice(0, 6)}`;
    },
    async refund() {
      return `${hashPrefix}_refund`;
    },
    async balance() {
      return '42';
    },
  };
}

test('looksLikeStellarAddress distinguishes G… accounts from 0x and junk', () => {
  assert.equal(looksLikeStellarAddress(G_ADDRESS), true);
  assert.equal(looksLikeStellarAddress(EVM_ADDRESS), false);
  assert.equal(looksLikeStellarAddress('not-an-address'), false);
  assert.equal(looksLikeStellarAddress(null), false);
});

test('routing: a G… payout goes to the Stellar escrow', async () => {
  const evm = recorder('evm');
  const stellar = recorder('xlm');
  const router = createRoutingEscrowService({ evm, stellar });

  const hash = await router.release(G_ADDRESS, 100);

  assert.equal(stellar.calls.length, 1);
  assert.equal(evm.calls.length, 0);
  assert.equal(stellar.calls[0].recipient, G_ADDRESS);
  assert.equal(stellar.calls[0].amountUsdc, 100);
  assert.match(hash, /^xlm_/);
});

test('routing: a 0x payout goes to the EVM escrow', async () => {
  const evm = recorder('evm');
  const stellar = recorder('xlm');
  const router = createRoutingEscrowService({ evm, stellar });

  const hash = await router.release(EVM_ADDRESS, 50);

  assert.equal(evm.calls.length, 1);
  assert.equal(stellar.calls.length, 0);
  assert.equal(evm.calls[0].recipient, EVM_ADDRESS);
  assert.match(hash, /^evm_/);
});

test('routing: a Stellar payout with no Stellar escrow configured fails loudly', async () => {
  const evm = recorder('evm');
  const router = createRoutingEscrowService({ evm, stellar: null });

  await assert.rejects(() => router.release(G_ADDRESS, 10), /STELLAR_OPERATOR_SECRET is not configured/);
  assert.equal(evm.calls.length, 0); // must NOT fall back to EVM for a Stellar address
});

test('routing: refund and balance default to the EVM escrow', async () => {
  const evm = recorder('evm');
  const stellar = recorder('xlm');
  const router = createRoutingEscrowService({ evm, stellar });

  assert.equal(await router.refund(5), 'evm_refund');
  assert.equal(await router.balance(), '42');
});

test('routingEscrowFromEnv with NO stellar secret builds and keeps EVM working', () => {
  const router = routingEscrowFromEnv({ ...BASE_ENV });
  assert.equal(typeof router.release, 'function');
});

test('routingEscrowFromEnv with a MALFORMED stellar secret does NOT crash the backend', async () => {
  // A bad secret must be swallowed at construction — the backend still boots and
  // the EVM/Base path still works; only Stellar payouts fail (cleanly, per order).
  let router;
  assert.doesNotThrow(() => {
    router = routingEscrowFromEnv({ ...BASE_ENV, STELLAR_OPERATOR_SECRET: 'not-a-real-secret' });
  });
  // EVM payout still releases (fake signer).
  assert.match(await router.release('0x92c7940000000000000000000000000000013da8', 1), /^0xfake/);
  // Stellar payout fails cleanly instead of taking down the service.
  await assert.rejects(
    () => router.release('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', 1),
    /STELLAR_OPERATOR_SECRET is not configured/
  );
});
