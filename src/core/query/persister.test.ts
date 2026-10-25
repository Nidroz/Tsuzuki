import { describe, expect, it, jest } from '@jest/globals';
import { noop, onlineManager, type QueryClient } from '@tanstack/react-query';
import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from '@tanstack/react-query-persist-client';

import type { StorageAdapter } from '../repositories/storage-adapter';
import {
  PERSIST_THROTTLE_MS,
  QUERY_CACHE_STORAGE_KEY,
  createPersistOptions,
  createQueryPersister,
} from './persister';
import { CACHE_SCHEMA_VERSION } from './cache-schema-version';
import { LIBRARY_KEY_ROOT, queryKeys } from './keys';
import { createQueryClient } from './query-client';
import { PERSISTED_CACHE_MAX_AGE } from './stale-times';

const APP_VERSION = '1.0.0';
const PREVIOUS_APP_VERSION = '0.9.0';
const MEDIA_KEY = ['media', 'mal', 'anime', 1];
const MEDIA = { title: 'Frieren' };
const OTHER_MEDIA = { title: 'Mushishi' };
const LIBRARY_NOTES = 'private note';
const MUTATION_PASSWORD = 'correct-horse-9';

type MemoryStorage = StorageAdapter & { values: Map<string, string> };

const createMemoryStorage = (): MemoryStorage => {
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

const save = async (
  queryClient: QueryClient,
  storage: StorageAdapter,
  appVersion = APP_VERSION,
  cacheSchemaVersion = CACHE_SCHEMA_VERSION,
): Promise<void> => {
  const options = createPersistOptions({
    persister: createQueryPersister(storage),
    appVersion,
    cacheSchemaVersion,
  });
  await persistQueryClientSave({ ...options, queryClient });
  jest.advanceTimersByTime(PERSIST_THROTTLE_MS);
};

const restore = async (storage: StorageAdapter): Promise<QueryClient> => {
  const queryClient = createQueryClient();
  const options = createPersistOptions({
    persister: createQueryPersister(storage),
    appVersion: APP_VERSION,
  });
  await persistQueryClientRestore({ ...options, queryClient });
  return queryClient;
};

describe('createPersistOptions', () => {
  it('keeps the cache for the max age and busts it by app and cache schema version', () => {
    const persister = createQueryPersister(createMemoryStorage());
    const options = createPersistOptions({ persister, appVersion: APP_VERSION });
    expect(options.maxAge).toBe(PERSISTED_CACHE_MAX_AGE);
    expect(options.buster).toBe(`${APP_VERSION}+${String(CACHE_SCHEMA_VERSION)}`);
    expect(options.persister).toBe(persister);
  });
});

describe('createQueryPersister', () => {
  it('restores a persisted successful query', async () => {
    const storage = createMemoryStorage();
    const source = createQueryClient();
    source.setQueryData(MEDIA_KEY, MEDIA);
    await save(source, storage);

    expect(storage.values.has(QUERY_CACHE_STORAGE_KEY)).toBe(true);
    const restored = await restore(storage);
    expect(restored.getQueryData(MEDIA_KEY)).toStrictEqual(MEDIA);
  });

  it('drops a cache written by another app version', async () => {
    const storage = createMemoryStorage();
    const source = createQueryClient();
    source.setQueryData(MEDIA_KEY, MEDIA);
    await save(source, storage, PREVIOUS_APP_VERSION);

    const restored = await restore(storage);
    expect(restored.getQueryData(MEDIA_KEY)).toBeUndefined();
    expect(storage.values.has(QUERY_CACHE_STORAGE_KEY)).toBe(false);
  });

  it('drops a cache written with another cache schema version of the same app version', async () => {
    const storage = createMemoryStorage();
    const source = createQueryClient();
    source.setQueryData(MEDIA_KEY, MEDIA);
    await save(source, storage, APP_VERSION, CACHE_SCHEMA_VERSION - 1);

    const restored = await restore(storage);
    expect(restored.getQueryData(MEDIA_KEY)).toBeUndefined();
    expect(storage.values.has(QUERY_CACHE_STORAGE_KEY)).toBe(false);
  });

  it('does not persist pending or failed queries', async () => {
    const storage = createMemoryStorage();
    const source = createQueryClient();
    await expect(
      source.query({
        queryKey: ['top', 'mal', 'anime', 1],
        queryFn: () => Promise.reject(new Error('offline')),
      }),
    ).rejects.toThrow('offline');
    void source
      .query({
        queryKey: ['season', 'mal', 1],
        queryFn: () => new Promise<never>(() => undefined),
      })
      .catch(noop);
    source.setQueryData(MEDIA_KEY, MEDIA);
    await save(source, storage);

    const restored = await restore(storage);
    expect(
      restored
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toStrictEqual([MEDIA_KEY]);
  });

  it.each<[string, readonly unknown[]]>([
    ['a search', queryKeys.search('mal', { kind: 'anime', query: 'frieren', page: 1 })],
    ['a later search page', queryKeys.search('mal', { kind: 'manga', query: 'berserk', page: 2 })],
    ['an idle search', ['search', 'mal', 'idle']],
  ])('does not persist %s, even when successful', async (_label, searchKey) => {
    const storage = createMemoryStorage();
    const source = createQueryClient();
    source.setQueryData(searchKey, { items: [] });
    source.setQueryData(MEDIA_KEY, MEDIA);
    await save(source, storage);

    expect(storage.values.get(QUERY_CACHE_STORAGE_KEY)).not.toContain('search');
    const restored = await restore(storage);
    expect(restored.getQueryData(searchKey)).toBeUndefined();
    expect(restored.getQueryData(MEDIA_KEY)).toStrictEqual(MEDIA);
  });

  it('does not persist library queries, even when successful', async () => {
    const storage = createMemoryStorage();
    const source = createQueryClient();
    const entryKey = queryKeys.library.entry({ namespace: 'mal', kind: 'anime', externalId: 1 });
    const listKey = queryKeys.library.all();
    source.setQueryData(entryKey, { progress: 3, notes: LIBRARY_NOTES });
    source.setQueryData(listKey, [{ progress: 3, notes: LIBRARY_NOTES }]);
    source.setQueryData(MEDIA_KEY, MEDIA);
    await save(source, storage);

    const stored = storage.values.get(QUERY_CACHE_STORAGE_KEY);
    expect(stored).not.toContain(LIBRARY_KEY_ROOT);
    expect(stored).not.toContain(LIBRARY_NOTES);
    const restored = await restore(storage);
    expect(restored.getQueryData(entryKey)).toBeUndefined();
    expect(restored.getQueryData(listKey)).toBeUndefined();
    expect(restored.getQueryData(MEDIA_KEY)).toStrictEqual(MEDIA);
  });

  it('does not persist a paused mutation nor its variables', async () => {
    const storage = createMemoryStorage();
    const source = createQueryClient();
    onlineManager.setOnline(false);
    try {
      const mutation = source
        .getMutationCache()
        .build<undefined, Error, { password: string }, unknown>(source, {
          mutationFn: () => Promise.resolve(undefined),
          networkMode: 'online',
        });
      void mutation.execute({ password: MUTATION_PASSWORD }).catch(noop);
      await Promise.resolve();
      // tanstack's default would persist this paused mutation, password included
      expect(mutation.state.isPaused).toBe(true);
      source.setQueryData(MEDIA_KEY, MEDIA);
      await save(source, storage);
    } finally {
      onlineManager.setOnline(true);
    }

    const stored = storage.values.get(QUERY_CACHE_STORAGE_KEY);
    expect(stored).not.toContain(MUTATION_PASSWORD);
    expect(JSON.parse(stored ?? '')).toMatchObject({ clientState: { mutations: [] } });
  });

  it('writes once per throttle interval, with the latest state', async () => {
    const storage = createMemoryStorage();
    const set = jest.spyOn(storage, 'set');
    const persister = createQueryPersister(storage);
    const source = createQueryClient();
    const options = createPersistOptions({ persister, appVersion: APP_VERSION });

    source.setQueryData(MEDIA_KEY, MEDIA);
    await persistQueryClientSave({ ...options, queryClient: source });
    source.setQueryData(MEDIA_KEY, OTHER_MEDIA);
    await persistQueryClientSave({ ...options, queryClient: source });
    expect(set).not.toHaveBeenCalled();
    jest.advanceTimersByTime(PERSIST_THROTTLE_MS);

    expect(set).toHaveBeenCalledTimes(1);
    expect((await restore(storage)).getQueryData(MEDIA_KEY)).toStrictEqual(OTHER_MEDIA);
  });

  it('cancels a waiting save when the cache is removed', async () => {
    const storage = createMemoryStorage();
    const persister = createQueryPersister(storage);
    await persister.persistClient({
      timestamp: Date.now(),
      buster: APP_VERSION,
      clientState: { queries: [], mutations: [] },
    });
    await persister.removeClient();
    jest.advanceTimersByTime(PERSIST_THROTTLE_MS);

    expect(storage.values.has(QUERY_CACHE_STORAGE_KEY)).toBe(false);
  });

  it.each([
    ['invalid json', '{not json'],
    ['a wrong envelope', JSON.stringify({ timestamp: 'now', buster: 1 })],
  ])('removes a stored cache holding %s without throwing', async (_case, stored) => {
    const storage = createMemoryStorage();
    storage.set(QUERY_CACHE_STORAGE_KEY, stored);

    const restored = await restore(storage);
    expect(restored.getQueryCache().getAll()).toHaveLength(0);
    expect(storage.values.has(QUERY_CACHE_STORAGE_KEY)).toBe(false);
  });

  it('restores nothing from an empty storage', async () => {
    const restored = await restore(createMemoryStorage());
    expect(restored.getQueryCache().getAll()).toHaveLength(0);
  });
});
