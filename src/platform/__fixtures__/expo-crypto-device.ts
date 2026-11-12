import { jest } from '@jest/globals';
import type * as ExpoCrypto from 'expo-crypto';

/**
 * a fake expo-crypto for the web crypto tests: a deterministic byte source in place of the native
 * random source, and node's sha-256 in place of the native digest. the tests mock expo-crypto with
 * the module below, from a jest.mock factory:
 * `jest.mock('expo-crypto', () =>
 *   jest.requireActual<typeof Device>('./__fixtures__/expo-crypto-device').fakeExpoCryptoModule())`
 * node's hash is read through jest, so it stays when a test removes globalThis.crypto to stand for
 * hermes. its state is per module registry: a jest.isolateModules callback gets its own
 */

interface NodeHash {
  update: (data: Uint8Array) => NodeHash;
  digest: () => Uint8Array;
}
const { createHash } = jest.requireActual<{ createHash: (algorithm: string) => NodeHash }>(
  'node:crypto',
);
const actual = jest.requireActual<typeof ExpoCrypto>('expo-crypto');

// the first byte after a reset, never 0: a filled array differs from a new one
const FIRST_BYTE = 1;
const BYTE_VALUES = 256;

let nextByte = FIRST_BYTE;
// the native calls in order: random:<byte count>, digest:<algorithm>:<byte count>
const calls: string[] = [];

export const expoCrypto = { calls };

/** a fresh source (from byte 1 again) and no recorded call. */
export const resetExpoCrypto = (): void => {
  nextByte = FIRST_BYTE;
  calls.length = 0;
};

/** the bytes the source hands out next, without drawing them: each one more than the last. */
export const nextRandomBytes = (count: number): Uint8Array =>
  Uint8Array.from({ length: count }, (_, index) => (nextByte + index) % BYTE_VALUES);

/** the lowercase hex of a digest. */
export const hexOf = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

const bytesOf = (data: BufferSource): Uint8Array =>
  ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);

// fills the memory of the array in place and returns it, as the native module does
const getRandomValues: typeof ExpoCrypto.getRandomValues = (typedArray) => {
  const bytes = new Uint8Array(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
  calls.push(`random:${String(bytes.length)}`);
  bytes.set(nextRandomBytes(bytes.length));
  nextByte = (nextByte + bytes.length) % BYTE_VALUES;
  return typedArray;
};

// resolves an ArrayBuffer, as expo-crypto does; any algorithm but sha-256 fails the test loudly
const digest: typeof ExpoCrypto.digest = (algorithm, data) => {
  const bytes = bytesOf(data);
  calls.push(`digest:${algorithm}:${String(bytes.length)}`);
  if (algorithm !== actual.CryptoDigestAlgorithm.SHA256) {
    return Promise.reject(new Error(`the fake digest has sha-256 only, not ${algorithm}`));
  }
  return Promise.resolve(Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer);
};

/** expo-crypto with the fake random source and digest, its other exports kept. */
export const fakeExpoCryptoModule = () => ({ ...actual, getRandomValues, digest });
