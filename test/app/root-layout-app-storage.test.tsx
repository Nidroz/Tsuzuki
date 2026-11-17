// the device mocks below read this binding: imported first, before anything loads them
import * as mockDevice from '@platform/__fixtures__/app-storage-device';

import { DEVICE_PURGE_MARKER_STORAGE_KEY } from '@core/repositories/local/device-purge-marker-repository';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type * as CryptoDevice from '@platform/__fixtures__/expo-crypto-device';
import type * as WebCryptoModule from '@platform/web-crypto';

import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import {
  appFileValues,
  launchInIsolation,
  owedPurgesOnDevice,
  seedEarlierLaunch,
  storedOwedPurges,
  USER_A,
} from './app-storage-support';

// the launches of the composition root (ADR-0020, R-09): the web crypto binding before the
// supabase client, a first launch that never reads a session or an owed purge stored before it
// (the ios keychain outlives an uninstall), a damaged owed document. the device is in memory
// (app-storage-support.ts): each isolated load of the layout module is a launch, the files
// outliving it. no test here loads the layout in the main registry, whose mocks every isolated
// registry would reuse

jest.mock('react-native-mmkv', () => mockDevice.fakeMmkvModule());
jest.mock('expo-secure-store', () => mockDevice.fakeSecureStoreModule());
jest.mock('expo-crypto', () =>
  jest
    .requireActual<typeof CryptoDevice>('@platform/__fixtures__/expo-crypto-device')
    .fakeExpoCryptoModule(),
);
// the real module, its installer recorded
jest.mock('@platform/web-crypto', () => {
  const actual = jest.requireActual<typeof WebCryptoModule>('@platform/web-crypto');
  return { ...actual, installWebCrypto: jest.fn(actual.installWebCrypto) };
});

jest.mock('@core/repositories/supabase/create-supabase-client', () =>
  jest
    .requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module')
    .fakeSupabaseClientModule(),
);
jest.mock('@core/repositories/supabase/auth-repository', () =>
  jest
    .requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module')
    .fakeSupabaseAuthModule(),
);
jest.mock('@core/catalog/jikan/jikan-catalog-provider', () =>
  jest.requireActual<typeof FakeJikanModule>('../mobile/fake-jikan-module').fakeJikanModule(),
);

// the session key supabase-js derives from the project url, and a session stored under it by an
// install before this one (the header, then its one chunk); low-entropy placeholders
const SESSION_KEY = 'sb-test-project-auth-token';
const STALE_SESSION = `stale-${'s'.repeat(16)}`;
const NEW_SESSION = `new-${'n'.repeat(16)}`;
// the sha-256 of "abc" (fips 180-2)
const ABC = new TextEncoder().encode('abc');
const ABC_SHA_256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const OWED_OF_A = { userId: USER_A, clearGuestLibrary: false, deviceWide: true };

const hexOf = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

const sessionItems = (): string[] =>
  [...mockDevice.device.secureItems.keys()].filter((key) => key.startsWith(SESSION_KEY));

// a member of an object, or undefined for anything else
const memberOf = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? (Reflect.get(value, key) as unknown) : undefined;

// the members of the global crypto, as the engine holds them now
const globalCrypto = () => {
  const crypto = memberOf(globalThis, 'crypto');
  return {
    getRandomValues: memberOf(crypto, 'getRandomValues'),
    digest: memberOf(memberOf(crypto, 'subtle'), 'digest'),
  };
};

type Digest = (algorithm: string, data: Uint8Array) => Promise<ArrayBuffer>;
const isDigest = (value: unknown): value is Digest => typeof value === 'function';

beforeEach(() => {
  mockDevice.resetDevice();
});

describe('root layout app storage', () => {
  it('installs the web crypto binding once, before the supabase client is created', async () => {
    const nativeCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    // hermes has no web crypto
    Reflect.deleteProperty(globalThis, 'crypto');
    const atClient: ReturnType<typeof globalCrypto>[] = [];
    const loaded: { webCrypto?: typeof WebCryptoModule } = {};
    try {
      launchInIsolation(() => {
        jest
          .requireMock<FakeSupabaseModule.FakeSupabaseClientModule>(
            '@core/repositories/supabase/create-supabase-client',
          )
          .createSupabaseClient.mockImplementation(() => {
            atClient.push(globalCrypto());
            return jest.requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module')
              .FAKE_SUPABASE_CLIENT;
          });
        loaded.webCrypto = jest.requireMock<typeof WebCryptoModule>('@platform/web-crypto');
      });
      const [seen] = atClient;
      expect(atClient).toHaveLength(1);
      expect(seen?.getRandomValues).toBe(loaded.webCrypto?.secureRandomValues);
      const install = loaded.webCrypto?.installWebCrypto;
      expect(install && jest.mocked(install).mock.calls).toStrictEqual([[globalThis]]);
      // the digest the client found is sha-256 over expo-crypto: node's went with its crypto
      const digest = seen?.digest;
      expect(isDigest(digest) && hexOf(await digest('SHA-256', ABC))).toBe(ABC_SHA_256);
    } finally {
      if (nativeCrypto) Object.defineProperty(globalThis, 'crypto', nativeCrypto);
    }
  });

  it('starts a first launch signed out, its stored session gone, and keeps a session it writes', async () => {
    mockDevice.seedSecureItem(SESSION_KEY, '0:1');
    mockDevice.seedSecureItem(`${SESSION_KEY}.0.0`, STALE_SESSION);

    const first = launchInIsolation();

    await expect(first.sessionStorage.getItem(SESSION_KEY)).resolves.toBeNull();
    expect(sessionItems()).toStrictEqual([]);
    await first.sessionStorage.setItem(SESSION_KEY, NEW_SESSION);

    const second = launchInIsolation();

    await expect(second.sessionStorage.getItem(SESSION_KEY)).resolves.toBe(NEW_SESSION);
  });

  it('drops at a first launch the purges an earlier install owed: the files are new', () => {
    owedPurgesOnDevice().add(OWED_OF_A);

    launchInIsolation();

    expect(storedOwedPurges()).toStrictEqual([]);
    expect(appFileValues()?.[DEVICE_PURGE_MARKER_STORAGE_KEY]).toBeUndefined();
  });

  it('carries nothing from a damaged owed purge document, reported, never thrown', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    seedEarlierLaunch({});
    mockDevice.seedSecureItem(`tsuzuki.documents.${DEVICE_PURGE_MARKER_STORAGE_KEY}`, 'not json {');

    expect(() => launchInIsolation()).not.toThrow();

    expect(appFileValues()?.[DEVICE_PURGE_MARKER_STORAGE_KEY]).toBeUndefined();
    expect(warn.mock.calls).toStrictEqual([
      ['[device-purge-marker]', expect.objectContaining({ problem: 'invalid-json' })],
    ]);
  });
});
