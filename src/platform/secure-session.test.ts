import type { ErrorReporter } from '@core/errors/error-reporter';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { type SecureStoreOptions, WHEN_UNLOCKED_THIS_DEVICE_ONLY } from 'expo-secure-store';

import { createSecureSessionStorage, MAX_CHUNK_BYTES, MAX_CHUNKS } from './secure-session';

// an in-memory secure-store; each call records the options it received
const mockStore = new Map<string, string>();
const mockOptions: (SecureStoreOptions | undefined)[] = [];
// a write to this exact key waits for the promise before it lands (interleaving tests)
let mockGate: { key: string; promise: Promise<void> } | undefined;
// the next write rejects with this error, writing nothing
let mockNextWriteFailure: Error | undefined;
// the next read rejects with this error
let mockNextReadFailure: Error | undefined;
// writes and deletes of these exact keys reject, changing nothing (a crash at that point)
const mockFailingKeys = new Set<string>();

jest.mock('expo-secure-store', () => ({
  // stands in for the keychain constant (the factory runs before this file's constants exist)
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: (key: string, options?: SecureStoreOptions) => {
    mockOptions.push(options);
    const failure = mockNextReadFailure;
    if (failure) {
      mockNextReadFailure = undefined;
      return Promise.reject(failure);
    }
    return Promise.resolve(mockStore.get(key) ?? null);
  },
  setItemAsync: (key: string, value: string, options?: SecureStoreOptions) => {
    mockOptions.push(options);
    const failure = mockNextWriteFailure;
    if (failure) {
      mockNextWriteFailure = undefined;
      return Promise.reject(failure);
    }
    if (mockFailingKeys.has(key)) return Promise.reject(new Error(`write to ${key} failed`));
    const write = () => {
      mockStore.set(key, value);
    };
    if (mockGate?.key === key) return mockGate.promise.then(write);
    write();
    return Promise.resolve();
  },
  deleteItemAsync: (key: string, options?: SecureStoreOptions) => {
    mockOptions.push(options);
    if (mockFailingKeys.has(key)) return Promise.reject(new Error(`delete of ${key} failed`));
    mockStore.delete(key);
    return Promise.resolve();
  },
}));

const KEY = 'sb-auth-token';
const utf8Bytes = (value: string): number => new TextEncoder().encode(value).length;

const captureError = jest.fn<ErrorReporter['captureError']>();
const createStorage = () => createSecureSessionStorage({ captureError });

// the keys of the store, sorted
const storedKeys = (): string[] => [...mockStore.keys()].sort();

// enough turns of the microtask queue for every unblocked storage call to settle
const MICROTASK_TURNS = 50;
const flushMicrotasks = async (): Promise<void> => {
  for (let turn = 0; turn < MICROTASK_TURNS; turn += 1) {
    await Promise.resolve();
  }
};

// holds the writes to one key until release is called
const gateWritesTo = (key: string): { release: () => void } => {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  mockGate = { key, promise };
  return { release };
};

// settles in the background; settled turns true once it does, whatever the outcome
const track = <T>(promise: Promise<T>): { promise: Promise<T>; settled: () => boolean } => {
  let settled = false;
  const done = (): void => {
    settled = true;
  };
  promise.then(done, done);
  return { promise, settled: () => settled };
};

beforeEach(() => {
  mockStore.clear();
  mockOptions.length = 0;
  mockGate = undefined;
  mockNextWriteFailure = undefined;
  mockNextReadFailure = undefined;
  mockFailingKeys.clear();
  captureError.mockReset();
});

