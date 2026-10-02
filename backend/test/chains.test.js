'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { activeChain } = require('../../chains');

const ARC_USDC = '0x3600000000000000000000000000000000000000';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
// A stale testnet global, as it appears in a real .env (MockUSDC + shared escrow).
const STALE = {
  USDC_ADDRESS: '0xdf4547092471a630d90f1A44521112C9aaC176e6',
  ESCROW_CONTRACT_ADDRESS: '0x05b9aD81666f3a245500FCFc4E0e13017BcFAcD4',
};

test('mainnet USDC ignores the stale global and uses the baked canonical token', () => {
  const arc = activeChain({ CHAIN: 'arc-mainnet', ...STALE });
  assert.equal(arc.usdcAddress, ARC_USDC, 'Arc must not inherit the testnet MockUSDC');
  const base = activeChain({ CHAIN: 'base-mainnet', ...STALE });
  assert.equal(base.usdcAddress, BASE_USDC, 'Base must not inherit the testnet MockUSDC');
});

test('mainnet escrow never falls back to the shared global', () => {
  const arc = activeChain({ CHAIN: 'arc-mainnet', ...STALE });
  // The global 0x05b9 escrow must NOT leak onto a mainnet chain.
  assert.notEqual(arc.escrowAddress, STALE.ESCROW_CONTRACT_ADDRESS);
  assert.equal(arc.escrowAddress, undefined);
});

test('per-chain mainnet overrides win over everything', () => {
  const arc = activeChain({
    CHAIN: 'arc-mainnet',
    ARC_MAINNET_ESCROW_ADDRESS: '0x0970462Cece33d425dBa716cbF4855bb4f44fCF5',
    ARC_MAINNET_USDC_ADDRESS: ARC_USDC,
    ...STALE,
  });
  assert.equal(arc.escrowAddress, '0x0970462Cece33d425dBa716cbF4855bb4f44fCF5');
  assert.equal(arc.usdcAddress, ARC_USDC);
  assert.equal(arc.mainnet, true);
});

test('a per-chain USDC override still wins on mainnet (e.g. a bridged variant)', () => {
  const base = activeChain({
    CHAIN: 'base-mainnet',
    BASE_MAINNET_USDC_ADDRESS: '0x0000000000000000000000000000000000001234',
  });
  assert.equal(base.usdcAddress, '0x0000000000000000000000000000000000001234');
});

test('testnets keep the shared global fallback (unchanged behaviour)', () => {
  const t = activeChain({ CHAIN: 'base-sepolia', ...STALE });
  assert.equal(t.usdcAddress, STALE.USDC_ADDRESS);
  assert.equal(t.escrowAddress, STALE.ESCROW_CONTRACT_ADDRESS);
  assert.equal(t.mainnet, false);
});

test('testnet per-chain override still wins over the global', () => {
  const t = activeChain({
    CHAIN: 'base-sepolia',
    BASE_SEPOLIA_ESCROW_ADDRESS: '0x00000000000000000000000000000000000000ee',
    ...STALE,
  });
  assert.equal(t.escrowAddress, '0x00000000000000000000000000000000000000ee');
});
