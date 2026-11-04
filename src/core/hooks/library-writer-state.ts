// the state the library writer (library-writer.ts) keeps per key in use: its serial chain of
// repository calls, its pending coalesced change, its last failed write and what holds it.
// entries are personal data: never logged
import type { LibraryEntry } from '../domain/library-entry';
import type { MediaKey } from '../domain/media';
import { mediaKeyId } from './library-list-data';

/** an apply waiting for the write that carries its change */
export interface Waiter {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

/** the latest optimistic entry of a key, not written yet, and the applies it carries */
export interface PendingWrite {
  readonly value: LibraryEntry | null;
  readonly waiters: Waiter[];
}

/** a failed write of a key: a new object per failure, so a write tells whether one failed since */
export interface WriteFailure {
  readonly error: unknown;
}

export interface KeyState {
  readonly id: string;
  readonly key: MediaKey;
  /** the tail of the serial chain of repository calls; never rejects */
  queue: Promise<unknown>;
  /** the last failed write of the key, null before any */
  failure: WriteFailure | null;
  /** the tail of the applies waiting for their query cancel, so they compute in call order */
  gate: Promise<unknown>;
  /** bumped by every optimistic change: a write result never replaces a newer one */
  version: number;
  pending: PendingWrite | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** the applies at their gate or computing, and the repository calls queued or running */
  busy: number;
  /** the writes started and not settled: their change is not confirmed yet */
  writing: number;
}

// the idle state of a key (`id`: its mediaKeyId)
const createKeyState = (id: string, key: MediaKey): KeyState => ({
  id,
  key,
  queue: Promise.resolve(),
  failure: null,
  gate: Promise.resolve(),
  version: 0,
  pending: null,
  timer: undefined,
  busy: 0,
  writing: 0,
});

/** the states of the keys in use, and the serial chain of each key's repository calls */
export interface KeyStates {
  /** every state kept, by mediaKeyId */
  readonly states: ReadonlyMap<string, KeyState>;
  /** the state of a key, a fresh one when it is not in use */
  readonly stateOf: (key: MediaKey) => KeyState;
  /** ends one hold of a key (`busy`): an idle key is pruned, a later use starts a fresh one */
  readonly release: (state: KeyState) => void;
  /** runs `task` once every earlier call of the key settled, whatever its outcome */
  readonly enqueue: <T>(state: KeyState, task: () => Promise<T>) => Promise<T>;
}

export const createKeyStates = (): KeyStates => {
  const states = new Map<string, KeyState>();

  const stateOf = (key: MediaKey): KeyState => {
    const id = mediaKeyId(key);
    const existing = states.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const created = createKeyState(id, key);
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

  const enqueue = <T>(state: KeyState, task: () => Promise<T>): Promise<T> => {
    state.busy += 1;
    const run = state.queue.then(task);
    const done = (): void => {
      release(state);
    };
    state.queue = run.then(done, done);
    return run;
  };

  return { states, stateOf, release, enqueue };
};
