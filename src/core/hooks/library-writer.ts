// the library writes of the hooks (docs/ARCHITECTURE.md §4 and §6 "Writes"): optimistic entries
// in the query cache, `+1` taps coalesced into one write (BR-09), and every repository call of a
// key serialized, since the LibraryRepository interface does not order concurrent calls.
// entries, keys and notes are personal data: never logged, never put in an error message
import type { QueryClient } from '@tanstack/react-query';

import {
  libraryWriteContextAt,
  type LibraryEntry,
  type LibraryWriteContext,
} from '../domain/library-entry';
import { PROGRESS_WRITE_COALESCE_MS } from '../domain/library-progress';
import type { MediaKey } from '../domain/media';
import { LibraryActionError } from '../errors/library-report-errors';
import { queryKeys, type LibraryScope } from '../query/keys';
import type { LibraryRepository } from '../repositories/library-repository';
import { mediaKeyId, setListEntry, withListEntry } from './library-list-data';
import { createKeyStates, type KeyState, type WriteFailure } from './library-writer-state';

/**
 * a library rule applied to the cached entry of a key (null: not in the library). it returns the
 * next entry, null to remove it, or the same value for a no-op (BR-09: nothing is written). it may
 * throw (an invalid value): the apply rejects and nothing changes.
 */
export type LibraryChange = (
  entry: LibraryEntry | null,
  ctx: LibraryWriteContext,
) => LibraryEntry | null;

export interface LibraryApplyOptions {
  /** debounce the write by PROGRESS_WRITE_COALESCE_MS, restarted by each coalesced apply */
  readonly coalesce?: boolean;
}

export interface LibraryWriter {
  /** the stored entry of a key, after every write of that key, pending coalesced ones included */
  read(key: MediaKey): Promise<LibraryEntry | null>;
  /**
   * every stored entry (repository.list order), where each key with a change not yet confirmed
   * (pending, or being written) shows its optimistic entry instead (null: left out; a new entry:
   * included). seeds the entry query of every other listed key with its stored entry, unless a
   * write settled while listing (the list is then refetched by that write's invalidation)
   */
  list(): Promise<readonly LibraryEntry[]>;
  /**
   * applies a change to the loaded entry of a key: shown at once (optimistic), then written.
   * settles with the write that carries the change: rejects with its error, after which the
   * entry refetches the stored truth. a write of the key that fails first fails every change
   * computed over it and not sent yet with the same error. rejects without writing, with a
   * LibraryActionError `entry-not-loaded`, when the entry is not loaded.
   */
  apply(key: MediaKey, change: LibraryChange, options?: LibraryApplyOptions): Promise<void>;
  /** writes every pending coalesced change now; resolves once every call settled, never rejects */
  flushAll(): Promise<void>;
  /**
   * the number of keys with a change not confirmed yet: pending (in its coalescing window) or
   * being written. a pending read is not counted
   */
  pendingChangeCount(): number;
}

export interface LibraryWriterOptions {
  readonly queryClient: QueryClient;
  readonly repository: LibraryRepository;
  /** the cache scope of every library key this writer reads, sets, cancels or invalidates */
  readonly scope: LibraryScope;
  /** the clock of the writes, `new Date()` by default */
  readonly now?: () => Date;
}

const noop = (): void => undefined;

const systemNow = (): Date => new Date();

/** a library writer and what the writer tests inspect, outside the LibraryWriter interface */
export interface InspectableLibraryWriter {
  readonly writer: LibraryWriter;
  /** the number of keys whose state the writer keeps, 0 once every call settled (idle: pruned) */
  readonly activeKeyCount: () => number;
}

