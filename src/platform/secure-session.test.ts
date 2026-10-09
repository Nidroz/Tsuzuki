import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { type SecureStoreOptions, WHEN_UNLOCKED_THIS_DEVICE_ONLY } from 'expo-secure-store';

import { createSecureSessionStorage, MAX_CHUNK_BYTES, MAX_CHUNKS } from './secure-session';

// an in-memory secure-store; each call records the options it received
const mockStore = new Map<string, string>();
const mockOptions: (SecureStoreOptions | undefined)[] = [];

jest.mock('expo-secure-store', () => ({
  // stands in for the keychain constant (the factory runs before this file's constants exist)
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: (key: string, options?: SecureStoreOptions) => {
    mockOptions.push(options);
    return Promise.resolve(mockStore.get(key) ?? null);
  },
  setItemAsync: (key: string, value: string, options?: SecureStoreOptions) => {
    mockOptions.push(options);
    mockStore.set(key, value);
    return Promise.resolve();
  },
  deleteItemAsync: (key: string, options?: SecureStoreOptions) => {
    mockOptions.push(options);
    mockStore.delete(key);
    return Promise.resolve();
  },
}));

const KEY = 'sb-auth-token';
const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length;

beforeEach(() => {
  mockStore.clear();
  mockOptions.length = 0;
});

