// an in-memory test double of the library repository (src/core/repositories/), for tests of the
// library writer and hooks: calls can be held or failed one by one to control their order
import { jest } from '@jest/globals';

import type { LibraryEntry } from '@core/domain/library-entry';
import type { MediaKey } from '@core/domain/media';
import type { LibraryRepository } from '@core/repositories/library-repository';

/** a promise settled from the outside */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

export const createDeferred = <T = void>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

const idOf = (key: MediaKey): string => `${key.namespace}:${key.kind}:${String(key.externalId)}`;

/**
 * a repository over an in-memory map, seeded with `initial`. every call first awaits
 * `beforeCall(method)`, a jest mock resolving at once by default: a test holds one call with
 * `beforeCall.mockReturnValueOnce(deferred.promise)` or fails it with
 * `beforeCall.mockRejectedValueOnce(error)`, and nothing changes in the map then. `save` stores a
 * copy keeping the stored `createdAt`, as the real implementations do, and resolves to it.
 * `stored(key)` reads the map without a call
 */
export const createFakeLibraryRepository = (initial: readonly LibraryEntry[] = []) => {
  const entries = new Map(initial.map((entry) => [idOf(entry.key), entry]));
  const beforeCall = jest.fn<(method: keyof LibraryRepository) => Promise<void>>(() =>
    Promise.resolve(),
  );
  return {
    beforeCall,
    list: jest.fn<LibraryRepository['list']>(async () => {
      await beforeCall('list');
      return [...entries.values()];
    }),
    get: jest.fn<LibraryRepository['get']>(async (key) => {
      await beforeCall('get');
      return entries.get(idOf(key)) ?? null;
    }),
    save: jest.fn<LibraryRepository['save']>(async (entry) => {
      await beforeCall('save');
      const existing = entries.get(idOf(entry.key));
      const stored = { ...entry, createdAt: existing?.createdAt ?? entry.createdAt };
      entries.set(idOf(entry.key), stored);
      return stored;
    }),
    remove: jest.fn<LibraryRepository['remove']>(async (key) => {
      await beforeCall('remove');
      entries.delete(idOf(key));
    }),
    stored: (key: MediaKey): LibraryEntry | null => entries.get(idOf(key)) ?? null,
  } satisfies LibraryRepository & {
    readonly beforeCall: typeof beforeCall;
    readonly stored: (key: MediaKey) => LibraryEntry | null;
  };
};

export type FakeLibraryRepository = ReturnType<typeof createFakeLibraryRepository>;
