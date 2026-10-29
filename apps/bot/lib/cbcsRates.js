// Official Exchange Rates for Use by the Commercial Banks — published by the
// CBCS (Centrale Bank van Curaçao en Sint Maarten).
//
// Values transcribed from the CBCS rate sheet. The CBCS site is behind a
// Cloudflare challenge, so these are maintained by hand for now — refresh the
// numbers and `asOf` when CBCS publishes new rates. (A live fetch would need a
// headless browser to clear the challenge; deferred — see issue #9.)
//
// Each entry is XCG (Caribbean guilder) per unit of foreign currency, by column:
//   buyNotes   — bank buys foreign cash from the customer        (lowest)
//   buyCheques — bank buys a foreign cheque/transfer             (mid)
//   sell       — bank SELLS foreign currency TO the customer     (highest)
//
// For this on-ramp the user pays XCG to receive USDC (a USD-denominated asset),
// i.e. the user is BUYING USD — so the bank "Sell" USD rate is the one to apply.
// The central USD/XCG parity is 1.79; the commercial-bank Sell rate sits above it.

const CBCS_RATES = {
  asOf: '2026-06-24', // date this sheet was captured — refresh from CBCS
  source: 'CBCS — Official Exchange Rates for Use by the Commercial Banks',
  parityUsd: 1.79, // central bank USD/XCG peg, for reference
  usd: { buyNotes: 1.77, buyCheques: 1.78, sell: 1.82 },
  // Captured for reference; not used by the on-ramp yet.
  jpyPer10000: { buyNotes: 109.44, buyCheques: 110.3, sell: 112.21 },
  gbp: { buyNotes: 2.27, buyCheques: 2.33, sell: 2.41 },
  eurPer100: { buyNotes: 200.2, buyCheques: 202.02, sell: 206.1 },
};

// The rate a customer pays to acquire 1 USD with XCG (bank's USD Sell rate).
const USD_SELL_RATE = CBCS_RATES.usd.sell; // 1.82

module.exports = { CBCS_RATES, USD_SELL_RATE };
