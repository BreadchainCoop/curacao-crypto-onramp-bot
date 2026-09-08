const test = require('node:test');
const assert = require('node:assert/strict');
const { quoteUsdcPurchase, loadFxConfig, DEFAULTS } = require('../lib/fx');

test('quotes the subtotal at the peg rate', () => {
  const q = quoteUsdcPurchase(100, { pegRate: 1.79, spreadPct: 0, feeEnabled: false, sentooEnabled: false });
  assert.equal(q.subtotalXcg, 179);
  assert.equal(q.totalXcg, 179);
  assert.equal(q.currency, 'XCG');
});

test('applies the FX spread on top of the subtotal', () => {
  const q = quoteUsdcPurchase(100, { pegRate: 1, spreadPct: 1.5, feeEnabled: false, sentooEnabled: false });
  assert.equal(q.subtotalXcg, 100);
  assert.equal(q.spread.amountXcg, 1.5);
  assert.equal(q.totalXcg, 101.5);
});

test('fee switch OFF adds no fee', () => {
  const q = quoteUsdcPurchase(100, {
    pegRate: 1, spreadPct: 0, feeEnabled: false, feePct: 1, feeFlatMinXcg: 0.5, sentooEnabled: false,
  });
  assert.equal(q.fee.enabled, false);
  assert.equal(q.fee.amountXcg, 0);
  assert.equal(q.totalXcg, 100);
});

test('percentage fee applies when it exceeds the flat minimum', () => {
  const q = quoteUsdcPurchase(100, {
    pegRate: 1, spreadPct: 0, feeEnabled: true, feePct: 1, feeFlatMinXcg: 0.5, sentooEnabled: false,
  });
  // 1% of 100 = 1.00 > 0.50 floor
  assert.equal(q.fee.amountXcg, 1);
  assert.equal(q.totalXcg, 101);
});

test('flat minimum fee applies to small orders', () => {
  const q = quoteUsdcPurchase(10, {
    pegRate: 1, spreadPct: 0, feeEnabled: true, feePct: 1, feeFlatMinXcg: 0.5, sentooEnabled: false,
  });
  // 1% of 10 = 0.10 < 0.50 floor -> charge the 0.50 floor
  assert.equal(q.fee.amountXcg, 0.5);
  assert.equal(q.totalXcg, 10.5);
});

test('maximum fee cap applies to large orders', () => {
  const q = quoteUsdcPurchase(10000, {
    pegRate: 1, spreadPct: 0, feeEnabled: true, feePct: 2.5, feeFlatMinXcg: 0.5, feeMaxXcg: 150, sentooEnabled: false,
  });
  // 2.5% of 10000 = 250 > 150 cap -> charge the 150 cap
  assert.equal(q.fee.amountXcg, 150);
  assert.equal(q.fee.capped, true);
  assert.equal(q.fee.floored, false);
  assert.equal(q.totalXcg, 10150);
});

