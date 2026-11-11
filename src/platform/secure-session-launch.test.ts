import type { ErrorReporter } from '@core/errors/error-reporter';
import type { SessionStorage } from '@core/repositories/session-storage';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { createSecureSessionStorage, MAX_CHUNK_BYTES, MAX_CHUNKS } from './secure-session';

type Operation = 'get' | 'set' | 'delete';
// the secure-store call during which the app process dies: it lands or not, then no call settles
type Kill = { operation: Operation; key: string; lands: boolean };

// an in-memory secure-store
const mockStore = new Map<string, string>();
// every call, in order, as "<operation> <key>"
const mockCalls: string[] = [];
// calls on these keys reject, changing nothing
const mockFailing: Record<Operation, Set<string>> = {
  get: new Set(),
  set: new Set(),
  delete: new Set(),
};
let mockKill: Kill | undefined;
let mockKilled = false;
// a deletion of this key waits for the promise (queue tests)
let mockHeld: { key: string; promise: Promise<void> } | undefined;

const mockCall = <T>(operation: Operation, key: string, apply: () => T): Promise<T> => {
  mockCalls.push(`${operation} ${key}`);
  const killed = mockKilled || (mockKill?.operation === operation && mockKill.key === key);
  if (killed) {
    if (!mockKilled && mockKill?.lands === true) apply();
    mockKilled = true;
    return new Promise<T>(() => undefined);
  }
  if (mockFailing[operation].has(key)) {
    return Promise.reject(new Error(`${operation} of ${key} failed`));
  }
  if (operation === 'delete' && mockHeld?.key === key) return mockHeld.promise.then(apply);
  return Promise.resolve(apply());
};

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: (key: string) => mockCall('get', key, () => mockStore.get(key) ?? null),
  setItemAsync: (key: string, value: string) =>
    mockCall('set', key, () => {
      mockStore.set(key, value);
    }),
  deleteItemAsync: (key: string) =>
    mockCall('delete', key, () => {
      mockStore.delete(key);
    }),
}));

const KEY = 'sb-auth-token';
const MARKER = `${KEY}.pending`;
// three chunks, then two
const OLD_VALUE = 'a'.repeat(MAX_CHUNK_BYTES * 2 + 1);
const NEW_VALUE = 'b'.repeat(MAX_CHUNK_BYTES + 1);
const OLD_CHUNKS = [`${KEY}.0.0`, `${KEY}.0.1`, `${KEY}.0.2`];
const NEW_CHUNKS = [`${KEY}.1.0`, `${KEY}.1.1`];
const KILL_BEFORE_HEADER: Kill = { operation: 'set', key: KEY, lands: false };
const KILL_AFTER_HEADER: Kill = { operation: 'set', key: KEY, lands: true };

const captureError = jest.fn<ErrorReporter['captureError']>();
// a new storage instance is a new app process
const launch = () => createSecureSessionStorage({ captureError });

const storedKeys = (): string[] => [...mockStore.keys()].sort();

// enough turns of the microtask queue for every unblocked storage call to settle
const MICROTASK_TURNS = 50;
const flushMicrotasks = async (): Promise<void> => {
  for (let turn = 0; turn < MICROTASK_TURNS; turn += 1) {
    await Promise.resolve();
  }
};

// stores the old value, runs the call until the process dies at the kill point, then launches again
const relaunchAfterKill = async (
  call: (storage: SessionStorage) => Promise<void>,
  kill: Kill,
): Promise<SessionStorage> => {
  const killedProcess = launch();
  await killedProcess.setItem(KEY, OLD_VALUE);
  mockKill = kill;
  void call(killedProcess);
  await flushMicrotasks();
  mockKill = undefined;
  mockKilled = false;
  mockCalls.length = 0;
  return launch();
};

const overwrite = (storage: SessionStorage) => storage.setItem(KEY, NEW_VALUE);

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
  mockCalls.length = 0;
  for (const keys of Object.values(mockFailing)) keys.clear();
  mockKill = undefined;
  mockKilled = false;
  mockHeld = undefined;
  captureError.mockReset();
});

