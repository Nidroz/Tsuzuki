import { AccountDeletionError } from '@core/errors/account-deletion-errors';
import type { Language } from '@core/i18n/index';
import type { AuthRepository, AuthSession } from '@core/repositories/auth-repository';
import { describe, expect, it, jest } from '@jest/globals';
import { act, screen, userEvent, within } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import {
  createFakeAuthRepository,
  createSessionSource,
} from '../../../test/core/fake-auth-repository';
import { createFakeGuestLibraryRepository } from '../../../test/core/fake-library-repository';
import { createStuckAccount } from '../../../test/core/stuck-account';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { DeleteAccountScreen } from './DeleteAccountScreen';

// per R-03: the deleted state is announced, and the signed-out state words an ended session for a
// user signed out already (the rest of the screen: DeleteAccountScreen.test.tsx)

// the real module otherwise: the theme provider builds the navigation theme from it
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useRouter: () => ({ push: jest.fn(), dismissTo: jest.fn() }),
}));

const SESSION: AuthSession = { userId: '7d4c0f52-7b8e-4a43-9f8a-2f1b3c4d5e6f' };
const TEST_ID = 'delete-account';

const DELETED = {
  en: {
    title: 'Your account was deleted',
    message: 'Your account and its library were deleted, and this device is signed out.',
  },
  fr: {
    title: 'Votre compte a été supprimé',
    message: 'Votre compte et sa bibliothèque ont été supprimés, et cet appareil est déconnecté.',
  },
} as const satisfies Record<Language, { title: string; message: string }>;

const SIGNED_OUT_SESSION_EXPIRED = {
  en: 'Your session ended before the deletion was confirmed, so your account may not have been deleted. Sign in to check, then try again if needed.',
  fr: "Votre session a pris fin avant que la suppression soit confirmée : votre compte n'a peut-être pas été supprimé. Connectez-vous pour le vérifier, puis réessayez si besoin.",
} as const satisfies Record<Language, string>;

// the react native jest preset mocks announceForAccessibility: its calls survive restoreMocks
const spyOnAnnounce = () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
  announce.mockClear();
  return announce;
};

// the screen signed in with its account instance; the local sign out ends the session at once
const renderScreen = async (deleteAccount: AuthRepository['deleteAccount'], language: Language) => {
  const source = createSessionSource(SESSION);
  const repository = createFakeAuthRepository({
    onAuthStateChange: source.subscribe,
    signOut: () => {
      source.emit(null);
      return Promise.resolve();
    },
    deleteAccount,
  });
  const { rerender } = await renderWithProviders(<DeleteAccountScreen />, {
    authRepository: repository,
    language,
    sessionLibrary: {
      account: createStuckAccount(0).account,
      guest: createFakeGuestLibraryRepository(),
    },
  });
  return { source, rerender };
};

// the first tap opens the confirmation, the second one deletes
const deleteAndConfirm = async () => {
  const user = userEvent.setup();
  await user.press(screen.getByTestId(`${TEST_ID}-delete`));
  await user.press(screen.getByTestId(`${TEST_ID}-confirm-confirm`));
};

describe('DeleteAccountScreen states (R-03)', () => {
  it.each<Language>(['en', 'fr'])(
    'announces the deleted state once, its title a heading (%s)',
    async (language) => {
      const { title, message } = DELETED[language];
      const { source, rerender } = await renderScreen(() => Promise.resolve(), language);
      const announce = spyOnAnnounce();

      await deleteAndConfirm();

      expect(await screen.findByRole('header', { name: title })).toBeOnTheScreen();
      expect(screen.getByTestId(`${TEST_ID}-deleted`)).toHaveTextContent(message, {
        exact: false,
      });
      expect(announce.mock.calls).toStrictEqual([[`${title}\n${message}`]]);

      // a render of the same state, and a repeated signed-out report, announce nothing more
      await rerender(<DeleteAccountScreen />);
      await act(() => {
        source.emit(null);
      });

      expect(screen.getByTestId(`${TEST_ID}-deleted`)).toBeOnTheScreen();
      expect(announce).toHaveBeenCalledTimes(1);
    },
  );

  it.each<Language>(['en', 'fr'])(
    'words an ended session for the signed-out state, as an announced alert (%s)',
    async (language) => {
      const text = SIGNED_OUT_SESSION_EXPIRED[language];
      const { source } = await renderScreen(
        () => Promise.reject(new AccountDeletionError('session-expired')),
        language,
      );
      await deleteAndConfirm();
      // the error first shows in the form, worded for a signed-in user
      expect(await screen.findByTestId(`${TEST_ID}-error`)).not.toHaveTextContent(text);
      const announce = spyOnAnnounce();

      await act(() => {
        source.emit(null);
      });

      const signedOut = await screen.findByTestId(`${TEST_ID}-signed-out`);
      const error = within(signedOut).getByTestId(`${TEST_ID}-error`);
      expect(error).toHaveProp('accessibilityRole', 'alert');
      expect(error).toHaveTextContent(text);
      expect(announce.mock.calls).toStrictEqual([[text]]);
    },
  );
});
