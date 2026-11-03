/* eslint-disable no-bitwise -- base64 encoding is bit manipulation by definition */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Hex digest -> base64. Firebase Storage reports md5Hash as base64 while the
 * file-system library gives hex, so we convert to compare them. Hand-rolled
 * because Hermes has no Buffer.
 */
export function hexToBase64(hex: string): string {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error('Invalid hex string');
  }
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const n = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out += ALPHABET[(n >> 18) & 63];
    out += ALPHABET[(n >> 12) & 63];
    out += b1 === undefined ? '=' : ALPHABET[(n >> 6) & 63];
    out += b2 === undefined ? '=' : ALPHABET[n & 63];
  }
  return out;
}
