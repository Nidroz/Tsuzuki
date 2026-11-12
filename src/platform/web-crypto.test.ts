import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { withoutMathRandom } from './__fixtures__/app-storage-device';
import type * as Device from './__fixtures__/expo-crypto-device';
import {
  expoCrypto,
  hexOf,
  nextRandomBytes,
  resetExpoCrypto,
} from './__fixtures__/expo-crypto-device';
import { appStorageKeySchema, generateAppStorageKey } from './app-storage-key';
import {
  installWebCrypto,
  RANDOM_VALUES_MAX_BYTES,
  secureRandomValues,
  WEB_CRYPTO_ERROR_NAMES,
  type WebCryptoTarget,
} from './web-crypto';

jest.mock('expo-crypto', () =>
  jest.requireActual<typeof Device>('./__fixtures__/expo-crypto-device').fakeExpoCryptoModule(),
);

// the binding as installed: its functions take any value and check it at runtime
interface Binding {
  getRandomValues: <T>(array: T) => T;
  subtle: { digest: (algorithm: unknown, data: unknown) => Promise<ArrayBuffer> };
}

const ABC = new TextEncoder().encode('abc');
// fips 180-2, appendix b.1
const ABC_SHA_256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const ABC_DIGEST_CALL = 'digest:SHA-256:3';

// a bare target, as the global object of hermes: no crypto at all
const installOnBareTarget = (): Binding => {
  const target: { crypto?: Binding } = {};
  installWebCrypto(target);
  if (target.crypto === undefined) throw new Error('the installer left the target without crypto');
  return target.crypto;
};

const thrownBy = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('the call did not throw');
};

beforeEach(resetExpoCrypto);

describe('installWebCrypto', () => {
  it('gives a bare target crypto with getRandomValues and subtle.digest', () => {
    const target: WebCryptoTarget = {};

    expect(installWebCrypto(target)).toStrictEqual(['crypto']);
    expect(target.crypto).toStrictEqual({
      getRandomValues: expect.any(Function),
      subtle: { digest: expect.any(Function) },
    });
  });

  it('keeps an existing getRandomValues, subtle and digest by identity', () => {
    const getRandomValues = <T>(array: T): T => array;
    const digest = () => Promise.resolve(new ArrayBuffer(0));
    const subtle = { digest };
    const crypto = { getRandomValues, subtle };
    const target = { crypto };

    expect(installWebCrypto(target)).toStrictEqual([]);
    expect(target.crypto).toBe(crypto);
    expect(target.crypto).toStrictEqual({ getRandomValues, subtle });
    expect(target.crypto.subtle).toBe(subtle);
    expect(target.crypto.subtle.digest).toBe(digest);
  });

  it('adds only subtle to a crypto that has getRandomValues but no subtle', () => {
    const getRandomValues = <T>(array: T): T => array;
    const crypto: { getRandomValues: typeof getRandomValues; subtle?: unknown } = {
      getRandomValues,
    };

    expect(installWebCrypto({ crypto })).toStrictEqual(['subtle']);
    expect(crypto.getRandomValues).toBe(getRandomValues);
    expect(crypto.subtle).toStrictEqual({ digest: expect.any(Function) });
  });

  it('adds only getRandomValues, or only digest, beside the members that exist', () => {
    const digest = () => Promise.resolve(new ArrayBuffer(0));
    const withDigest = { subtle: { digest } };
    const emptySubtle = {};
    const withEmptySubtle: { getRandomValues: unknown; subtle: { digest?: unknown } } = {
      getRandomValues: <T>(array: T): T => array,
      subtle: emptySubtle,
    };

    expect(installWebCrypto({ crypto: withDigest })).toStrictEqual(['getRandomValues']);
    expect(withDigest.subtle.digest).toBe(digest);
    expect(installWebCrypto({ crypto: withEmptySubtle })).toStrictEqual(['digest']);
    expect(withEmptySubtle.subtle).toBe(emptySubtle);
    expect(emptySubtle).toStrictEqual({ digest: expect.any(Function) });
  });

  it('shadows an inherited subtle getter that reads undefined, as an insecure context has', () => {
    const prototype = Object.defineProperty({}, 'subtle', { get: () => undefined });
    const crypto: { subtle?: unknown } = Object.create(prototype) as { subtle?: unknown };

    expect(installWebCrypto({ crypto })).toStrictEqual(['getRandomValues', 'subtle']);
    expect(crypto.subtle).toStrictEqual({ digest: expect.any(Function) });
  });

  it('installs once per target: a second call adds and replaces nothing', () => {
    const target: { crypto?: { subtle?: unknown } } = {};
    installWebCrypto(target);
    const first = target.crypto;
    Reflect.deleteProperty(first ?? {}, 'subtle');

    expect(installWebCrypto(target)).toStrictEqual([]);
    expect(target.crypto).toBe(first);
    expect(target.crypto).not.toHaveProperty('subtle');
  });
});

