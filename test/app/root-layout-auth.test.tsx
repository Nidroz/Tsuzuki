import { useAuthContext } from '@core/hooks/use-auth-context';
import type { AuthRepository } from '@core/repositories/auth-repository';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
// react native testing library 14's act is async; expo-router re-exports it typed as react's act
import { act } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { screen } from 'expo-router/testing-library';
import { useEffect } from 'react';
import { AppState, Text, type AppStateStatus } from 'react-native';

import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import { renderRouterAsync } from '../mobile/render-router';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import { appRoutesWithDiscover } from './app-routes';

// the auth wiring (A-01): the composition root (app/_layout.tsx) creates the supabase client from
// the app env over the secure session storage and the auth repository over it, once, when the
// layout module loads, with the app's own email link urls; it gives that repository to the auth
// hooks and binds its token auto refresh to the app foreground. both factories are fakes: no test
// creates a real supabase client

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

jest.mock('react-native-mmkv', () =>
  jest.requireActual<typeof SharedMmkv>('../mobile/shared-mmkv').sharedMmkvModule(),
);

// read from the mock registry: a static import would load the modules before @jest/globals,
// which the hoisted factories above need
const supabaseClientModule = jest.requireMock<FakeSupabaseModule.FakeSupabaseClientModule>(
  '@core/repositories/supabase/create-supabase-client',
);
const supabaseAuthModule = jest.requireMock<FakeSupabaseModule.FakeSupabaseAuthModule>(
  '@core/repositories/supabase/auth-repository',
);
const createClient = supabaseClientModule.createSupabaseClient;
const createAuthRepository = supabaseAuthModule.createSupabaseAuthRepository;
const { FAKE_SUPABASE_CLIENT, appAuthRepositoryOf } = jest.requireActual<typeof FakeSupabaseModule>(
  '../mobile/fake-supabase-module',
);

// the env of test/mobile/setup.ts
const SUPABASE_URL = 'https://test-project.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_test-key';

// the repository the layout created when it loaded
const appAuthRepository = () => appAuthRepositoryOf(supabaseAuthModule);

// the react native jest preset mocks AppState: the current state is set (and restored), and the
// change handler captured
const presetCurrentState: unknown = AppState.currentState;
let appStateHandler: ((state: AppStateStatus) => void) | null = null;
const removeAppStateListener = jest.fn<() => void>();

beforeEach(() => {
  Reflect.set(AppState, 'currentState', presetCurrentState);
  appStateHandler = null;
  removeAppStateListener.mockClear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    appStateHandler = handler;
    return { remove: removeAppStateListener };
  });
  appAuthRepository().setAutoRefresh.mockClear();
});

const STATUS_TEST_ID = 'auth-status';
const seen: { repository: AuthRepository | null } = { repository: null };

function AuthProbe() {
  const { repository, state } = useAuthContext();
  useEffect(() => {
    seen.repository = repository;
  }, [repository]);
  return <Text testID={STATUS_TEST_ID}>{state.status}</Text>;
}

describe('root layout auth wiring (A-01)', () => {
  it('creates one supabase client from the app env, its session in the secure store', () => {
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith({
      url: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
      sessionStorage: expect.objectContaining({
        getItem: expect.any(Function),
        setItem: expect.any(Function),
        removeItem: expect.any(Function),
      }),
    });
  });

  it('creates one auth repository over that client, with the app email link urls', () => {
    expect(createAuthRepository).toHaveBeenCalledTimes(1);
    expect(createAuthRepository).toHaveBeenCalledWith(FAKE_SUPABASE_CLIENT, {
      confirmationRedirectUrl: 'tsuzuki://auth/callback',
      passwordResetRedirectUrl: 'tsuzuki://auth/reset-password',
      reporter: expect.objectContaining({ captureError: expect.any(Function) }),
    });
  });

  it('gives the auth hooks that repository and its session', async () => {
    await renderRouterAsync(appRoutesWithDiscover(AuthProbe));

    expect(seen.repository).toBe(appAuthRepository());
    expect(screen.getByTestId(STATUS_TEST_ID)).toHaveTextContent('signed-out');
  });

  it('runs the token auto refresh only while the app is in the foreground', async () => {
    Reflect.set(AppState, 'currentState', 'active');
    const { setAutoRefresh } = appAuthRepository();

    await renderRouterAsync(appRoutesWithDiscover(AuthProbe));

    expect(setAutoRefresh.mock.calls).toStrictEqual([[true]]);

    await act(() => {
      appStateHandler?.('background');
    });
    await act(() => {
      appStateHandler?.('active');
    });

    expect(setAutoRefresh.mock.calls).toStrictEqual([[true], [false], [true]]);
  });

  it('stops following the app state when the layout unmounts', async () => {
    await renderRouterAsync(appRoutesWithDiscover(AuthProbe));

    expect(appAuthRepository().setAutoRefresh).toHaveBeenLastCalledWith(false);
    expect(removeAppStateListener).not.toHaveBeenCalled();

    await screen.unmount();

    expect(removeAppStateListener).toHaveBeenCalledTimes(1);
  });
});
