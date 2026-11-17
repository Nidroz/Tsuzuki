import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import type * as Device from './__fixtures__/expo-crypto-device';
import type * as WebCrypto from './web-crypto';

jest.mock('expo-crypto', () =>
  jest.requireActual<typeof Device>('./__fixtures__/expo-crypto-device').fakeExpoCryptoModule(),
);

// the test environment's own globals (node): hermes has no crypto, so the tests remove it, and
// the s256 checks remove TextEncoder or btoa
const NATIVE_GLOBALS = ['crypto', 'TextEncoder', 'btoa'] as const;
const nativeGlobals = NATIVE_GLOBALS.map(
  (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
);

const restoreNativeGlobals = () => {
  for (const [name, descriptor] of nativeGlobals) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
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

// loads the polyfill in a fresh module registry and returns what its evaluation threw, with the
// launch error message of that registry's binding (the main registry never loads the binding,
// whose expo-crypto mock every isolated registry would then share)
const launchFailure = (): { readonly thrown: unknown; readonly expected: Error } => {
  const result: { thrown?: unknown; message?: string } = {};
  jest.isolateModules(() => {
    try {
      jest.requireActual('./web-crypto-polyfill');
    } catch (error) {
      result.thrown = error;
    }
    result.message =
      jest.requireActual<typeof WebCrypto>('./web-crypto').PKCE_S256_PREREQUISITES_MESSAGE;
  });
  if (result.message === undefined) throw new Error('the isolated registry loaded no binding');
  return { thrown: result.thrown, expected: new Error(result.message) };
};

const defineGlobal = (name: string, value: unknown): void => {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
};

// an engine object that accepts a definition and keeps nothing: the binding cannot land on it
const ignoringDefinitions = (target: object): object =>
  new Proxy(target, { defineProperty: () => true });

const drawNothing = <T>(array: T): T => array;
const digestNothing = (): Promise<ArrayBuffer> => Promise.resolve(new ArrayBuffer(0));

afterEach(restoreNativeGlobals);

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

describe('the web crypto polyfill without an s256 pkce prerequisite', () => {
  it.each([
    [
      'crypto.getRandomValues',
      () => {
        defineGlobal('crypto', ignoringDefinitions({ subtle: { digest: digestNothing } }));
      },
    ],
    [
      'crypto.subtle.digest',
      () => {
        defineGlobal('crypto', { getRandomValues: drawNothing, subtle: ignoringDefinitions({}) });
      },
    ],
    [
      'TextEncoder',
      () => {
        Reflect.deleteProperty(globalThis, 'TextEncoder');
      },
    ],
    [
      'btoa',
      () => {
        Reflect.deleteProperty(globalThis, 'btoa');
      },
    ],
  ])('fails the launch with a fixed error without %s', (_name, remove) => {
    remove();

    const { thrown, expected } = launchFailure();

    expect(thrown).toStrictEqual(expected);
  });

  it('lets the launch go on where every prerequisite exists', () => {
    expect(launchFailure().thrown).toBeUndefined();
  });
});