describe('createSecureSessionStorage', () => {
  it('round-trips a short value as one chunk and its header', async () => {
    const storage = createStorage();

    await storage.setItem(KEY, '{"access_token":"a"}');

    expect(await storage.getItem(KEY)).toBe('{"access_token":"a"}');
    expect(storedKeys()).toStrictEqual([KEY, `${KEY}.0.0`]);
    expect(mockStore.get(KEY)).toBe('0:1');
  });

  it('returns null for a key never written', async () => {
    expect(await createStorage().getItem(KEY)).toBeNull();
  });

  it('splits a long value into chunks of at most the byte limit', async () => {
    const value = 'a'.repeat(MAX_CHUNK_BYTES * 2 + 1);

    await createStorage().setItem(KEY, value);

    expect(mockStore.get(KEY)).toBe('0:3');
    expect(mockStore.get(`${KEY}.0.2`)).toBe('a');
    expect(await createStorage().getItem(KEY)).toBe(value);
  });

  it.each([
    ['exactly the byte limit', 'a'.repeat(MAX_CHUNK_BYTES), '0:1'],
    ['one byte over the limit', 'a'.repeat(MAX_CHUNK_BYTES + 1), '0:2'],
    ['2-byte characters filling the limit exactly', 'é'.repeat(MAX_CHUNK_BYTES / 2), '0:1'],
    ['4-byte emoji filling the limit exactly', '😀'.repeat(MAX_CHUNK_BYTES / 4), '0:1'],
    ['an emoji one byte past the limit', `${'😀'.repeat(MAX_CHUNK_BYTES / 4 - 1)}abc😀`, '0:2'],
  ])('stores a value of %s under the header %s', async (_, value, header) => {
    const storage = createStorage();

    await storage.setItem(KEY, value);

    expect(mockStore.get(KEY)).toBe(header);
    expect(await storage.getItem(KEY)).toBe(value);
  });

  it('round-trips an empty value', async () => {
    const storage = createStorage();

    await storage.setItem(KEY, '');

    expect(mockStore.get(KEY)).toBe('0:1');
    expect(await storage.getItem(KEY)).toBe('');
  });

  it.each([
    ['2-byte', 'é'],
    ['3-byte', '続'],
    ['4-byte emoji (surrogate pair)', '😀'],
  ])('never cuts a %s character at a chunk boundary', async (_, character) => {
    // one ascii byte shifts every character across the boundary
    const value = `x${character.repeat(MAX_CHUNK_BYTES)}`;
    const storage = createStorage();

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

  it('alternates the generation and deletes the chunks of the previous value', async () => {
    const storage = createStorage();
    await storage.setItem(KEY, 'a'.repeat(MAX_CHUNK_BYTES * 3));

    await storage.setItem(KEY, 'short');

    expect(storedKeys()).toStrictEqual([KEY, `${KEY}.1.0`]);
    expect(mockStore.get(KEY)).toBe('1:1');
    expect(await storage.getItem(KEY)).toBe('short');

    await storage.setItem(KEY, 'again');

    expect(storedKeys()).toStrictEqual([KEY, `${KEY}.0.0`]);
    expect(await storage.getItem(KEY)).toBe('again');
  });

  it('fails closed on a header in the f-09 format, then deletes its chunks on the next write', async () => {
    mockStore.set(KEY, '2');
    mockStore.set(`${KEY}.0`, 'old');
    mockStore.set(`${KEY}.1`, 'old');
    mockStore.set(`${KEY}.${String(MAX_CHUNKS - 1)}`, 'old');
    const storage = createStorage();

    expect(await storage.getItem(KEY)).toBeNull();

    await storage.setItem(KEY, 'short');

    expect(storedKeys()).toStrictEqual([KEY, `${KEY}.0.0`]);
    expect(await storage.getItem(KEY)).toBe('short');
  });

  it('deletes the leftover chunks of both generations when the header is invalid', async () => {
    mockStore.set(KEY, 'corrupt');
    mockStore.set(`${KEY}.0.0`, 'old');
    mockStore.set(`${KEY}.1.${String(MAX_CHUNKS - 1)}`, 'old');

    await createStorage().setItem(KEY, 'short');

    expect(storedKeys()).toStrictEqual([KEY, `${KEY}.0.0`]);
    expect(mockStore.get(`${KEY}.0.0`)).toBe('short');
  });

  it('fails closed when a chunk is missing', async () => {
    const storage = createStorage();
    await storage.setItem(KEY, 'a'.repeat(MAX_CHUNK_BYTES * 2));
    mockStore.delete(`${KEY}.0.1`);

    expect(await storage.getItem(KEY)).toBeNull();
  });

  it.each(['0:0', '1:-1', '2:1', '0:1.5', 'abc', '', '1', `0:${String(MAX_CHUNKS + 1)}`, ' 0:1'])(
    'fails closed when the stored header is %j',
    async (header) => {
      mockStore.set(`${KEY}.0.0`, 'chunk');
      mockStore.set(`${KEY}.1.0`, 'chunk');
      mockStore.set(`${KEY}.0`, 'chunk');
      mockStore.set(KEY, header);

      expect(await createStorage().getItem(KEY)).toBeNull();
    },
  );

  it('removeItem clears the header and every chunk', async () => {
    const storage = createStorage();
    await storage.setItem(KEY, 'a'.repeat(MAX_CHUNK_BYTES * 2 + 1));

    await storage.removeItem(KEY);

    expect(mockStore.size).toBe(0);
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it('removeItem clears every possible chunk, f-09 ones included, when the header is invalid', async () => {
    mockStore.set(`${KEY}.0`, 'chunk');
    mockStore.set(`${KEY}.0.5`, 'chunk');
    mockStore.set(`${KEY}.1.${String(MAX_CHUNKS - 1)}`, 'chunk');
    mockStore.set(KEY, 'corrupt');

    await createStorage().removeItem(KEY);

    expect(mockStore.size).toBe(0);
  });

  it('removeItem deletes the header first and reports a failed chunk deletion', async () => {
    const storage = createStorage();
    await storage.setItem(KEY, 'value');
    mockFailingKeys.add(`${KEY}.0.0`);

    await storage.removeItem(KEY);

    expect(await storage.getItem(KEY)).toBeNull();
    expect(storedKeys()).toStrictEqual([`${KEY}.0.0`]);
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), { source: 'secure-session' });
  });

  it.each(['', 'has space', 'slash/key', 'é', 'dotted.key'])(
    'rejects the invalid key %j',
    async (key) => {
      const storage = createStorage();

      await expect(storage.getItem(key)).rejects.toThrow(TypeError);
      await expect(storage.setItem(key, 'value')).rejects.toThrow(TypeError);
      await expect(storage.removeItem(key)).rejects.toThrow(TypeError);
      expect(mockStore.size).toBe(0);
    },
  );

  it('rejects a value needing more than the chunk limit, writing nothing', async () => {
    const storage = createStorage();

    await expect(
      storage.setItem(KEY, 'a'.repeat(MAX_CHUNK_BYTES * MAX_CHUNKS + 1)),
    ).rejects.toThrow(RangeError);
    expect(mockStore.size).toBe(0);
  });

  it('passes the keychain accessibility on every call', async () => {
    const storage = createStorage();
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
    await createStorage().setItem(KEY, 'a'.repeat(MAX_CHUNK_BYTES + 1));

    expect(storedKeys()).toStrictEqual([KEY, `${KEY}.0.0`, `${KEY}.0.1`]);
  });
});

describe('createSecureSessionStorage crash safety', () => {
  const OLD_VALUE = 'a'.repeat(MAX_CHUNK_BYTES * 2 + 1);
  const NEW_VALUE = 'b'.repeat(MAX_CHUNK_BYTES + 1);

  it('keeps the whole old value after an overwrite that failed part-way', async () => {
    const storage = createStorage();
    await storage.setItem(KEY, OLD_VALUE);
    // the first chunk write fails, the second lands
    mockNextWriteFailure = new Error('keychain unavailable');

    await expect(storage.setItem(KEY, NEW_VALUE)).rejects.toThrow('keychain unavailable');

    expect(mockStore.get(`${KEY}.1.1`)).toBe('b');
    expect(await storage.getItem(KEY)).toBe(OLD_VALUE);
  });

  it('keeps the whole old value when the write stops before the header', async () => {
    const storage = createStorage();
    await storage.setItem(KEY, OLD_VALUE);
    mockFailingKeys.add(KEY);

    await expect(storage.setItem(KEY, NEW_VALUE)).rejects.toThrow(`write to ${KEY} failed`);

    expect(mockStore.get(KEY)).toBe('0:3');
    expect(mockStore.get(`${KEY}.1.0`)).toBe('b'.repeat(MAX_CHUNK_BYTES));
    expect(await storage.getItem(KEY)).toBe(OLD_VALUE);
  });

  it('returns the new value and reports the error when deleting the old chunks fails', async () => {
    const storage = createStorage();
    await storage.setItem(KEY, OLD_VALUE);
    mockFailingKeys.add(`${KEY}.0.2`);

    await storage.setItem(KEY, NEW_VALUE);

    expect(await storage.getItem(KEY)).toBe(NEW_VALUE);
    expect(storedKeys()).toStrictEqual([KEY, `${KEY}.0.2`, `${KEY}.1.0`, `${KEY}.1.1`]);
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), { source: 'secure-session' });
  });

  it('deletes the leftovers of failed writes and cleanups on the next write', async () => {
    const storage = createStorage();
    await storage.setItem(KEY, OLD_VALUE);
    mockFailingKeys.add(`${KEY}.0.2`);
    await storage.setItem(KEY, NEW_VALUE);
    mockFailingKeys.clear();
    // a failed write leaves chunks of generation 0 next to the leftover
    mockFailingKeys.add(KEY);
    await expect(storage.setItem(KEY, OLD_VALUE)).rejects.toThrow();
    mockFailingKeys.clear();

    await storage.setItem(KEY, 'short');

    expect(storedKeys()).toStrictEqual([KEY, `${KEY}.0.0`]);
    expect(await storage.getItem(KEY)).toBe('short');
  });

  it('waits for every chunk write before rejecting a failed write', async () => {
    const storage = createStorage();
    await storage.setItem(KEY, OLD_VALUE);
    mockNextWriteFailure = new Error('keychain unavailable');
    const gate = gateWritesTo(`${KEY}.1.1`);

    const write = track(storage.setItem(KEY, NEW_VALUE));
    await flushMicrotasks();

    expect(write.settled()).toBe(false);
    gate.release();
    await expect(write.promise).rejects.toThrow('keychain unavailable');
    expect(await storage.getItem(KEY)).toBe(OLD_VALUE);
  });
});

