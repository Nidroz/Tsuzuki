import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
// react native testing library 14's act is async; expo-router re-exports it typed as react's act
import { act, userEvent, waitFor } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { router } from 'expo-router';
import { screen } from 'expo-router/testing-library';

import en from '../../src/core/i18n/en.json';
import type * as FakeJikanModule from '../mobile/fake-jikan-module';
import type * as FakeSupabaseModule from '../mobile/fake-supabase-module';
import { renderRouterAsync } from '../mobile/render-router';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import { APP_ROUTES } from './app-routes';
import { visibleBackButtons, visibleHeaderTitles } from './native-header';

// the auth routes (A-01, ADR-0014) through the real root layout: the email links open their
// screens with a translated header and write nothing, and the account section leads to sign in
// and sign up. the auth repository is the fake the mocked supabase factory returns

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

// read from the mock registry: a static import would load the module before @jest/globals
const supabaseAuthModule = jest.requireMock<FakeSupabaseModule.FakeSupabaseAuthModule>(
  '@core/repositories/supabase/auth-repository',
);
const { appAuthRepositoryOf } = jest.requireActual<typeof FakeSupabaseModule>(
  '../mobile/fake-supabase-module',
);

// the repository the layout created when it loaded
const appAuthRepository = () => appAuthRepositoryOf(supabaseAuthModule);

const CODE = '3f2a9c1e-5b7d-4e8f-a1b2-c3d4e5f6a7b8';
const FLOW_ID = 'flow_id-12345';
const LINK_QUERY = `?sb_flow_id=${FLOW_ID}&code=${CODE}`;
const SESSION = { userId: '7d4c0f52-7b8e-4a43-9f8a-2f1b3c4d5e6f' };
// low-entropy placeholders: the oauth route never reads them
const OAUTH_QUERY =
  '?sb_flow_id=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee&code=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

beforeEach(() => {
  const repository = appAuthRepository();
  repository.completeEmailLink.mockClear();
  repository.updatePassword.mockClear();
  repository.signInWithProvider.mockClear();
});

afterEach(() => {
  // the default of every A-02 build: no provider
  appAuthRepository().oauthProviders = [];
});

const openLink = (url: string) => renderRouterAsync(APP_ROUTES, { initialUrl: url });

