'use strict';

// Minimal StrKey validator for Stellar ed25519 public keys (G…), implemented
// with NO external dependency so the bot stays lean (the Base bot pulls in
// nothing new). Follows SEP-23 / StrKey: the address is base32 (RFC 4648, no
// padding) of [version byte][32-byte ed25519 key][CRC16-XModem checksum, 2
// bytes little-endian]. We only need to VALIDATE a user-pasted payout address,
// not encode — so this is read-only and self-contained.

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
// Version byte for an ed25519 public key: 6 << 3 = 48, which base32-encodes to 'G'.
const VERSION_ED25519_PUBLIC_KEY = 6 << 3;

/** Decode an RFC 4648 base32 string (no padding) to a byte array, or null. */
function base32Decode(str) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of str) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) return null; // invalid character
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** CRC16-XModem (poly 0x1021, init 0x0000) over the given bytes. */
function crc16xmodem(bytes) {
  let crc = 0x0000;
  for (const b of bytes) {
    crc ^= (b & 0xff) << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/**
 * True if `address` is a valid Stellar ed25519 public key (G…): correct length,
 * version byte, and CRC16 checksum. Mixed-case/lowercase is rejected (StrKey is
 * uppercase base32), which also catches typos a naive "starts with G" check
 * would wave through.
 */
function isValidEd25519PublicKey(address) {
  if (typeof address !== 'string' || address.length !== 56 || address[0] !== 'G') {
    return false;
  }
  const data = base32Decode(address);
  // 1 version byte + 32-byte key + 2-byte checksum = 35 bytes.
  if (!data || data.length !== 35) return false;
  if (data[0] !== VERSION_ED25519_PUBLIC_KEY) return false;
  const payload = data.subarray(0, 33); // version + key
  const checksum = data[33] | (data[34] << 8); // stored little-endian
  return crc16xmodem(payload) === checksum;
}

module.exports = { isValidEd25519PublicKey };
