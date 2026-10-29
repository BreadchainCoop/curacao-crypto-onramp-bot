'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCircleOperatorSigner,
  circleBlockchain,
} = require('../services/circleOperator');

// Fake Circle client: createContractExecutionTransaction returns an id; each
// getTransaction call returns the next state in `states` (last one repeats).
function fakeClient(states) {
  let i = 0;
  const calls = { create: [], get: [] };
  return {
    calls,
    async createContractExecutionTransaction(args) {
      calls.create.push(args);
      return { data: { id: 'tx_abc' } };
    },
    async getTransaction(args) {
      calls.get.push(args);
      const s = states[Math.min(i, states.length - 1)];
      i += 1;
      return { data: { transaction: s } };
    },
  };
}

test('circleBlockchain maps chain ids and rejects unknown', () => {
  assert.equal(circleBlockchain(5042), 'ARC');
  assert.equal(circleBlockchain(8453), 'BASE');
  assert.equal(circleBlockchain(5042002), 'ARC-TESTNET');
  assert.throws(() => circleBlockchain(999999), /no blockchain mapping/);
});

test('send submits a contract execution and returns the tx hash once SENT', async () => {
  const client = fakeClient([
    { state: 'QUEUED' },
    { state: 'SENT', txHash: '0xdeadbeef' },
  ]);
  const signer = createCircleOperatorSigner({
    client, walletId: 'w1', blockchain: 'ARC', pollIntervalMs: 0,
  });
  const hash = await signer.send({ to: '0xEscrow', data: '0xcalldata' });
  assert.equal(hash, '0xdeadbeef');

  // correct params were sent to Circle
  const c = client.calls.create[0];
  assert.equal(c.walletId, 'w1');
  assert.equal(c.blockchain, 'ARC');
  assert.equal(c.contractAddress, '0xEscrow');
  assert.equal(c.callData, '0xcalldata');
  assert.deepEqual(c.fee, { type: 'level', config: { feeLevel: 'MEDIUM' } });
});

test('send throws on a terminal failure state', async () => {
  const client = fakeClient([{ state: 'FAILED', errorReason: 'insufficient funds' }]);
  const signer = createCircleOperatorSigner({
    client, walletId: 'w1', blockchain: 'ARC', pollIntervalMs: 0,
  });
  await assert.rejects(
    () => signer.send({ to: '0xEscrow', data: '0x' }),
    /FAILED: insufficient funds/,
  );
});

test('send times out if no hash ever appears', async () => {
  const client = fakeClient([{ state: 'QUEUED' }]);
  const signer = createCircleOperatorSigner({
    client, walletId: 'w1', blockchain: 'ARC', pollIntervalMs: 0, maxWaitMs: 0,
  });
  await assert.rejects(() => signer.send({ to: '0xE', data: '0x' }), /produced no hash/);
});

test('honours a custom fee level', async () => {
  const client = fakeClient([{ state: 'SENT', txHash: '0x1' }]);
  const signer = createCircleOperatorSigner({
    client, walletId: 'w1', blockchain: 'BASE', feeLevel: 'HIGH', pollIntervalMs: 0,
  });
  await signer.send({ to: '0xE', data: '0x' });
  assert.equal(client.calls.create[0].fee.config.feeLevel, 'HIGH');
});

test('requires client, walletId and blockchain', () => {
  assert.throws(() => createCircleOperatorSigner({ walletId: 'w', blockchain: 'ARC' }), /requires a client/);
  assert.throws(() => createCircleOperatorSigner({ client: {}, blockchain: 'ARC' }), /CIRCLE_WALLET_ID/);
  assert.throws(() => createCircleOperatorSigner({ client: {}, walletId: 'w' }), /requires a blockchain/);
});
