// the device mocks below read this binding: imported first, before anything loads them
import * as mockDevice from '@platform/__fixtures__/app-storage-device';

import { LANGUAGE_PREFERENCE_KEY } from '@core/preferences/index';
import { describe, expect, it, jest } from '@jest/globals';
import type * as CryptoDevice from '@platform/__fixtures__/expo-crypto-device';
import { openAppStorage } from '@platform/app-storage';
import type * as AppStorageModule from '@platform/app-storage';
import { APP_STORAGE_INSTANCE_ID } from '@platform/app-storage-instance';
import { secureRandomValues } from '@platform/web-crypto';
import { within } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { screen } from 'expo-router/testing-library';

import fr from '../../src/core/i18n/fr.json';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import { renderRouterAsync } from '../mobile/render-router';
import type * as AppRoutes from './app-routes';
import { seedEarlierLaunch, STORED_KEY } from './app-storage-support';

// the app storage the composition root opens (ADR-0020, R-09): once, through openAppStorage with
// the secure random source, before anything reads it, so the preferences of the first frame come
// from the encrypted instance an earlier launch left. the device is in memory
// (app-storage-support.ts); the layout loads once, as the test starts

jest.mock('react-native-mmkv', () => mockDevice.fakeMmkvModule());
jest.mock('expo-secure-store', () => mockDevice.fakeSecureStoreModule());
jest.mock('expo-crypto', () =>
  jest
    .requireActual<typeof CryptoDevice>('@platform/__fixtures__/expo-crypto-device')
    .fakeExpoCryptoModule(),
);
// the real module, its calls recorded
jest.mock('@platform/app-storage', () => {
  const actual = jest.requireActual<typeof AppStorageModule>('@platform/app-storage');
  return { ...actual, openAppStorage: jest.fn(actual.openAppStorage) };
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
jest.mock('expo-localization', () => ({
  ...jest.requireActual<typeof Localization>('expo-localization'),
  useLocales: () => [{ languageTag: 'en-US' }],
}));

describe('root layout app storage at launch', () => {
  it('opens the encrypted storage once, with the secure source, and reads the preferences from it', async () => {
    mockDevice.resetDevice();
    seedEarlierLaunch({ [LANGUAGE_PREFERENCE_KEY]: 'fr' });
    const { APP_ROUTES } = jest.requireActual<typeof AppRoutes>('./app-routes');

    await renderRouterAsync(APP_ROUTES);

    // the stored language, at the first frame
    expect(within(screen.getByTestId('tab-discover')).getByText(fr.tabs.discover)).toBeTruthy();
    expect(jest.mocked(openAppStorage).mock.calls).toStrictEqual([
      [{ reporter: expect.anything(), getRandomValues: secureRandomValues }],
    ]);
    // the stored key opened the encrypted instance; nothing opened the unencrypted one
    expect(mockDevice.device.configurations).toStrictEqual([
      { id: APP_STORAGE_INSTANCE_ID, encryptionKey: STORED_KEY, encryptionType: 'AES-256' },
    ]);
  });
});
