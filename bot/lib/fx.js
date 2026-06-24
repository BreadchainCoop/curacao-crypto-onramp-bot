// FX / rate calculation for the on-ramp.
//
// Pure functions: given a USDC amount the user wants to buy, compute the XCG
// (Caribbean guilder) they must pay, broken down into subtotal, FX spread, and
// an optional platform fee. The full breakdown is returned so the bot can show
// the spread and the fee as SEPARATE line items before the user confirms.
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
  spreadPct: 1.5, // FX margin baked into the rate, percent.
  feeEnabled: true, // platform "fee switch" — captures a fee into the exchange.
  feePct: 1.0, // platform fee, percent of order value (USDC notional).
  feeFlatMinXcg: 0.5, // minimum fee in XCG, so tiny orders still cover costs.
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
  if (cfg.feeEnabled) {
    const feeFromPct = subtotalXcg * (cfg.feePct / 100);
    feeXcg = round2(Math.max(feeFromPct, cfg.feeFlatMinXcg));
  }

  const totalXcg = round2(subtotalXcg + spreadXcg + feeXcg);

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
      amountXcg: feeXcg,
    },
    totalXcg,
    // All-in XCG paid per 1 USDC — display/telemetry only.
    effectiveRate: round4(totalXcg / usdcAmount),
  };
}

module.exports = { quoteUsdcPurchase, loadFxConfig, DEFAULTS };
