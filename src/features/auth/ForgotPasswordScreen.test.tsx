import { AuthError } from '@core/errors/auth-errors';
import type { AuthRepository } from '@core/repositories/auth-repository';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { createSessionAuthRepository } from '../../../test/core/fake-auth-repository';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { ForgotPasswordScreen } from './ForgotPasswordScreen';

const EMAIL = 'reader@example.test';

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
  await renderWithProviders(<ForgotPasswordScreen />, { authRepository: repository });
  return repository;
};

const send = async (email: string) => {
  const user = userEvent.setup();
  if (email !== '') {
    await user.type(screen.getByLabelText('Email'), email);
  }
  await user.press(screen.getByRole('button', { name: 'Send the link' }));
  return user;
};

describe('ForgotPasswordScreen', () => {
  it('explains the email and shows a labelled email field', async () => {
    await renderScreen();

    expect(screen.getByTestId('auth-forgot-password-screen')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Enter the email address of your account: we will send you a link to choose a new password.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Email')).toHaveProp('autoComplete', 'email');
  });

  it.each([
    ['', 'Enter your email address.'],
    ['reader@', 'Enter a valid email address.'],
    [`${'a'.repeat(250)}@b.cd`, 'An email address has at most 254 characters.'],
  ])('rejects the email %j before any call', async (email, message) => {
    const repository = await renderScreen();

    await send(email);

    expect(screen.getByTestId('auth-forgot-password-email-error')).toHaveTextContent(message);
    expect(repository.requestPasswordReset).not.toHaveBeenCalled();
  });

  // the same state whether or not an account exists: the screen never tells which addresses do
  it.each([EMAIL, 'unknown@example.test'])(
    'asks for the recovery email of %s, then shows the neutral sent state',
    async (email) => {
      const repository = await renderScreen({ requestPasswordReset: () => Promise.resolve() });

      await send(email);

      expect(await screen.findByTestId('auth-forgot-password-sent')).toHaveTextContent(
        `If an account exists for ${email}, we sent it a link to choose a new password. Open it on this device.`,
        { exact: false },
      );
      expect(screen.getByRole('header', { name: 'Check your email' })).toBeOnTheScreen();
      expect(repository.requestPasswordReset).toHaveBeenCalledWith(email, undefined);
    },
  );

  it('goes back to sign in from the sent state', async () => {
    await renderScreen({ requestPasswordReset: () => Promise.resolve() });
    const user = await send(EMAIL);

    await user.press(await screen.findByRole('button', { name: 'Back to sign in' }));

    expect(mockDismissTo).toHaveBeenCalledWith('/auth/sign-in');
  });

  it('shows a translated error and keeps the form', async () => {
    await renderScreen({
      requestPasswordReset: () => Promise.reject(new AuthError('rate-limited')),
    });

    await send(EMAIL);

    expect(await screen.findByTestId('auth-forgot-password-error')).toHaveTextContent(
      'Too many attempts. Wait a moment, then try again.',
    );
    expect(screen.getByLabelText('Email')).toBeOnTheScreen();
  });
});
