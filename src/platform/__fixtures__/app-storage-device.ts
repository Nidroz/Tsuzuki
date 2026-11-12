import { expect, jest } from '@jest/globals';
import type { SecureStoreOptions } from 'expo-secure-store';
import type { Configuration, MMKV } from 'react-native-mmkv';

/**
 * an in-memory device for the app storage tests: mmkv files per instance id (each with the key
 * that wrote it) and the secure store, with failure injection. the tests mock react-native-mmkv
 * and expo-secure-store with the modules below, from a jest.mock factory:
 * `jest.mock('react-native-mmkv', () => jest.requireActual<typeof Device>('./__fixtures__/app-storage-device').fakeMmkvModule())`
 * the files outlive the instances, so calling openAppStorage again is the next launch
 */

// what an existing file opened with another key reads as: mmkv discards a file that fails its
// checks (empty), or decrypts it into values that are not what was written (garbage)
export type WrongKeyRead = 'discard' | 'garbage';

// a value decrypted with the wrong key
export const GARBAGE_VALUE = '\u0000garbage';

// stands in for the keychain constant
export const FAKE_WHEN_UNLOCKED_THIS_DEVICE_ONLY = 7;

type StoredValue = string | number | boolean;

interface FakeFile {
  encryptionKey: string | undefined;
  readonly values: Map<string, StoredValue>;
}

// the instance methods the app storage uses
export type FakeMmkv = Pick<MMKV, 'getString' | 'set' | 'remove' | 'getAllKeys' | 'clearAll'>;

interface Failures {
  secureRead: boolean;
  secureWrite: boolean;
  // instance ids whose createMMKV throws
  readonly create: Set<string>;
  // instance ids whose deleteMMKV throws or returns false, deleting nothing
  readonly delete: Map<string, 'throw' | 'false'>;
  // a set on this instance id throws once this many sets succeeded on it (a kill mid-copy)
  setLimit: { readonly id: string; remaining: number } | undefined;
}

const files = new Map<string, FakeFile>();
const secureItems = new Map<string, string>();
// the native calls in order: secure.get, secure.set, mmkv.exists:<id>, mmkv.create:<id>,
// mmkv.delete:<id>, mmkv.set:<id>:<key>, mmkv.remove:<id>:<key>
const events: string[] = [];
const secureOptions: (SecureStoreOptions | undefined)[] = [];
const configurations: Configuration[] = [];
// the values seeded and the values written to the secure store, for knownSecrets
const seededSecrets = new Set<string>();
const writtenSecureValues = new Set<string>();
const failures: Failures = {
  secureRead: false,
  secureWrite: false,
  create: new Set(),
  delete: new Map(),
  setLimit: undefined,
};
let wrongKeyRead: WrongKeyRead = 'discard';
// the instances created per id, destroyed by a deletion like the native ones
const openInstances = new Map<string, { destroyed: boolean }[]>();

export const device = { files, secureItems, events, secureOptions, configurations, failures };

/** a fresh device: no file, no secure item, no failure, no recorded call. */
export const resetDevice = (): void => {
  files.clear();
  secureItems.clear();
  events.length = 0;
  secureOptions.length = 0;
  configurations.length = 0;
  seededSecrets.clear();
  writtenSecureValues.clear();
  failures.secureRead = false;
  failures.secureWrite = false;
  failures.create.clear();
  failures.delete.clear();
  failures.setLimit = undefined;
  wrongKeyRead = 'discard';
  openInstances.clear();
};

export const setWrongKeyRead = (read: WrongKeyRead): void => {
  wrongKeyRead = read;
};

/** writes a file as a previous launch left it. */
export const seedFile = (
  id: string,
  encryptionKey: string | undefined,
  values: Readonly<Record<string, StoredValue>>,
): void => {
  files.set(id, { encryptionKey, values: new Map(Object.entries(values)) });
  for (const value of [encryptionKey, ...Object.values(values)]) {
    if (typeof value === 'string') seededSecrets.add(value);
  }
};

/** stores a value in the secure store, as a previous launch left it. */
export const seedSecureItem = (key: string, value: string): void => {
  seededSecrets.add(value);
  secureItems.set(key, value);
};

/** the string values of a file, or undefined when it does not exist. */
export const fileValues = (id: string): Record<string, StoredValue> | undefined => {
  const file = files.get(id);
  return file === undefined ? undefined : Object.fromEntries(file.values);
};

