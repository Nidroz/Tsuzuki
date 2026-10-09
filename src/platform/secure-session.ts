import type { ErrorReporter } from '@core/errors/error-reporter';
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

// the source of the errors reported by this module
const REPORT_SOURCE = 'secure-session';

// readable only while the device is unlocked, and never migrated to another device by a backup
const OPTIONS: SecureStoreOptions = { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY };

// stored content is untrusted: anything but a generation and a count within 1..MAX_CHUNKS is
// invalid, including the bare count of the f-09 format (that session fails closed: sign in again)
const headerSchema = z
  .string()
  .regex(HEADER)
  .transform((value) => value.split(HEADER_SEPARATOR).map(Number))
  .pipe(z.tuple([z.union([z.literal(0), z.literal(1)]), z.number().int().min(1).max(MAX_CHUNKS)]))
  .transform(([generation, count]) => ({ generation, count }));

type Header = z.infer<typeof headerSchema>;

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

const chunkKey = (key: string, generation: Generation, index: number): string =>
  `${key}.${String(generation)}.${String(index)}`;

// the chunk keys of the f-09 format, without generation: never read, only deleted
const legacyChunkKey = (key: string, index: number): string => `${key}.${String(index)}`;

const range = (start: number, end: number): number[] =>
  Array.from({ length: Math.max(end - start, 0) }, (_, offset) => start + offset);

const formatHeader = (header: Header): string =>
  `${String(header.generation)}${HEADER_SEPARATOR}${String(header.count)}`;

const otherGeneration = (generation: Generation): Generation => (generation === 0 ? 1 : 0);

const ignore = (): void => undefined;

/**
 * waits for every call, then rejects with the first failure: a call still running after its
 * caller moved on could land in the middle of the next write on the key
 */
const settleAll = async (calls: readonly Promise<void>[]): Promise<void> => {
  const results = await Promise.allSettled(calls);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
};

const readStoredHeader = async (
  key: string,
): Promise<{ raw: string | null; header: Header | undefined }> => {
  const raw = await getItemAsync(key, OPTIONS);
  const parsed = headerSchema.safeParse(raw);
  return { raw, header: parsed.success ? parsed.data : undefined };
};

const readValue = async (key: string): Promise<string | null> => {
  const { header } = await readStoredHeader(key);
  if (header === undefined) return null;
  const chunks = await Promise.all(
    range(0, header.count).map((index) =>
      getItemAsync(chunkKey(key, header.generation, index), OPTIONS),
    ),
  );
  if (chunks.some((chunk) => chunk === null)) return null;
  return chunks.join('');
};

const generationKeys = (key: string, generation: Generation, start: number): string[] =>
  range(start, MAX_CHUNKS).map((index) => chunkKey(key, generation, index));

// every chunk key outside the current value (all of them without one): the other generation, the
// current generation past its count and, when asked, the f-09 chunks
const staleChunkKeys = (key: string, current: Header | undefined, legacy: boolean): string[] => [
  ...(current
    ? [
        ...generationKeys(key, otherGeneration(current.generation), 0),
        ...generationKeys(key, current.generation, current.count),
      ]
    : GENERATIONS.flatMap((generation) => generationKeys(key, generation, 0))),
  ...(legacy ? range(0, MAX_CHUNKS).map((index) => legacyChunkKey(key, index)) : []),
];

/**
 * deletes chunks no header points to. the value is already whole (or already removed), so a
 * failure is reported, not thrown: the next write or removal deletes them again
 */
const deleteStaleChunks = async (
  keys: readonly string[],
  reporter: ErrorReporter,
): Promise<void> => {
  try {
    await settleAll(keys.map((chunk) => deleteItemAsync(chunk, OPTIONS)));
  } catch (error) {
    reporter.captureError(error, { source: REPORT_SOURCE });
  }
};

const writeValue = async (key: string, value: string, reporter: ErrorReporter): Promise<void> => {
  const chunks = splitIntoChunks(value);
  if (chunks.length > MAX_CHUNKS) {
    throw new RangeError(
      `secure session value for "${key}" needs ${String(chunks.length)} chunks, over ${String(MAX_CHUNKS)}`,
    );
  }
  const previous = await readStoredHeader(key);
  // the chunks the stored header points to are never touched before the new header lands
  const generation = previous.header ? otherGeneration(previous.header.generation) : 0;
  await settleAll(
    chunks.map((chunk, index) => setItemAsync(chunkKey(key, generation, index), chunk, OPTIONS)),
  );
  const header: Header = { generation, count: chunks.length };
  // one secure-store write switches from the whole old value to the whole new value
  await setItemAsync(key, formatHeader(header), OPTIONS);
  // a stored header that is not valid may be an f-09 count: its chunks go too
  const legacy = previous.raw !== null && previous.header === undefined;
  await deleteStaleChunks(staleChunkKeys(key, header, legacy), reporter);
};

const removeValue = async (key: string, reporter: ErrorReporter): Promise<void> => {
  // the header goes first: reads fail closed even if a chunk deletion fails
  await deleteItemAsync(key, OPTIONS);
  await deleteStaleChunks(staleChunkKeys(key, undefined, true), reporter);
};

/**
 * runs the calls on one key one after another, calls on other keys independently: an overwrite
 * spans several writes, and a read in between could see mixed chunks, find the session invalid and
 * remove it (silent sign-out). a failed call still rejects for its caller and never blocks the next
 */
const createKeyQueue = () => {
  // the settled end of each key's queue; removed once the queue drains
  const tails = new Map<string, Promise<void>>();
  return <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const result = (tails.get(key) ?? Promise.resolve()).then(task);
    const tail = result.then(ignore, ignore);
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  };
};

/**
 * the auth session storage over expo-secure-store. a write stores the chunks under
 * `<key>.<generation>.<index>` in the generation the stored header does not point to, then the
 * header `<generation>:<count>` under `<key>`, last, then deletes the other chunks: a read returns
 * the whole old value or the whole new value, never a mix, and fails closed (null) while the
 * header is missing or invalid or a chunk is missing. a failed chunk deletion is reported to the
 * reporter, never thrown. calls are queued per key. values are never logged
 */
export const createSecureSessionStorage = (reporter: ErrorReporter): SessionStorage => {
  const enqueue = createKeyQueue();
  return {
    getItem: async (key) => {
      assertValidKey(key);
      return enqueue(key, () => readValue(key));
    },
    setItem: async (key, value) => {
      assertValidKey(key);
      return enqueue(key, () => writeValue(key, value, reporter));
    },
    removeItem: async (key) => {
      assertValidKey(key);
      return enqueue(key, () => removeValue(key, reporter));
    },
  };
};
