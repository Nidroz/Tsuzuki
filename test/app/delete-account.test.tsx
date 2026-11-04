import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { STORAGE_INSTANCE_ID } from '@platform/storage';
import { onlineManager } from '@tanstack/react-query';
// react native testing library 14's act is async; expo-router re-exports it typed as react's act
import { act, userEvent } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { screen } from 'expo-router/testing-library';
import { createMMKV } from 'react-native-mmkv';

import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeNetworkModule from '../mobile/fake-network-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import { renderRouterAsync } from '../mobile/render-router';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import { APP_ROUTES } from './app-routes';
import { visibleHeaderTitles } from './native-header';

// the account deletion through the composition root (A-06, FR-24, ADR-0018): Settings opens the
// deletion screen, which deletes after two taps, purges the device and signs it out, then returns
// to Settings signed out; a link to the screen never deletes anything, nor does an offline device.
// every supabase factory is a fake (no real client), the device network a fake driving the real
// connectivity binding

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
jest.mock('@core/repositories/supabase/library-repository', () =>
  jest
    .requireActual<typeof FakeSupabaseModule>('../mobile/fake-supabase-module')
    .fakeSupabaseLibraryModule(),
);

// no http: the settings and deletion screens read no catalog data
jest.mock('@core/catalog/jikan/jikan-catalog-provider', () =>
  jest.requireActual<typeof FakeJikanModule>('../mobile/fake-jikan-module').fakeJikanModule(),
);

jest.mock('expo-network', () =>
  jest.requireActual<typeof FakeNetworkModule>('../mobile/fake-network-module').fakeNetworkModule(),
);

jest.mock('expo-localization', () => ({
  ...jest.requireActual<typeof Localization>('expo-localization'),
  useLocales: () => [{ languageTag: 'en-US' }],
}));

// the layout opens its storage when it is imported: the shared instance lets the test clear it
jest.mock('react-native-mmkv', () =>
  jest.requireActual<typeof SharedMmkv>('../mobile/shared-mmkv').sharedMmkvModule(),
);

// read from the mock registry: a static import would load the modules before @jest/globals,
// which the hoisted factories above need
const supabaseAuthModule = jest.requireMock<FakeSupabaseModule.FakeSupabaseAuthModule>(
  '@core/repositories/supabase/auth-repository',
);
const supabaseLibraryModule = jest.requireMock<FakeSupabaseModule.FakeSupabaseLibraryModule>(
  '@core/repositories/supabase/library-repository',
);
const { network } = jest.requireMock<FakeNetworkModule.FakeNetworkModule>('expo-network');
const { appAuthRepositoryOf } = jest.requireActual<typeof FakeSupabaseModule>(
  '../mobile/fake-supabase-module',
);

const appStorage = createMMKV({ id: STORAGE_INSTANCE_ID });

// the repository the layout created when it loaded
const appAuthRepository = () => appAuthRepositoryOf(supabaseAuthModule);

// a placeholder user id
const USER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const DELETE_PATH = '/account/delete';
const SETTINGS_PATH = '/settings';

const settle = async () => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
};

const reportSession = async (userId: string | null) => {
  await act(async () => {
    supabaseAuthModule.sessionSource.emit(userId === null ? null : { userId });
    await jest.advanceTimersByTimeAsync(0);
  });
};

const setDeviceOnline = async (online: boolean) => {
  await act(async () => {
    network.setOnline(online);
    await jest.advanceTimersByTimeAsync(0);
  });
};

// the destructive button, then the destructive confirmation
const deleteAndConfirm = async () => {
  const user = userEvent.setup();
  await user.press(screen.getByTestId('delete-account-delete'));
  await user.press(screen.getByTestId('delete-account-confirm-confirm'));
  await settle();
};

beforeEach(() => {
  appStorage.clearAll();
  supabaseLibraryModule.accountEntries.clear();
  supabaseLibraryModule.accountSetups.length = 0;
  // no listener between tests: this sets the session the next mount reports, signed out
  supabaseAuthModule.sessionSource.emit(null);
  const auth = appAuthRepository();
  auth.deleteAccount.mockClear();
  auth.deleteAccount.mockImplementation(() => Promise.resolve());
  // the local sign out ends the session, as supabase-js does
  auth.signOut.mockClear();
  auth.signOut.mockImplementation(() => {
    supabaseAuthModule.sessionSource.emit(null);
    return Promise.resolve();
  });
});

afterEach(() => {
  network.setOnline(true);
  onlineManager.setOnline(true);
});

describe('account deletion route (A-06)', () => {
  it('deletes the account from Settings after two taps, then returns to Settings signed out', async () => {
    const user = userEvent.setup();
    const router = await renderRouterAsync(APP_ROUTES, { initialUrl: SETTINGS_PATH });
    await reportSession(USER_ID);

    await user.press(screen.getByTestId('settings-account-delete-account'));

    expect(router.getPathname()).toBe(DELETE_PATH);
    expect(visibleHeaderTitles()).toStrictEqual(['Delete account']);

    await deleteAndConfirm();

    expect(appAuthRepository().deleteAccount).toHaveBeenCalledTimes(1);
    expect(appAuthRepository().signOut).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('delete-account-deleted')).toBeOnTheScreen();
    expect(screen.queryByTestId('delete-account-signed-out')).not.toBeOnTheScreen();

    await user.press(screen.getByTestId('delete-account-back'));

    expect(router.getPathname()).toBe(SETTINGS_PATH);
    expect(screen.queryByTestId('delete-account-screen')).not.toBeOnTheScreen();
    expect(screen.getByTestId('settings-account-sign-in')).toBeOnTheScreen();
    expect(screen.queryByTestId('settings-account-signed-in')).not.toBeOnTheScreen();
  });

  it('opens from a link while signed out on the sign in state, and never deletes', async () => {
    const router = await renderRouterAsync(APP_ROUTES, { initialUrl: DELETE_PATH });
    await settle();

    expect(router.getPathname()).toBe(DELETE_PATH);
    expect(await screen.findByTestId('delete-account-signed-out')).toBeOnTheScreen();
    expect(screen.queryByTestId('delete-account-delete')).not.toBeOnTheScreen();
    expect(appAuthRepository().deleteAccount).not.toHaveBeenCalled();
  });

  it('shows the offline error without sending anything, still signed in', async () => {
    await renderRouterAsync(APP_ROUTES, { initialUrl: DELETE_PATH });
    await reportSession(USER_ID);
    await setDeviceOnline(false);

    await deleteAndConfirm();

    expect(await screen.findByTestId('delete-account-error')).toHaveTextContent(
      'You are offline. Connect to the internet to delete your account. Nothing was deleted.',
    );
    expect(appAuthRepository().deleteAccount).not.toHaveBeenCalled();
    expect(appAuthRepository().signOut).not.toHaveBeenCalled();
    expect(screen.getByTestId('delete-account-form')).toBeOnTheScreen();
  });
});