test('spread, fee and Sentoo are reported as separate line items that sum to the total', () => {
  const q = quoteUsdcPurchase(100, {
    pegRate: 1, spreadPct: 1.5, feeEnabled: true, feePct: 1, feeFlatMinXcg: 0.5,
    sentooEnabled: true, sentooPct: 1, sentooCapUsd: 1000,
  });
  assert.equal(q.subtotalXcg, 100);
  assert.equal(q.spread.amountXcg, 1.5);
  assert.equal(q.fee.amountXcg, 1);
  // base = 102.5; Sentoo grossed up = 102.5 * 0.01 / 0.99 = 1.0353 -> 1.04
  assert.equal(q.sentoo.amountXcg, 1.04);
  assert.equal(q.totalXcg, 103.54);
  // The displayed line items must add up exactly to what the user pays.
  assert.equal(
    q.subtotalXcg + q.spread.amountXcg + q.fee.amountXcg + q.sentoo.amountXcg,
    q.totalXcg,
  );
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

// ── Sentoo payment-processor pass-through ──────────────────────────────────

test('Sentoo pass-through is grossed up so the processor cut is fully covered', () => {
  // base = 100 (no spread/fee); Sentoo 1% off the top, high cap so uncapped.
  const q = quoteUsdcPurchase(100, {
    pegRate: 1, spreadPct: 0, feeEnabled: false,
    sentooEnabled: true, sentooPct: 1, sentooCapUsd: 1000,
  });
  // grossed-up pass-through = 100 * 0.01 / 0.99 = 1.0101… -> 1.01
  assert.equal(q.sentoo.amountXcg, 1.01);
  assert.equal(q.sentoo.capped, false);
  assert.equal(q.totalXcg, 101.01);
  // Reconciliation: Sentoo's real 1% cut of the total ≈ what we added.
  assert.ok(Math.abs(q.totalXcg * 0.01 - q.sentoo.amountXcg) < 0.01);
});

test('Sentoo cap binds on large orders (flat USD cap converted at the peg)', () => {
  const q = quoteUsdcPurchase(1000, {
    pegRate: 1, spreadPct: 0, feeEnabled: false,
    sentooEnabled: true, sentooPct: 1, sentooCapUsd: 1.5,
  });
  // uncapped would be 1000 * 0.01 / 0.99 = 10.10 > 1.50 cap -> flat cap.
  assert.equal(q.sentoo.capXcg, 1.5); // 1.5 USD * pegRate 1
  assert.equal(q.sentoo.amountXcg, 1.5);
  assert.equal(q.sentoo.capped, true);
  assert.equal(q.totalXcg, 1001.5);
});

test('Sentoo cap in XCG scales with the peg rate', () => {
  const q = quoteUsdcPurchase(1000, {
    pegRate: 1.82, spreadPct: 0, feeEnabled: false,
    sentooEnabled: true, sentooPct: 1, sentooCapUsd: 1.5,
  });
  assert.equal(q.sentoo.capXcg, 2.73); // 1.5 * 1.82
  assert.equal(q.sentoo.amountXcg, 2.73); // capped
  assert.equal(q.sentoo.capped, true);
});

test('Sentoo disabled adds nothing', () => {
  const q = quoteUsdcPurchase(100, {
    pegRate: 1, spreadPct: 0, feeEnabled: false, sentooEnabled: false,
  });
  assert.equal(q.sentoo.enabled, false);
  assert.equal(q.sentoo.pct, 0);
  assert.equal(q.sentoo.amountXcg, 0);
  assert.equal(q.totalXcg, 100);
});

test('full stack: subtotal + spread + platform fee + Sentoo reconcile', () => {
  // Realistic defaults: peg 1.82, spread 1.5%, fee 2.5%, Sentoo 1% / $1.50 cap.
  const q = quoteUsdcPurchase(100, {
    pegRate: 1.82, spreadPct: 1.5,
    feeEnabled: true, feePct: 2.5, feeFlatMinXcg: 0.5, feeMaxXcg: 150,
    sentooEnabled: true, sentooPct: 1, sentooCapUsd: 1.5,
  });
  assert.equal(q.subtotalXcg, 182);
  assert.equal(q.spread.amountXcg, 2.73); // 182 * 1.5%
  assert.equal(q.fee.amountXcg, 4.55); // 182 * 2.5%
  // base = 189.28; grossed up 189.28*0.01/0.99 = 1.9119 -> 1.91 (< 2.73 cap)
  assert.equal(q.sentoo.amountXcg, 1.91);
  assert.equal(q.sentoo.capped, false);
  assert.equal(q.totalXcg, 191.19);
});

test('rejects invalid Sentoo config', () => {
  assert.throws(() => quoteUsdcPurchase(100, { sentooPct: 100 }), RangeError);
  assert.throws(() => quoteUsdcPurchase(100, { sentooPct: -1 }), RangeError);
  assert.throws(() => quoteUsdcPurchase(100, { sentooCapUsd: -1 }), RangeError);
});

test('loadFxConfig reads Sentoo env with per-field fallbacks', () => {
  const cfg = loadFxConfig({ SENTOO_FEE_PCT: '1.25', SENTOO_FEE_CAP_USD: '2' });
  assert.equal(cfg.sentooPct, 1.25);
  assert.equal(cfg.sentooCapUsd, 2);
  assert.equal(cfg.sentooEnabled, DEFAULTS.sentooEnabled); // fallback
  assert.equal(loadFxConfig({ SENTOO_FEE_ENABLED: 'off' }).sentooEnabled, false);
});
