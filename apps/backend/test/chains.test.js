'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { activeChain, escrowUrl } = require('@kambiox/chains');

const STELLAR_CONTRACT = 'CCA2WYNWADCEH5ZZ36D7II5OCVZL3HTMIKDTOC74HEVHHJZONNT2AXR5';
const STELLAR_USDC_SAC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';

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

// ── Stellar (Soroban) ──
test('stellar-testnet resolves to a distinctly shaped stellar object', () => {
  const s = activeChain({ CHAIN: 'stellar-testnet', STELLAR_OPERATOR_SECRET: 'SABC' });
  assert.equal(s.stellar, true);
  assert.equal(s.contractId, STELLAR_CONTRACT); // baked-in known contract
  assert.equal(s.usdcSac, STELLAR_USDC_SAC);
  assert.equal(s.usdcDecimals, 7);
  assert.equal(s.operatorSecret, 'SABC');
  assert.equal(s.networkPassphrase, 'Test SDF Network ; September 2015');
  // Must NOT carry EVM-shaped fields that code could mistake for an EVM chain.
  assert.equal(s.escrowAddress, undefined);
  assert.equal(s.usdcAddress, undefined);
  assert.equal(s.chainId, undefined);
  assert.equal(s.privateKey, undefined);
});

test('stellar ignores stale EVM globals (no cross-contamination)', () => {
  const s = activeChain({ CHAIN: 'stellar-testnet', ...STALE });
  assert.equal(s.escrowAddress, undefined);
  assert.equal(s.usdcAddress, undefined);
  assert.equal(s.contractId, STELLAR_CONTRACT); // still the baked Soroban contract
});

test('stellar per-chain overrides win (redeploy / different SAC)', () => {
  const s = activeChain({
    CHAIN: 'stellar-testnet',
    STELLAR_TESTNET_ESCROW_CONTRACT_ID: 'CDWONTMATCHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    STELLAR_TESTNET_USDC_SAC: 'CSOMEOTHERSACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  });
  assert.equal(s.contractId, 'CDWONTMATCHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  assert.equal(s.usdcSac, 'CSOMEOTHERSACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
});

test('escrowUrl uses the Soroban /contract/ path for stellar', () => {
  const s = activeChain({ CHAIN: 'stellar-testnet' });
  assert.equal(
    escrowUrl(s),
    `https://stellar.expert/explorer/testnet/contract/${STELLAR_CONTRACT}`
  );
});
