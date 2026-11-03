'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createStellarEscrowService,
  stellarEscrowFromChain,
  toBaseUnits,
  fromBaseUnits,
} = require('../services/stellarEscrow');

const CONTRACT = 'CCA2WYNWADCEH5ZZ36D7II5OCVZL3HTMIKDTOC74HEVHHJZONNT2AXR5';
const SECRET = 'SABTESTSECRETxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const RECIPIENT = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

// ── A minimal fake @stellar/stellar-sdk that records calls and lets a test
//    script the getTransaction status sequence and the simulate result. ──
function fakeSdk({ getTxStatuses = ['SUCCESS'], sendStatus = 'PENDING', simResult, simError } = {}) {
  const log = { calls: [], ops: [], signed: 0 };
  let txIndex = 0;

  class Server {
    constructor(url) {
      this.url = url;
    }
    async getAccount() {
      return { accountId: () => 'G...', sequenceNumber: () => '1' };
    }
    async prepareTransaction(tx) {
      tx.prepared = true;
      return tx;
    }
    async simulateTransaction() {
      return simError ? { error: simError } : { result: { retval: simResult } };
    }
    async sendTransaction() {
      return { status: sendStatus === 'ERROR' ? 'ERROR' : 'PENDING', hash: 'HASH123', errorResult: { x: 1 } };
    }
    async getTransaction() {
      const s = getTxStatuses[Math.min(txIndex, getTxStatuses.length - 1)];
      txIndex += 1;
      return { status: s };
    }
  }

  const sdk = {
    BASE_FEE: '100',
    rpc: {
      Server,
      Api: { isSimulationError: (sim) => !!(sim && sim.error) },
    },
    Keypair: { fromSecret: (s) => ({ secret: s, publicKey: () => 'GOWNER' }) },
    Contract: class {
      constructor(id) {
        this.id = id;
      }
      call(method, ...args) {
        const op = { method, args };
        log.ops.push(op);
        return op;
      }
    },
    TransactionBuilder: class {
      constructor(account, opts) {
        this.opts = opts;
        this.ops = [];
      }
      addOperation(op) {
        this.ops.push(op);
        return this;
      }
      setTimeout() {
        return this;
      }
      build() {
        const ops = this.ops;
        return {
          ops,
          sign() {
            log.signed += 1;
          },
        };
      }
    },
    Address: class {
      constructor(str) {
        this.str = str;
      }
      toScVal() {
        return { kind: 'address', value: this.str };
      }
    },
    nativeToScVal: (v, o) => ({ kind: (o && o.type) || 'native', value: v }),
    scValToNative: (v) => v,
  };
  return { sdk, log };
}

function svc(opts = {}, fakeOpts = {}) {
  const { sdk, log } = fakeSdk(fakeOpts);
  const service = createStellarEscrowService({
    contractId: CONTRACT,
    operatorSecret: SECRET,
    sorobanRpc: 'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    usdcDecimals: 7,
    sdk,
    pollIntervalMs: 0,
    maxPolls: 3,
    ...opts,
  });
  return { service, log };
}

// ── toBaseUnits / fromBaseUnits ──
test('toBaseUnits converts human USDC to 7-decimal i128 base units', () => {
  assert.equal(toBaseUnits('100.5', 7), 1_005_000_000n);
  assert.equal(toBaseUnits(1, 7), 10_000_000n);
  assert.equal(toBaseUnits('0.0000001', 7), 1n);
});

test('toBaseUnits rejects invalid, zero, and over-precise amounts', () => {
  assert.throws(() => toBaseUnits('abc', 7), /Invalid USDC amount/);
  assert.throws(() => toBaseUnits('0', 7), /must be positive/);
  assert.throws(() => toBaseUnits('-5', 7), /Invalid USDC amount/);
  assert.throws(() => toBaseUnits('1.12345678', 7), /more than 7 decimals/);
});

test('fromBaseUnits renders human units and trims trailing zeros', () => {
  assert.equal(fromBaseUnits(1_005_000_000n, 7), '100.5');
  assert.equal(fromBaseUnits(10_000_000n, 7), '1');
  assert.equal(fromBaseUnits(0n, 7), '0');
  assert.equal(fromBaseUnits(1n, 7), '0.0000001');
});

// ── release ──
test('release signs and submits a release invoke and returns the tx hash', async () => {
  const { service, log } = svc();
  const hash = await service.release(RECIPIENT, 100.5);

  assert.equal(hash, 'HASH123');
  assert.equal(log.signed, 1);
  const op = log.ops.at(-1);
  assert.equal(op.method, 'release');
  assert.equal(op.args[0].value, RECIPIENT); // recipient address ScVal
  assert.equal(op.args[1].kind, 'i128');
  assert.equal(op.args[1].value, 1_005_000_000n); // 100.5 * 1e7
});

test('release throws when the submission is rejected', async () => {
  const { service } = svc({}, { sendStatus: 'ERROR' });
  await assert.rejects(() => service.release(RECIPIENT, 5), /submission failed/);
});

test('release throws when the transaction fails on-chain', async () => {
  const { service } = svc({}, { getTxStatuses: ['FAILED'] });
  await assert.rejects(() => service.release(RECIPIENT, 5), /failed on-chain/);
});

test('release polls past NOT_FOUND until SUCCESS', async () => {
  const { service } = svc({}, { getTxStatuses: ['NOT_FOUND', 'NOT_FOUND', 'SUCCESS'] });
  const hash = await service.release(RECIPIENT, 5);
  assert.equal(hash, 'HASH123');
});

test('release gives up after maxPolls when never confirmed', async () => {
  const { service } = svc({ maxPolls: 2 }, { getTxStatuses: ['NOT_FOUND'] });
  await assert.rejects(() => service.release(RECIPIENT, 5), /not confirmed/);
});

// ── refund (owner withdraw) ──
test('refund maps to the owner withdraw invoke', async () => {
  const { service, log } = svc();
  const hash = await service.refund(10);
  assert.equal(hash, 'HASH123');
  assert.equal(log.ops.at(-1).method, 'withdraw');
  assert.equal(log.ops.at(-1).args[0].value, 100_000_000n); // 10 * 1e7
});

// ── balance ──
test('balance simulates the read and returns human units', async () => {
  const { service } = svc({}, { simResult: 2_500_000_000n });
  assert.equal(await service.balance(), '250');
});

test('balance throws on a simulation error', async () => {
  const { service } = svc({}, { simError: 'boom' });
  await assert.rejects(() => service.balance(), /simulation failed/);
});

// ── construction guards ──
test('createStellarEscrowService requires the core params', () => {
  assert.throws(
    () => createStellarEscrowService({ contractId: CONTRACT }),
    /requires contractId, operatorSecret/
  );
});

test('stellarEscrowFromChain requires a stellar chain and an operator secret', () => {
  const { sdk } = fakeSdk();
  assert.throws(() => stellarEscrowFromChain({ stellar: false }), /requires a stellar chain/);
  assert.throws(
    () => stellarEscrowFromChain({ stellar: true, contractId: CONTRACT }),
    /STELLAR_OPERATOR_SECRET is required/
  );
  const service = stellarEscrowFromChain(
    {
      stellar: true,
      contractId: CONTRACT,
      operatorSecret: SECRET,
      sorobanRpc: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      usdcDecimals: 7,
    },
    { sdk }
  );
  assert.equal(typeof service.release, 'function');
});
