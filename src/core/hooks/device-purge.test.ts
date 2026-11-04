import { describe, expect, it, jest } from '@jest/globals';

import {
  createFakeAccountLibraryRepository,
  createFakeGuestLibraryRepository,
  createStuckWriteMocks,
} from '../../../test/core/fake-library-repository';
import { createFakeRecentSearchesRepository } from '../../../test/core/fake-recent-searches-repository';
import { DEVICE_PURGE_STEPS, DevicePurgeError } from '../errors/device-purge-errors';
import type { ErrorReporter } from '../errors/error-reporter';
import { createQueryClient } from '../query/query-client';
import type { OfflineAccountLibraryRepository } from '../repositories/library-repository';
import { keepsGuestLibrary, purgeDeviceUserData } from './device-purge';
import { GUEST_MERGE_STATUSES } from './guest-merge-context';

const QUERY_KEY = ['catalog', 'probe'] as const;

const createPurgeInput = () => {
  const account = {
    ...createFakeAccountLibraryRepository(),
    replayQueuedWrites: jest.fn<OfflineAccountLibraryRepository['replayQueuedWrites']>(),
    subscribeToQueuedWrites: jest.fn<OfflineAccountLibraryRepository['subscribeToQueuedWrites']>(),
    queuedWriteCount: jest.fn<OfflineAccountLibraryRepository['queuedWriteCount']>(),
    ...createStuckWriteMocks(),
    purgeDeviceData: jest.fn<OfflineAccountLibraryRepository['purgeDeviceData']>(),
  } satisfies OfflineAccountLibraryRepository;
  const queryClient = createQueryClient();
  queryClient.setQueryData(QUERY_KEY, 1);
  // a mutation in the cache, as the running sign out is
  void queryClient.getMutationCache().build(queryClient, { mutationFn: () => Promise.resolve() });
  const removeQueries = jest.spyOn(queryClient, 'removeQueries');
  const input = {
    account,
    guest: createFakeGuestLibraryRepository(),
    clearGuestLibrary: true,
    deviceWide: true,
    recentSearches: createFakeRecentSearchesRepository(['frieren']),
    queryClient,
    removePersistedCache: jest.fn<() => void>(),
    reporter: { captureError: jest.fn<ErrorReporter['captureError']>() },
    advanceGeneration: jest.fn<() => void>(),
  };
  // the mocks of the steps, in the order of DEVICE_PURGE_STEPS, then the generation
  const steps = {
    'account-library': account.purgeDeviceData,
    'guest-library': input.guest.clear,
    'recent-searches': input.recentSearches.clear,
    'query-cache': removeQueries,
    'persisted-cache': input.removePersistedCache,
  };
  const order = (): readonly string[] =>
    [...Object.entries(steps), ['generation', input.advanceGeneration] as const]
      .flatMap(([name, mock]) => mock.mock.invocationCallOrder.map((at) => ({ name, at })))
      .sort((left, right) => left.at - right.at)
      .map(({ name }) => name);
  return { input, steps, order };
};

describe('purgeDeviceUserData', () => {
  it('runs every step in order, then advances the generation', async () => {
    const { input, order } = createPurgeInput();

    await expect(purgeDeviceUserData(input)).resolves.toStrictEqual([]);

    expect(order()).toStrictEqual([...DEVICE_PURGE_STEPS, 'generation']);
    expect(input.recentSearches.stored()).toStrictEqual([]);
    expect(input.reporter.captureError).not.toHaveBeenCalled();
  });

  it('removes every query, keeps the mutations, then removes the persisted cache', async () => {
    const { input } = createPurgeInput();
    let queriesLeft: number | undefined;
    input.removePersistedCache.mockImplementation(() => {
      queriesLeft = input.queryClient.getQueryCache().getAll().length;
    });

    await purgeDeviceUserData(input);

    expect(queriesLeft).toBe(0);
    expect(input.queryClient.getMutationCache().getAll()).toHaveLength(1);
  });

  it('keeps the guest library when told to', async () => {
    const { input, order } = createPurgeInput();

    await purgeDeviceUserData({ ...input, clearGuestLibrary: false });

    expect(input.guest.clear).not.toHaveBeenCalled();
    expect(order()).toStrictEqual([
      'account-library',
      'recent-searches',
      'query-cache',
      'persisted-cache',
      'generation',
    ]);
  });

  it.each(DEVICE_PURGE_STEPS)(
    'reports a failing %s step alone and still runs the next ones',
    async (failing) => {
      const { input, steps, order } = createPurgeInput();
      steps[failing].mockImplementation(() => {
        throw new Error('storage unavailable: frieren');
      });

      await expect(purgeDeviceUserData(input)).resolves.toStrictEqual([failing]);

      expect(order()).toStrictEqual([...DEVICE_PURGE_STEPS, 'generation']);
      expect(input.reporter.captureError).toHaveBeenCalledTimes(1);
      const [reported, context] = input.reporter.captureError.mock.calls[0] ?? [];
      expect(reported).toStrictEqual(new DevicePurgeError(failing));
      expect(reported).not.toHaveProperty('cause');
      expect(context).toStrictEqual({ source: 'device-purge', tags: { step: failing } });
    },
  );

  it('reports a step that rejects', async () => {
    const { input } = createPurgeInput();
    input.guest.clear.mockRejectedValue(new Error('storage unavailable'));

    await expect(purgeDeviceUserData(input)).resolves.toStrictEqual(['guest-library']);

    expect(input.reporter.captureError).toHaveBeenCalledWith(
      new DevicePurgeError('guest-library'),
      { source: 'device-purge', tags: { step: 'guest-library' } },
    );
    expect(input.advanceGeneration).toHaveBeenCalledTimes(1);
  });
});

describe('purgeDeviceUserData without the device-wide steps', () => {
  it('purges the account library only: no guest library, searches, caches or generation', async () => {
    const { input, order } = createPurgeInput();

    await expect(purgeDeviceUserData({ ...input, deviceWide: false })).resolves.toStrictEqual([]);

    expect(order()).toStrictEqual(['account-library']);
    expect(input.recentSearches.stored()).toStrictEqual(['frieren']);
    expect(input.queryClient.getQueryData(QUERY_KEY)).toBe(1);
  });

  it('resolves the failed account-library step, reported, and runs nothing else', async () => {
    const { input, steps, order } = createPurgeInput();
    steps['account-library'].mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    await expect(purgeDeviceUserData({ ...input, deviceWide: false })).resolves.toStrictEqual([
      'account-library',
    ]);

    expect(order()).toStrictEqual(['account-library']);
    expect(input.reporter.captureError).toHaveBeenCalledWith(
      new DevicePurgeError('account-library'),
      { source: 'device-purge', tags: { step: 'account-library' } },
    );
  });

  it('lists every failed step in order', async () => {
    const { input, steps } = createPurgeInput();
    for (const step of ['account-library', 'query-cache'] as const) {
      steps[step].mockImplementation(() => {
        throw new Error('storage unavailable');
      });
    }

    await expect(purgeDeviceUserData(input)).resolves.toStrictEqual([
      'account-library',
      'query-cache',
    ]);
    expect(input.advanceGeneration).toHaveBeenCalledTimes(1);
  });
});

describe('keepsGuestLibrary', () => {
  it('keeps the guest library until the merge concluded', () => {
    expect(GUEST_MERGE_STATUSES.map((status) => [status, keepsGuestLibrary(status)])).toStrictEqual(
      [
        ['idle', false],
        ['checking', true],
        ['merging', true],
        ['failed', true],
      ],
    );
  });
});
