const test = require('node:test');
const assert = require('node:assert/strict');
const { quoteUsdcPurchase, loadFxConfig, DEFAULTS } = require('../lib/fx');

test('quotes the subtotal at the peg rate', () => {
  const q = quoteUsdcPurchase(100, { pegRate: 1.79, spreadPct: 0, feeEnabled: false });
  assert.equal(q.subtotalXcg, 179);
  assert.equal(q.totalXcg, 179);
  assert.equal(q.currency, 'XCG');
});

test('applies the FX spread on top of the subtotal', () => {
  const q = quoteUsdcPurchase(100, { pegRate: 1, spreadPct: 1.5, feeEnabled: false });
  assert.equal(q.subtotalXcg, 100);
  assert.equal(q.spread.amountXcg, 1.5);
  assert.equal(q.totalXcg, 101.5);
});

test('fee switch OFF adds no fee', () => {
  const q = quoteUsdcPurchase(100, {
    pegRate: 1, spreadPct: 0, feeEnabled: false, feePct: 1, feeFlatMinXcg: 0.5,
  });
  assert.equal(q.fee.enabled, false);
  assert.equal(q.fee.amountXcg, 0);
  assert.equal(q.totalXcg, 100);
});

test('percentage fee applies when it exceeds the flat minimum', () => {
  const q = quoteUsdcPurchase(100, {
    pegRate: 1, spreadPct: 0, feeEnabled: true, feePct: 1, feeFlatMinXcg: 0.5,
  });
  // 1% of 100 = 1.00 > 0.50 floor
  assert.equal(q.fee.amountXcg, 1);
  assert.equal(q.totalXcg, 101);
});

test('flat minimum fee applies to small orders', () => {
  const q = quoteUsdcPurchase(10, {
    pegRate: 1, spreadPct: 0, feeEnabled: true, feePct: 1, feeFlatMinXcg: 0.5,
  });
  // 1% of 10 = 0.10 < 0.50 floor -> charge the 0.50 floor
  assert.equal(q.fee.amountXcg, 0.5);
  assert.equal(q.totalXcg, 10.5);
});

test('spread and fee are reported as separate line items that sum to the total', () => {
  const q = quoteUsdcPurchase(100, {
    pegRate: 1, spreadPct: 1.5, feeEnabled: true, feePct: 1, feeFlatMinXcg: 0.5,
  });
  assert.equal(q.subtotalXcg, 100);
  assert.equal(q.spread.amountXcg, 1.5);
  assert.equal(q.fee.amountXcg, 1);
  assert.equal(q.totalXcg, 102.5);
  // The displayed line items must add up exactly to what the user pays.
  assert.equal(q.subtotalXcg + q.spread.amountXcg + q.fee.amountXcg, q.totalXcg);
});

test('defaults to the CBCS commercial-bank USD sell rate (1.82)', () => {
  const q = quoteUsdcPurchase(100, { spreadPct: 0, feeEnabled: false });
  assert.equal(q.pegRate, 1.82);
  assert.equal(q.subtotalXcg, 182);
});

test('rejects non-positive or non-numeric amounts', () => {
  assert.throws(() => quoteUsdcPurchase(0), RangeError);
  assert.throws(() => quoteUsdcPurchase(-5), RangeError);
  assert.throws(() => quoteUsdcPurchase('100'), RangeError);
  assert.throws(() => quoteUsdcPurchase(Number.NaN), RangeError);
});

test('rejects invalid config', () => {
  assert.throws(() => quoteUsdcPurchase(100, { pegRate: 0 }), RangeError);
  assert.throws(() => quoteUsdcPurchase(100, { spreadPct: -1 }), RangeError);
  assert.throws(() => quoteUsdcPurchase(100, { feePct: -1 }), RangeError);
});

test('loadFxConfig reads from env with per-field fallbacks', () => {
  const cfg = loadFxConfig({ FX_PEG_RATE: '1.79', FX_FEE_ENABLED: 'false' });
  assert.equal(cfg.pegRate, 1.79);
  assert.equal(cfg.feeEnabled, false);
  assert.equal(cfg.spreadPct, DEFAULTS.spreadPct); // falls back to default
});

test('loadFxConfig parses the fee switch as a boolean', () => {
  assert.equal(loadFxConfig({ FX_FEE_ENABLED: 'off' }).feeEnabled, false);
  assert.equal(loadFxConfig({ FX_FEE_ENABLED: '0' }).feeEnabled, false);
  assert.equal(loadFxConfig({ FX_FEE_ENABLED: 'no' }).feeEnabled, false);
  assert.equal(loadFxConfig({ FX_FEE_ENABLED: 'true' }).feeEnabled, true);
  assert.equal(loadFxConfig({}).feeEnabled, DEFAULTS.feeEnabled);
});
