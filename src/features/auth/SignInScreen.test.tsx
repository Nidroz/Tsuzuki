import { AuthError, type AuthErrorReason } from '@core/errors/auth-errors';
import type { AuthRepository } from '@core/repositories/auth-repository';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent, waitFor } from '@testing-library/react-native';

import { createSessionAuthRepository } from '../../../test/core/fake-auth-repository';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { SignInScreen } from './SignInScreen';

const EMAIL = 'reader@example.test';
const PASSWORD = 'correct-horse-42';
const SESSION = { userId: '7d4c0f52-7b8e-4a43-9f8a-2f1b3c4d5e6f' };

const mockDismissTo = jest.fn<(href: string) => void>();
const mockPush = jest.fn<(href: string) => void>();

// the real module otherwise: the theme provider builds the navigation theme from it
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ dismissTo: mockDismissTo, push: mockPush }),
}));

beforeEach(() => {
  mockDismissTo.mockClear();
  mockPush.mockClear();
});

const renderScreen = (overrides: Partial<AuthRepository> = {}) => {
  const repository = createSessionAuthRepository(null, overrides);
  return {
    repository,
    rendered: renderWithProviders(<SignInScreen />, { authRepository: repository }),
  };
};

const fill = async (email: string, password: string) => {
  const user = userEvent.setup();
  if (email !== '') {
    await user.type(screen.getByLabelText('Email'), email);
  }
  if (password !== '') {
    await user.type(screen.getByLabelText('Password'), password);
  }
  return user;
};

const submit = (user: ReturnType<typeof userEvent.setup>) =>
  user.press(screen.getByRole('button', { name: 'Sign in' }));

describe('SignInScreen', () => {
  it('shows labelled email and password fields, filled by password managers', async () => {
    await renderScreen().rendered;

    expect(screen.getByTestId('auth-sign-in-screen')).toBeOnTheScreen();
    expect(screen.getByLabelText('Email')).toHaveProp('autoComplete', 'email');
    expect(screen.getByLabelText('Email')).toHaveProp('keyboardType', 'email-address');
    expect(screen.getByLabelText('Password')).toHaveProp('secureTextEntry', true);
    expect(screen.getByLabelText('Password')).toHaveProp('autoComplete', 'password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeOnTheScreen();
  });

  it('shows the problem of each field and calls nothing when the form is invalid', async () => {
    const { repository, rendered } = renderScreen();
    await rendered;
    const user = await fill('not-an-email', '');

    await submit(user);

    expect(screen.getByTestId('auth-sign-in-email-error')).toHaveTextContent(
      'Enter a valid email address.',
    );
    expect(screen.getByTestId('auth-sign-in-password-error')).toHaveTextContent(
      'Enter your password.',
    );
    expect(repository.signIn).not.toHaveBeenCalled();
  });

  it('clears the problem of a field when the user types in it', async () => {
    await renderScreen().rendered;
    const user = userEvent.setup();
    await submit(user);

    expect(screen.getByTestId('auth-sign-in-email-error')).toHaveTextContent(
      'Enter your email address.',
    );

    await user.type(screen.getByLabelText('Email'), 'r');

    expect(screen.queryByTestId('auth-sign-in-email-error')).not.toBeOnTheScreen();
    expect(screen.getByTestId('auth-sign-in-password-error')).toBeOnTheScreen();
  });

  it('signs in with the trimmed email, then returns to the settings', async () => {
    const { repository, rendered } = renderScreen({ signIn: () => Promise.resolve(SESSION) });
    await rendered;
    const user = await fill(` ${EMAIL} `, PASSWORD);

    await submit(user);

    await waitFor(() => {
      expect(mockDismissTo).toHaveBeenCalledWith('/settings');
    });
    expect(repository.signIn).toHaveBeenCalledWith({ email: EMAIL, password: PASSWORD }, undefined);
  });

  it.each<[AuthErrorReason, string]>([
    ['invalid-credentials', 'Incorrect email or password.'],
    ['network', 'The server could not be reached. Check your connection, then try again.'],
    ['rate-limited', 'Too many attempts. Wait a moment, then try again.'],
  ])('shows the translated %s error and stays', async (reason, message) => {
    await renderScreen({ signIn: () => Promise.reject(new AuthError(reason)) }).rendered;
    const user = await fill(EMAIL, PASSWORD);

    await submit(user);

    expect(await screen.findByTestId('auth-sign-in-error')).toHaveTextContent(message);
    expect(screen.queryByRole('button', { name: 'Resend the confirmation email' })).toBeNull();
    expect(mockDismissTo).not.toHaveBeenCalled();
  });

  it('shows an address the server rejects under the email field, until it is edited', async () => {
    await renderScreen({ signIn: () => Promise.reject(new AuthError('invalid-email')) }).rendered;
    const user = await fill(EMAIL, PASSWORD);

    await submit(user);

    expect(await screen.findByTestId('auth-sign-in-email-error')).toHaveTextContent(
      'This email address is not accepted. Check it, or use another one.',
    );
    expect(screen.queryByTestId('auth-sign-in-error')).not.toBeOnTheScreen();

    await user.type(screen.getByLabelText('Email'), 'x');

    expect(screen.queryByTestId('auth-sign-in-email-error')).not.toBeOnTheScreen();
  });

  it('offers to resend the confirmation email to the submitted address when unconfirmed', async () => {
    const { repository, rendered } = renderScreen({
      signIn: () => Promise.reject(new AuthError('email-not-confirmed')),
      resendConfirmation: () => Promise.resolve(),
    });
    await rendered;
    const user = await fill(EMAIL, PASSWORD);
    await submit(user);
    await screen.findByTestId('auth-sign-in-error');
    // a later edit of the field does not change the address the email goes to
    await user.type(screen.getByLabelText('Email'), 'x');

    await user.press(screen.getByRole('button', { name: 'Resend the confirmation email' }));

    expect(await screen.findByTestId('auth-sign-in-resent')).toHaveTextContent(
      'We sent a new confirmation email. Open its link on this device.',
    );
    expect(repository.resendConfirmation).toHaveBeenCalledTimes(1);
    expect(repository.resendConfirmation).toHaveBeenCalledWith(EMAIL, undefined);
  });

  it('shows a failed resend', async () => {
    await renderScreen({
      signIn: () => Promise.reject(new AuthError('email-not-confirmed')),
      resendConfirmation: () => Promise.reject(new AuthError('rate-limited')),
    }).rendered;
    const user = await fill(EMAIL, PASSWORD);
    await submit(user);

    await user.press(await screen.findByRole('button', { name: 'Resend the confirmation email' }));

    expect(await screen.findByTestId('auth-sign-in-resend-error')).toHaveTextContent(
      'Too many attempts. Wait a moment, then try again.',
    );
  });

  it('leads to forgot password and to create an account', async () => {
    await renderScreen().rendered;
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Forgot your password?' }));
    await user.press(screen.getByRole('button', { name: 'Create an account' }));

    expect(mockPush.mock.calls).toStrictEqual([['/auth/forgot-password'], ['/auth/sign-up']]);
  });

  it('speaks french', async () => {
    await renderWithProviders(<SignInScreen />, {
      authRepository: createSessionAuthRepository(),
      language: 'fr',
    });
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Se connecter' }));

    expect(screen.getByLabelText('Adresse e-mail')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-sign-in-email-error')).toHaveTextContent(
      'Saisissez votre adresse e-mail.',
    );
  });
});