describe('the binding getRandomValues', () => {
  it('fills a Uint8Array in place from expo-crypto and returns that array', () => {
    const { getRandomValues } = installOnBareTarget();
    const array = new Uint8Array(8);
    const expected = nextRandomBytes(8);

    expect(withoutMathRandom(() => getRandomValues(array))).toBe(array);
    expect(array).toStrictEqual(expected);
    expect(expoCrypto.calls).toStrictEqual(['random:8']);
  });

  it('fills every byte of a Uint32Array and returns that array', () => {
    const { getRandomValues } = installOnBareTarget();
    const array = new Uint32Array(56);
    const expected = new Uint32Array(nextRandomBytes(56 * Uint32Array.BYTES_PER_ELEMENT).buffer);

    expect(getRandomValues(array)).toBe(array);
    expect(array).toStrictEqual(expected);
    expect(expoCrypto.calls).toStrictEqual(['random:224']);
  });

  it('fills only the window of a view with an offset', () => {
    const { getRandomValues } = installOnBareTarget();
    const buffer = new ArrayBuffer(8);
    const expected = Uint8Array.of(0, 0, ...nextRandomBytes(4), 0, 0);

    getRandomValues(new Uint8Array(buffer, 2, 4));

    expect(new Uint8Array(buffer)).toStrictEqual(expected);
  });

  it.each([
    new Int8Array(2),
    new Uint8ClampedArray(2),
    new Int16Array(2),
    new Int32Array(2),
    new BigInt64Array(2),
    new BigUint64Array(2),
  ])('fills an integer typed array (%#)', (array) => {
    const { getRandomValues } = installOnBareTarget();

    expect(getRandomValues(array)).toBe(array);
    expect(expoCrypto.calls).toStrictEqual([`random:${String(array.byteLength)}`]);
  });

  it('fills exactly 65536 bytes, and draws nothing for an empty array', () => {
    const { getRandomValues } = installOnBareTarget();
    const empty = new Uint8Array(0);

    getRandomValues(new Uint8Array(RANDOM_VALUES_MAX_BYTES));

    expect(getRandomValues(empty)).toBe(empty);
    expect(expoCrypto.calls).toStrictEqual([`random:${String(RANDOM_VALUES_MAX_BYTES)}`]);
  });

  it.each([
    new Uint8Array(RANDOM_VALUES_MAX_BYTES + 1),
    new Uint32Array(RANDOM_VALUES_MAX_BYTES / Uint32Array.BYTES_PER_ELEMENT + 1),
    new BigUint64Array(RANDOM_VALUES_MAX_BYTES / BigUint64Array.BYTES_PER_ELEMENT + 1),
  ])('refuses more than 65536 bytes with a QuotaExceededError, drawing nothing (%#)', (array) => {
    const { getRandomValues } = installOnBareTarget();

    expect(thrownBy(() => getRandomValues(array))).toMatchObject({
      name: WEB_CRYPTO_ERROR_NAMES.quotaExceeded,
      message: 'crypto.getRandomValues fills at most 65536 bytes',
    });
    expect(expoCrypto.calls).toStrictEqual([]);
  });

  it.each([new Float32Array(2), new Float64Array(2), new DataView(new ArrayBuffer(2))])(
    'refuses a view that is not an integer typed array with a TypeMismatchError (%#)',
    (view) => {
      const { getRandomValues } = installOnBareTarget();

      expect(thrownBy(() => getRandomValues(view))).toMatchObject({
        name: WEB_CRYPTO_ERROR_NAMES.typeMismatch,
        message: 'crypto.getRandomValues takes an integer typed array',
      });
      expect(expoCrypto.calls).toStrictEqual([]);
    },
  );

  it.each([[[0, 0]], [new ArrayBuffer(2)], ['00'], [undefined], [null]])(
    'refuses %p, which is no ArrayBufferView, with a TypeError',
    (value) => {
      const { getRandomValues } = installOnBareTarget();

      expect(() => getRandomValues(value)).toThrow(
        new TypeError('crypto.getRandomValues takes an ArrayBufferView'),
      );
      expect(expoCrypto.calls).toStrictEqual([]);
    },
  );
});

