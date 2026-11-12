import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import type * as Device from './__fixtures__/expo-crypto-device';

jest.mock('expo-crypto', () =>
  jest.requireActual<typeof Device>('./__fixtures__/expo-crypto-device').fakeExpoCryptoModule(),
);

// the test environment's own crypto (node): hermes has none, so the tests remove it
const nativeCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

const restoreNativeCrypto = () => {
  if (nativeCrypto) {
    Object.defineProperty(globalThis, 'crypto', nativeCrypto);
  } else {
    Reflect.deleteProperty(globalThis, 'crypto');
  }
};

// a fresh module registry each time, as a second evaluation of the module would be; returns the
// fake expo-crypto that registry gives the binding
const loadPolyfill = (): typeof Device => {
  const loaded: { device?: typeof Device } = {};
  jest.isolateModules(() => {
    jest.requireActual('./web-crypto-polyfill');
    loaded.device = jest.requireActual<typeof Device>('./__fixtures__/expo-crypto-device');
  });
  if (loaded.device === undefined) throw new Error('the isolated registry loaded no fake');
  return loaded.device;
};

// the members of the global crypto, each compared by identity (the functions are methods)
const globalMembers = () => {
  const { crypto } = globalThis;
  return {
    crypto,
    getRandomValues: Reflect.get(crypto, 'getRandomValues') as unknown,
    subtle: crypto.subtle,
    digest: Reflect.get(crypto.subtle, 'digest') as unknown,
  };
};

type Members = ReturnType<typeof globalMembers>;

// the names of the members the global crypto no longer holds by identity
const replacedSince = (before: Members): string[] => {
  const after = globalMembers();
  return (Object.keys(before) as (keyof Members)[]).filter((name) => after[name] !== before[name]);
};

afterEach(restoreNativeCrypto);

describe('the web crypto polyfill on an engine without crypto', () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, 'crypto');
  });

  it('installs crypto.getRandomValues on expo-crypto', () => {
    expect('crypto' in globalThis).toBe(false);
    const device = loadPolyfill();
    const expected = device.nextRandomBytes(16);
    const array = new Uint8Array(16);

    expect(globalThis.crypto.getRandomValues(array)).toBe(array);
    expect(array).toStrictEqual(expected);
    expect(device.expoCrypto.calls).toStrictEqual(['random:16']);
  });

  it('installs crypto.subtle.digest with sha-256 on expo-crypto', async () => {
    const device = loadPolyfill();

    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('abc'),
    );

    expect(device.hexOf(digest)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(device.expoCrypto.calls).toStrictEqual(['digest:SHA-256:3']);
  });

  it('gives one binding when it is evaluated twice', () => {
    loadPolyfill();
    const first = globalMembers();

    loadPolyfill();

    expect(replacedSince(first)).toStrictEqual([]);
  });
});

describe('the web crypto polyfill on an engine with crypto', () => {
  it('leaves the native crypto and its members untouched', () => {
    const native = globalMembers();

    const device = loadPolyfill();
    globalThis.crypto.getRandomValues(new Uint8Array(4));

    expect(replacedSince(native)).toStrictEqual([]);
    expect(device.expoCrypto.calls).toStrictEqual([]);
  });
});
