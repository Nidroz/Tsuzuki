import { describe, expect, it, jest } from '@jest/globals';

import { CatalogAbortedError } from '../../errors/catalog-errors';
import { createInFlightDedup } from './in-flight-dedup';

const KEY = 'https://catalog.test/anime/1';
const OTHER_KEY = 'https://catalog.test/anime/2';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

const createDeferred = <T>(): Deferred<T> => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

// a task that settles when the test says so, and rejects like a fetch when its signal aborts
const createControlledTask = () => {
  const signals: AbortSignal[] = [];
  const pending: Deferred<string>[] = [];
  const task = jest.fn((signal: AbortSignal) => {
    const deferred = createDeferred<string>();
    signals.push(signal);
    pending.push(deferred);
    signal.addEventListener('abort', () => {
      deferred.reject(new CatalogAbortedError());
    });
    return deferred.promise;
  });
  return { task, signals, pending };
};

describe('createInFlightDedup', () => {
  it('runs one task for callers of the same key', async () => {
    const dedup = createInFlightDedup<string>();
    const { task, pending } = createControlledTask();

    const first = dedup.run(KEY, task);
    const second = dedup.run(KEY, task);
    pending[0]?.resolve('frieren');

    await expect(first).resolves.toBe('frieren');
    await expect(second).resolves.toBe('frieren');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('runs one task per key', async () => {
    const dedup = createInFlightDedup<string>();
    const { task, pending } = createControlledTask();

    const first = dedup.run(KEY, task);
    const second = dedup.run(OTHER_KEY, task);
    pending[0]?.resolve('frieren');
    pending[1]?.resolve('mushishi');

    await expect(first).resolves.toBe('frieren');
    await expect(second).resolves.toBe('mushishi');
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('starts a new task once the previous one succeeded', async () => {
    const dedup = createInFlightDedup<string>();
    const { task, pending } = createControlledTask();

    const first = dedup.run(KEY, task);
    pending[0]?.resolve('frieren');
    await expect(first).resolves.toBe('frieren');
    const second = dedup.run(KEY, task);
    pending[1]?.resolve('frieren, updated');

    await expect(second).resolves.toBe('frieren, updated');
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('shares a failure, then starts a new task', async () => {
    const dedup = createInFlightDedup<string>();
    const { task, pending } = createControlledTask();
    const failure = new Error('provider down');

    const settled = Promise.allSettled([dedup.run(KEY, task), dedup.run(KEY, task)]);
    pending[0]?.reject(failure);
    expect(await settled).toStrictEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    const third = dedup.run(KEY, task);
    pending[1]?.resolve('frieren');

    await expect(third).resolves.toBe('frieren');
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('turns a synchronous throw of the task into a rejection', async () => {
    const dedup = createInFlightDedup<string>();
    const failure = new Error('bad task');

    const running = dedup.run(KEY, () => {
      throw failure;
    });

    await expect(running).rejects.toBe(failure);
  });
});

describe('aborting callers', () => {
  it('rejects only the caller that aborted while the task goes on', async () => {
    const dedup = createInFlightDedup<string>();
    const { task, signals, pending } = createControlledTask();
    const leaving = new AbortController();
    const staying = new AbortController();

    const left = dedup.run(KEY, task, leaving.signal);
    const stayed = dedup.run(KEY, task, staying.signal);
    leaving.abort();
    await expect(left).rejects.toBeInstanceOf(CatalogAbortedError);
    pending[0]?.resolve('frieren');

    await expect(stayed).resolves.toBe('frieren');
    expect(signals[0]?.aborted).toBe(false);
  });

  it('aborts the shared task once every caller left, and a later caller starts afresh', async () => {
    const dedup = createInFlightDedup<string>();
    const { task, signals, pending } = createControlledTask();
    const first = new AbortController();
    const second = new AbortController();

    // both outcomes, with their rejections handled from the start
    const outcomes = Promise.all(
      [first, second].map(({ signal }) =>
        dedup.run(KEY, task, signal).catch((error: unknown) => error),
      ),
    );
    first.abort();
    expect(signals[0]?.aborted).toBe(false);
    second.abort();

    const [firstOutcome, secondOutcome] = await outcomes;
    expect(firstOutcome).toBeInstanceOf(CatalogAbortedError);
    expect(secondOutcome).toBeInstanceOf(CatalogAbortedError);
    expect(signals[0]?.aborted).toBe(true);
    // the aborted task rejects with nobody waiting for it: no unhandled rejection
    await expect(pending[0]?.promise).rejects.toBeInstanceOf(CatalogAbortedError);
    const later = dedup.run(KEY, task);
    pending[1]?.resolve('frieren');
    await expect(later).resolves.toBe('frieren');
    expect(task).toHaveBeenCalledTimes(2);
  });

  it('keeps the shared task alive for a caller without a signal', async () => {
    const dedup = createInFlightDedup<string>();
    const { task, signals, pending } = createControlledTask();
    const leaving = new AbortController();

    const stayed = dedup.run(KEY, task);
    const left = dedup.run(KEY, task, leaving.signal);
    leaving.abort();
    await expect(left).rejects.toBeInstanceOf(CatalogAbortedError);
    pending[0]?.resolve('frieren');

    await expect(stayed).resolves.toBe('frieren');
    expect(signals[0]?.aborted).toBe(false);
  });

  it('neither starts nor joins a task for an already aborted caller', async () => {
    const dedup = createInFlightDedup<string>();
    const { task, signals } = createControlledTask();
    const aborted = new AbortController();
    aborted.abort();
    const running = new AbortController();

    await expect(dedup.run(KEY, task, aborted.signal)).rejects.toBeInstanceOf(CatalogAbortedError);
    expect(task).not.toHaveBeenCalled();
    const joined = dedup.run(KEY, task, running.signal);
    await expect(dedup.run(KEY, task, aborted.signal)).rejects.toBeInstanceOf(CatalogAbortedError);
    running.abort();

    // the already aborted caller never counted: the only real caller left, so the task is aborted
    await expect(joined).rejects.toBeInstanceOf(CatalogAbortedError);
    expect(signals[0]?.aborted).toBe(true);
  });

  // the entry subscribes to the task's promise one microtask turn after run() returns: a reaction
  // added after that turn runs right after the entry settled, before the caller adopts the outcome
  it.each([
    [
      'succeeded',
      (deferred?: Deferred<string>) => {
        deferred?.resolve('frieren');
      },
    ],
    [
      'failed',
      (deferred?: Deferred<string>) => {
        deferred?.reject(new Error('provider down'));
      },
    ],
  ])(
    'rejects a caller aborting after the task %s, before its own promise settled, and starts afresh',
    async (_, settleTask) => {
      const dedup = createInFlightDedup<string>();
      const { task, pending } = createControlledTask();
      const caller = new AbortController();
      const abort = (): void => {
        caller.abort();
      };

      const outcome = dedup.run(KEY, task, caller.signal).catch((error: unknown) => error);
      // that turn: the abort is now queued behind the entry's own reaction to the task
      await Promise.resolve();
      void pending[0]?.promise.then(abort, abort);
      settleTask(pending[0]);

      // the abort came first for this caller: neither the value nor the failure reaches it
      expect(await outcome).toBeInstanceOf(CatalogAbortedError);
      expect(caller.signal.aborted).toBe(true);
      const later = dedup.run(KEY, task);
      pending[1]?.resolve('frieren, updated');
      await expect(later).resolves.toBe('frieren, updated');
      expect(task).toHaveBeenCalledTimes(2);
    },
  );

  it('removes its listener from the caller signal once settled', async () => {
    const dedup = createInFlightDedup<string>();
    const { task, pending } = createControlledTask();
    const caller = new AbortController();
    const add = jest.spyOn(caller.signal, 'addEventListener');
    const remove = jest.spyOn(caller.signal, 'removeEventListener');

    const running = dedup.run(KEY, task, caller.signal);
    pending[0]?.resolve('frieren');
    await expect(running).resolves.toBe('frieren');

    expect(add).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls).toStrictEqual(add.mock.calls);
  });
});
