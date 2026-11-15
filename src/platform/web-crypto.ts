import {
  CryptoDigestAlgorithm,
  digest as expoDigest,
  getRandomValues as expoGetRandomValues,
} from 'expo-crypto';

import type { GetRandomValues } from './app-storage-key';

/**
 * a web crypto binding on expo-crypto for engines that have none: hermes on react native 0.86 with
 * expo sdk 57 installs no crypto.getRandomValues and no crypto.subtle, so auth-js would draw its
 * pkce verifier and flow id from Math.random and send the verifier as a plain challenge. the
 * binding holds what the app's libraries call: getRandomValues (SecRandomCopyBytes on ios,
 * SecureRandom on android) and subtle.digest with sha-256, each checked as web crypto checks it
 */

/** the DOMException names web crypto gives these failures; react native has no DOMException. */
export const WEB_CRYPTO_ERROR_NAMES = {
  typeMismatch: 'TypeMismatchError',
  quotaExceeded: 'QuotaExceededError',
  notSupported: 'NotSupportedError',
} as const;

type WebCryptoErrorName = (typeof WEB_CRYPTO_ERROR_NAMES)[keyof typeof WEB_CRYPTO_ERROR_NAMES];

/** web crypto fills at most this many bytes per getRandomValues call. */
export const RANDOM_VALUES_MAX_BYTES = 65_536;

// the integer typed arrays web crypto fills, by built-in tag: float arrays and DataView are
// refused. Object.prototype.toString reads the tag of an array from any realm (jest hands out
// arrays of node's realm, from TextEncoder), where instanceof would not
const INTEGER_ARRAY_TAGS: ReadonlySet<string> = new Set(
  [
    'Int8Array',
    'Uint8Array',
    'Uint8ClampedArray',
    'Int16Array',
    'Uint16Array',
    'Int32Array',
    'Uint32Array',
    'BigInt64Array',
    'BigUint64Array',
  ].map((name) => `[object ${name}]`),
);
const ARRAY_BUFFER_TAG = '[object ArrayBuffer]';

// the one digest algorithm, as its name reads in ascii lower case
const SHA_256 = 'sha-256';

const tagOf = (value: unknown): string => Object.prototype.toString.call(value);

const webCryptoError = (name: WebCryptoErrorName, message: string): Error => {
  const error = new Error(message);
  error.name = name;
  return error;
};

/**
 * crypto.getRandomValues: fills an integer typed array in place and returns that array.
 * expo-crypto fills any typed array of any size; like web crypto, this one throws a TypeError for
 * anything but an ArrayBufferView, a TypeMismatchError for a float array or a DataView and a
 * QuotaExceededError above 65536 bytes, before drawing any byte. the messages are fixed
 */
