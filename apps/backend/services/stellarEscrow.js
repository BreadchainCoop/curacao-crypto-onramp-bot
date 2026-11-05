// Stellar / Soroban escrow release — the Stellar counterpart of services/escrow.js.
//
// It exposes the SAME public interface the rest of the backend already uses,
//   release(recipient, amountUsdc) -> txHash
//   refund(amountUsdc)             -> txHash   (owner treasury withdrawal)
//   balance()                      -> string   (human units)
// so routes/sentoo.js and the admin flows are unchanged when CHAIN=stellar-*.
//
// Stellar specifics (vs the EVM escrow):
//   - the escrow is the KambioEscrow Soroban contract (C...), not Escrow.sol
//   - recipients are StrKey accounts (G...), amounts are i128 base units
//   - USDC on Stellar has 7 decimals (EVM USDC has 6)
//   - the OWNER keypair signs; it must be the escrow owner (require_owner)
//   - `release`/`withdraw` are owner-only; the contract has no on-chain `refund`,
//     so `refund` here maps to the owner `withdraw` (pool -> owner), matching the
//     EVM refund semantics the backend expects.
//
// The Stellar SDK is INJECTED (`sdk`) so unit tests run without a network. In
// production it defaults to require('@stellar/stellar-sdk').

const DEFAULT_USDC_DECIMALS = 7;

/**
 * Convert a human USDC amount (e.g. 100.5 or "100.5") into an integer i128
 * BigInt in base units, without floating-point error. Rejects negative, zero,
 * non-finite, or over-precise inputs (more fractional digits than `decimals`).
 */
function toBaseUnits(amountUsdc, decimals = DEFAULT_USDC_DECIMALS) {
  const s = String(amountUsdc).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Invalid USDC amount "${amountUsdc}"`);
  }
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) {
    throw new Error(`USDC amount "${amountUsdc}" has more than ${decimals} decimals`);
  }
  const base = BigInt(whole + frac.padEnd(decimals, '0'));
  if (base <= 0n) {
    throw new Error(`USDC amount must be positive, got "${amountUsdc}"`);
  }
  return base;
}

/** Convert an i128 BigInt of base units back to a human string (for balance). */
function fromBaseUnits(base, decimals = DEFAULT_USDC_DECIMALS) {
  const neg = base < 0n;
  const abs = (neg ? -base : base).toString().padStart(decimals + 1, '0');
  const whole = abs.slice(0, abs.length - decimals);
  const frac = abs.slice(abs.length - decimals).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

/**
 * Build the Stellar escrow service.
 *
 * @param {object} opts
 * @param {string} opts.contractId         KambioEscrow contract id (C...)
 * @param {string} opts.operatorSecret     escrow owner secret (S...) — signs
 * @param {string} opts.sorobanRpc         Soroban RPC URL
 * @param {string} opts.networkPassphrase  e.g. "Test SDF Network ; September 2015"
 * @param {number} [opts.usdcDecimals=7]
 * @param {object} [opts.sdk]              injectable @stellar/stellar-sdk
 * @param {number} [opts.pollIntervalMs=1000]
 * @param {number} [opts.maxPolls=30]
 */
function createStellarEscrowService({
  contractId,
  operatorSecret,
  sorobanRpc,
  networkPassphrase,
  usdcDecimals = DEFAULT_USDC_DECIMALS,
  sdk,
  pollIntervalMs = 1000,
  maxPolls = 30,
}) {
  if (!contractId || !operatorSecret || !sorobanRpc || !networkPassphrase) {
    throw new Error(
      'Stellar escrow requires contractId, operatorSecret, sorobanRpc, networkPassphrase'
    );
  }
  const S = sdk ?? require('@stellar/stellar-sdk');
  const server = new S.rpc.Server(sorobanRpc, { allowHttp: sorobanRpc.startsWith('http://') });
  const keypair = S.Keypair.fromSecret(operatorSecret);
  const contract = new S.Contract(contractId);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Build a tx that calls `method(...args)`, where args are already ScVals. */
  function buildCall(account, method, args) {
    return new S.TransactionBuilder(account, {
      fee: S.BASE_FEE,
      networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();
  }

  /** Simulate a read-only call and return the decoded native result. */
  async function simulateRead(method, args = []) {
    const account = await server.getAccount(keypair.publicKey());
    const tx = buildCall(account, method, args);
    const sim = await server.simulateTransaction(tx);
    if (S.rpc.Api.isSimulationError(sim)) {
      throw new Error(`Soroban simulation failed for ${method}: ${sim.error}`);
    }
    return S.scValToNative(sim.result.retval);
  }

  /** Sign, submit and await a state-changing call; returns the tx hash. */
  async function invoke(method, args) {
    const account = await server.getAccount(keypair.publicKey());
    let tx = buildCall(account, method, args);
    tx = await server.prepareTransaction(tx); // simulate + assemble soroban data/fees
    tx.sign(keypair);

    const sent = await server.sendTransaction(tx);
    if (sent.status === 'ERROR') {
      throw new Error(`Soroban ${method} submission failed: ${JSON.stringify(sent.errorResult)}`);
    }
    const hash = sent.hash;

    for (let i = 0; i < maxPolls; i += 1) {
      const got = await server.getTransaction(hash);
      if (got.status === 'SUCCESS') return hash;
      if (got.status === 'FAILED') {
        throw new Error(`Soroban ${method} failed on-chain (tx ${hash})`);
      }
      await sleep(pollIntervalMs); // status NOT_FOUND -> still pending
    }
    throw new Error(`Soroban ${method} not confirmed after ${maxPolls} polls (tx ${hash})`);
  }

  /** Release `amountUsdc` (human units) to a Stellar account `recipient` (G...). */
  async function release(recipient, amountUsdc) {
    const amount = toBaseUnits(amountUsdc, usdcDecimals);
    return invoke('release', [
      new S.Address(recipient).toScVal(),
      S.nativeToScVal(amount, { type: 'i128' }),
    ]);
  }

  /** Owner treasury withdrawal of `amountUsdc` (pooled funds -> owner). */
  async function refund(amountUsdc) {
    const amount = toBaseUnits(amountUsdc, usdcDecimals);
    return invoke('withdraw', [S.nativeToScVal(amount, { type: 'i128' })]);
  }

  /** Pooled escrow USDC balance in human units (read-only simulation). */
  async function balance() {
    const raw = await simulateRead('balance');
    return fromBaseUnits(BigInt(raw), usdcDecimals);
  }

  return { release, refund, balance };
}

/** Build the Stellar escrow service from a resolved stellar chain object. */
function stellarEscrowFromChain(chain, { sdk } = {}) {
  if (!chain || !chain.stellar) {
    throw new Error('stellarEscrowFromChain requires a stellar chain');
  }
  if (!chain.operatorSecret) {
    throw new Error('STELLAR_OPERATOR_SECRET is required to sign Stellar releases');
  }
  return createStellarEscrowService({
    contractId: chain.contractId,
    operatorSecret: chain.operatorSecret,
    sorobanRpc: chain.sorobanRpc,
    networkPassphrase: chain.networkPassphrase,
    usdcDecimals: chain.usdcDecimals,
    sdk,
  });
}

module.exports = {
  createStellarEscrowService,
  stellarEscrowFromChain,
  toBaseUnits,
  fromBaseUnits,
};
