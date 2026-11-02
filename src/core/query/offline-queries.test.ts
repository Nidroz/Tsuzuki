import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { persistQueryClientSave } from '@tanstack/react-query-persist-client';

import type { StorageAdapter } from '../repositories/storage-adapter';
import { queryKeys, toLibraryScope } from './keys';
import {
  PERSIST_THROTTLE_MS,
  QUERY_CACHE_STORAGE_KEY,
  createPersistOptions,
  createQueryPersister,
} from './persister';
import { createQueryClient } from './query-client';

// the queries offline (ADR-0017 "Connectivity"): a catalog query pauses instead of failing, so a
// viewed media detail keeps its success state and stays in the persisted cache; a library query
// never pauses, its repository answers offline itself

const MEDIA_KEY = queryKeys.media({ namespace: 'mal', kind: 'anime', externalId: 52991 });
const DETAIL = { title: 'Sousou no Frieren' };
const LIBRARY_KEY = queryKeys.library.all(toLibraryScope(1));

const createMemoryStorage = (): StorageAdapter & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return {
    values,
    getString: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value);
    },
    delete: (key) => {
      values.delete(key);
    },
  };
};

// mounted clients follow onlineManager, as under QueryClientProvider
const mounted: QueryClient[] = [];

afterEach(() => {
  for (const client of mounted.splice(0)) {
    client.unmount();
  }
  onlineManager.setOnline(true);
});

// the media detail cached, stale, then refetched with the device offline
const setupStaleDetail = async () => {
  const client = createQueryClient();
  client.mount();
  mounted.push(client);
  client.setQueryData(MEDIA_KEY, DETAIL);
  const fetchDetail = jest.fn<() => Promise<typeof DETAIL>>(() =>
    Promise.reject(new Error('unreachable')),
  );
  onlineManager.setOnline(false);
  const refetch = client.query({ queryKey: MEDIA_KEY, queryFn: fetchDetail, staleTime: 0 });
  await jest.advanceTimersByTimeAsync(0);
  return { client, fetchDetail, refetch };
};

describe('a catalog query refetched offline', () => {
  it('pauses without calling the provider, keeping its success state and data', async () => {
    const { client, fetchDetail, refetch } = await setupStaleDetail();

    const state = client.getQueryState(MEDIA_KEY);
    expect(state).toMatchObject({ status: 'success', fetchStatus: 'paused', data: DETAIL });
    expect(fetchDetail).not.toHaveBeenCalled();

    fetchDetail.mockResolvedValueOnce(DETAIL);
    onlineManager.setOnline(true);
    await expect(refetch).resolves.toBe(DETAIL);
    expect(fetchDetail).toHaveBeenCalledTimes(1);
  });

  it('is still written to the persisted cache by the persist options', async () => {
    const { client } = await setupStaleDetail();
    const storage = createMemoryStorage();
    const options = createPersistOptions({
      persister: createQueryPersister(storage),
      appVersion: '1.0.0',
    });

    await persistQueryClientSave({ ...options, queryClient: client });
    jest.advanceTimersByTime(PERSIST_THROTTLE_MS);

    const stored: unknown = JSON.parse(storage.values.get(QUERY_CACHE_STORAGE_KEY) ?? 'null');
    expect(stored).toMatchObject({
      clientState: {
        queries: [{ queryKey: MEDIA_KEY, state: { status: 'success', data: DETAIL } }],
      },
    });
  });
});

describe('a library query offline', () => {
  it('runs at once instead of pausing', async () => {
    const client = createQueryClient();
    onlineManager.setOnline(false);
    const list = jest.fn(() => Promise.resolve([]));

    await expect(client.query({ queryKey: LIBRARY_KEY, queryFn: list })).resolves.toStrictEqual([]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('fails at once with the error of its repository, never paused', async () => {
    const client = createQueryClient();
    onlineManager.setOnline(false);
    const failure = new Error('no device copy');

    await expect(
      client.query({ queryKey: LIBRARY_KEY, queryFn: () => Promise.reject(failure) }),
    ).rejects.toBe(failure);
    expect(client.getQueryState(LIBRARY_KEY)?.fetchStatus).toBe('idle');
  });
});