describe('createSecureSessionStorage', () => {
  it('round-trips a short value as one chunk and its count', async () => {
    const storage = createSecureSessionStorage();

    await storage.setItem(KEY, '{"access_token":"a"}');

    expect(await storage.getItem(KEY)).toBe('{"access_token":"a"}');
    expect([...mockStore.keys()].sort()).toStrictEqual([KEY, `${KEY}.0`]);
    expect(mockStore.get(KEY)).toBe('1');
  });

  it('returns null for a key never written', async () => {
    expect(await createSecureSessionStorage().getItem(KEY)).toBeNull();
  });

  it('splits a long value into chunks of at most the byte limit', async () => {
    const value = 'a'.repeat(MAX_CHUNK_BYTES * 2 + 1);

    await createSecureSessionStorage().setItem(KEY, value);

    expect(mockStore.get(KEY)).toBe('3');
    expect(mockStore.get(`${KEY}.2`)).toBe('a');
    expect(await createSecureSessionStorage().getItem(KEY)).toBe(value);
  });

  it.each([
    ['exactly the byte limit', 'a'.repeat(MAX_CHUNK_BYTES), '1'],
    ['one byte over the limit', 'a'.repeat(MAX_CHUNK_BYTES + 1), '2'],
    ['2-byte characters filling the limit exactly', 'é'.repeat(MAX_CHUNK_BYTES / 2), '1'],
    ['4-byte emoji filling the limit exactly', '😀'.repeat(MAX_CHUNK_BYTES / 4), '1'],
    ['an emoji one byte past the limit', `${'😀'.repeat(MAX_CHUNK_BYTES / 4 - 1)}abc😀`, '2'],
  ])('stores a value of %s as %s chunk(s)', async (_, value, count) => {
    const storage = createSecureSessionStorage();

    await storage.setItem(KEY, value);

    expect(mockStore.get(KEY)).toBe(count);
    expect(await storage.getItem(KEY)).toBe(value);
  });

  it('round-trips an empty value', async () => {
    const storage = createSecureSessionStorage();

    await storage.setItem(KEY, '');

    expect(mockStore.get(KEY)).toBe('1');
    expect(await storage.getItem(KEY)).toBe('');
  });

  it.each([
    ['2-byte', 'é'],
    ['3-byte', '続'],
    ['4-byte emoji (surrogate pair)', '😀'],
  ])('never cuts a %s character at a chunk boundary', async (_, character) => {
    // one ascii byte shifts every character across the boundary
    const value = `x${character.repeat(MAX_CHUNK_BYTES)}`;
    const storage = createSecureSessionStorage();

    await storage.setItem(KEY, value);

    const chunks = [...mockStore.entries()]
      .filter(([key]) => key !== KEY)
      .map(([, chunk]) => chunk);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(utf8Bytes(chunk)).toBeLessThanOrEqual(MAX_CHUNK_BYTES);
      // a cut surrogate pair would be re-encoded as replacement characters
      expect(chunk.isWellFormed()).toBe(true);
    }
    expect(await storage.getItem(KEY)).toBe(value);
  });

  it('deletes the leftover chunks of a previous longer value', async () => {
    const storage = createSecureSessionStorage();
    await storage.setItem(KEY, 'a'.repeat(MAX_CHUNK_BYTES * 3));

    await storage.setItem(KEY, 'short');

    expect([...mockStore.keys()].sort()).toStrictEqual([KEY, `${KEY}.0`]);
    expect(await storage.getItem(KEY)).toBe('short');
  });

  it('deletes every leftover chunk when the previous count is invalid', async () => {
    mockStore.set(`${KEY}.0`, 'old');
    mockStore.set(`${KEY}.1`, 'old');
    mockStore.set(`${KEY}.${String(MAX_CHUNKS - 1)}`, 'old');
    mockStore.set(KEY, 'corrupt');
    const storage = createSecureSessionStorage();

    await storage.setItem(KEY, 'short');

    expect([...mockStore.keys()].sort()).toStrictEqual([KEY, `${KEY}.0`]);
    expect(await storage.getItem(KEY)).toBe('short');
  });

  it('fails closed when a chunk is missing', async () => {
    const storage = createSecureSessionStorage();
    await storage.setItem(KEY, 'a'.repeat(MAX_CHUNK_BYTES * 2));
    mockStore.delete(`${KEY}.1`);

    expect(await storage.getItem(KEY)).toBeNull();
  });

  it.each(['0', '-1', '1.5', 'abc', '', String(MAX_CHUNKS + 1)])(
    'fails closed when the stored count is %j',
    async (count) => {
      mockStore.set(`${KEY}.0`, 'chunk');
      mockStore.set(KEY, count);

      expect(await createSecureSessionStorage().getItem(KEY)).toBeNull();
    },
  );

  it('removeItem clears the count and every chunk', async () => {
    const storage = createSecureSessionStorage();
    await storage.setItem(KEY, 'a'.repeat(MAX_CHUNK_BYTES * 2 + 1));

    await storage.removeItem(KEY);

    expect(mockStore.size).toBe(0);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('removeItem clears every possible chunk when the count is invalid', async () => {
    mockStore.set(`${KEY}.0`, 'chunk');
    mockStore.set(`${KEY}.5`, 'chunk');
    mockStore.set(KEY, 'corrupt');

    await createSecureSessionStorage().removeItem(KEY);

    expect(mockStore.size).toBe(0);
  });

  it.each(['', 'has space', 'slash/key', 'é', 'dotted.key'])(
    'rejects the invalid key %j',
    async (key) => {
      const storage = createSecureSessionStorage();

      await expect(storage.getItem(key)).rejects.toThrow(TypeError);
      await expect(storage.setItem(key, 'value')).rejects.toThrow(TypeError);
      await expect(storage.removeItem(key)).rejects.toThrow(TypeError);
      expect(mockStore.size).toBe(0);
    },
  );

  it('rejects a value needing more than the chunk limit, writing nothing', async () => {
    const storage = createSecureSessionStorage();

    await expect(
      storage.setItem(KEY, 'a'.repeat(MAX_CHUNK_BYTES * MAX_CHUNKS + 1)),
    ).rejects.toThrow(RangeError);
    expect(mockStore.size).toBe(0);
  });

  it('passes the keychain accessibility on every call', async () => {
    const storage = createSecureSessionStorage();
    await storage.setItem(KEY, 'a'.repeat(MAX_CHUNK_BYTES + 1));
    await storage.getItem(KEY);
    await storage.removeItem(KEY);

    expect(WHEN_UNLOCKED_THIS_DEVICE_ONLY).toBe('when-unlocked-this-device-only');
    expect(mockOptions.length).toBeGreaterThan(0);
    for (const options of mockOptions) {
      expect(options).toStrictEqual({ keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    }
  });

  // the proof that the session never reaches mmkv is src/core/repositories/supabase/session-isolation.test.ts
  it('writes under the key and its chunks only', async () => {
    await createSecureSessionStorage().setItem(KEY, 'a'.repeat(MAX_CHUNK_BYTES + 1));

    expect([...mockStore.keys()].sort()).toStrictEqual([KEY, `${KEY}.0`, `${KEY}.1`]);
  });
});
