// the state the library writer (library-writer.ts) keeps per key in use: its serial chain of
// repository calls, its pending coalesced change and what holds it. entries are personal data:
// never logged
import type { LibraryEntry } from '../domain/library-entry';
import type { MediaKey } from '../domain/media';

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

export interface KeyState {
  readonly id: string;
  readonly key: MediaKey;
  /** the tail of the serial chain of repository calls; never rejects */
  queue: Promise<unknown>;
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

/** the idle state of a key (`id`: its mediaKeyId) */
export const createKeyState = (id: string, key: MediaKey): KeyState => ({
  id,
  key,
  queue: Promise.resolve(),
  gate: Promise.resolve(),
  version: 0,
  pending: null,
  timer: undefined,
  busy: 0,
  writing: 0,
});
