import { AuthError } from '@core/errors/auth-errors';
import type { AuthRepository, AuthSession } from '@core/repositories/auth-repository';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, screen, userEvent, within } from '@testing-library/react-native';

import {
  createFakeAuthRepository,
  createSessionSource,
} from '../../../test/core/fake-auth-repository';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { AccountSection } from './AccountSection';

const SESSION: AuthSession = { userId: '7d4c0f52-7b8e-4a43-9f8a-2f1b3c4d5e6f' };
const TEST_ID = 'settings-account';

const mockPush = jest.fn<(href: string) => void>();

// the real module otherwise: the theme provider builds the navigation theme from it
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ push: mockPush }),
}));

beforeEach(() => {
  mockPush.mockClear();
});

const renderSection = async (
  session: AuthSession | null,
  overrides: Partial<AuthRepository> = {},
) => {
  const source = createSessionSource(session);
  const repository = createFakeAuthRepository({
    onAuthStateChange: source.subscribe,
    ...overrides,
  });
  await renderWithProviders(<AccountSection />, { authRepository: repository });
  return { repository, source };
};

describe('AccountSection', () => {
  it('shows a spinner until the session is known', async () => {
    // a repository that never reports the session
    await renderWithProviders(<AccountSection />, {
      authRepository: createFakeAuthRepository({ onAuthStateChange: () => () => undefined }),
    });

    const section = screen.getByTestId(TEST_ID);

    expect(within(section).getByText('Account')).toBeOnTheScreen();
    expect(
      within(section).getByRole('progressbar', { name: 'Loading your account' }),
    ).toBeOnTheScreen();
    expect(within(section).queryByRole('button')).not.toBeOnTheScreen();
  });

  it('offers sign in and create an account while signed out', async () => {
    await renderSection(null);
    const user = userEvent.setup();

    expect(
      screen.getByText('You are not signed in. Your library stays on this device.'),
    ).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Sign in' }));
    await user.press(screen.getByRole('button', { name: 'Create an account' }));

    expect(mockPush.mock.calls).toStrictEqual([['/auth/sign-in'], ['/auth/sign-up']]);
  });

  it('shows the signed-in state without any personal data, and signs out', async () => {
    const { repository, source } = await renderSection(SESSION, {
      signOut: () => {
        source.emit(null);
        return Promise.resolve();
      },
    });
    const user = userEvent.setup();

    expect(screen.getByTestId(`${TEST_ID}-signed-in`)).toHaveTextContent('You are signed in.');
    expect(screen.queryByText(SESSION.userId, { exact: false })).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Sign out' }));

    expect(repository.signOut).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeOnTheScreen();
    expect(screen.queryByTestId(`${TEST_ID}-signed-in`)).not.toBeOnTheScreen();
  });

  it('shows a translated error when signing out fails, and stays signed in', async () => {
    await renderSection(SESSION, { signOut: () => Promise.reject(new AuthError('network')) });

    await userEvent.setup().press(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByTestId(`${TEST_ID}-error`)).toHaveTextContent(
      'The server could not be reached. Check your connection, then try again.',
    );
    expect(screen.getByTestId(`${TEST_ID}-signed-in`)).toBeOnTheScreen();
  });

  it('follows a sign in made elsewhere', async () => {
    const { source } = await renderSection(null);

    await act(() => {
      source.emit(SESSION);
    });

    expect(screen.getByTestId(`${TEST_ID}-signed-in`)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeOnTheScreen();
  });
});
