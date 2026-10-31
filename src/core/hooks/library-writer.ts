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
import { queryKeys, type LibraryScope } from '../query/keys';
import type { LibraryRepository } from '../repositories/library-repository';
import { mediaKeyId, setListEntry, withListEntry } from './library-list-data';

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
   * entry refetches the stored truth. rejects without writing when the entry is not loaded.
   */
  apply(key: MediaKey, change: LibraryChange, options?: LibraryApplyOptions): Promise<void>;
  /** writes every pending coalesced change now; resolves once every call settled, never rejects */
  flushAll(): Promise<void>;
}

export interface LibraryWriterOptions {
  readonly queryClient: QueryClient;
  readonly repository: LibraryRepository;
  /** the cache scope of every library key this writer reads, sets, cancels or invalidates */
  readonly scope: LibraryScope;
  /** the clock of the writes, `new Date()` by default */
  readonly now?: () => Date;
}

interface Waiter {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

// the latest optimistic entry of a key, not written yet, and the applies it carries
interface PendingWrite {
  readonly value: LibraryEntry | null;
  readonly waiters: Waiter[];
}

interface KeyState {
  readonly id: string;
  readonly key: MediaKey;
  // the tail of the serial chain of repository calls; never rejects
  queue: Promise<unknown>;
  // the tail of the applies waiting for their query cancel, so they compute in call order
  gate: Promise<unknown>;
  // bumped by every optimistic change: a write result never replaces a newer one
  version: number;
  pending: PendingWrite | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  // the applies at their gate or computing, and the repository calls queued or running
  busy: number;
  // the writes started and not settled: their change is not confirmed yet
  writing: number;
}

const noop = (): void => undefined;

// a programming error: the ui enables library actions once the entry is loaded
const NOT_LOADED_MESSAGE = 'library change applied before the library entry was loaded';

const systemNow = (): Date => new Date();

/** the library writes over a repository and the query cache of the library entries. */
export const createLibraryWriter = ({
  queryClient,
  repository,
  scope,
  now = systemNow,
}: LibraryWriterOptions): LibraryWriter => {
  // the states of the keys in use: an idle one is pruned, a later use starts a fresh one
  const states = new Map<string, KeyState>();
  // every write settled so far, whatever its outcome: a list sees whether one settled meanwhile
  let settledWrites = 0;

  const stateOf = (key: MediaKey): KeyState => {
    const id = mediaKeyId(key);
    const existing = states.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const created: KeyState = {
      id,
      key,
      queue: Promise.resolve(),
      gate: Promise.resolve(),
      version: 0,
      pending: null,
      timer: undefined,
      busy: 0,
      writing: 0,
    };
    states.set(id, created);
    return created;
  };

  // an idle key keeps nothing the cache does not hold: its versions end with its last write
  const release = (state: KeyState): void => {
    state.busy -= 1;
    if (
      state.busy === 0 &&
      state.writing === 0 &&
      state.pending === null &&
      state.timer === undefined
    ) {
      states.delete(state.id);
    }
  };

  // runs `task` once every earlier call of the key settled, whatever its outcome
  const enqueue = <T>(state: KeyState, task: () => Promise<T>): Promise<T> => {
    state.busy += 1;
    const run = state.queue.then(task);
    const done = (): void => {
      release(state);
    };
    state.queue = run.then(done, done);
    return run;
  };

  const persist = (state: KeyState, value: LibraryEntry | null): Promise<LibraryEntry | null> =>
    enqueue(state, async () => {
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
    return persist(state, pending.value).then(
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
        finish();
        // the entry refetches the stored truth through read, after any newer pending change
        void queryClient.invalidateQueries({ queryKey: entryKey, exact: true });
        void queryClient.invalidateQueries({ queryKey: listKey, exact: true });
        for (const waiter of pending.waiters) {
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
        throw new Error(NOT_LOADED_MESSAGE);
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

  return { read, list, apply, flushAll };
};