describe('auth routes', () => {
  it.each([
    ['/auth/sign-in', 'auth-sign-in-screen', en.auth.signIn.title],
    ['/auth/sign-up', 'auth-sign-up-screen', en.auth.signUp.title],
    ['/auth/forgot-password', 'auth-forgot-password-screen', en.auth.forgotPassword.title],
    [`/auth/callback${LINK_QUERY}`, 'auth-callback-screen', en.auth.emailConfirmed.title],
    [
      `/auth/reset-password${LINK_QUERY}`,
      'auth-reset-password-screen',
      en.auth.resetPassword.title,
    ],
    [
      `/auth/oauth-callback${OAUTH_QUERY}`,
      'auth-oauth-callback-interrupted',
      en.auth.oauthCallback.title,
    ],
  ])(
    'opens %s with its translated header and a minimal back button',
    async (url, testID, title) => {
      await openLink(url);

      expect(screen.getByTestId(testID)).toBeOnTheScreen();
      expect(visibleHeaderTitles()).toStrictEqual([title]);
      for (const backButton of visibleBackButtons()) {
        expect(backButton).toMatchObject({ minimal: true, disableBackButtonMenu: true });
      }
    },
  );

  it('opens the confirmation link without exchanging its code; Continue does, then settings', async () => {
    const appRouter = await openLink(`/auth/callback${LINK_QUERY}`);
    const repository = appAuthRepository();

    expect(screen.getByTestId('auth-callback-confirmed')).toBeOnTheScreen();
    expect(repository.completeEmailLink).not.toHaveBeenCalled();

    repository.completeEmailLink.mockResolvedValueOnce(SESSION);
    await userEvent.setup().press(screen.getByRole('button', { name: 'Continue' }));

    expect(repository.completeEmailLink).toHaveBeenCalledWith({ code: CODE, flowId: FLOW_ID });
    await waitFor(() => {
      expect(appRouter.getPathname()).toBe('/settings');
    });
  });

  it('opens the recovery link without exchanging its code', async () => {
    await openLink(`/auth/reset-password${LINK_QUERY}`);
    const repository = appAuthRepository();

    expect(screen.getByLabelText('New password')).toBeOnTheScreen();
    expect(repository.completeEmailLink).not.toHaveBeenCalled();
    expect(repository.updatePassword).not.toHaveBeenCalled();
  });

  it('shows an expired confirmation link from its error params', async () => {
    await openLink('/auth/callback?error=access_denied&error_code=otp_expired');

    expect(screen.getByTestId('auth-callback-expired')).toBeOnTheScreen();
    expect(appAuthRepository().completeEmailLink).not.toHaveBeenCalled();
  });

  it('leads from the settings to sign in, to sign up and back', async () => {
    const appRouter = await openLink('/settings');
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Sign in' }));

    expect(appRouter.getPathname()).toBe('/auth/sign-in');

    await user.press(screen.getByRole('button', { name: 'Create an account' }));

    expect(appRouter.getPathname()).toBe('/auth/sign-up');
    expect(screen.getByTestId('auth-sign-up-screen')).toBeOnTheScreen();

    await act(() => {
      router.back();
    });

    expect(appRouter.getPathname()).toBe('/auth/sign-in');

    // sign up, then "I already have an account" returns to the sign in below instead of stacking one
    await user.press(screen.getByRole('button', { name: 'Create an account' }));
    await user.press(screen.getByRole('button', { name: 'I already have an account' }));

    expect(appRouter.getPathname()).toBe('/auth/sign-in');

    await act(() => {
      router.back();
    });

    expect(appRouter.getPathname()).toBe('/settings');
  });

  it('goes back from the oauth redirect to the sign in screen awaiting the flow, writing nothing', async () => {
    const appRouter = await openLink('/auth/sign-in');
    const repository = appAuthRepository();

    await act(() => {
      router.push(`/auth/oauth-callback${OAUTH_QUERY}`);
    });

    await waitFor(() => {
      expect(appRouter.getPathname()).toBe('/auth/sign-in');
    });
    expect(screen.getByTestId('auth-sign-in-screen')).toBeOnTheScreen();
    expect(repository.signInWithProvider).not.toHaveBeenCalled();
    expect(repository.completeEmailLink).not.toHaveBeenCalled();
  });

  it('says sign in did not finish when the oauth redirect starts the app, then leads to sign in', async () => {
    const appRouter = await openLink(`/auth/oauth-callback${OAUTH_QUERY}`);
    const repository = appAuthRepository();

    expect(screen.getByTestId('auth-oauth-callback-interrupted')).toBeOnTheScreen();
    expect(appRouter.getPathname()).toBe('/auth/oauth-callback');

    await userEvent.setup().press(screen.getByRole('button', { name: 'Sign in' }));

    expect(appRouter.getPathname()).toBe('/auth/sign-in');
    expect(repository.signInWithProvider).not.toHaveBeenCalled();
    expect(repository.completeEmailLink).not.toHaveBeenCalled();
  });

  it('shows no provider button on sign in while the repository lists none', async () => {
    await openLink('/auth/sign-in');

    expect(screen.queryByTestId('auth-sign-in-oauth-google')).not.toBeOnTheScreen();
  });

  it('shows a button per provider the repository lists', async () => {
    appAuthRepository().oauthProviders = ['apple', 'google'];
    await openLink('/auth/sign-in');

    expect(screen.getByTestId('auth-sign-in-oauth-apple')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-sign-in-oauth-google')).toBeOnTheScreen();
  });
});
