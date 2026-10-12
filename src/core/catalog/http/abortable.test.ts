import { describe, expect, it, jest } from '@jest/globals';

import { CatalogAbortedError } from '../../errors/catalog-errors';
import { onAbort, raceAbort, sleep } from './abortable';

const DELAY_MS = 1_000;

describe('sleep', () => {
  it('resolves after the delay, not before', async () => {
    const done = jest.fn();
    void sleep(DELAY_MS).then(done);

    await jest.advanceTimersByTimeAsync(DELAY_MS - 1);
    expect(done).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects when aborted mid-sleep and clears its timer', async () => {
    const controller = new AbortController();
    const sleeping = sleep(DELAY_MS, controller.signal);
    await jest.advanceTimersByTimeAsync(DELAY_MS / 2);

    controller.abort();

    await expect(sleeping).rejects.toBeInstanceOf(CatalogAbortedError);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects an already aborted signal without a timer', async () => {
    const controller = new AbortController();
    controller.abort();
    const addListener = jest.spyOn(controller.signal, 'addEventListener');

    const sleeping = sleep(DELAY_MS, controller.signal);

    expect(jest.getTimerCount()).toBe(0);
    expect(addListener).not.toHaveBeenCalled();
    await expect(sleeping).rejects.toBeInstanceOf(CatalogAbortedError);
  });

  it('removes its abort listener when it resolves or rejects', async () => {
    const resolving = new AbortController();
    const resolvingAdd = jest.spyOn(resolving.signal, 'addEventListener');
    const resolvingRemove = jest.spyOn(resolving.signal, 'removeEventListener');
    const rejecting = new AbortController();
    const rejectingAdd = jest.spyOn(rejecting.signal, 'addEventListener');
    const rejectingRemove = jest.spyOn(rejecting.signal, 'removeEventListener');

    const resolved = sleep(DELAY_MS, resolving.signal);
    const rejected = sleep(DELAY_MS, rejecting.signal);
    rejecting.abort();
    await expect(rejected).rejects.toBeInstanceOf(CatalogAbortedError);
    await jest.advanceTimersByTimeAsync(DELAY_MS);
    await expect(resolved).resolves.toBeUndefined();

    expect(resolvingAdd).toHaveBeenCalledTimes(1);
    expect(resolvingRemove.mock.calls).toStrictEqual(resolvingAdd.mock.calls);
    expect(rejectingAdd).toHaveBeenCalledTimes(1);
    expect(rejectingRemove.mock.calls).toStrictEqual(rejectingAdd.mock.calls);
  });
});

describe('onAbort', () => {
  it('calls the listener on abort until detached', () => {
    const controller = new AbortController();
    const listener = jest.fn();

    const detach = onAbort(controller.signal, listener);
    detach();
    controller.abort();

    expect(listener).not.toHaveBeenCalled();
  });

  it('calls the listener when the signal aborts', () => {
    const controller = new AbortController();
    const listener = jest.fn();

    onAbort(controller.signal, listener);
    controller.abort();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('returns a detach that does nothing without a signal', () => {
    const listener = jest.fn();

    const detach = onAbort(undefined, listener);

    expect(detach).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('raceAbort', () => {
  const VALUE = 'payload';

  it('settles like the promise it races', async () => {
    const controller = new AbortController();
    const failure = new TypeError('terminated');

    await expect(raceAbort(Promise.resolve(VALUE), controller.signal)).resolves.toBe(VALUE);
    await expect(raceAbort(Promise.reject(failure), controller.signal)).rejects.toBe(failure);
  });

  it('rejects on abort although the promise never settles, and removes its listener', async () => {
    const controller = new AbortController();
    const removeListener = jest.spyOn(controller.signal, 'removeEventListener');
    const racing = raceAbort(new Promise<string>(() => undefined), controller.signal);

    controller.abort();

    await expect(racing).rejects.toBeInstanceOf(CatalogAbortedError);
    expect(removeListener).toHaveBeenCalledTimes(1);
  });

  it('ignores a late rejection once aborted, without leaving it unhandled', async () => {
    const controller = new AbortController();
    let rejectLate: (error: Error) => void = () => undefined;
    const late = new Promise<string>((_resolve, reject) => {
      rejectLate = reject;
    });
    const racing = raceAbort(late, controller.signal);

    controller.abort();
    rejectLate(new TypeError('terminated'));

    await expect(racing).rejects.toBeInstanceOf(CatalogAbortedError);
    await expect(late.catch((error: unknown) => error)).resolves.toBeInstanceOf(TypeError);
  });

  it('rejects an already aborted signal without adding a listener', async () => {
    const controller = new AbortController();
    controller.abort();
    const addListener = jest.spyOn(controller.signal, 'addEventListener');

    await expect(raceAbort(Promise.resolve(VALUE), controller.signal)).rejects.toBeInstanceOf(
      CatalogAbortedError,
    );
    expect(addListener).not.toHaveBeenCalled();
  });
});
