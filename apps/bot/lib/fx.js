// FX / rate calculation for the on-ramp.
//
// Pure functions: given a USDC amount the user wants to buy, compute the XCG
// (Caribbean guilder) they must pay, broken down into subtotal, FX spread, an
// optional platform fee, and the Sentoo payment-processor pass-through. The full
// breakdown is returned so the bot can show each as SEPARATE line items before
// the user confirms.
//
// Money flow (MVP): the platform fee is captured in fiat XCG — the user pays a
// little more in guilders and the fee accrues in the operator's Sentoo/bank
// balance. It does not touch the on-chain escrow.
//
// THE RATE — SOURCE OF TRUTH: rates come from the CBCS (Centrale Bank van Curaçao
// en Sint Maarten) "Official Exchange Rates for Use by the Commercial Banks".
// The central USD/XCG parity is 1.79, but customers transact at the commercial-
// bank rates around it. Because this on-ramp has the user pay XCG to receive a
// USD-denominated asset (USDC), the user is BUYING USD, so the bank "Sell" USD
// rate applies: 1.82 XCG per USD (see bot/lib/cbcsRates.js). It is NOT 1:1.
// Override via FX_PEG_RATE; refresh cbcsRates.js when CBCS publishes new rates.

const { USD_SELL_RATE } = require('./cbcsRates');

const DEFAULTS = {
  pegRate: USD_SELL_RATE, // CBCS commercial-bank USD "Sell" rate (XCG per USD).
  // FX spread folded into the single service fee below — XCG is hard-pegged to
  // USD, so there is no currency volatility to hedge separately. Kept as a
  // configurable knob (FX_SPREAD_PCT) for chains/currencies that do float.
  spreadPct: 0, // FX margin baked into the rate, percent.
  feeEnabled: true, // platform "fee switch" — captures a fee into the exchange.
  feePct: 3, // single service fee, percent of order value (USDC notional).
  feeFlatMinXcg: 0.5, // minimum fee in XCG, so tiny orders still cover costs.
  feeMaxXcg: 182, // max fee in XCG (~$100 at the 1.82 peg) — a volume discount for large orders.
  // ── Sentoo payment-processor pass-through ──
  // Sentoo (the fiat rail) charges a fee on every successful payment: on the
  // Account-to-Account base plan it is `sentooPct`% of the amount collected,
  // capped at `sentooCapUsd` USD per transaction. It is a real cost of goods, so
  // it is passed through to the customer (grossed up — see quoteUsdcPurchase) on
  // top of the spread and platform fee, never absorbed by them.
  sentooEnabled: true,
  sentooPct: 1.0, // Sentoo base fee, percent of the total collected (capped below).
  sentooCapUsd: 1.5, // Sentoo per-transaction cap on the base fee, in USD ($1.50).
  // Extra UNCAPPED fee Sentoo charges when the customer's bank differs from our
  // merchant bank ("via escrow" inter-bank A2A). The paid amount is fixed before
  // the bank is known, so we price this in by default (worst case) and simply
  // keep it on a same-bank payment. Set 0 to disable, or a blended value once the
  // same/inter-bank mix is known.
  sentooInterbankPct: 0.4,
};

