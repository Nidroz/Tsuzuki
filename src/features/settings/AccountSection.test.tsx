import { AuthError } from '@core/errors/auth-errors';
import type { AuthRepository, AuthSession } from '@core/repositories/auth-repository';
import type {
  LibraryReplayRun,
  OfflineAccountLibraryRepository,
} from '@core/repositories/library-repository';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, screen, userEvent, within } from '@testing-library/react-native';

import {
  createFakeAuthRepository,
  createSessionSource,
} from '../../../test/core/fake-auth-repository';
import {
  createFakeAccountLibraryRepository,
  createFakeGuestLibraryRepository,
  createStuckWriteMocks,
} from '../../../test/core/fake-library-repository';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { AccountSection } from './AccountSection';

const SESSION: AuthSession = { userId: '7d4c0f52-7b8e-4a43-9f8a-2f1b3c4d5e6f' };
const TEST_ID = 'settings-account';
const UNSYNCED_TEST_ID = `${TEST_ID}-unsynced`;
const NOTHING_REPLAYED: LibraryReplayRun = { status: 'done', confirmed: 0 };

const mockPush = jest.fn<(href: string) => void>();

// the real module otherwise: the theme provider builds the navigation theme from it
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ push: mockPush }),
}));

beforeEach(() => {
  mockPush.mockClear();
});

// the account instance of the session, `queued` writes still in its queue after every replay
const createAccount = (queued: number) =>
  ({
    ...createFakeAccountLibraryRepository(),
    replayQueuedWrites: jest.fn<OfflineAccountLibraryRepository['replayQueuedWrites']>(() =>
      Promise.resolve(NOTHING_REPLAYED),
    ),
    subscribeToQueuedWrites: jest.fn<OfflineAccountLibraryRepository['subscribeToQueuedWrites']>(
      () => () => undefined,
    ),
    queuedWriteCount: jest.fn<OfflineAccountLibraryRepository['queuedWriteCount']>(() => queued),
    ...createStuckWriteMocks(),
    purgeDeviceData: jest.fn<OfflineAccountLibraryRepository['purgeDeviceData']>(),
  }) satisfies OfflineAccountLibraryRepository;

type FakeAccount = ReturnType<typeof createAccount>;

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

// signed in with `account` as the session's account instance; the sign out ends the session
const renderSignedIn = async (account: FakeAccount, language: 'en' | 'fr' = 'en') => {
  const source = createSessionSource(SESSION);
  const repository = createFakeAuthRepository({
    onAuthStateChange: source.subscribe,
    signOut: () => {
      source.emit(null);
      return Promise.resolve();
    },
  });
  await renderWithProviders(<AccountSection />, {
    authRepository: repository,
    sessionLibrary: { account, guest: createFakeGuestLibraryRepository() },
    language,
  });
  return { repository };
};

