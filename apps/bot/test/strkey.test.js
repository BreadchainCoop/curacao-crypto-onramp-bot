'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isValidEd25519PublicKey } = require('../lib/strkey');

// Real mainnet/testnet account addresses (G…) with valid checksums.
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const OWNER = 'GBSU6Q7LPCCLENKZZYNVM5C6A55MECOPBHUE6IGPC5WWLTJOJPM2M5GX';

test('accepts valid Stellar ed25519 public keys (G…)', () => {
  assert.equal(isValidEd25519PublicKey(ISSUER), true);
  assert.equal(isValidEd25519PublicKey(OWNER), true);
});

test('rejects malformed, miscased, and non-account strings', () => {
  assert.equal(isValidEd25519PublicKey(ISSUER.toLowerCase()), false); // StrKey is uppercase
  assert.equal(isValidEd25519PublicKey(ISSUER.slice(0, -1)), false); // too short
  assert.equal(isValidEd25519PublicKey('0x' + 'a'.repeat(40)), false); // EVM address
  assert.equal(
    isValidEd25519PublicKey('CCA2WYNWADCEH5ZZ36D7II5OCVZL3HTMIKDTOC74HEVHHJZONNT2AXR5'),
    false // a contract (C…) is not an account (G…)
  );
  assert.equal(isValidEd25519PublicKey(''), false);
  assert.equal(isValidEd25519PublicKey(null), false);
});

test('rejects a G-address with a corrupted checksum', () => {
  // Flip the last character — breaks the CRC16 but keeps the shape.
  const last = ISSUER.at(-1) === 'A' ? 'B' : 'A';
  const corrupted = ISSUER.slice(0, -1) + last;
  assert.equal(isValidEd25519PublicKey(corrupted), false);
});
