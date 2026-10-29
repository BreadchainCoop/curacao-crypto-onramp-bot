'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEscrowBalanceReader } = require('../services/escrowBalance');

// Minimal ethers fake: records the escrow address + ABI, returns a fixed raw
// balance, and formats 6-decimal units like real ethers.
function fakeEthers(rawBalance) {
  const seen = {};
  return {
    JsonRpcProvider: class { constructor(url) { seen.rpcUrl = url; } },
    Contract: class {
      constructor(addr, abi) { seen.addr = addr; seen.abi = abi; }
      async balance() { return rawBalance; }
    },
    formatUnits: (raw, dec) => String(Number(raw) / 10 ** dec),
    _seen: seen,
  };
}

test('reads escrow balance() and formats to human USDC (6 decimals)', async () => {
  const ethers = fakeEthers(95588000000n); // 95,588 USDC in 6-dec units
  const get = createEscrowBalanceReader({ rpcUrl: 'https://rpc', escrowAddress: '0xEsc', ethers });
  assert.equal(await get(), 95588);
  assert.equal(ethers._seen.rpcUrl, 'https://rpc');
  assert.equal(ethers._seen.addr, '0xEsc');
});

test('requires rpcUrl and escrowAddress', () => {
  assert.throws(() => createEscrowBalanceReader({ escrowAddress: '0xE' }), /requires rpcUrl/);
  assert.throws(() => createEscrowBalanceReader({ rpcUrl: 'x' }), /requires rpcUrl/);
});
