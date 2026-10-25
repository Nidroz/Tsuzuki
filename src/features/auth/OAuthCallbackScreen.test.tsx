import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { createSessionAuthRepository } from '../../../test/core/fake-auth-repository';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { OAuthCallbackScreen } from './OAuthCallbackScreen';

interface FakeStackState {
  readonly index: number;
  readonly routes: readonly { readonly name: string }[];
}

const mockBack = jest.fn<() => void>();
const mockDismissTo = jest.fn<(href: string) => void>();
let mockStackState: FakeStackState | undefined;

// the real module otherwise: the theme provider builds the navigation theme from it
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ back: mockBack, dismissTo: mockDismissTo }),
  useNavigation: () => ({ getState: () => mockStackState }),
}));

beforeEach(() => {
  mockBack.mockClear();
  mockDismissTo.mockClear();
  mockStackState = undefined;
});

const stackOf = (...names: string[]): FakeStackState => ({
  index: names.length - 1,
  routes: names.map((name) => ({ name })),
});

// the screen never reads the params: a repository whose every auth call rejects proves it writes
// nothing (createSessionAuthRepository)
const renderScreen = async () => {
  const repository = createSessionAuthRepository();
  await renderWithProviders(<OAuthCallbackScreen />, { authRepository: repository });
  return repository;
};

describe('OAuthCallbackScreen', () => {
  it.each([
    ['sign in', stackOf('(tabs)', 'auth/sign-in', 'auth/oauth-callback')],
    ['sign up', stackOf('(tabs)', 'auth/sign-in', 'auth/sign-up', 'auth/oauth-callback')],
  ])(
    'goes back once to the %s screen awaiting the flow, and writes nothing',
    async (_case, state) => {
      mockStackState = state;
      const repository = await renderScreen();

      expect(mockBack).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('auth-oauth-callback-returning')).toBeOnTheScreen();
      expect(screen.getByLabelText('Returning to sign in')).toBeOnTheScreen();
      expect(repository.signInWithProvider).not.toHaveBeenCalled();
      expect(repository.completeEmailLink).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a cold start, with the tabs below', stackOf('(tabs)', 'auth/oauth-callback')],
    [
      'a stray link over another screen',
      stackOf('(tabs)', 'media/[namespace]/[kind]/[id]', 'auth/oauth-callback'),
    ],
    ['no navigation state', undefined],
  ])('says sign in did not finish after %s, and offers sign in', async (_case, state) => {
    mockStackState = state;
    const repository = await renderScreen();

    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.getByTestId('auth-oauth-callback-interrupted')).toBeOnTheScreen();
    expect(screen.getByText('Sign in did not finish')).toBeOnTheScreen();
    expect(screen.getByText('Start again from the sign in screen.')).toBeOnTheScreen();

    await userEvent.setup().press(screen.getByRole('button', { name: 'Sign in' }));

    expect(mockDismissTo).toHaveBeenCalledWith('/auth/sign-in');
    expect(repository.signInWithProvider).not.toHaveBeenCalled();
  });

  it('speaks french', async () => {
    await renderWithProviders(<OAuthCallbackScreen />, {
      authRepository: createSessionAuthRepository(),
      language: 'fr',
    });

    expect(screen.getByText("La connexion n'a pas abouti")).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeOnTheScreen();
  });
});
