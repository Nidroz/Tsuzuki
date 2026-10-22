import { AuthError } from '@core/errors/auth-errors';
import type { AuthRepository } from '@core/repositories/auth-repository';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { createSessionAuthRepository } from '../../../test/core/fake-auth-repository';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { ResetPasswordScreen } from './ResetPasswordScreen';

const CODE = '3f2a9c1e-5b7d-4e8f-a1b2-c3d4e5f6a7b8';
const FLOW_ID = 'flow_id-12345';
const LINK_PARAMS = { code: CODE, sb_flow_id: FLOW_ID };
const LINK = { code: CODE, flowId: FLOW_ID };
const PASSWORD = 'new-password-2026';
const SESSION = { userId: '7d4c0f52-7b8e-4a43-9f8a-2f1b3c4d5e6f' };

const mockDismissTo = jest.fn<(href: string) => void>();

// the real module otherwise: the theme provider builds the navigation theme from it
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ dismissTo: mockDismissTo }),
}));

beforeEach(() => {
  mockDismissTo.mockClear();
});

const renderScreen = async (params: unknown, overrides: Partial<AuthRepository> = {}) => {
  const repository = createSessionAuthRepository(null, overrides);
  await renderWithProviders(<ResetPasswordScreen params={params} />, {
    authRepository: repository,
  });
  return repository;
};

const submitPassword = async (password: string, confirmation = password) => {
  const user = userEvent.setup();
  if (password !== '') {
    await user.type(screen.getByLabelText('New password'), password);
  }
  if (confirmation !== '') {
    await user.type(screen.getByLabelText('Confirm new password'), confirmation);
  }
  await user.press(screen.getByRole('button', { name: 'Save the password' }));
  return user;
};

describe('ResetPasswordScreen', () => {
  it('shows the new password form, and writes nothing when the link opens', async () => {
    const repository = await renderScreen(LINK_PARAMS);

    expect(screen.getByTestId('auth-reset-password-screen')).toBeOnTheScreen();
    for (const label of ['New password', 'Confirm new password']) {
      expect(screen.getByLabelText(label)).toHaveProp('autoComplete', 'new-password');
      expect(screen.getByLabelText(label)).toHaveProp('secureTextEntry', true);
    }
    expect(
      screen.getByText('At least 10 characters, with a letter and a digit.'),
    ).toBeOnTheScreen();
    expect(repository.completeEmailLink).not.toHaveBeenCalled();
    expect(repository.updatePassword).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', '', '', 'auth-reset-password-password-error', 'Enter your password.'],
    [
      'too short',
      'abc123',
      'abc123',
      'auth-reset-password-password-error',
      'Use at least 10 characters.',
    ],
    [
      'not confirmed',
      PASSWORD,
      '',
      'auth-reset-password-password-confirmation-error',
      'Type the password again.',
    ],
    [
      'confirmed differently',
      PASSWORD,
      `${PASSWORD}!`,
      'auth-reset-password-password-confirmation-error',
      'The two passwords do not match.',
    ],
  ])(
    'validates a password %s before exchanging the code',
    async (_case, password, confirmation, testID, message) => {
      const repository = await renderScreen(LINK_PARAMS);

      await submitPassword(password, confirmation);

      expect(screen.getByTestId(testID)).toHaveTextContent(message);
      expect(repository.completeEmailLink).not.toHaveBeenCalled();
      expect(repository.updatePassword).not.toHaveBeenCalled();
    },
  );

  it('exchanges the code once, sets the password, then returns to the settings', async () => {
    const repository = await renderScreen(LINK_PARAMS, {
      completeEmailLink: () => Promise.resolve(SESSION),
      updatePassword: () => Promise.resolve(),
    });

    await submitPassword(PASSWORD);

    expect(repository.completeEmailLink).toHaveBeenCalledTimes(1);
    expect(repository.completeEmailLink).toHaveBeenCalledWith(LINK);
    expect(repository.updatePassword).toHaveBeenCalledWith(PASSWORD);
    expect(mockDismissTo).toHaveBeenCalledWith('/settings');
  });

  it('shows a refused password, and a retry sets the password without a new exchange', async () => {
    const repository = await renderScreen(LINK_PARAMS, {
      completeEmailLink: () => Promise.resolve(SESSION),
      updatePassword: () => Promise.reject(new AuthError('same-password')),
    });
    const user = await submitPassword(PASSWORD);

    expect(await screen.findByTestId('auth-reset-password-error')).toHaveTextContent(
      'Your new password must differ from your current one.',
    );

    repository.updatePassword.mockResolvedValueOnce(undefined);
    await user.press(screen.getByRole('button', { name: 'Save the password' }));

    expect(repository.completeEmailLink).toHaveBeenCalledTimes(1);
    expect(repository.updatePassword).toHaveBeenCalledTimes(2);
    expect(mockDismissTo).toHaveBeenCalledWith('/settings');
  });

  it('offers a new link when the code cannot be used', async () => {
    const repository = await renderScreen(LINK_PARAMS, {
      completeEmailLink: () => Promise.reject(new AuthError('link-invalid')),
    });

    await submitPassword(PASSWORD);

    expect(await screen.findByTestId('auth-reset-password-invalid')).toBeOnTheScreen();
    expect(screen.getByText('This link is not valid')).toBeOnTheScreen();
    expect(repository.updatePassword).not.toHaveBeenCalled();

    await userEvent.setup().press(screen.getByRole('button', { name: 'Ask for a new link' }));

    expect(mockDismissTo).toHaveBeenCalledWith('/auth/forgot-password');
  });

  it.each([
    ['expired', { error: 'access_denied', error_code: 'otp_expired' }, 'This link has expired'],
    ['invalid', { code: 'not a code', sb_flow_id: FLOW_ID }, 'This link is not valid'],
  ])(
    'shows an %s link with a new link action, and writes nothing',
    async (reason, params, title) => {
      const repository = await renderScreen(params);

      expect(screen.getByTestId(`auth-reset-password-${reason}`)).toBeOnTheScreen();
      expect(screen.getByText(title)).toBeOnTheScreen();
      expect(screen.queryByLabelText('New password')).not.toBeOnTheScreen();
      expect(repository.completeEmailLink).not.toHaveBeenCalled();

      await userEvent.setup().press(screen.getByRole('button', { name: 'Ask for a new link' }));

      expect(mockDismissTo).toHaveBeenCalledWith('/auth/forgot-password');
    },
  );
});
