import {
  AccountDeletionError,
  type AccountDeletionErrorReason,
} from '@core/errors/account-deletion-errors';
import type { AuthRepository, AuthSession } from '@core/repositories/auth-repository';
import type {
  LibraryReplayRun,
  OfflineAccountLibraryRepository,
} from '@core/repositories/offline-account-library-repository';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, screen, userEvent, waitFor, within } from '@testing-library/react-native';

import {
  createFakeAuthRepository,
  createSessionSource,
} from '../../../test/core/fake-auth-repository';
import {
  createDeferred,
  createFakeAccountLibraryRepository,
  createFakeGuestLibraryRepository,
  createStuckWriteMocks,
} from '../../../test/core/fake-library-repository';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { DeleteAccountScreen } from './DeleteAccountScreen';

const SESSION: AuthSession = { userId: '7d4c0f52-7b8e-4a43-9f8a-2f1b3c4d5e6f' };
const TEST_ID = 'delete-account';
const CONFIRM_TEST_ID = `${TEST_ID}-confirm`;
const NOTHING_REPLAYED: LibraryReplayRun = { status: 'done', confirmed: 0 };

const mockPush = jest.fn<(href: string) => void>();
const mockDismissTo = jest.fn<(href: string) => void>();

// the real module otherwise: the theme provider builds the navigation theme from it
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ push: mockPush, dismissTo: mockDismissTo }),
}));

beforeEach(() => {
  mockPush.mockClear();
  mockDismissTo.mockClear();
});

// the account instance of the session, its queue empty
const createAccount = () =>
  ({
    ...createFakeAccountLibraryRepository(),
    replayQueuedWrites: jest.fn<OfflineAccountLibraryRepository['replayQueuedWrites']>(() =>
      Promise.resolve(NOTHING_REPLAYED),
    ),
    subscribeToQueuedWrites: jest.fn<OfflineAccountLibraryRepository['subscribeToQueuedWrites']>(
      () => () => undefined,
    ),
    queuedWriteCount: jest.fn<OfflineAccountLibraryRepository['queuedWriteCount']>(() => 0),
    ...createStuckWriteMocks(),
    purgeDeviceData: jest.fn<OfflineAccountLibraryRepository['purgeDeviceData']>(),
  }) satisfies OfflineAccountLibraryRepository;

/**
 * the screen with `session` reported (null: signed out) and its account instance; the local sign
 * out ends the session at once, then resolves with `signOutSettled`; every other auth call is the
 * test's `overrides`
 */
const renderScreen = async (
  session: AuthSession | null,
  overrides: Partial<AuthRepository> = {},
  signOutSettled: Promise<void> = Promise.resolve(),
) => {
  const source = createSessionSource(session);
  const account = session === null ? null : createAccount();
  const repository = createFakeAuthRepository({
    onAuthStateChange: source.subscribe,
    signOut: () => {
      source.emit(null);
      return signOutSettled;
    },
    ...overrides,
  });
  await renderWithProviders(<DeleteAccountScreen />, {
    authRepository: repository,
    sessionLibrary: { account, guest: createFakeGuestLibraryRepository() },
  });
  return { repository, account, source };
};

const deleteButton = () => screen.getByTestId(`${TEST_ID}-delete`);
const confirmSheet = () => screen.queryByTestId(CONFIRM_TEST_ID);

// the first tap opens the confirmation, the second one deletes
const deleteAndConfirm = async () => {
  const user = userEvent.setup();
  await user.press(deleteButton());
  await user.press(screen.getByTestId(`${CONFIRM_TEST_ID}-confirm`));
};

// the signed-out state with the deletion's error inside, as an alert (InlineError announces it)
const expectSignedOutError = async (message: string) => {
  const signedOut = await screen.findByTestId(`${TEST_ID}-signed-out`);
  const error = within(signedOut).getByTestId(`${TEST_ID}-error`);
  expect(error).toHaveTextContent(message);
  expect(error).toHaveProp('accessibilityRole', 'alert');
  expect(within(signedOut).getByRole('button', { name: 'Sign in' })).toBeOnTheScreen();
  expect(screen.queryByTestId(`${TEST_ID}-form`)).not.toBeOnTheScreen();
};

