/* eslint-disable no-bitwise -- RFC 4122 sets specific bits of the random bytes */

/** Anything that fills a byte array with random values (crypto.getRandomValues). */
export type RandomBytes = (bytes: Uint8Array) => Uint8Array;

/**
 * UUID v4, generated on the phone when the report draft is created. The id is
 * the idempotency key for everything downstream (local row, Storage paths,
 * Firestore document), so it must be unique without asking the server.
 */
export function uuidV4(getRandomValues: RandomBytes): string {
  const b = getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40; // version 4
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
