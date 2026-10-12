// in-flight dedup of identical catalog requests (docs/ARCHITECTURE.md §6): callers of one key share
// one running task. nothing is cached: once the task settles, the next call starts a new one
import { CatalogAbortedError } from '../../errors/catalog-errors';
import { onAbort } from './abortable';

export interface InFlightDedup<T> {
  /**
   * joins the running task of `key`, or starts `task` when there is none. the task gets a shared
   * signal, aborted once every caller with a signal has left and no caller without one remains.
   * the caller's promise rejects with `CatalogAbortedError` as soon as its own signal aborts.
   */
  run(key: string, task: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T>;
}

interface Entry<T> {
  readonly controller: AbortController;
  readonly promise: Promise<T>;
  callers: number;
}

export const createInFlightDedup = <T>(): InFlightDedup<T> => {
  const entries = new Map<string, Entry<T>>();

  // removes the entry only if the map still holds that same one: a later task may own the key
  const forget = (key: string, entry: Entry<T>): void => {
    if (entries.get(key) === entry) {
      entries.delete(key);
    }
  };

  const start = (key: string, task: (signal: AbortSignal) => Promise<T>): Entry<T> => {
    const controller = new AbortController();
    // the executor turns a synchronous throw of the task into a rejection
    const promise = new Promise<T>((resolve) => {
      resolve(task(controller.signal));
    });
    const entry: Entry<T> = { controller, promise, callers: 0 };
    entries.set(key, entry);
    // then(cleanup, cleanup), not finally: finally would hand the rejection on, unhandled
    const cleanup = (): void => {
      forget(key, entry);
    };
    promise.then(cleanup, cleanup);
    return entry;
  };

  return {
    run: (key, task, signal) => {
      if (signal?.aborted === true) {
        return Promise.reject(new CatalogAbortedError());
      }
      const entry = entries.get(key) ?? start(key, task);
      entry.callers += 1;
      return new Promise<T>((resolve, reject) => {
        const detach = onAbort(signal, () => {
          detach();
          entry.callers -= 1;
          reject(new CatalogAbortedError());
          if (entry.callers === 0) {
            // the last caller left: cancel the shared work, and let a later caller start afresh
            forget(key, entry);
            entry.controller.abort();
          }
        });
        // once the task settled, the caller adopts its outcome (a no-op after an abort)
        const settle = (): void => {
          detach();
          resolve(entry.promise);
        };
        entry.promise.then(settle, settle);
      });
    },
  };
};