describe('DeleteAccountScreen', () => {
  it('shows a spinner until the session is known, and no action', async () => {
    // a repository that never reports the session
    await renderWithProviders(<DeleteAccountScreen />, {
      authRepository: createFakeAuthRepository({ onAuthStateChange: () => () => undefined }),
    });

    expect(screen.getByRole('progressbar', { name: 'Loading your account' })).toBeOnTheScreen();
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  it('asks to sign in first while signed out, with no deletion at all', async () => {
    const { repository } = await renderScreen(null);

    expect(
      screen.getByRole('header', { name: 'Sign in to delete your account' }),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId(`${TEST_ID}-delete`)).not.toBeOnTheScreen();
    expect(screen.queryByTestId(`${TEST_ID}-error`)).not.toBeOnTheScreen();

    await userEvent.setup().press(screen.getByRole('button', { name: 'Sign in' }));

    expect(mockPush.mock.calls).toStrictEqual([['/auth/sign-in']]);
    expect(repository.deleteAccount).not.toHaveBeenCalled();
  });

  it('explains what is deleted, and the first tap only opens the confirmation', async () => {
    const { repository } = await renderScreen(SESSION);

    expect(screen.getByRole('header', { name: 'Delete your account' })).toBeOnTheScreen();
    for (const text of [
      'Your account and its sign-in methods.',
      'Your library on every device: titles, progress, scores, notes and favorites.',
      'Your progress history.',
      'On this device: the copy of your library, the changes not synced yet, your recent searches and the cached data.',
      'This cannot be undone.',
    ]) {
      expect(screen.getByText(text)).toBeOnTheScreen();
    }
    expect(confirmSheet()).not.toBeOnTheScreen();

    await userEvent.setup().press(screen.getByRole('button', { name: 'Delete account' }));

    const sheet = screen.getByTestId(CONFIRM_TEST_ID);
    expect(within(sheet).getByText('Delete your account?')).toBeOnTheScreen();
    expect(within(sheet).getByRole('button', { name: 'Delete my account' })).toBeOnTheScreen();
    expect(repository.deleteAccount).not.toHaveBeenCalled();
  });

  it('closes the confirmation on Cancel without deleting anything', async () => {
    const { repository, account } = await renderScreen(SESSION);
    const user = userEvent.setup();

    await user.press(deleteButton());
    await user.press(
      within(screen.getByTestId(CONFIRM_TEST_ID)).getByRole('button', { name: 'Cancel' }),
    );

    expect(confirmSheet()).not.toBeOnTheScreen();
    expect(deleteButton()).toBeEnabled();
    expect(repository.deleteAccount).not.toHaveBeenCalled();
    expect(account?.purgeDeviceData).not.toHaveBeenCalled();
  });

  it('disables the deletion and labels its spinner while it runs', async () => {
    // a deletion that never settles
    await renderScreen(SESSION, { deleteAccount: () => new Promise<never>(() => undefined) });

    await deleteAndConfirm();

    expect(confirmSheet()).not.toBeOnTheScreen();
    expect(deleteButton()).toHaveAccessibleName('Deleting your account');
    expect(deleteButton()).toBeDisabled();
  });

  it('deletes once confirmed, then shows the deleted state signed out, back to settings', async () => {
    const { repository, account } = await renderScreen(SESSION, {
      deleteAccount: () => Promise.resolve(),
    });

    await deleteAndConfirm();

    expect(repository.deleteAccount).toHaveBeenCalledTimes(1);
    expect(account?.purgeDeviceData).toHaveBeenCalledTimes(1);
    expect(repository.signOut).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole('header', { name: 'Your account was deleted' }),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId(`${TEST_ID}-signed-out`)).not.toBeOnTheScreen();

    await userEvent.setup().press(screen.getByRole('button', { name: 'Back to Settings' }));

    expect(mockDismissTo.mock.calls).toStrictEqual([['/settings']]);
  });

  it('keeps the pending form while its sign out ends the session, never asking to sign in', async () => {
    const signOutHeld = createDeferred();
    const { repository } = await renderScreen(
      SESSION,
      { deleteAccount: () => Promise.resolve() },
      signOutHeld.promise,
    );

    await deleteAndConfirm();
    // signed out on the device, the deletion not resolved yet
    await waitFor(() => {
      expect(repository.signOut).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByTestId(`${TEST_ID}-signed-out`)).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeOnTheScreen();
    expect(screen.getByTestId(`${TEST_ID}-form`)).toBeOnTheScreen();
    expect(deleteButton()).toHaveAccessibleName('Deleting your account');
    expect(deleteButton()).toBeDisabled();

    await act(async () => {
      signOutHeld.resolve();
      await signOutHeld.promise;
    });

    expect(
      await screen.findByRole('header', { name: 'Your account was deleted' }),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId(`${TEST_ID}-signed-out`)).not.toBeOnTheScreen();
  });

  it.each<[string, AccountDeletionErrorReason | 'not an AccountDeletionError']>([
    [
      'You are offline. Connect to the internet to delete your account. Nothing was deleted.',
      'offline',
    ],
    [
      'The server could not be reached, so your account may not have been deleted. Check your connection, then try again.',
      'network',
    ],
    ['Your session has ended. Sign out, sign in again, then try again.', 'session-expired'],
    ['Your account could not be deleted. Try again later.', 'unknown'],
    ['Your account could not be deleted. Try again later.', 'not an AccountDeletionError'],
  ])('shows "%s" for %s, still signed in', async (message, reason) => {
    const error =
      reason === 'not an AccountDeletionError'
        ? new Error('boom')
        : new AccountDeletionError(reason);
    const { repository, account } = await renderScreen(SESSION, {
      deleteAccount: () => Promise.reject(error),
    });

    await deleteAndConfirm();

    expect(await screen.findByTestId(`${TEST_ID}-error`)).toHaveTextContent(message);
    expect(repository.deleteAccount).toHaveBeenCalledTimes(1);
    expect(repository.signOut).not.toHaveBeenCalled();
    expect(account?.purgeDeviceData).not.toHaveBeenCalled();
    expect(screen.getByTestId(`${TEST_ID}-form`)).toBeOnTheScreen();
    expect(deleteButton()).toBeEnabled();
  });

  it('shows the error of a deletion that failed once the session ended in the signed-out state', async () => {
    const answer = createDeferred();
    const { source } = await renderScreen(SESSION, { deleteAccount: () => answer.promise });
    await deleteAndConfirm();
    // a lost answer, then a failed token refresh ends the session: the pending form stays
    await act(() => {
      source.emit(null);
    });
    expect(deleteButton()).toBeDisabled();

    await act(async () => {
      answer.reject(new AccountDeletionError('network'));
      await answer.promise.catch(() => undefined);
    });

    await expectSignedOutError(
      'The server could not be reached, so your account may not have been deleted. Check your connection, then try again.',
    );
  });

  it('keeps the error of a failed deletion in the signed-out state once the session ends', async () => {
    const { source } = await renderScreen(SESSION, {
      deleteAccount: () => Promise.reject(new AccountDeletionError('unknown')),
    });
    await deleteAndConfirm();
    expect(await screen.findByTestId(`${TEST_ID}-error`)).toBeOnTheScreen();

    // the account deleted on another device: the next token refresh ends the session
    await act(() => {
      source.emit(null);
    });

    await expectSignedOutError('Your account could not be deleted. Try again later.');
  });
});
