import { AuthError, type AuthErrorReason } from '@core/errors/auth-errors';
import type { AuthRepository } from '@core/repositories/auth-repository';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { createSessionAuthRepository } from '../../../test/core/fake-auth-repository';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { SignUpScreen } from './SignUpScreen';

const EMAIL = 'reader@example.test';
const PASSWORD = 'correct-horse-42';
const SENT_MESSAGE = `We sent a confirmation link to ${EMAIL}. Open it on this device to confirm your address, then sign in.`;

const mockDismissTo = jest.fn<(href: string) => void>();

// the real module otherwise: the theme provider builds the navigation theme from it
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ dismissTo: mockDismissTo }),
}));

beforeEach(() => {
  mockDismissTo.mockClear();
});

const renderScreen = async (overrides: Partial<AuthRepository> = {}) => {
  const repository = createSessionAuthRepository(null, overrides);
  await renderWithProviders(<SignUpScreen />, { authRepository: repository });
  return repository;
};

const fill = async (email: string, password: string, confirmation: string) => {
  const user = userEvent.setup();
  for (const [label, text] of [
    ['Email', email],
    ['Password', password],
    ['Confirm password', confirmation],
  ] as const) {
    if (text !== '') {
      await user.type(screen.getByLabelText(label), text);
    }
  }
  return user;
};

const submit = (user: ReturnType<typeof userEvent.setup>) =>
  user.press(screen.getByRole('button', { name: 'Create the account' }));

describe('SignUpScreen', () => {
  it('shows the email, a new password with the policy and its confirmation', async () => {
    await renderScreen();

    expect(screen.getByTestId('auth-sign-up-screen')).toBeOnTheScreen();
    expect(screen.getByLabelText('Email')).toHaveProp('autoComplete', 'email');
    for (const label of ['Password', 'Confirm password']) {
      expect(screen.getByLabelText(label)).toHaveProp('autoComplete', 'new-password');
      expect(screen.getByLabelText(label)).toHaveProp('secureTextEntry', true);
    }
    expect(
      screen.getByText('At least 10 characters, with a letter and a digit.'),
    ).toBeOnTheScreen();
  });

  it.each([
    ['short', 'abc123', 'abc123', 'password', 'Use at least 10 characters.'],
    [
      'without a digit',
      'correct-horse',
      'correct-horse',
      'password',
      'Add at least one digit (0 to 9).',
    ],
    [
      'without a letter',
      '1234567890',
      '1234567890',
      'password',
      'Add at least one letter (A to Z).',
    ],
    [
      'over 72 bytes',
      `a1${'é'.repeat(36)}`,
      `a1${'é'.repeat(36)}`,
      'password',
      'This password is too long: at most 72 characters, fewer with accents or emoji.',
    ],
    [
      'with another confirmation',
      PASSWORD,
      `${PASSWORD}!`,
      'password-confirmation',
      'The two passwords do not match.',
    ],
  ])(
    'rejects a password %s before any call',
    async (_case, password, confirmation, field, message) => {
      const repository = await renderScreen();
      const user = await fill(EMAIL, password, confirmation);

      await submit(user);

      expect(screen.getByTestId(`auth-sign-up-${field}-error`)).toHaveTextContent(message);
      expect(repository.signUp).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['a new address', () => Promise.resolve()],
    // supabase answers a registered address the same way: the screen cannot tell them apart
    ['an address already registered', () => Promise.resolve()],
  ])('shows the check-your-email state for %s', async (_case, signUp) => {
    const repository = await renderScreen({ signUp });
    const user = await fill(` ${EMAIL}`, PASSWORD, PASSWORD);

    await submit(user);

    expect(await screen.findByTestId('auth-sign-up-sent')).toHaveTextContent(SENT_MESSAGE, {
      exact: false,
    });
    expect(screen.getByRole('header', { name: 'Check your email' })).toBeOnTheScreen();
    expect(repository.signUp).toHaveBeenCalledWith({ email: EMAIL, password: PASSWORD }, undefined);
    expect(screen.queryByLabelText('Password')).not.toBeOnTheScreen();
  });

  it('resends the confirmation email from the sent state, then says so', async () => {
    const repository = await renderScreen({
      signUp: () => Promise.resolve(),
      resendConfirmation: () => Promise.resolve(),
    });
    const user = await fill(EMAIL, PASSWORD, PASSWORD);
    await submit(user);

    await user.press(await screen.findByRole('button', { name: 'Resend the email' }));

    expect(await screen.findByTestId('auth-sign-up-resent')).toHaveTextContent(
      'We sent the email again.',
    );
    expect(repository.resendConfirmation).toHaveBeenCalledWith(EMAIL, undefined);
  });

  it('shows a failed resend', async () => {
    await renderScreen({
      signUp: () => Promise.resolve(),
      resendConfirmation: () => Promise.reject(new AuthError('network')),
    });
    const user = await fill(EMAIL, PASSWORD, PASSWORD);
    await submit(user);

    await user.press(await screen.findByRole('button', { name: 'Resend the email' }));

    expect(await screen.findByTestId('auth-sign-up-resend-error')).toHaveTextContent(
      'The server could not be reached. Check your connection, then try again.',
    );
  });

  it('goes to sign in from the sent state', async () => {
    await renderScreen({ signUp: () => Promise.resolve() });
    const user = await fill(EMAIL, PASSWORD, PASSWORD);
    await submit(user);

    await user.press(await screen.findByRole('button', { name: 'Go to sign in' }));

    expect(mockDismissTo).toHaveBeenCalledWith('/auth/sign-in');
  });

  it.each<[AuthErrorReason, string]>([
    ['weak-password', 'This password is not accepted. Choose another one.'],
    ['captcha-failed', 'The security check failed. Try again.'],
  ])('shows the translated %s error and keeps the form', async (reason, message) => {
    await renderScreen({ signUp: () => Promise.reject(new AuthError(reason)) });
    const user = await fill(EMAIL, PASSWORD, PASSWORD);

    await submit(user);

    expect(await screen.findByTestId('auth-sign-up-error')).toHaveTextContent(message);
    expect(screen.getByLabelText('Password')).toBeOnTheScreen();
  });

  it('shows an address the server rejects under the email field, until it is edited', async () => {
    await renderScreen({ signUp: () => Promise.reject(new AuthError('invalid-email')) });
    const user = await fill(EMAIL, PASSWORD, PASSWORD);

    await submit(user);

    expect(await screen.findByTestId('auth-sign-up-email-error')).toHaveTextContent(
      'This email address is not accepted. Check it, or use another one.',
    );
    expect(screen.queryByTestId('auth-sign-up-error')).not.toBeOnTheScreen();

    await user.type(screen.getByLabelText('Email'), 'x');

    expect(screen.queryByTestId('auth-sign-up-email-error')).not.toBeOnTheScreen();
    expect(screen.getByLabelText('Password')).toBeOnTheScreen();
  });

  it('goes to sign in when the user already has an account', async () => {
    await renderScreen();
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'I already have an account' }));

    expect(mockDismissTo).toHaveBeenCalledWith('/auth/sign-in');
  });
});
