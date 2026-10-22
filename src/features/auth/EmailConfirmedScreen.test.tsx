import { AuthError } from '@core/errors/auth-errors';
import type { AuthRepository } from '@core/repositories/auth-repository';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { createSessionAuthRepository } from '../../../test/core/fake-auth-repository';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { EmailConfirmedScreen } from './EmailConfirmedScreen';

const CODE = '3f2a9c1e-5b7d-4e8f-a1b2-c3d4e5f6a7b8';
const FLOW_ID = 'flow_id-12345';
const LINK_PARAMS = { code: CODE, sb_flow_id: FLOW_ID };
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
  await renderWithProviders(<EmailConfirmedScreen params={params} />, {
    authRepository: repository,
  });
  return repository;
};

const pressContinue = () =>
  userEvent.setup().press(screen.getByRole('button', { name: 'Continue' }));

describe('EmailConfirmedScreen', () => {
  it('shows the email confirmed, and writes nothing when the link opens', async () => {
    const repository = await renderScreen(LINK_PARAMS, {
      completeEmailLink: () => Promise.resolve(SESSION),
    });

    expect(screen.getByTestId('auth-callback-confirmed')).toHaveTextContent(
      'Your email address is confirmed. Continue to sign in on this device.',
      { exact: false },
    );
    expect(screen.getByRole('header', { name: 'Email confirmed' })).toBeOnTheScreen();
    expect(repository.completeEmailLink).not.toHaveBeenCalled();
  });

  it('exchanges the code of the link on Continue, then returns to the settings', async () => {
    const repository = await renderScreen(LINK_PARAMS, {
      completeEmailLink: () => Promise.resolve(SESSION),
    });

    await pressContinue();

    expect(repository.completeEmailLink).toHaveBeenCalledTimes(1);
    expect(repository.completeEmailLink).toHaveBeenCalledWith({ code: CODE, flowId: FLOW_ID });
    expect(mockDismissTo).toHaveBeenCalledWith('/settings');
  });

  it('offers sign in when the exchange fails, and never exchanges the code again', async () => {
    const repository = await renderScreen(LINK_PARAMS, {
      // every failed exchange, a lost connection included, rejects link-invalid: it is final
      completeEmailLink: () => Promise.reject(new AuthError('link-invalid')),
    });

    await pressContinue();

    expect(await screen.findByTestId('auth-callback-sign-in-required')).toHaveTextContent(
      'Sign in to continue.',
      { exact: false },
    );
    expect(screen.getByRole('header', { name: 'Your email is confirmed' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeOnTheScreen();

    await userEvent.setup().press(screen.getByRole('button', { name: 'Sign in' }));

    expect(mockDismissTo).toHaveBeenCalledWith('/auth/sign-in');
    expect(repository.completeEmailLink).toHaveBeenCalledTimes(1);
  });

  it('offers sign in after a failure of any kind, without a retry of the exchange', async () => {
    await renderScreen(LINK_PARAMS, {
      completeEmailLink: () => Promise.reject(new Error('unexpected')),
    });

    await pressContinue();

    expect(await screen.findByTestId('auth-callback-sign-in-required')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeOnTheScreen();
  });

  it.each([
    [
      'an expired link',
      {
        error: 'access_denied',
        error_code: 'otp_expired',
        error_description: 'Email link is invalid',
      },
      'auth-callback-expired',
      'This link has expired',
    ],
    [
      'a link with an error',
      { error: 'server_error' },
      'auth-callback-invalid',
      'This link is not valid',
    ],
    [
      'a link without code',
      { sb_flow_id: FLOW_ID },
      'auth-callback-invalid',
      'This link is not valid',
    ],
    [
      'repeated params',
      { code: [CODE, CODE], sb_flow_id: FLOW_ID },
      'auth-callback-invalid',
      'This link is not valid',
    ],
  ])('shows %s with sign in, and writes nothing', async (_case, params, testID, title) => {
    const repository = await renderScreen(params);

    expect(screen.getByTestId(testID)).toBeOnTheScreen();
    expect(screen.getByText(title)).toBeOnTheScreen();
    // the server text is never shown
    expect(screen.queryByText(/Email link is invalid/u)).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeOnTheScreen();
    expect(repository.completeEmailLink).not.toHaveBeenCalled();

    await userEvent.setup().press(screen.getByRole('button', { name: 'Sign in' }));

    expect(mockDismissTo).toHaveBeenCalledWith('/auth/sign-in');
  });
});