/** createLibraryWriter with its key state count, for the writer tests: the app never uses it */
export const createInspectableLibraryWriter = ({
  queryClient,
  repository,
  scope,
  now = systemNow,
}: LibraryWriterOptions): InspectableLibraryWriter => {
  // the states of the keys in use: an idle one is pruned, a later use starts a fresh one
  const { states, stateOf, release, enqueue } = createKeyStates();
  // every write settled so far, whatever its outcome: a list sees whether one settled meanwhile
  let settledWrites = 0;

  // `failureBefore`: the last failed write of the key when this write started. a write started
  // before a failure settled was computed from the failed write's optimistic entry, so it carries
  // the failed change: it fails with the same error, never sent. the failure handler of startWrite
  // records a failure before the next call of the key runs: it is queued as the write settles,
  // that call only once the queue tail settled after it
  const persist = (
    state: KeyState,
    value: LibraryEntry | null,
    failureBefore: WriteFailure | null,
  ): Promise<LibraryEntry | null> =>
    enqueue(state, async () => {
      const { failure } = state;
      if (failure !== null && failure !== failureBefore) {
        throw failure.error;
      }
      if (value === null) {
        await repository.remove(state.key);
        return null;
      }
      return repository.save(value);
    });

  // takes the pending change of a key into a write, queued now; the applies it carries settle
  // with it. returns the write, which never rejects, or null when nothing was pending
  const startWrite = (state: KeyState): Promise<void> | null => {
    const { pending } = state;
    if (pending === null) {
      return null;
    }
    clearTimeout(state.timer);
    state.timer = undefined;
    state.pending = null;
    const version = state.version;
    const entryKey = queryKeys.library.entry(scope, state.key);
    const listKey = queryKeys.library.all(scope);
    // the write holds its key until it settled, so its version is compared on the same state
    state.writing += 1;
    state.busy += 1;
    const finish = (): void => {
      settledWrites += 1;
      state.writing -= 1;
      release(state);
    };
    return persist(state, pending.value, state.failure).then(
      (stored) => {
        if (state.version === version) {
          queryClient.setQueryData(entryKey, stored);
          setListEntry(queryClient, scope, state.key, stored);
        }
        finish();
        // exact: the list query only, never an entry over a pending optimistic value
        void queryClient.invalidateQueries({ queryKey: listKey, exact: true });
        for (const waiter of pending.waiters) {
          waiter.resolve();
        }
      },
      (error: unknown) => {
        // the newer changes were computed from this write's optimistic entry, so they carry the
        // failed change: the writes already chained fail with it (persist), never sent, and the
        // pending change is dropped and fails with it, never written on its own
        state.failure = { error };
        const dropped = state.pending;
        clearTimeout(state.timer);
        state.timer = undefined;
        state.pending = null;
        finish();
        // the entry refetches the stored truth through read
        void queryClient.invalidateQueries({ queryKey: entryKey, exact: true });
        void queryClient.invalidateQueries({ queryKey: listKey, exact: true });
        for (const waiter of [...pending.waiters, ...(dropped?.waiters ?? [])]) {
          waiter.reject(error);
        }
      },
    );
  };

  const read = (key: MediaKey): Promise<LibraryEntry | null> => {
    const state = stateOf(key);
    void startWrite(state);
    return enqueue(state, () => repository.get(key));
  };

  const list = async (): Promise<readonly LibraryEntry[]> => {
    const settledBefore = settledWrites;
    const stored = await repository.list();
    // the writer state once listed, not before: a change made while listing is shown too
    let shown = stored;
    const unconfirmed = new Set<string>();
    for (const state of states.values()) {
      if (state.pending !== null || state.writing > 0) {
        unconfirmed.add(state.id);
        const optimistic = queryClient.getQueryData<LibraryEntry | null>(
          queryKeys.library.entry(scope, state.key),
        );
        if (optimistic !== undefined) {
          shown = withListEntry(shown, state.key, optimistic);
        }
      }
    }
    // after a write settled meanwhile, `stored` may be older than the cache: no seeding then
    if (settledWrites === settledBefore) {
      for (const entry of stored) {
        if (!unconfirmed.has(mediaKeyId(entry.key))) {
          queryClient.setQueryData(queryKeys.library.entry(scope, entry.key), entry);
        }
      }
    }
    return shown;
  };

  const apply = async (
    key: MediaKey,
    change: LibraryChange,
    options: LibraryApplyOptions = {},
  ): Promise<void> => {
    const state = stateOf(key);
    const entryKey = queryKeys.library.entry(scope, key);
    state.busy += 1;
    try {
      // first, as documented for optimistic updates: a fetch in flight would otherwise resolve
      // over the optimistic entry, and data set before the cancel settled could be reverted. the
      // gate keeps the applies of a key in call order whatever each cancel waits for
      const cancelled = state.gate.then(() =>
        queryClient.cancelQueries({ queryKey: entryKey, exact: true }),
      );
      state.gate = cancelled.then(noop, noop);
      await cancelled;

      const current = queryClient.getQueryData<LibraryEntry | null>(entryKey);
      if (current === undefined) {
        // a programming error: the ui enables library actions once the entry is loaded
        throw new LibraryActionError('entry-not-loaded');
      }
      const next = change(current, libraryWriteContextAt(now()));
      if (next === current) {
        return;
      }
      queryClient.setQueryData(entryKey, next);
      setListEntry(queryClient, scope, key, next);
      state.version += 1;

      const settled = new Promise<void>((resolve, reject) => {
        // the pending value is the latest optimistic entry, which holds every earlier change
        const waiters = state.pending?.waiters ?? [];
        waiters.push({ resolve, reject });
        state.pending = { value: next, waiters };
      });
      clearTimeout(state.timer);
      state.timer = undefined;
      if (options.coalesce === true) {
        state.timer = setTimeout(() => {
          state.timer = undefined;
          void startWrite(state);
        }, PROGRESS_WRITE_COALESCE_MS);
      } else {
        void startWrite(state);
      }
      // the key stays busy until the change is written: pruned once nothing else holds it
      await settled;
    } finally {
      release(state);
    }
  };

  const flushAll = async (): Promise<void> => {
    const all = [...states.values()];
    // the applies still waiting for their cancel first, so their changes are written too
    await Promise.all(all.map((state) => state.gate));
    const writes = all.map(startWrite);
    // the writes started here, then every call already queued: none of them rejects
    await Promise.all([...writes, ...all.map((state) => state.queue)]);
  };

  const pendingChangeCount = (): number =>
    [...states.values()].filter((state) => state.pending !== null || state.writing > 0).length;

  return {
    writer: { read, list, apply, flushAll, pendingChangeCount },
    activeKeyCount: () => states.size,
  };
};

/** the library writes over a repository and the query cache of the library entries. */
export const createLibraryWriter = (options: LibraryWriterOptions): LibraryWriter =>
  createInspectableLibraryWriter(options).writer;