const unsyncedSheet = () => screen.queryByTestId(UNSYNCED_TEST_ID);

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

  it('offers sign in and create an account while signed out, and no deletion', async () => {
    await renderSection(null);
    const user = userEvent.setup();

    expect(
      screen.getByText('You are not signed in. Your library stays on this device.'),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId(`${TEST_ID}-delete-account`)).not.toBeOnTheScreen();

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

  it('syncs, signs out and purges the account without asking when nothing is unsynced', async () => {
    const account = createAccount(0);
    const { repository } = await renderSignedIn(account);

    await userEvent.setup().press(screen.getByRole('button', { name: 'Sign out' }));

    expect(account.replayQueuedWrites).toHaveBeenCalledTimes(1);
    expect(repository.signOut).toHaveBeenCalledTimes(1);
    expect(account.purgeDeviceData).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeOnTheScreen();
    expect(unsyncedSheet()).not.toBeOnTheScreen();
  });

  it('shows a loading label while signing out, the deletion disabled meanwhile', async () => {
    // a sign out that never settles
    await renderSection(SESSION, { signOut: () => new Promise<never>(() => undefined) });

    await userEvent.setup().press(screen.getByRole('button', { name: 'Sign out' }));

    const signOut = screen.getByTestId(`${TEST_ID}-sign-out`);
    expect(signOut).toHaveAccessibleName('Syncing and signing out');
    expect(signOut).toBeDisabled();
    expect(screen.getByTestId(`${TEST_ID}-delete-account`)).toBeDisabled();
  });

  it('asks before losing an unsynced change, and Cancel leaves everything as it was', async () => {
    const account = createAccount(1);
    const { repository } = await renderSignedIn(account);
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Sign out' }));

    const sheet = screen.getByTestId(UNSYNCED_TEST_ID);
    expect(within(sheet).getByText('Changes not synced')).toBeOnTheScreen();
    expect(
      within(sheet).getByText(
        '1 change made on this device has not reached your account yet. Signing out deletes it from this device.',
      ),
    ).toBeOnTheScreen();
    expect(within(sheet).getByRole('button', { name: 'Sign out and delete it' })).toBeOnTheScreen();
    expect(repository.signOut).not.toHaveBeenCalled();

    await user.press(within(sheet).getByRole('button', { name: 'Cancel' }));

    expect(unsyncedSheet()).not.toBeOnTheScreen();
    expect(screen.getByTestId(`${TEST_ID}-signed-in`)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
    expect(account.replayQueuedWrites).toHaveBeenCalledTimes(1);
    expect(repository.signOut).not.toHaveBeenCalled();
    expect(account.purgeDeviceData).not.toHaveBeenCalled();
  });

  it('signs out and purges the unsynced changes once confirmed', async () => {
    const account = createAccount(3);
    const { repository } = await renderSignedIn(account);
    const user = userEvent.setup();

    await user.press(screen.getByRole('button', { name: 'Sign out' }));

    const sheet = screen.getByTestId(UNSYNCED_TEST_ID);
    expect(
      within(sheet).getByText(
        '3 changes made on this device have not reached your account yet. Signing out deletes them from this device.',
      ),
    ).toBeOnTheScreen();

    await user.press(within(sheet).getByRole('button', { name: 'Sign out and delete them' }));

    // the sync is tried again, the count skipped (discardUnsynced), whatever remains purged
    expect(account.replayQueuedWrites).toHaveBeenCalledTimes(2);
    expect(account.queuedWriteCount).toHaveBeenCalledTimes(1);
    expect(repository.signOut).toHaveBeenCalledTimes(1);
    expect(account.purgeDeviceData).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeOnTheScreen();
    expect(unsyncedSheet()).not.toBeOnTheScreen();
  });

  it('asks in french with the plural of the count', async () => {
    await renderSignedIn(createAccount(2), 'fr');

    await userEvent.setup().press(screen.getByRole('button', { name: 'Se déconnecter' }));

    const sheet = screen.getByTestId(UNSYNCED_TEST_ID);
    expect(
      within(sheet).getByText(
        '2 modifications faites sur cet appareil ne sont pas encore enregistrées dans votre compte. La déconnexion les supprimera de cet appareil.',
      ),
    ).toBeOnTheScreen();
    expect(
      within(sheet).getByRole('button', { name: 'Se déconnecter et les supprimer' }),
    ).toBeOnTheScreen();
  });

  it('shows a translated error when signing out fails, and stays signed in', async () => {
    await renderSection(SESSION, { signOut: () => Promise.reject(new AuthError('network')) });

    await userEvent.setup().press(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByTestId(`${TEST_ID}-error`)).toHaveTextContent(
      'The server could not be reached. Check your connection, then try again.',
    );
    expect(screen.getByTestId(`${TEST_ID}-signed-in`)).toBeOnTheScreen();
  });

  it('opens the account deletion screen from its destructive button', async () => {
    await renderSection(SESSION);

    await userEvent.setup().press(screen.getByRole('button', { name: 'Delete account' }));

    expect(mockPush.mock.calls).toStrictEqual([['/account/delete']]);
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
