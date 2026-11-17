import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type * as Device from './__fixtures__/app-storage-device';
import {
  device,
  FAKE_WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  resetDevice,
  seedSecureItem,
} from './__fixtures__/app-storage-device';
import { APP_STORAGE_KEY_NAME } from './app-storage-key';
import {
  createSecureDocumentStorage,
  MAX_SECURE_DOCUMENT_BYTES,
  SECURE_DOCUMENT_PREFIX,
} from './secure-documents';

jest.mock('expo-secure-store', () =>
  jest.requireActual<typeof Device>('./__fixtures__/app-storage-device').fakeSecureStoreModule(),
);

// the key the owed purges use, and a key holding a user id
const KEY = 'device-purge-pending';
const NAME = `${SECURE_DOCUMENT_PREFIX}${KEY}`;
const USER_KEY = 'owed.00000000-0000-4000-8000-000000000001';
const DOCUMENT = '{"version":1,"users":[]}';
const NEWER_DOCUMENT = '{"version":1,"users":[{"userId":"u"}]}';
// what other items of the secure store hold: low-entropy placeholders
const SESSION_NAME = 'sb-project-auth-token';
const SESSION_VALUE = 'session-value';
const STORED_KEY = 'S'.repeat(32);

const OPTIONS = { keychainAccessible: FAKE_WHEN_UNLOCKED_THIS_DEVICE_ONLY };
// fixed: it never quotes the key, which may hold a user id
const KEY_FORM_MESSAGE =
  'invalid secure document key: lowercase letters and digits, joined by single dots or dashes';

const thrownMessage = (call: () => unknown): string | undefined => {
  try {
    call();
  } catch (error) {
    return error instanceof Error ? error.message : undefined;
  }
  return undefined;
};

beforeEach(resetDevice);

describe('createSecureDocumentStorage', () => {
  it('returns undefined for a key never written', () => {
    expect(createSecureDocumentStorage().getString(KEY)).toBeUndefined();
  });

  it('stores a value under the prefixed name, read back at the next launch', () => {
    createSecureDocumentStorage().set(KEY, DOCUMENT);

    expect([...device.secureItems]).toStrictEqual([[NAME, DOCUMENT]]);
    expect(createSecureDocumentStorage().getString(KEY)).toBe(DOCUMENT);
  });

  it('overwrites a value and keeps keys apart', () => {
    const storage = createSecureDocumentStorage();
    storage.set(KEY, DOCUMENT);
    storage.set(USER_KEY, DOCUMENT);

    storage.set(KEY, NEWER_DOCUMENT);

    expect(storage.getString(KEY)).toBe(NEWER_DOCUMENT);
    expect(storage.getString(USER_KEY)).toBe(DOCUMENT);
  });

  it('deletes with an empty tombstone written synchronously, read as no value', () => {
    const storage = createSecureDocumentStorage();
    storage.set(KEY, DOCUMENT);
    device.events.length = 0;

    storage.delete(KEY);

    expect(device.events).toStrictEqual(['secure.set']);
    expect(device.secureItems.get(NAME)).toBe('');
    expect(storage.getString(KEY)).toBeUndefined();
    expect(createSecureDocumentStorage().getString(KEY)).toBeUndefined();
  });

  it('stores again after a deletion, and reads an empty value as a deletion', () => {
    const storage = createSecureDocumentStorage();
    storage.delete(KEY);

    storage.set(KEY, DOCUMENT);

    expect(storage.getString(KEY)).toBe(DOCUMENT);
    storage.set(KEY, '');
    expect(storage.getString(KEY)).toBeUndefined();
  });

  it('returns the stored text as it is: its reader parses it', () => {
    seedSecureItem(NAME, 'not json');

    expect(createSecureDocumentStorage().getString(KEY)).toBe('not json');
  });

  it('leaves the session and the app storage key alone', () => {
    seedSecureItem(SESSION_NAME, SESSION_VALUE);
    seedSecureItem(APP_STORAGE_KEY_NAME, STORED_KEY);
    const storage = createSecureDocumentStorage();

    storage.set('sb-project-auth-token', DOCUMENT);
    storage.delete('tsuzuki-app-storage-key');

    expect(device.secureItems.get(SESSION_NAME)).toBe(SESSION_VALUE);
    expect(device.secureItems.get(APP_STORAGE_KEY_NAME)).toBe(STORED_KEY);
    expect(storage.getString('sb-project-auth-token')).toBe(DOCUMENT);
  });

  it('passes the device-only accessibility on every call', () => {
    const storage = createSecureDocumentStorage();
    storage.set(KEY, DOCUMENT);
    storage.getString(KEY);
    storage.delete(KEY);

    expect(device.secureOptions).toStrictEqual([OPTIONS, OPTIONS, OPTIONS]);
  });

  it('throws what the secure store throws', () => {
    const storage = createSecureDocumentStorage();
    device.failures.secureRead = true;
    device.failures.secureWrite = true;

    expect(() => storage.getString(KEY)).toThrow();
    expect(() => {
      storage.set(KEY, DOCUMENT);
    }).toThrow();
    expect(() => {
      storage.delete(KEY);
    }).toThrow();
  });
});

