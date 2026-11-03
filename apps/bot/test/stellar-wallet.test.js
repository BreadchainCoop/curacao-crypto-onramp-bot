'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const wallet = require('../flows/wallet');

const G_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const EVM_ADDRESS = '0x' + 'a'.repeat(40);

test('on a Stellar chain, addresses validate as StrKey G-addresses (not 0x)', () => {
  const stellar = { stellar: true };
  assert.equal(wallet.isValidAddress(G_ADDRESS, stellar), true);
  assert.equal(wallet.isValidAddress(EVM_ADDRESS, stellar), false);
});

test('on an EVM chain, addresses validate as 0x (not G…)', () => {
  const evm = { stellar: false };
  assert.equal(wallet.isValidAddress(EVM_ADDRESS, evm), true);
  assert.equal(wallet.isValidAddress(G_ADDRESS, evm), false);
});