describe('the binding subtle.digest', () => {
  it('hashes "abc" with sha-256 through expo-crypto into an ArrayBuffer', async () => {
    const { subtle } = installOnBareTarget();

    const digest = await subtle.digest('SHA-256', ABC);

    expect(digest).toBeInstanceOf(ArrayBuffer);
    expect(hexOf(digest)).toBe(ABC_SHA_256);
    expect(expoCrypto.calls).toStrictEqual([ABC_DIGEST_CALL]);
  });

  it.each(['sha-256', 'Sha-256', { name: 'SHA-256' }, { name: 'sha-256', length: 1 }])(
    'matches the algorithm %p as web crypto does',
    async (algorithm) => {
      const { subtle } = installOnBareTarget();

      expect(hexOf(await subtle.digest(algorithm, ABC))).toBe(ABC_SHA_256);
    },
  );

  it.each([
    ['an ArrayBuffer', ABC.slice().buffer],
    ['the window of a view', new TextEncoder().encode('xabcx').subarray(1, 4)],
    ['a DataView', new DataView(Uint8Array.of(0x78, 0x61, 0x62, 0x63).buffer, 1)],
  ])('hashes %s', async (_, data) => {
    const { subtle } = installOnBareTarget();

    expect(hexOf(await subtle.digest('SHA-256', data))).toBe(ABC_SHA_256);
    expect(expoCrypto.calls).toStrictEqual([ABC_DIGEST_CALL]);
  });

  // the long s (U+017F) upper-cases to S: only an ascii case-insensitive match refuses it
  it.each(['SHA-1', 'SHA-512', 'SHA256', 'MD5', 'ſha-256', { name: 'SHA-1' }, {}, 256, null])(
    'rejects the algorithm %p with a NotSupportedError, hashing nothing',
    async (algorithm) => {
      const { subtle } = installOnBareTarget();

      await expect(subtle.digest(algorithm, ABC)).rejects.toMatchObject({
        name: WEB_CRYPTO_ERROR_NAMES.notSupported,
        message: 'crypto.subtle.digest supports SHA-256 only',
      });
      expect(expoCrypto.calls).toStrictEqual([]);
    },
  );

  it.each([['abc'], [[0x61, 0x62, 0x63]], [undefined]])(
    'rejects the data %p with a TypeError, hashing nothing',
    async (data) => {
      const { subtle } = installOnBareTarget();

      await expect(subtle.digest('SHA-256', data)).rejects.toThrow(
        new TypeError('crypto.subtle.digest takes an ArrayBuffer or an ArrayBufferView'),
      );
      expect(expoCrypto.calls).toStrictEqual([]);
    },
  );
});

describe('secureRandomValues', () => {
  it('is the getRandomValues of the binding', () => {
    expect(installOnBareTarget().getRandomValues).toBe(secureRandomValues);
  });

  it('draws the app storage key from expo-crypto, never from Math.random', () => {
    const key = withoutMathRandom(() => generateAppStorageKey(secureRandomValues));

    expect(appStorageKeySchema.safeParse(key).success).toBe(true);
    expect(expoCrypto.calls).toStrictEqual(['random:32']);
  });
});