describe('createSecureSessionStorage after a kill', () => {
  // the kill point, then the new chunks the killed write left
  it.each<[string, Kill, readonly string[]]>([
    ['after the chunk writes, before the header write', KILL_BEFORE_HEADER, NEW_CHUNKS],
    [
      'during the chunk writes',
      { operation: 'set', key: `${KEY}.1.1`, lands: false },
      [`${KEY}.1.0`],
    ],
  ])('sweeps a write killed %s at the next launch', async (_, kill, leftovers) => {
    const next = await relaunchAfterKill(overwrite, kill);
    expect(storedKeys()).toStrictEqual([KEY, ...OLD_CHUNKS, ...leftovers, MARKER].sort());

    expect(await next.getItem(KEY)).toBe(OLD_VALUE);

    expect(storedKeys()).toStrictEqual([KEY, ...OLD_CHUNKS]);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('sweeps the previous value at the next launch after a kill before the cleanup', async () => {
    const next = await relaunchAfterKill(overwrite, KILL_AFTER_HEADER);
    expect(storedKeys()).toStrictEqual([KEY, ...OLD_CHUNKS, ...NEW_CHUNKS, MARKER].sort());

    expect(await next.getItem(KEY)).toBe(NEW_VALUE);

    expect(storedKeys()).toStrictEqual([KEY, ...NEW_CHUNKS]);
  });

  it('sweeps every chunk key the header does not point to, past its count and f-09 ones too', async () => {
    const next = await relaunchAfterKill(overwrite, KILL_BEFORE_HEADER);
    const strays = [`${KEY}.0.${String(MAX_CHUNKS - 1)}`, `${KEY}.1.5`, `${KEY}.3`];
    for (const stray of strays) mockStore.set(stray, 'stray');

    expect(await next.getItem(KEY)).toBe(OLD_VALUE);

    expect(storedKeys()).toStrictEqual([KEY, ...OLD_CHUNKS]);
  });

  it('sweeps the chunks of a removal killed after the header deletion', async () => {
    const next = await relaunchAfterKill((storage) => storage.removeItem(KEY), {
      operation: 'delete',
      key: KEY,
      lands: true,
    });
    expect(storedKeys()).toStrictEqual([...OLD_CHUNKS, MARKER]);

    expect(await next.getItem(KEY)).toBeNull();

    expect(storedKeys()).toStrictEqual([]);
  });

  it('reports a failed sweep deletion, still reads the value, and sweeps at the next write', async () => {
    const next = await relaunchAfterKill(overwrite, KILL_AFTER_HEADER);
    mockFailing.delete.add(`${KEY}.0.1`);

    expect(await next.getItem(KEY)).toBe(NEW_VALUE);

    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), { source: 'secure-session' });
    // the chunk that failed and the marker stay
    expect(storedKeys()).toStrictEqual([KEY, `${KEY}.0.1`, ...NEW_CHUNKS, MARKER]);
    mockFailing.delete.clear();

    await next.setItem(KEY, 'short');

    expect(storedKeys()).toStrictEqual([KEY, `${KEY}.0.0`]);
  });

  it('reports a failed marker read, still reads the value, and sweeps at the next write', async () => {
    const next = await relaunchAfterKill(overwrite, KILL_AFTER_HEADER);
    mockFailing.get.add(MARKER);

    expect(await next.getItem(KEY)).toBe(NEW_VALUE);

    expect(captureError).toHaveBeenCalledTimes(1);
    mockFailing.get.clear();

    await next.setItem(KEY, 'short');

    expect(storedKeys()).toStrictEqual([KEY, `${KEY}.0.0`]);
  });

  it('sweeps once per process: later calls neither read the marker nor sweep', async () => {
    const next = await relaunchAfterKill(overwrite, KILL_AFTER_HEADER);
    await next.getItem(KEY);
    mockCalls.length = 0;

    await next.getItem(KEY);
    await next.setItem(KEY, 'again');

    expect(mockCalls).not.toContain(`get ${MARKER}`);
    // the targeted cleanup of the previous value only, then the marker
    const deletions = mockCalls.filter((call) => call.startsWith('delete '));
    expect(deletions).toStrictEqual([...NEW_CHUNKS, MARKER].map((key) => `delete ${key}`));
  });

  it('costs one marker read at a launch without a marker, and sweeps nothing', async () => {
    await launch().setItem(KEY, OLD_VALUE);
    mockCalls.length = 0;

    expect(await launch().getItem(KEY)).toBe(OLD_VALUE);

    expect(mockCalls).toStrictEqual([MARKER, KEY, ...OLD_CHUNKS].map((key) => `get ${key}`));
  });

  it('sweeps inside the key queue, before a write queued with the first read', async () => {
    const next = await relaunchAfterKill(overwrite, KILL_AFTER_HEADER);
    let release = (): void => undefined;
    mockHeld = {
      key: `${KEY}.0.0`,
      promise: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };

    const read = track(next.getItem(KEY));
    const write = track(next.setItem(KEY, 'next'));
    await flushMicrotasks();

    // the sweep holds the queue: the read has not read a chunk, the write has written nothing
    expect(read.settled()).toBe(false);
    expect(write.settled()).toBe(false);
    expect(mockCalls).not.toContain(`get ${KEY}.1.0`);
    expect(mockCalls.filter((call) => call.startsWith('set '))).toStrictEqual([]);

    release();

    expect(await read.promise).toBe(NEW_VALUE);
    await write.promise;
    expect(await next.getItem(KEY)).toBe('next');
    expect(storedKeys()).toStrictEqual([KEY, `${KEY}.0.0`]);
  });
});
