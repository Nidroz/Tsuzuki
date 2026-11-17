import type { ErrorReporter } from '@core/errors/error-reporter';
import type { SessionStorage } from '@core/repositories/session-storage';
import { deleteItemAsync, setItemAsync } from 'expo-secure-store';

import {
  allStaleChunkKeys,
  assertValidKey,
  chunkKey,
  deleteStaleChunks,
  formatHeader,
  type Header,
  MAX_CHUNKS,
  otherGeneration,
  previousChunkKeys,
  readStoredHeader,
  readValue,
  SECURE_SESSION_OPTIONS as OPTIONS,
  settleAll,
  splitIntoChunks,
  succeeded,
} from './secure-session-chunks';
import {
  deleteMarker,
  discardFailedError,
  discardStoredKey,
  setMarker,
  sweepMarkedKey,
} from './secure-session-sweep';

// the stored layout (chunks and header) lives in secure-session-chunks.ts, the cleanup marker, the
// sweep of a key's first access and the discard of a first launch in secure-session-sweep.ts
export { MAX_CHUNK_BYTES, MAX_CHUNKS, splitIntoChunks } from './secure-session-chunks';

const ignore = (): void => undefined;

/**
 * writes the value and resolves whether its cleanup succeeded. a clean key only deletes the chunks
 * of the previous value; a sweep (asked by the caller, or forced by a missing or invalid header)
 * deletes every chunk key outside the new value
 */
const writeValue = async (
  key: string,
  value: string,
  reporter: ErrorReporter,
  sweep: boolean,
): Promise<boolean> => {
  const chunks = splitIntoChunks(value);
  if (chunks.length > MAX_CHUNKS) {
    throw new RangeError(
      `secure session value for "${key}" needs ${String(chunks.length)} chunks, over ${String(MAX_CHUNKS)}`,
    );
  }
  const previous = await readStoredHeader(key);
  // before the first chunk: a write that cannot set it fails with nothing written
  await setMarker(key);
  // the chunks the stored header points to are never touched before the new header lands
  const generation = previous.header ? otherGeneration(previous.header.generation) : 0;
  await settleAll(
    chunks.map((chunk, index) => setItemAsync(chunkKey(key, generation, index), chunk, OPTIONS)),
  );
  const header: Header = { generation, count: chunks.length };
  // one secure-store write switches from the whole old value to the whole new value
  await setItemAsync(key, formatHeader(header), OPTIONS);
  if (previous.header && !sweep) {
    return deleteStaleChunks(previousChunkKeys(key, previous.header), reporter);
  }
  // a stored header that is not valid may be an f-09 count: its chunks go too
  const legacy = previous.raw !== null && previous.header === undefined;
  return deleteStaleChunks(allStaleChunkKeys(key, header, legacy), reporter);
};

const removeValue = async (key: string, reporter: ErrorReporter): Promise<boolean> => {
  // a removal that cannot set the marker still goes on (reported): a session left on the device is
  // worse than chunks left until the next write or removal
  await succeeded(() => setMarker(key), reporter);
  // the header goes first: reads fail closed even if a chunk deletion fails
  await deleteItemAsync(key, OPTIONS);
  return deleteStaleChunks(allStaleChunkKeys(key, undefined, true), reporter);
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

export interface SecureSessionOptions {
  /**
   * removes what each key holds on its first access in this process, inside its queue, before the
   * access runs: a first launch (the ios keychain outlives an uninstall) never reads a session, a
   * pkce verifier or a flow index stored before it. false by default
   */
  readonly discardStored?: boolean;
}

// a read whose key could not be discarded: nothing stored before this process is read
const readClosed = (): null => null;

// a write or a removal whose key could not be discarded: it does nothing and rejects
const rejectClosed = (): never => {
  throw discardFailedError();
};

/**
 * the auth session storage over expo-secure-store. a write stores the chunks under
 * `<key>.<generation>.<index>` in the generation the stored header does not point to, then the
 * header `<generation>:<count>` under `<key>`, last, then deletes the chunks of the previous value:
 * a read returns the whole old value or the whole new value, never a mix, and fails closed (null)
 * while the header is missing or invalid or a chunk is missing. every chunk key is swept only when
 * the stored header is missing or invalid, on removal, on the first write after a failed write or
 * cleanup on the key, and on the key's first access in a process while its cleanup marker is set.
 * a failed chunk deletion is reported, never thrown. calls are queued per key. values are never
 * logged.
 *
 * with discardStored, the first access of each key in the process first removes whatever it holds
 * (secure-session-sweep.ts, discardStoredKey; a key holding nothing costs a marker and a header
 * read), in place of the marker check. a discard that fails is reported with a fixed error, and
 * that access fails closed (a read resolves null, a write or a removal rejects with that error,
 * changing nothing); the next access on the key tries again. once discarded, the key works as
 * usual for the rest of the process. a key never accessed in this process is not discarded
 */
export const createSecureSessionStorage = (
  reporter: ErrorReporter,
  { discardStored = false }: SecureSessionOptions = {},
): SessionStorage => {
  const enqueue = createKeyQueue();
  // keys that may hold leftover chunks: a call or a sweep on them failed since their last sweep
  const dirtyKeys = new Set<string>();
  // keys whose first access check this process queued: one check per key per process
  const checkedKeys = new Set<string>();
  // the check of a key's first access, inside its queue: resolves whether the key is clean, and
  // never rejects (its failures are reported)
  const checkFirstAccess = (key: string): Promise<boolean> => sweepMarkedKey(key, reporter);
  // discardStored: the keys this process emptied, and those whose discard failed (the next one
  // sweeps every chunk key again)
  const discardedKeys = new Set<string>();
  const failedDiscards = new Set<string>();
  // queues the task behind the discard of the key, until one succeeds; closed answers the access
  // while it fails
  const runDiscarded = <T>(key: string, task: () => Promise<T>, closed: () => T): Promise<T> =>
    enqueue(key, async () => {
      if (!discardedKeys.has(key)) {
        if (!(await discardStoredKey(key, failedDiscards.has(key), reporter))) {
          failedDiscards.add(key);
          return closed();
        }
        discardedKeys.add(key);
        failedDiscards.delete(key);
      }
      return task();
    });
  // queues the task, behind the check on the key's first access in the process
  const run = <T>(key: string, task: () => Promise<T>, closed: () => T): Promise<T> => {
    assertValidKey(key);
    if (discardStored) return runDiscarded(key, task, closed);
    if (!checkedKeys.has(key)) {
      checkedKeys.add(key);
      void enqueue(key, async () => {
        if (!(await checkFirstAccess(key))) dirtyKeys.add(key);
      });
    }
    return enqueue(key, task);
  };
  // runs a write or a removal: the key stays dirty and marked unless the call and its cleanup
  // succeed
  const tracked = async (
    key: string,
    call: (sweep: boolean) => Promise<boolean>,
  ): Promise<void> => {
    const sweep = dirtyKeys.has(key);
    dirtyKeys.add(key);
    if (!(await call(sweep))) return;
    dirtyKeys.delete(key);
    // a marker left behind only costs one more sweep at the next launch
    await succeeded(() => deleteMarker(key), reporter);
  };
  return {
    getItem: async (key) => run(key, () => readValue(key), readClosed),
    setItem: async (key, value) =>
      run(
        key,
        () => tracked(key, (sweep) => writeValue(key, value, reporter, sweep)),
        rejectClosed,
      ),
    removeItem: async (key) =>
      run(key, () => tracked(key, () => removeValue(key, reporter)), rejectClosed),
  };
};
