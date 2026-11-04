import { describe, expect, it, jest } from '@jest/globals';
import { screen, within } from '@testing-library/react-native';

import { createFakeGuestLibraryRepository } from '../../../test/core/fake-library-repository';
import { createStuckAccount } from '../../../test/core/stuck-account';
import type * as FakeFocusEffect from '../../../test/mobile/fake-focus-effect';
import { settle } from '../../../test/mobile/render-library-screen';
import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { FavoritesScreen } from '../favorites/FavoritesScreen';
import { FRIEREN, LIBRARY } from './__fixtures__/library-entries';
import { LibraryScreen } from './LibraryScreen';

// adR-0017 "Stuck writes", visible state: the library and favorites tabs show the notice of the
// changes of the account library that could not be synced above their list

// the real module otherwise: the theme provider builds the navigation theme from it. no navigator
// around the screen: focused once mounted
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  useFocusEffect: jest.requireActual<typeof FakeFocusEffect>(
    '../../../test/mobile/fake-focus-effect',
  ).useFakeFocusEffect,
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
}));

const NOTICE_TEXT = '2 changes could not be synced to your account.';
const FAVORITE = { ...FRIEREN, isFavorite: true };

// the screen of `tab` over the account library of the session, `stuckCount` of its writes stuck
const renderTab = async (tab: 'library' | 'favorites', stuckCount: number) => {
  const { account } = createStuckAccount(stuckCount, tab === 'library' ? LIBRARY : [FAVORITE]);
  await renderWithProviders(tab === 'library' ? <LibraryScreen /> : <FavoritesScreen />, {
    sessionLibrary: { account, guest: createFakeGuestLibraryRepository() },
  });
  await settle();
};

describe('the library tabs with stuck writes', () => {
  it.each(['library', 'favorites'] as const)(
    'the %s tab shows the notice in its screen, above its list',
    async (tab) => {
      await renderTab(tab, 2);

      const notice = screen.getByTestId(`${tab}-sync`);
      expect(within(screen.getByTestId(`${tab}-screen`)).getByTestId(`${tab}-sync`)).toBe(notice);
      expect(within(notice).getByRole('alert', { name: NOTICE_TEXT })).toBeOnTheScreen();
      const list = screen.getByTestId(`${tab}-list`);
      // the notice and the list share the column of the screen, the notice first
      const column = notice.parent;
      expect(column).not.toBeNull();
      const children = column?.children ?? [];
      const listBranch = children.findIndex(
        (child) => typeof child !== 'string' && within(child).queryByTestId(`${tab}-list`) === list,
      );
      expect(children.indexOf(notice)).toBe(0);
      expect(listBranch).toBeGreaterThan(0);
    },
  );

  it.each(['library', 'favorites'] as const)(
    'the %s tab shows no notice without a stuck write',
    async (tab) => {
      await renderTab(tab, 0);

      expect(screen.getByTestId(`${tab}-list`)).toBeOnTheScreen();
      expect(screen.queryByTestId(`${tab}-sync`)).not.toBeOnTheScreen();
    },
  );
});