describe('createSecureDocumentStorage, the size bound', () => {
  it.each([
    ['ascii', 'a'.repeat(MAX_SECURE_DOCUMENT_BYTES)],
    ['2-byte characters', 'é'.repeat(MAX_SECURE_DOCUMENT_BYTES / 2)],
    ['4-byte emoji', '😀'.repeat(MAX_SECURE_DOCUMENT_BYTES / 4)],
  ])('stores %s filling the 2048 utf-8 bytes exactly', (_, value) => {
    const storage = createSecureDocumentStorage();

    storage.set(KEY, value);

    expect(storage.getString(KEY)).toBe(value);
  });

  it.each([
    ['ascii', 'a'.repeat(MAX_SECURE_DOCUMENT_BYTES + 1)],
    ['2-byte characters', `a${'é'.repeat(MAX_SECURE_DOCUMENT_BYTES / 2)}`],
    ['4-byte emoji', `${'😀'.repeat(MAX_SECURE_DOCUMENT_BYTES / 4)}a`],
  ])('refuses %s one byte over, writing nothing and quoting no value', (_, value) => {
    const storage = createSecureDocumentStorage();
    storage.set(KEY, DOCUMENT);
    device.events.length = 0;

    const write = (): void => {
      storage.set(KEY, value);
    };

    expect(write).toThrow(RangeError);
    expect(thrownMessage(write)).toBe(
      `secure document value over ${String(MAX_SECURE_DOCUMENT_BYTES)} utf-8 bytes`,
    );
    expect(device.events).toStrictEqual([]);
    expect(storage.getString(KEY)).toBe(DOCUMENT);
  });
});

describe('createSecureDocumentStorage, the key form', () => {
  it.each(['device-purge-pending', 'owed.00000000-0000-4000-8000-000000000001', 'a', 'a1.b2-c3'])(
    'accepts the key %j',
    (key) => {
      const storage = createSecureDocumentStorage();

      storage.set(key, DOCUMENT);

      expect(device.secureItems.get(`${SECURE_DOCUMENT_PREFIX}${key}`)).toBe(DOCUMENT);
    },
  );

  it.each(['', 'Upper', 'has space', 'under_score', 'slash/key', 'a..b', '.lead', 'trail-', 'é'])(
    'refuses the key %j before any secure-store call, without quoting it',
    (key) => {
      const storage = createSecureDocumentStorage();
      const calls = [
        () => storage.getString(key),
        () => {
          storage.set(key, DOCUMENT);
        },
        () => {
          storage.delete(key);
        },
      ];

      for (const call of calls) {
        expect(call).toThrow(TypeError);
        expect(thrownMessage(call)).toBe(KEY_FORM_MESSAGE);
      }
      expect(device.events).toStrictEqual([]);
    },
  );
});
