import type { SessionStorage } from '@core/repositories/session-storage';
import {
  deleteItemAsync,
  getItemAsync,
  setItemAsync,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  type SecureStoreOptions,
} from 'expo-secure-store';
import { z } from 'zod';

// secure-store values over 2048 bytes are unreliable (ios keychain warning, android keystore
// limits): a value is split into chunks of at most this many utf-8 bytes
export const MAX_CHUNK_BYTES = 2048;
// a session is a few kilobytes: a longer value is a programming error, not a session
export const MAX_CHUNKS = 32;

// secure-store accepts [\w.-]; the dot is reserved for the chunk suffix, so a caller key such as
// a.0 cannot collide with chunk 0 of the key a
const SECURE_STORE_KEY = /^[\w-]+$/;
const DECIMAL_INTEGER = /^\d+$/;

// readable only while the device is unlocked, and never migrated to another device by a backup
const OPTIONS: SecureStoreOptions = { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY };

// stored content is untrusted: a count that is not an integer within 1..MAX_CHUNKS is invalid
const chunkCountSchema = z
  .string()
  .regex(DECIMAL_INTEGER)
  .transform(Number)
  .pipe(z.number().int().min(1).max(MAX_CHUNKS));

const encoder = new TextEncoder();

// utf-8 length of one code point; a lone surrogate is encoded as U+FFFD, as secure-store stores it
const utf8Length = (character: string): number => encoder.encode(character).length;

/** splits by code point (a surrogate pair is never cut) into chunks of at most MAX_CHUNK_BYTES */
export const splitIntoChunks = (value: string): string[] => {
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  // the string iterator yields whole code points
  for (const character of value) {
    const bytes = utf8Length(character);
    if (currentBytes + bytes > MAX_CHUNK_BYTES) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += character;
    currentBytes += bytes;
  }
  // an empty value is stored as one empty chunk
  chunks.push(current);
  return chunks;
};

const assertValidKey = (key: string): void => {
  if (!SECURE_STORE_KEY.test(key)) {
    throw new TypeError(
      `invalid secure session key "${key}": allowed characters are [A-Za-z0-9._-]`,
    );
  }
};

const chunkKey = (key: string, index: number): string => `${key}.${String(index)}`;

const range = (start: number, end: number): number[] =>
  Array.from({ length: Math.max(end - start, 0) }, (_, offset) => start + offset);

const readChunkCount = async (key: string): Promise<number | undefined> => {
  const parsed = chunkCountSchema.safeParse(await getItemAsync(key, OPTIONS));
  return parsed.success ? parsed.data : undefined;
};

// deletes the chunks from index start; without a valid count, every possible index is cleared
const deleteChunksFrom = async (key: string, start: number, count: number | undefined) => {
  await Promise.all(
    range(start, count ?? MAX_CHUNKS).map((index) =>
      deleteItemAsync(chunkKey(key, index), OPTIONS),
    ),
  );
};

/**
 * the auth session storage over expo-secure-store. each value is stored as chunks under
 * `<key>.<index>`, then their count under `<key>`, written last: a read fails closed (null) while
 * the count is missing or invalid, or when a chunk is missing. values are never logged
 */
export const createSecureSessionStorage = (): SessionStorage => ({
  getItem: async (key) => {
    assertValidKey(key);
    const count = await readChunkCount(key);
    if (count === undefined) return null;
    const chunks = await Promise.all(
      range(0, count).map((index) => getItemAsync(chunkKey(key, index), OPTIONS)),
    );
    if (chunks.some((chunk) => chunk === null)) return null;
    return chunks.join('');
  },
  setItem: async (key, value) => {
    assertValidKey(key);
    const chunks = splitIntoChunks(value);
    if (chunks.length > MAX_CHUNKS) {
      throw new RangeError(
        `secure session value for "${key}" needs ${String(chunks.length)} chunks, over ${String(MAX_CHUNKS)}`,
      );
    }
    const previousCount = await readChunkCount(key);
    await Promise.all(
      chunks.map((chunk, index) => setItemAsync(chunkKey(key, index), chunk, OPTIONS)),
    );
    await setItemAsync(key, String(chunks.length), OPTIONS);
    // chunks of a previous longer value
    await deleteChunksFrom(key, chunks.length, previousCount);
  },
  removeItem: async (key) => {
    assertValidKey(key);
    const count = await readChunkCount(key);
    // the count goes first: reads fail closed even if a chunk deletion fails
    await deleteItemAsync(key, OPTIONS);
    await deleteChunksFrom(key, 0, count);
  },
});
