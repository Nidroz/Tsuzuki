import { AuthError, type AuthErrorReason } from '@core/errors/auth-errors';
import type { AuthRepository, AuthSession } from '@core/repositories/auth-repository';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, screen, userEvent } from '@testing-library/react-native';

import { createSessionAuthRepository } from '../../../test/core/fake-auth-repository';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { OAuthButtons } from './OAuthButtons';

const SESSION = { userId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' };
const BOTH: AuthRepository['oauthProviders'] = ['google', 'apple'];

const mockDismissTo = jest.fn<(href: string) => void>();

// the real module otherwise: the theme provider builds the navigation theme from it
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ dismissTo: mockDismissTo }),
}));

beforeEach(() => {
  mockDismissTo.mockClear();
});

const renderButtons = async (
  overrides: Partial<AuthRepository> = {},
  language: 'en' | 'fr' = 'en',
) => {
  const repository = createSessionAuthRepository(null, { oauthProviders: BOTH, ...overrides });
  await renderWithProviders(<OAuthButtons testIdPrefix="auth-test" />, {
    authRepository: repository,
    language,
  });
  return repository;
};

const pressGoogle = () =>
  userEvent.setup().press(screen.getByRole('button', { name: 'Continue with Google' }));

describe('OAuthButtons', () => {
  it('renders nothing while the build has no provider', async () => {
    await renderButtons({ oauthProviders: [] });

    expect(screen.queryByText('or')).not.toBeOnTheScreen();
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  it('shows a labelled button per provider, in the order of the build, under "or"', async () => {
    await renderButtons({ oauthProviders: ['apple', 'google'] });

    expect(screen.getByText('or')).toBeOnTheScreen();
    const buttons = screen.getAllByRole('button');

    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAccessibleName('Continue with Apple');
    expect(buttons[1]).toHaveAccessibleName('Continue with Google');
    expect(screen.getByTestId('auth-test-oauth-apple')).toBeEnabled();
    expect(screen.getByTestId('auth-test-oauth-google')).toBeEnabled();
  });

  it('shows only the providers of the build', async () => {
    await renderButtons({ oauthProviders: ['google'] });

    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeOnTheScreen();
    expect(screen.queryByTestId('auth-test-oauth-apple')).not.toBeOnTheScreen();
  });

  it('signs in with the tapped provider, disables the others meanwhile, then goes to the settings', async () => {
    let finish: (session: AuthSession | null) => void = () => undefined;
    const repository = await renderButtons({
      signInWithProvider: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });

    await pressGoogle();

    expect(repository.signInWithProvider).toHaveBeenCalledWith('google');
    expect(screen.getByTestId('auth-test-oauth-google')).toHaveAccessibleName('Signing in');
    expect(screen.getByTestId('auth-test-oauth-google')).toBeBusy();
    expect(screen.getByTestId('auth-test-oauth-apple')).toBeDisabled();
    expect(mockDismissTo).not.toHaveBeenCalled();

    await act(() => {
      finish(SESSION);
    });

    expect(mockDismissTo).toHaveBeenCalledWith('/settings');
  });

  it('stays as it was, without an error, when the browser was closed', async () => {
    const repository = await renderButtons({ signInWithProvider: () => Promise.resolve(null) });

    await pressGoogle();

    expect(repository.signInWithProvider).toHaveBeenCalledTimes(1);
    expect(mockDismissTo).not.toHaveBeenCalled();
    expect(screen.queryByTestId('auth-test-oauth-error')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  });

  it.each<[AuthErrorReason, string]>([
    ['oauth-failed', 'Sign in with this provider did not work. Try again.'],
    ['network', 'The server could not be reached. Check your connection, then try again.'],
    ['unknown', 'Something went wrong. Try again in a moment.'],
  ])('shows the translated %s error, and a new tap starts again', async (reason, message) => {
    const repository = await renderButtons({
      signInWithProvider: () => Promise.reject(new AuthError(reason)),
    });

    await pressGoogle();

    expect(await screen.findByTestId('auth-test-oauth-error')).toHaveTextContent(message);
    expect(mockDismissTo).not.toHaveBeenCalled();

    repository.signInWithProvider.mockResolvedValueOnce(SESSION);
    await pressGoogle();

    expect(screen.queryByTestId('auth-test-oauth-error')).not.toBeOnTheScreen();
    expect(mockDismissTo).toHaveBeenCalledWith('/settings');
  });

  it('speaks french', async () => {
    await renderButtons({}, 'fr');

    expect(screen.getByText('ou')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Continuer avec Google' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Continuer avec Apple' })).toBeOnTheScreen();
  });
});