const openFile = (configuration: Configuration): FakeFile => {
  const file = files.get(configuration.id);
  if (file === undefined) {
    const created: FakeFile = { encryptionKey: configuration.encryptionKey, values: new Map() };
    files.set(configuration.id, created);
    return created;
  }
  if (file.encryptionKey !== configuration.encryptionKey) {
    for (const key of file.values.keys()) {
      if (wrongKeyRead === 'discard') file.values.delete(key);
      else file.values.set(key, GARBAGE_VALUE);
    }
    file.encryptionKey = configuration.encryptionKey;
  }
  return file;
};

const checkSetLimit = (id: string, key: string): void => {
  const limit = failures.setLimit;
  if (limit?.id !== id) return;
  if (limit.remaining === 0) throw new Error(`mmkv write of ${key} failed`);
  limit.remaining -= 1;
};

const createInstance = (configuration: Configuration): FakeMmkv => {
  const { id } = configuration;
  events.push(`mmkv.create:${id}`);
  configurations.push(configuration);
  if (failures.create.has(id))
    throw new Error(`cannot open ${id} with ${String(configuration.encryptionKey)}`);
  const file = openFile(configuration);
  const handle = { destroyed: false };
  openInstances.set(id, [...(openInstances.get(id) ?? []), handle]);
  // a destroyed native instance is a dangling pointer: any use is a test failure
  const live = (): FakeFile => {
    if (handle.destroyed) throw new Error(`instance ${id} used after its deletion`);
    return file;
  };
  return {
    getString: (key) => {
      const value = live().values.get(key);
      return typeof value === 'string' ? value : undefined;
    },
    set: (key, value) => {
      const target = live();
      checkSetLimit(id, key);
      if (typeof value === 'object') throw new TypeError('buffers are not modelled');
      events.push(`mmkv.set:${id}:${key}`);
      target.values.set(key, value);
    },
    remove: (key) => {
      const target = live();
      events.push(`mmkv.remove:${id}:${key}`);
      return target.values.delete(key);
    },
    getAllKeys: () => [...live().values.keys()],
    clearAll: () => {
      live().values.clear();
    },
  };
};

const deleteInstance = (id: string): boolean => {
  events.push(`mmkv.delete:${id}`);
  const failure = failures.delete.get(id);
  if (failure === 'throw') throw new Error(`cannot delete ${id}`);
  if (failure === 'false') return false;
  files.delete(id);
  for (const handle of openInstances.get(id) ?? []) handle.destroyed = true;
  openInstances.delete(id);
  return true;
};

/** the react-native-mmkv module over the fake files. */
export const fakeMmkvModule = () => ({
  createMMKV: createInstance,
  existsMMKV: (id: string): boolean => {
    events.push(`mmkv.exists:${id}`);
    return files.has(id);
  },
  deleteMMKV: deleteInstance,
});

/** the synchronous expo-secure-store functions over the fake secure store. */
export const fakeSecureStoreModule = () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: FAKE_WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  getItem: (key: string, options?: SecureStoreOptions): string | null => {
    events.push('secure.get');
    secureOptions.push(options);
    const stored = secureItems.get(key) ?? null;
    // the failures quote what they touch: a report holding them would leak it
    if (failures.secureRead) throw new Error(`keychain read failed near ${String(stored)}`);
    return stored;
  },
  setItem: (key: string, value: string, options?: SecureStoreOptions): void => {
    events.push('secure.set');
    secureOptions.push(options);
    writtenSecureValues.add(value);
    if (failures.secureWrite) throw new Error(`keychain write of ${value} failed`);
    secureItems.set(key, value);
  },
});

/** a random source that fills the array with these bytes, repeated. */
export const repeatingRandomSource =
  (pattern: readonly number[]) =>
  (array: Uint8Array): Uint8Array => {
    array.set(array.map((_, index) => pattern[index % pattern.length] ?? 0));
    return array;
  };

/**
 * runs the call and returns what it returns, failing the test if the call used Math.random: the
 * injected source is the only randomness. scoped to the call, as jest itself uses Math.random
 */
export const withoutMathRandom = <T>(call: () => T): T => {
  const random = jest.spyOn(Math, 'random');
  try {
    return call();
  } finally {
    const calls = random.mock.calls.length;
    random.mockRestore();
    expect(calls).toBe(0);
  }
};

/**
 * every key and stored string the test touched (seeded, written, stored in the secure store or
 * given to createMMKV): no report may quote one
 */
export const knownSecrets = (): string[] =>
  [
    ...seededSecrets,
    ...writtenSecureValues,
    ...configurations.map((configuration) => configuration.encryptionKey ?? ''),
    ...[...files.values()].flatMap((file) => [...file.values.values()]),
  ].filter((secret): secret is string => typeof secret === 'string' && secret !== '');
