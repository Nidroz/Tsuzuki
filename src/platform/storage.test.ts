import { describe, expect, it, jest } from '@jest/globals';
import type * as MmkvModule from 'react-native-mmkv';
import { createMMKV } from 'react-native-mmkv';

import { createStorage, STORAGE_INSTANCE_ID } from './storage';

// the in-memory instance mmkv provides under jest, wrapped to record its configuration
jest.mock('react-native-mmkv', () => {
  const actual = jest.requireActual<typeof MmkvModule>('react-native-mmkv');
  return { ...actual, createMMKV: jest.fn(actual.createMMKV) };
});

describe('createStorage', () => {
  it('returns undefined for a key never written', () => {
    expect(createStorage().getString('storage-test.missing')).toBeUndefined();
  });

  it('round-trips a string', () => {
    const storage = createStorage();

    storage.set('storage-test.round-trip', 'dark');

    expect(storage.getString('storage-test.round-trip')).toBe('dark');
  });

  it('overwrites a previous value', () => {
    const storage = createStorage();
    storage.set('storage-test.overwrite', 'light');

    storage.set('storage-test.overwrite', 'dark');

    expect(storage.getString('storage-test.overwrite')).toBe('dark');
  });

  it('deletes a key', () => {
    const storage = createStorage();
    storage.set('storage-test.delete', 'fr');

    storage.delete('storage-test.delete');

    expect(storage.getString('storage-test.delete')).toBeUndefined();
  });

  it('opens the single app instance, without encryption options', () => {
    createStorage();

    // never holds secrets: the session lives in secure-store
    expect(jest.mocked(createMMKV)).toHaveBeenLastCalledWith({ id: STORAGE_INSTANCE_ID });
  });
});