// Round to 2 decimals (XCG cents), half-up, avoiding binary-float drift.
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Round to 4 decimals — used for the display-only effective rate.
function round4(n) {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

function validateConfig(cfg) {
  if (!(cfg.pegRate > 0) || !Number.isFinite(cfg.pegRate)) {
    throw new RangeError('pegRate must be a finite number > 0');
  }
  if (!(cfg.spreadPct >= 0) || !Number.isFinite(cfg.spreadPct)) {
    throw new RangeError('spreadPct must be a finite number >= 0');
  }
  if (!(cfg.feePct >= 0) || !Number.isFinite(cfg.feePct)) {
    throw new RangeError('feePct must be a finite number >= 0');
  }
  if (!(cfg.feeFlatMinXcg >= 0) || !Number.isFinite(cfg.feeFlatMinXcg)) {
    throw new RangeError('feeFlatMinXcg must be a finite number >= 0');
  }
  if (!(cfg.feeMaxXcg >= 0) || !Number.isFinite(cfg.feeMaxXcg)) {
    throw new RangeError('feeMaxXcg must be a finite number >= 0');
  }
  if (cfg.feeMaxXcg < cfg.feeFlatMinXcg) {
    throw new RangeError('feeMaxXcg must be >= feeFlatMinXcg');
  }
  // sentooPct must stay strictly under 100 so the gross-up (÷ (1 - s)) is finite
  // and positive.
  if (!(cfg.sentooPct >= 0) || cfg.sentooPct >= 100 || !Number.isFinite(cfg.sentooPct)) {
    throw new RangeError('sentooPct must be a finite number in [0, 100)');
  }
  if (!(cfg.sentooCapUsd >= 0) || !Number.isFinite(cfg.sentooCapUsd)) {
    throw new RangeError('sentooCapUsd must be a finite number >= 0');
  }
  if (!(cfg.sentooInterbankPct >= 0) || !Number.isFinite(cfg.sentooInterbankPct)) {
    throw new RangeError('sentooInterbankPct must be a finite number >= 0');
  }
  // Combined Sentoo rate must stay strictly under 100% for the gross-up.
  if (cfg.sentooPct + cfg.sentooInterbankPct >= 100) {
    throw new RangeError('sentooPct + sentooInterbankPct must be < 100');
  }
}

/**
 * Build an FX config from environment variables, falling back to DEFAULTS.
 * Kept separate from the pure quote function so the pricing logic stays testable
 * and free of process.env access.
 *
 * @param {object} [env] - defaults to process.env.
 * @returns {{pegRate:number, spreadPct:number, feeEnabled:boolean, feePct:number, feeFlatMinXcg:number}}
 */
function loadFxConfig(env = process.env) {
  const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
  const bool = (v, d) =>
    v === undefined || v === ''
      ? d
      : !/^(false|0|no|off)$/i.test(String(v).trim());
  return {
    pegRate: num(env.FX_PEG_RATE, DEFAULTS.pegRate),
    spreadPct: num(env.FX_SPREAD_PCT, DEFAULTS.spreadPct),
    feeEnabled: bool(env.FX_FEE_ENABLED, DEFAULTS.feeEnabled),
    feePct: num(env.FX_FEE_PCT, DEFAULTS.feePct),
    feeFlatMinXcg: num(env.FX_FEE_FLAT_MIN_XCG, DEFAULTS.feeFlatMinXcg),
    feeMaxXcg: num(env.FX_FEE_MAX_XCG, DEFAULTS.feeMaxXcg),
    sentooEnabled: bool(env.SENTOO_FEE_ENABLED, DEFAULTS.sentooEnabled),
    sentooPct: num(env.SENTOO_FEE_PCT, DEFAULTS.sentooPct),
    sentooCapUsd: num(env.SENTOO_FEE_CAP_USD, DEFAULTS.sentooCapUsd),
    sentooInterbankPct: num(env.SENTOO_INTERBANK_PCT, DEFAULTS.sentooInterbankPct),
  };
}

/**
 * Quote the XCG a user must pay to buy `usdcAmount` USDC.
 * Pure: depends only on its arguments.
 *
 * The fee is computed on the USDC notional (subtotal), independent of the
 * spread, so the two are never compounded and each is shown on its own line.
 *
 * @param {number} usdcAmount - USDC the user wants to receive (> 0).
 * @param {object} [config] - partial FX config; DEFAULTS applied per field.
 * @returns {object} full price breakdown.
 */
function quoteUsdcPurchase(usdcAmount, config = {}) {
  if (
    typeof usdcAmount !== 'number' ||
    !Number.isFinite(usdcAmount) ||
    usdcAmount <= 0
  ) {
    throw new RangeError('usdcAmount must be a positive, finite number');
  }
  const cfg = { ...DEFAULTS, ...config };
  validateConfig(cfg);

  const subtotalXcg = round2(usdcAmount * cfg.pegRate);
  const spreadXcg = round2(subtotalXcg * (cfg.spreadPct / 100));

  let feeXcg = 0;
  let feeFloored = false;
  let feeCapped = false;
  if (cfg.feeEnabled) {
    const feeFromPct = subtotalXcg * (cfg.feePct / 100);
    if (feeFromPct < cfg.feeFlatMinXcg) {
      feeXcg = cfg.feeFlatMinXcg; // tiny orders still cover a minimum.
      feeFloored = true;
    } else if (feeFromPct > cfg.feeMaxXcg) {
      feeXcg = cfg.feeMaxXcg; // large orders are capped so the fee stays sane.
      feeCapped = true;
    } else {
      feeXcg = feeFromPct;
    }
    feeXcg = round2(feeXcg);
  }

  // Sentoo payment-processor fee, passed through to the customer and grossed up
  // so that after Sentoo takes its cut we still net subtotal + spread + fee. The
  // cut comes off the TOTAL collected (T), in two parts:
  //   • sentooPct% of T, capped at sentooCapUsd (the same-bank base fee), and
  //   • sentooInterbankPct% of T, UNCAPPED (added when the customer's bank differs
  //     from our merchant bank; priced in by default since T is fixed before the
  //     bank is known — kept as margin on a same-bank payment).
  // Cut C(T) = min(s1·T, cap) + s2·T. We solve T − C(T) = base per regime:
  //   uncapped 1%:  T = base / (1 − s1 − s2)
  //   capped   1%:  T = (base + cap) / (1 − s2)
  const sentooCapXcg = round2(cfg.sentooCapUsd * cfg.pegRate);
  let sentooXcg = 0;
  let sentooCapped = false;
  if (cfg.sentooEnabled && (cfg.sentooPct > 0 || cfg.sentooInterbankPct > 0)) {
    const base = subtotalXcg + spreadXcg + feeXcg;
    const s1 = cfg.sentooPct / 100;
    const s2 = cfg.sentooInterbankPct / 100;
    let total = base / (1 - s1 - s2); // assume the base fee is below its cap
    if (s1 * total > sentooCapXcg) {
      total = (base + sentooCapXcg) / (1 - s2); // base fee hits its flat cap
      sentooCapped = true;
    }
    sentooXcg = round2(total - base);
  }

  const totalXcg = round2(subtotalXcg + spreadXcg + feeXcg + sentooXcg);

  return {
    usdcAmount,
    currency: 'XCG',
    pegRate: cfg.pegRate,
    subtotalXcg,
    spread: { pct: cfg.spreadPct, amountXcg: spreadXcg },
    fee: {
      enabled: cfg.feeEnabled,
      pct: cfg.feeEnabled ? cfg.feePct : 0,
      flatMinXcg: cfg.feeFlatMinXcg,
      maxXcg: cfg.feeMaxXcg,
      amountXcg: feeXcg,
      floored: feeFloored,
      capped: feeCapped,
    },
    sentoo: {
      enabled: cfg.sentooEnabled,
      pct: cfg.sentooEnabled ? cfg.sentooPct : 0,
      interbankPct: cfg.sentooEnabled ? cfg.sentooInterbankPct : 0,
      capUsd: cfg.sentooCapUsd,
      capXcg: sentooCapXcg,
      amountXcg: sentooXcg,
      capped: sentooCapped,
    },
    totalXcg,
    // All-in XCG paid per 1 USDC — display/telemetry only.
    effectiveRate: round4(totalXcg / usdcAmount),
  };
}

module.exports = { quoteUsdcPurchase, loadFxConfig, DEFAULTS };