const getRandomValues = <T>(array: T): T => {
  if (!ArrayBuffer.isView(array)) {
    throw new TypeError('crypto.getRandomValues takes an ArrayBufferView');
  }
  if (!INTEGER_ARRAY_TAGS.has(tagOf(array))) {
    throw webCryptoError(
      WEB_CRYPTO_ERROR_NAMES.typeMismatch,
      'crypto.getRandomValues takes an integer typed array',
    );
  }
  if (array.byteLength > RANDOM_VALUES_MAX_BYTES) {
    throw webCryptoError(
      WEB_CRYPTO_ERROR_NAMES.quotaExceeded,
      `crypto.getRandomValues fills at most ${String(RANDOM_VALUES_MAX_BYTES)} bytes`,
    );
  }
  // expo-crypto fills bytes whatever the element type (its types leave out the bigint arrays), so
  // it gets a byte view over the same memory. no byte to draw for an empty array, whose buffer
  // may be detached and take no view
  if (array.byteLength > 0) {
    expoGetRandomValues(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  }
  return array;
};

// web crypto matches algorithm names ascii case-insensitively: toLowerCase would also map
// non-ascii letters (the kelvin sign to k)
const asciiLowerCase = (text: string): string =>
  text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

// an AlgorithmIdentifier names its algorithm by itself (a string) or by its name member
const algorithmName = (algorithm: unknown): string | undefined => {
  if (typeof algorithm === 'string') return algorithm;
  if (typeof algorithm === 'object' && algorithm !== null && 'name' in algorithm) {
    return typeof algorithm.name === 'string' ? algorithm.name : undefined;
  }
  return undefined;
};

const isArrayBuffer = (value: unknown): value is ArrayBuffer => tagOf(value) === ARRAY_BUFFER_TAG;

// a BufferSource over unshared memory, as web crypto takes it
const isBufferSource = (value: unknown): value is ArrayBuffer | ArrayBufferView<ArrayBuffer> =>
  isArrayBuffer(value) || (ArrayBuffer.isView(value) && isArrayBuffer(value.buffer));

/**
 * crypto.subtle.digest with sha-256 only, the one digest the app's libraries ask for (the pkce
 * challenge of auth-js). the data is checked first, then the algorithm, as web crypto converts its
 * arguments before it normalizes the algorithm. it rejects, never throws: a TypeError for data
 * other than an ArrayBuffer or an ArrayBufferView, a NotSupportedError for any other algorithm
 */
const digest = async (algorithm: unknown, data: unknown): Promise<ArrayBuffer> => {
  if (!isBufferSource(data)) {
    throw new TypeError('crypto.subtle.digest takes an ArrayBuffer or an ArrayBufferView');
  }
  const name = algorithmName(algorithm);
  if (name === undefined || asciiLowerCase(name) !== SHA_256) {
    throw webCryptoError(
      WEB_CRYPTO_ERROR_NAMES.notSupported,
      'crypto.subtle.digest supports SHA-256 only',
    );
  }
  return expoDigest(CryptoDigestAlgorithm.SHA256, data);
};

/**
 * the secure random source of the app storage key (ADR-0020): the binding's getRandomValues, on
 * expo-crypto whether or not the binding was installed on globalThis
 */
export const secureRandomValues: GetRandomValues = getRandomValues;

/** a member the installer adds; a new crypto holds the others, a new subtle holds digest. */
export type WebCryptoMember = 'crypto' | 'getRandomValues' | 'subtle' | 'digest';

/** where the binding goes: globalThis in the app, a bare object in a test. */
export interface WebCryptoTarget {
  crypto?: unknown;
}

// the targets that got their binding: a second call on one installs and replaces nothing
const installedTargets = new WeakSet<WebCryptoTarget>();

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null;

const isFunction = (value: unknown): boolean => typeof value === 'function';

// an own data property, as an assignment makes, but also over an inherited getter that has no
// setter (a Crypto.prototype.subtle that reads undefined). throws on a frozen target: a binding
// that cannot be installed fails the launch instead of leaving Math.random to auth-js
const define = (object: object, key: string, value: unknown): void => {
  Object.defineProperty(object, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
};

const installMissing = (target: WebCryptoTarget): WebCryptoMember[] => {
  const existing = target.crypto;
  if (!isObject(existing)) {
    define(target, 'crypto', { getRandomValues, subtle: { digest } });
    return ['crypto'];
  }
  const installed: WebCryptoMember[] = [];
  if (!isFunction(Reflect.get(existing, 'getRandomValues'))) {
    define(existing, 'getRandomValues', getRandomValues);
    installed.push('getRandomValues');
  }
  const subtle: unknown = Reflect.get(existing, 'subtle');
  if (!isObject(subtle)) {
    define(existing, 'subtle', { digest });
    installed.push('subtle');
  } else if (!isFunction(Reflect.get(subtle, 'digest'))) {
    define(subtle, 'digest', digest);
    installed.push('digest');
  }
  return installed;
};

/**
 * installs the binding on the target where it is missing and returns the members it added. a
 * member counts as missing when it is not of its kind (an object for crypto and subtle, a function
 * for getRandomValues and digest), so an engine's own implementation is never replaced, member by
 * member. once per target: a second call adds nothing, even for a member removed since; a fresh
 * module instance (fast refresh, jest.isolateModules) finds the members present and keeps them
 */
export const installWebCrypto = (target: WebCryptoTarget): readonly WebCryptoMember[] => {
  if (installedTargets.has(target)) return [];
  const installed = installMissing(target);
  installedTargets.add(target);
  return installed;
};

/** the fixed message of the error that fails the launch without the s256 pkce prerequisites */
export const PKCE_S256_PREREQUISITES_MESSAGE =
  'the s256 pkce prerequisites are missing: crypto.getRandomValues, crypto.subtle.digest, TextEncoder and btoa must be functions';

/** where the s256 prerequisites are read: globalThis in the app, a bare object in a test */
export interface PkceS256Target extends WebCryptoTarget {
  TextEncoder?: unknown;
  btoa?: unknown;
}

/**
 * throws an Error with PKCE_S256_PREREQUISITES_MESSAGE unless crypto.getRandomValues,
 * crypto.subtle.digest, TextEncoder and btoa are functions of the target. auth-js 2.117.3 builds
 * an s256 challenge only when crypto, crypto.subtle and TextEncoder are defined, and otherwise
 * silently sends the plain verifier (generatePKCEChallenge in lib/helpers.js: dist/module lines
 * 231-233, dist/main 266-268); it then hashes with TextEncoder and crypto.subtle.digest and
 * encodes with btoa (dist/module 239, dist/main 274), and draws the verifier from
 * crypto.getRandomValues (generatePKCEVerifier). the polyfill calls it right after installing the
 * binding, so a launch fails instead of reaching `plain`
 */
export const assertPkceS256Prerequisites = (target: PkceS256Target): void => {
  const { crypto } = target;
  const subtle: unknown = isObject(crypto) ? Reflect.get(crypto, 'subtle') : undefined;
  const ready =
    isObject(crypto) &&
    isFunction(Reflect.get(crypto, 'getRandomValues')) &&
    isObject(subtle) &&
    isFunction(Reflect.get(subtle, 'digest')) &&
    isFunction(target.TextEncoder) &&
    isFunction(target.btoa);
  if (!ready) {
    throw new Error(PKCE_S256_PREREQUISITES_MESSAGE);
  }
};
