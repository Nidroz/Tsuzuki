// abort helpers of the catalog http layer. react native's AbortController is the abort-controller
// polyfill: only `aborted` and the 'abort' event are used here, never `reason`, `throwIfAborted`,
// `AbortSignal.any` or `AbortSignal.timeout`, and every listener is removed once its operation settles
import { CatalogAbortedError } from '../../errors/catalog-errors';

const ABORT_EVENT = 'abort';

/** removes the listener it was returned for; calling it again does nothing. */
export type Detach = () => void;

const NOOP_DETACH: Detach = () => undefined;

/**
 * calls `listener` when `signal` aborts and returns the function that removes it. no signal: no
 * listener. an already aborted signal never fires again: callers check `signal.aborted` first.
 */
export const onAbort = (signal: AbortSignal | undefined, listener: () => void): Detach => {
  if (signal === undefined) {
    return NOOP_DETACH;
  }
  signal.addEventListener(ABORT_EVENT, listener);
  return () => {
    signal.removeEventListener(ABORT_EVENT, listener);
  };
};

/**
 * settles like `promise`, or rejects with `CatalogAbortedError` as soon as `signal` aborts, so a
 * transfer that ignores its signal (a body read on some fetch implementations) cannot outlive an
 * abort or a timeout. the late outcome of `promise` is then ignored, never left unhandled.
 */
export const raceAbort = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new CatalogAbortedError());
    }
    // no listener on a signal that already aborted: it would never fire, nor be removed
    const detach = onAbort(signal.aborted ? undefined : signal, () => {
      detach();
      reject(new CatalogAbortedError());
    });
    void promise.then(resolve, reject).then(detach);
  });

/**
 * resolves after `ms`; rejects with `CatalogAbortedError` when `signal` aborts first, clearing its
 * timer. an already aborted signal rejects at once, without a timer.
 */
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new CatalogAbortedError());
      return;
    }
    const timer = setTimeout(() => {
      detach();
      resolve();
    }, ms);
    const detach = onAbort(signal, () => {
      clearTimeout(timer);
      detach();
      reject(new CatalogAbortedError());
    });
  });
