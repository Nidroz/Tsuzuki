import type { ErrorReporter } from '@core/errors/error-reporter';
import {
  deleteItemAsync,
  getItemAsync,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  type SecureStoreOptions,
} from 'expo-secure-store';
import { z } from 'zod';

/**
 * the stored layout of a secure session value (secure-session.ts): its chunks under
 * `<key>.<generation>.<index>`, the header `<generation>:<count>` under `<key>`, the f-09 chunks
 * that are only deleted, and the secure-store calls the writes, the removals and the sweep share
 */

// secure-store values over 2048 bytes are unreliable (ios keychain warning, android keystore
// limits): a value is split into chunks of at most this many utf-8 bytes
export const MAX_CHUNK_BYTES = 2048;
// a session is a few kilobytes: a longer value is a programming error, not a session
export const MAX_CHUNKS = 32;

// secure-store accepts [\w.-]; the dot is reserved for the chunk suffixes, so a caller key such
// as a.0 cannot collide with a chunk of the key a
const SECURE_STORE_KEY = /^[\w-]+$/;

// a write puts its chunks in the generation the stored header does not point to, so the value
// the header points to stays whole until the new header replaces it
const GENERATIONS = [0, 1] as const;
type Generation = (typeof GENERATIONS)[number];

// the header stored under the key: `<generation>:<count>`, e.g. 1:3
const HEADER = /^([01]):(\d{1,2})$/;
const HEADER_SEPARATOR = ':';

// the source of the errors reported by the secure session storage
export const SECURE_SESSION_REPORT_SOURCE = 'secure-session';

// readable only while the device is unlocked, and never migrated to another device by a backup
export const SECURE_SESSION_OPTIONS: SecureStoreOptions = {
  keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// stored content is untrusted: anything but a generation and a count within 1..MAX_CHUNKS is
// invalid, including the bare count of the f-09 format (that session fails closed: sign in again)
const headerSchema = z
  .string()
  .regex(HEADER)
  .transform((value) => value.split(HEADER_SEPARATOR).map(Number))
  .pipe(z.tuple([z.union([z.literal(0), z.literal(1)]), z.number().int().min(1).max(MAX_CHUNKS)]))
  .transform(([generation, count]) => ({ generation, count }));

export type Header = z.infer<typeof headerSchema>;

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

export const assertValidKey = (key: string): void => {
  if (!SECURE_STORE_KEY.test(key)) {
    throw new TypeError(
      `invalid secure session key "${key}": allowed characters are [A-Za-z0-9._-]`,
    );
  }
};

export const chunkKey = (key: string, generation: Generation, index: number): string =>
  `${key}.${String(generation)}.${String(index)}`;

// the chunk keys of the f-09 format, without generation: never read, only deleted
const legacyChunkKey = (key: string, index: number): string => `${key}.${String(index)}`;

const range = (start: number, end: number): number[] =>
  Array.from({ length: Math.max(end - start, 0) }, (_, offset) => start + offset);

export const formatHeader = (header: Header): string =>
  `${String(header.generation)}${HEADER_SEPARATOR}${String(header.count)}`;

export const otherGeneration = (generation: Generation): Generation => (generation === 0 ? 1 : 0);

/**
 * waits for every call, then rejects with the first failure: a call still running after its
 * caller moved on could land in the middle of the next write on the key
 */
export const settleAll = async (calls: readonly Promise<void>[]): Promise<void> => {
  const results = await Promise.allSettled(calls);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
};

export const readStoredHeader = async (
  key: string,
): Promise<{ raw: string | null; header: Header | undefined }> => {
  const raw = await getItemAsync(key, SECURE_SESSION_OPTIONS);
  const parsed = headerSchema.safeParse(raw);
  return { raw, header: parsed.success ? parsed.data : undefined };
};

export const readValue = async (key: string): Promise<string | null> => {
  const { header } = await readStoredHeader(key);
  if (header === undefined) return null;
  const chunks = await Promise.all(
    range(0, header.count).map((index) =>
      getItemAsync(chunkKey(key, header.generation, index), SECURE_SESSION_OPTIONS),
    ),
  );
  if (chunks.some((chunk) => chunk === null)) return null;
  return chunks.join('');
};

const generationKeys = (key: string, generation: Generation, start: number): string[] =>
  range(start, MAX_CHUNKS).map((index) => chunkKey(key, generation, index));

// the chunks of the value a valid header pointed to: after a write lands, the only stale chunks a
// clean key holds (the other generation was emptied by the write that made it stale)
export const previousChunkKeys = (key: string, previous: Header): string[] =>
  range(0, previous.count).map((index) => chunkKey(key, previous.generation, index));

// every chunk key outside the current value (all of them without one): the other generation, the
// current generation past its count and, when asked, the f-09 chunks
export const allStaleChunkKeys = (
  key: string,
  current: Header | undefined,
  legacy: boolean,
): string[] => [
  ...(current
    ? [
        ...generationKeys(key, otherGeneration(current.generation), 0),
        ...generationKeys(key, current.generation, current.count),
      ]
    : GENERATIONS.flatMap((generation) => generationKeys(key, generation, 0))),
  ...(legacy ? range(0, MAX_CHUNKS).map((index) => legacyChunkKey(key, index)) : []),
];

// resolves whether the call succeeded: a failure is reported, never thrown
export const succeeded = async (
  call: () => Promise<unknown>,
  reporter: ErrorReporter,
): Promise<boolean> => {
  try {
    await call();
    return true;
  } catch (error) {
    reporter.captureError(error, { source: SECURE_SESSION_REPORT_SOURCE });
    return false;
  }
};

export const deleteAll = (keys: readonly string[]): Promise<void> =>
  settleAll(keys.map((chunk) => deleteItemAsync(chunk, SECURE_SESSION_OPTIONS)));

// deletes chunks no header points to; the value is already whole (or removed), so a failure is
// reported, not thrown: the next write or removal sweeps every chunk key
export const deleteStaleChunks = (
  keys: readonly string[],
  reporter: ErrorReporter,
): Promise<boolean> => succeeded(() => deleteAll(keys), reporter);
