import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { WHEN_UNLOCKED_THIS_DEVICE_ONLY } from 'expo-secure-store';

import type * as Device from './__fixtures__/app-storage-device';
import {
  device,
  repeatingRandomSource,
  resetDevice,
  seedSecureItem,
  withoutMathRandom,
} from './__fixtures__/app-storage-device';
import {
  APP_STORAGE_KEY_LENGTH,
  APP_STORAGE_KEY_NAME,
  appStorageKeySchema,
  generateAppStorageKey,
  readAppStorageKey,
  writeAppStorageKey,
} from './app-storage-key';

jest.mock('expo-secure-store', () =>
  jest.requireActual<typeof Device>('./__fixtures__/app-storage-device').fakeSecureStoreModule(),
);

// each byte & 63 picks a character: 0, 8, 16, ... 56 are A I Q Y g o w 4
const STEP_BYTES = [0, 8, 16, 24, 32, 40, 48, 56];
const STEP_KEY = 'AIQYgow4'.repeat(4);
// the high bits are dropped: 62 and 63 plus any multiple of 64 are - and _
const HIGH_BIT_BYTES = [62, 63, 126, 127, 190, 191, 254, 255];
const HIGH_BIT_KEY = '-_'.repeat(16);
const VALID_KEY = 'Az09-_'.repeat(5).concat('xy');
// keys with no session meaning: the session is sb-<project>-auth-token and its chunks
const SESSION_KEY_PREFIX = 'sb-';
const SECURE_STORE_KEY = /^[A-Za-z0-9_-]+$/;

beforeEach(resetDevice);

describe('generateAppStorageKey', () => {
  it('builds the key from the injected bytes, one alphabet character per byte', () => {
    const source = jest.fn(repeatingRandomSource(STEP_BYTES));

    expect(withoutMathRandom(() => generateAppStorageKey(source))).toBe(STEP_KEY);
    expect(source).toHaveBeenCalledTimes(1);
    expect(source.mock.calls[0]?.[0]).toHaveLength(APP_STORAGE_KEY_LENGTH);
  });

  it('keeps the low 6 bits of each byte', () => {
    expect(
      withoutMathRandom(() => generateAppStorageKey(repeatingRandomSource(HIGH_BIT_BYTES))),
    ).toBe(HIGH_BIT_KEY);
  });

  it('gives a key of the stored form', () => {
    const key = withoutMathRandom(() =>
      generateAppStorageKey(repeatingRandomSource([7, 200, 33, 91])),
    );

    expect(appStorageKeySchema.safeParse(key).success).toBe(true);
    expect(new TextEncoder().encode(key)).toHaveLength(APP_STORAGE_KEY_LENGTH);
  });

  it.each([16, 33])('rejects a source that returns %i bytes, quoting no byte', (length) => {
    const short = () => new Uint8Array(length).fill(HIGH_BIT_BYTES[0] ?? 0);

    expect(() => generateAppStorageKey(short)).toThrow(RangeError);
    expect(() => generateAppStorageKey(short)).toThrow(
      `the random source returned ${String(length)} bytes, not ${String(APP_STORAGE_KEY_LENGTH)}`,
    );
  });
});

describe('appStorageKeySchema', () => {
  it('accepts 32 characters of the url-safe base64 alphabet', () => {
    expect(appStorageKeySchema.parse(VALID_KEY)).toBe(VALID_KEY);
  });

  it.each([
    ['31 characters', VALID_KEY.slice(1)],
    ['33 characters', `${VALID_KEY}A`],
    ['a dot', `${VALID_KEY.slice(1)}.`],
    ['standard base64 characters', `${VALID_KEY.slice(2)}+/`],
    ['padding', `${VALID_KEY.slice(1)}=`],
    ['a trailing line break', `${VALID_KEY.slice(1)}\n`],
  ])('rejects a value with %s', (_, value) => {
    expect(appStorageKeySchema.safeParse(value).success).toBe(false);
  });
});

describe('readAppStorageKey', () => {
  it('reads a missing key as missing', () => {
    expect(readAppStorageKey()).toStrictEqual({ status: 'missing' });
  });

  it('reads a valid key', () => {
    seedSecureItem(APP_STORAGE_KEY_NAME, VALID_KEY);

    expect(readAppStorageKey()).toStrictEqual({ status: 'valid', key: VALID_KEY });
  });

  it('reads a value of another form as invalid, without returning it', () => {
    seedSecureItem(APP_STORAGE_KEY_NAME, 'a-stored-value-of-another-form');

    expect(readAppStorageKey()).toStrictEqual({ status: 'invalid' });
  });

  it('reads with the session accessibility', () => {
    readAppStorageKey();

    expect(device.secureOptions).toStrictEqual([
      { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    ]);
  });

  it('throws when the secure store cannot be read', () => {
    device.failures.secureRead = true;

    expect(() => readAppStorageKey()).toThrow(Error);
  });
});

describe('writeAppStorageKey', () => {
  it('stores the key under its name with the session accessibility', () => {
    writeAppStorageKey(VALID_KEY);

    expect(device.secureItems.get(APP_STORAGE_KEY_NAME)).toBe(VALID_KEY);
    expect(device.secureOptions).toStrictEqual([
      { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    ]);
  });

  it('throws when the secure store cannot be written', () => {
    device.failures.secureWrite = true;

    expect(() => {
      writeAppStorageKey(VALID_KEY);
    }).toThrow(Error);
    expect(device.secureItems.size).toBe(0);
  });
});

describe('APP_STORAGE_KEY_NAME', () => {
  it('is a secure-store key no session key can take', () => {
    expect(APP_STORAGE_KEY_NAME).toMatch(SECURE_STORE_KEY);
    expect(APP_STORAGE_KEY_NAME.startsWith(SESSION_KEY_PREFIX)).toBe(false);
  });
});
