import { LANGUAGE_PREFERENCE_KEY, THEME_PREFERENCE_KEY } from '@core/preferences/index';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { STORAGE_INSTANCE_ID } from '@platform/storage';
import { userEvent, within } from '@testing-library/react-native';
import type * as Localization from 'expo-localization';
import { useTheme } from 'expo-router';
import { screen } from 'expo-router/testing-library';
import type * as Nativewind from 'nativewind';
import { Text } from 'react-native';
import { createMMKV } from 'react-native-mmkv';

import DiscoverRoute from '../../app/(tabs)/index';
import en from '../../src/core/i18n/en.json';
import fr from '../../src/core/i18n/fr.json';
import { renderRouterAsync } from '../mobile/render-router';
import type * as SharedMmkv from '../mobile/shared-mmkv';
import { appRoutesWithDiscover } from './app-routes';

type ColorScheme = 'light' | 'dark';

// an english device: the language picker, not the device, switches the app to french
const DEVICE_LOCALES: readonly Pick<Localization.Locale, 'languageTag'>[] = [
  { languageTag: 'en-US' },
];

jest.mock('expo-localization', () => ({
  ...jest.requireActual<typeof Localization>('expo-localization'),
  useLocales: () => DEVICE_LOCALES,
}));

// the device light/dark setting reaches ThemeProvider through nativewind's useColorScheme; the
// preference leaves through colorScheme.set, which drives the native appearance and is stubbed.
// the factory runs before this mock is initialized: it calls it lazily
const mockDeviceScheme = jest.fn<() => ColorScheme>();

jest.mock('nativewind', () => {
  const actual = jest.requireActual<typeof Nativewind>('nativewind');
  return {
    ...actual,
    useColorScheme: () => ({ ...actual.useColorScheme(), colorScheme: mockDeviceScheme() }),
    colorScheme: { ...actual.colorScheme, set: () => undefined },
  };
});

// the layout opens its storage when it is imported: the shared instance lets a test seed and read it
jest.mock('react-native-mmkv', () =>
  jest.requireActual<typeof SharedMmkv>('../mobile/shared-mmkv').sharedMmkvModule(),
);

const appStorage = createMMKV({ id: STORAGE_INSTANCE_ID });

const NAVIGATION_SCHEME_TEST_ID = 'navigation-scheme';

// the real Discover route, plus the scheme of the navigation theme navigators read (react
// navigation's useTheme, through expo-router)
function DiscoverWithThemeProbe() {
  const { dark } = useTheme();
  return (
    <>
      <DiscoverRoute />
      <Text testID={NAVIGATION_SCHEME_TEST_ID}>{dark ? 'dark' : 'light'}</Text>
    </>
  );
}

const renderApp = () => renderRouterAsync(appRoutesWithDiscover(DiscoverWithThemeProbe));

const tabLabel = (id: keyof typeof en.tabs, label: string) =>
  within(screen.getByTestId(`tab-${id}`)).getByText(label);

const navigationScheme = () => screen.getByTestId(NAVIGATION_SCHEME_TEST_ID);

describe('settings route', () => {
  // the storage outlives each test: every test starts with nothing stored
  beforeEach(() => {
    mockDeviceScheme.mockReturnValue('light');
    appStorage.clearAll();
  });

  it('opens with the stored theme applied and checked', async () => {
    appStorage.set(THEME_PREFERENCE_KEY, 'dark');
    const user = userEvent.setup();
    await renderApp();

    expect(navigationScheme()).toHaveTextContent('dark');
    await user.press(screen.getByTestId('tab-settings'));
    expect(screen.getByTestId('theme-picker-dark')).toBeChecked();
  });

  it('stores the theme and language selected', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.press(screen.getByTestId('tab-settings'));

    await user.press(screen.getByTestId('theme-picker-dark'));
    await user.press(screen.getByTestId('language-picker-fr'));

    expect(appStorage.getString(THEME_PREFERENCE_KEY)).toBe('dark');
    expect(appStorage.getString(LANGUAGE_PREFERENCE_KEY)).toBe('fr');
  });

  it('opens from its tab with the system theme and language checked', async () => {
    const user = userEvent.setup();
    const router = await renderApp();

    await user.press(screen.getByTestId('tab-settings'));

    expect(router.getPathname()).toBe('/settings');
    expect(screen.getByTestId('settings-screen')).toBeOnTheScreen();
    expect(screen.getAllByRole('radio', { checked: true })).toStrictEqual([
      screen.getByTestId('theme-picker-system'),
      screen.getByTestId('language-picker-system'),
    ]);
  });

  it('switches the tabs and the settings screen to french when Français is selected', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.press(screen.getByTestId('tab-settings'));

    await user.press(screen.getByTestId('language-picker-fr'));

    for (const id of ['discover', 'search', 'library', 'favorites', 'settings'] as const) {
      expect(tabLabel(id, fr.tabs[id])).toBeOnTheScreen();
    }
    expect(screen.getByText(fr.settings.theme.title)).toBeOnTheScreen();
    expect(screen.getByTestId('language-picker')).toHaveProp(
      'accessibilityLabel',
      fr.settings.language.title,
    );
    expect(screen.getByRole('radio', { name: fr.settings.theme.options.dark })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: fr.settings.language.options.fr })).toBeChecked();
    expect(screen.queryByText(en.settings.theme.title)).not.toBeOnTheScreen();
  });

  it('switches back to the device language when System is selected', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.press(screen.getByTestId('tab-settings'));

    await user.press(screen.getByTestId('language-picker-fr'));
    await user.press(screen.getByTestId('language-picker-system'));

    expect(tabLabel('settings', en.tabs.settings)).toBeOnTheScreen();
    expect(screen.getByText(en.settings.theme.title)).toBeOnTheScreen();
    expect(screen.queryByText(fr.settings.theme.title)).not.toBeOnTheScreen();
  });

  it.each<[ColorScheme, 'light' | 'dark', ColorScheme]>([
    ['light', 'dark', 'dark'],
    ['dark', 'light', 'light'],
  ])(
    'on a %s device, gives the navigators the theme of the selected %s preference',
    async (device, preference, expected) => {
      mockDeviceScheme.mockReturnValue(device);
      const user = userEvent.setup();
      await renderApp();
      expect(navigationScheme()).toHaveTextContent(device);
      await user.press(screen.getByTestId('tab-settings'));

      await user.press(screen.getByTestId(`theme-picker-${preference}`));
      await user.press(screen.getByTestId('tab-discover'));

      expect(navigationScheme()).toHaveTextContent(expected);
    },
  );

  it.each<ColorScheme>(['light', 'dark'])(
    'falls back to the %s device scheme when System is selected again',
    async (device) => {
      mockDeviceScheme.mockReturnValue(device);
      const other = device === 'light' ? 'dark' : 'light';
      const user = userEvent.setup();
      await renderApp();
      await user.press(screen.getByTestId('tab-settings'));

      await user.press(screen.getByTestId(`theme-picker-${other}`));
      await user.press(screen.getByTestId('theme-picker-system'));
      await user.press(screen.getByTestId('tab-discover'));

      expect(navigationScheme()).toHaveTextContent(device);
    },
  );
});
