import type { ErrorReporter } from '@core/errors/error-reporter';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { createSecureSessionStorage } from './secure-session';

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
    return Promise.reject(new Error(`${operation} of ${key} failed`));
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

const captureError = jest.fn<ErrorReporter['captureError']>();
// a new storage instance is a new app process
const launch = () => createSecureSessionStorage({ captureError });

const storedKeys = (): string[] => [...mockStore.keys()].sort();
const position = (call: string): number => mockCalls.indexOf(call);

beforeEach(() => {
  mockStore.clear();
  mockCalls.length = 0;
  for (const keys of Object.values(mockFailing)) keys.clear();
  captureError.mockReset();
});

describe('createSecureSessionStorage cleanup marker', () => {
  it('costs a write two calls: the marker set before the first chunk, deleted after the cleanup', async () => {
    const storage = launch();
    await storage.setItem(KEY, 'first');
    mockCalls.length = 0;

    await storage.setItem(KEY, 'second');

    expect(mockCalls).toStrictEqual([
      `get ${KEY}`,
      `set ${MARKER}`,
      `set ${KEY}.1.0`,
      `set ${KEY}`,
      `delete ${KEY}.0.0`,
      `delete ${MARKER}`,
    ]);
    expect(storedKeys()).toStrictEqual([KEY, `${KEY}.1.0`]);
  });

  it('sets the marker before a removal deletes the header, and deletes it after the sweep', async () => {
    const storage = launch();
    await storage.setItem(KEY, 'value');
    mockCalls.length = 0;

    await storage.removeItem(KEY);

    expect(position(`set ${MARKER}`)).toBeLessThan(position(`delete ${KEY}`));
    expect(mockCalls.at(-1)).toBe(`delete ${MARKER}`);
    expect(storedKeys()).toStrictEqual([]);
  });

  it('fails a write that cannot set its marker, with nothing written', async () => {
    const storage = launch();
    await storage.setItem(KEY, 'old');
    mockFailing.set.add(MARKER);

    await expect(storage.setItem(KEY, 'new')).rejects.toThrow(`set of ${MARKER} failed`);

    expect(mockCalls).not.toContain(`set ${KEY}.1.0`);
    expect(await storage.getItem(KEY)).toBe('old');
    expect(storedKeys()).toStrictEqual([KEY, `${KEY}.0.0`]);
  });

  it('reports a removal that cannot set its marker, and still removes the value', async () => {
    const storage = launch();
    await storage.setItem(KEY, 'value');
    mockFailing.set.add(MARKER);

    await storage.removeItem(KEY);

    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), { source: 'secure-session' });
    expect(await storage.getItem(KEY)).toBeNull();
    expect(storedKeys()).toStrictEqual([]);
  });

  it('reports a marker it cannot delete, keeps the value, and sweeps once at the next launch', async () => {
    const storage = launch();
    mockFailing.delete.add(MARKER);

    await storage.setItem(KEY, 'value');

    expect(captureError).toHaveBeenCalledTimes(1);
    expect(await storage.getItem(KEY)).toBe('value');
    expect(storedKeys()).toStrictEqual([KEY, `${KEY}.0.0`, MARKER]);
    mockFailing.delete.clear();

    expect(await launch().getItem(KEY)).toBe('value');

    expect(storedKeys()).toStrictEqual([KEY, `${KEY}.0.0`]);
  });

  it('keeps the marker per key: another key is not swept', async () => {
    const OTHER_KEY = 'other-key';
    await launch().setItem(OTHER_KEY, 'other');
    mockStore.set(MARKER, '1');
    mockCalls.length = 0;

    expect(await launch().getItem(OTHER_KEY)).toBe('other');

    expect(mockCalls.filter((call) => call.startsWith('delete '))).toStrictEqual([]);
    expect(mockCalls).not.toContain(`get ${MARKER}`);
  });
});
