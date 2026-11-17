import type { ErrorReporter } from '@core/errors/error-reporter';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { createSecureSessionStorage, MAX_CHUNK_BYTES, MAX_CHUNKS } from './secure-session';
import { DISCARD_FAILED_MESSAGE } from './secure-session-sweep';

type Operation = 'get' | 'set' | 'delete';

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

const mockCall = <T>(operation: Operation, key: string, apply: () => T): Promise<T> => {
  mockCalls.push(`${operation} ${key}`);
  if (mockFailing[operation].has(key)) {
    // the failure quotes what the store holds: a report holding it would leak the session
    const held = [...mockStore.values()].join(',');
    return Promise.reject(new Error(`${operation} of ${key} failed near ${held}`));
  }
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
// a session of three chunks, stored before the reinstall; low-entropy placeholder
const STALE_MARK = 'stale-session';
const STALE_VALUE = `${STALE_MARK}-${'s'.repeat(MAX_CHUNK_BYTES * 2)}`;
const STALE_CHUNKS = [`${KEY}.0.0`, `${KEY}.0.1`, `${KEY}.0.2`];
const NEW_VALUE = 'n'.repeat(MAX_CHUNK_BYTES + 1);
const NEW_CHUNKS = [`${KEY}.0.0`, `${KEY}.0.1`];
// the keys auth-js derives from the session key for pkce: the fixed verifier, the flow index, a
// flow's verifier slot
const VERIFIER_KEYS = [
  `${KEY}-code-verifier`,
  `${KEY}-flows-code-verifier`,
  `${KEY}-flow-0123abcd-code-verifier`,
];
// both generations, the f-09 chunks, the marker: what a discard deletes after the header
const DISCARD_DELETIONS = MAX_CHUNKS * 3 + 1;

const captureError = jest.fn<ErrorReporter['captureError']>();
// a new storage instance is a new app process
const launch = () => createSecureSessionStorage({ captureError });
const launchDiscarding = () =>
  createSecureSessionStorage({ captureError }, { discardStored: true });

const storedKeys = (): string[] => [...mockStore.keys()].sort();
const position = (call: string): number => mockCalls.indexOf(call);
const deletions = (): string[] => mockCalls.filter((call) => call.startsWith('delete '));

// a previous install's session, with a leftover of each kind a discard must also remove
const seedStaleSession = async (): Promise<void> => {
  await launch().setItem(KEY, STALE_VALUE);
  mockStore.set(MARKER, '1');
  mockStore.set(`${KEY}.1.${String(MAX_CHUNKS - 1)}`, STALE_MARK);
  mockStore.set(`${KEY}.${String(MAX_CHUNKS - 1)}`, STALE_MARK);
  mockCalls.length = 0;
};

// the one report of a failed discard: a fixed error, no cause, nothing stored quoted
const expectOneFixedReport = (): void => {
  expect(captureError).toHaveBeenCalledTimes(1);
  const [error, context] = captureError.mock.calls[0] ?? [];
  expect(context).toStrictEqual({ source: 'secure-session' });
  expect(error).toBeInstanceOf(Error);
  expect(error instanceof Error ? error.message : undefined).toBe(DISCARD_FAILED_MESSAGE);
  expect(error).not.toHaveProperty('cause');
  expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(STALE_MARK);
};

beforeEach(() => {
  mockStore.clear();
  mockCalls.length = 0;
  for (const keys of Object.values(mockFailing)) keys.clear();
  captureError.mockReset();
});

describe('createSecureSessionStorage, discardStored', () => {
  it('discards a stored session on its first read: null, nothing left under the key', async () => {
    await seedStaleSession();

    expect(await launchDiscarding().getItem(KEY)).toBeNull();

    expect(storedKeys()).toStrictEqual([]);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('deletes the header before any chunk, then every chunk key, the marker last', async () => {
    await seedStaleSession();

    await launchDiscarding().getItem(KEY);

    expect(position(`delete ${KEY}`)).toBeLessThan(position(`delete ${KEY}.0.0`));
    expect(deletions()).toHaveLength(DISCARD_DELETIONS + 1);
    expect(deletions().at(-1)).toBe(`delete ${MARKER}`);
  });

  it.each(VERIFIER_KEYS)('discards the pkce key %s on its first access', async (key) => {
    await launch().setItem(key, STALE_VALUE);

    expect(await launchDiscarding().getItem(key)).toBeNull();

    expect(storedKeys()).toStrictEqual([]);
  });

  it('costs a key holding nothing a marker and a header read, no deletion', async () => {
    expect(await launchDiscarding().getItem(KEY)).toBeNull();

    // the discard's two reads, then the read itself
    expect(mockCalls).toStrictEqual([`get ${MARKER}`, `get ${KEY}`, `get ${KEY}`]);
  });

  it('discards once per key per process: what the process writes is read back', async () => {
    await seedStaleSession();
    const storage = launchDiscarding();

    await storage.setItem(KEY, NEW_VALUE);

    expect(await storage.getItem(KEY)).toBe(NEW_VALUE);
    expect(await launch().getItem(KEY)).toBe(NEW_VALUE);
    expect(storedKeys()).toStrictEqual([KEY, ...NEW_CHUNKS]);
    expect(mockCalls.filter((call) => call === `delete ${KEY}`)).toHaveLength(1);
  });

  it('discards inside the key queue: a write queued with the first read waits for it', async () => {
    await seedStaleSession();
    const storage = launchDiscarding();

    const read = storage.getItem(KEY);
    const write = storage.setItem(KEY, NEW_VALUE);

    expect(await read).toBeNull();
    await write;
    expect(position(`delete ${MARKER}`)).toBeLessThan(position(`set ${MARKER}`));
    expect(await storage.getItem(KEY)).toBe(NEW_VALUE);
  });

  it('leaves the keys this process never accesses as they are', async () => {
    await seedStaleSession();
    const [verifier = ''] = VERIFIER_KEYS;
    await launch().setItem(verifier, STALE_VALUE);

    await launchDiscarding().getItem(verifier);

    expect(mockStore.get(KEY)).toBe('0:3');
    expect(storedKeys()).toContain(STALE_CHUNKS[0]);
  });
});

describe('createSecureSessionStorage, a discard that fails', () => {
  it('fails a read closed, reported with a fixed error, and tries again at the next access', async () => {
    await seedStaleSession();
    mockFailing.delete.add(KEY);
    const storage = launchDiscarding();

    expect(await storage.getItem(KEY)).toBeNull();

    expectOneFixedReport();
    expect(mockStore.get(KEY)).toBe('0:3');
    mockFailing.delete.clear();

    expect(await storage.getItem(KEY)).toBeNull();

    expect(storedKeys()).toStrictEqual([]);
    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it('sweeps every chunk key again after a failure past the header', async () => {
    // a clean key: no marker to tell the next try that chunks are left
    await launch().setItem(KEY, STALE_VALUE);
    mockFailing.delete.add(`${KEY}.0.1`);
    const storage = launchDiscarding();

    expect(await storage.getItem(KEY)).toBeNull();

    expect(storedKeys()).toStrictEqual([`${KEY}.0.1`]);
    mockFailing.delete.clear();
    mockCalls.length = 0;

    expect(await storage.getItem(KEY)).toBeNull();

    // no header and no marker left, swept all the same
    expect(deletions()).toContain(`delete ${KEY}.0.1`);
    expect(storedKeys()).toStrictEqual([]);
    expectOneFixedReport();
  });

  it.each<[string, (storage: ReturnType<typeof launch>) => Promise<void>, string | null]>([
    ['a write', (storage) => storage.setItem(KEY, NEW_VALUE), NEW_VALUE],
    ['a removal', (storage) => storage.removeItem(KEY), null],
  ])(
    'rejects %s with the fixed error, changing nothing, then lets the next try run',
    async (_, call, expected) => {
      await seedStaleSession();
      mockFailing.get.add(MARKER);
      const storage = launchDiscarding();
      const before = new Map(mockStore);

      await expect(call(storage)).rejects.toThrow(DISCARD_FAILED_MESSAGE);

      expect(mockStore).toStrictEqual(before);
      expectOneFixedReport();
      mockFailing.get.clear();

      await call(storage);

      expect(await storage.getItem(KEY)).toBe(expected);
      expect(storedKeys()).not.toContain(`${KEY}.1.${String(MAX_CHUNKS - 1)}`);
    },
  );
});

describe('createSecureSessionStorage, discardStored false', () => {
  it('reads what is stored, with the marker check only, as without options', async () => {
    await launch().setItem(KEY, STALE_VALUE);
    mockCalls.length = 0;

    expect(
      await createSecureSessionStorage({ captureError }, { discardStored: false }).getItem(KEY),
    ).toBe(STALE_VALUE);

    expect(mockCalls).toStrictEqual([MARKER, KEY, ...STALE_CHUNKS].map((key) => `get ${key}`));
    expect(storedKeys()).toStrictEqual([KEY, ...STALE_CHUNKS]);
  });
});