describe('createSecureSessionStorage call queue', () => {
  const OLD_VALUE = 'a'.repeat(MAX_CHUNK_BYTES * 2 + 1);
  const NEW_VALUE = 'b'.repeat(MAX_CHUNK_BYTES + 1);

  it('makes a read wait for an overwrite in progress: it sees the full new value', async () => {
    const storage = createStorage();
    await storage.setItem(KEY, OLD_VALUE);
    // the new chunks land, the header write is held
    const gate = gateWritesTo(KEY);

    const write = track(storage.setItem(KEY, NEW_VALUE));
    const read = track(storage.getItem(KEY));
    await flushMicrotasks();

    expect(mockStore.get(`${KEY}.1.0`)).toBe('b'.repeat(MAX_CHUNK_BYTES));
    expect(mockStore.get(KEY)).toBe('0:3');
    expect(write.settled()).toBe(false);
    expect(read.settled()).toBe(false);

    gate.release();

    await write.promise;
    expect(await read.promise).toBe(NEW_VALUE);
    expect(await storage.getItem(KEY)).toBe(NEW_VALUE);
    expect(mockStore.get(KEY)).toBe('1:2');
  });

  it('serves a read queued before an overwrite with the full old value, keeping the session', async () => {
    const storage = createStorage();
    await storage.setItem(KEY, OLD_VALUE);

    const read = storage.getItem(KEY);
    const write = storage.setItem(KEY, NEW_VALUE);

    expect(await read).toBe(OLD_VALUE);
    await write;
    expect(await storage.getItem(KEY)).toBe(NEW_VALUE);
  });

  it('rejects a failed call with its own error and runs the next call on the key', async () => {
    const storage = createStorage();
    await storage.setItem(KEY, OLD_VALUE);
    // the overwrite reads the previous header first: it fails before writing anything
    const failure = new Error('keychain unavailable');
    mockNextReadFailure = failure;

    const failed = storage.setItem(KEY, NEW_VALUE);
    const next = storage.getItem(KEY);

    await expect(failed).rejects.toBe(failure);
    // nothing was written: the old value is still whole
    expect(await next).toBe(OLD_VALUE);
    await storage.setItem(KEY, NEW_VALUE);
    expect(await storage.getItem(KEY)).toBe(NEW_VALUE);
  });

  it('lets a removal clear the value after a failed write on the key', async () => {
    const storage = createStorage();
    await storage.setItem(KEY, OLD_VALUE);
    mockNextWriteFailure = new Error('first write fails');

    await expect(storage.setItem(KEY, NEW_VALUE)).rejects.toThrow('first write fails');
    await storage.removeItem(KEY);

    expect(await storage.getItem(KEY)).toBeNull();
    expect(mockStore.size).toBe(0);
  });

  it('does not make calls on another key wait', async () => {
    const OTHER_KEY = 'other-key';
    const storage = createStorage();
    await storage.setItem(OTHER_KEY, 'other');
    const gate = gateWritesTo(KEY);

    const blocked = track(storage.setItem(KEY, NEW_VALUE));
    const otherRead = track(storage.getItem(OTHER_KEY));
    const otherWrite = track(storage.setItem(OTHER_KEY, 'changed'));
    await flushMicrotasks();

    expect(blocked.settled()).toBe(false);
    expect(otherRead.settled()).toBe(true);
    expect(otherWrite.settled()).toBe(true);
    expect(await otherRead.promise).toBe('other');
    expect(await storage.getItem(OTHER_KEY)).toBe('changed');

    gate.release();
    await blocked.promise;
    expect(await storage.getItem(KEY)).toBe(NEW_VALUE);
  });
});
