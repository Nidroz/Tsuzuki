import type { Language, LanguagePreference } from '@core/i18n/index';
import { PreferencesProvider, type ThemePreference } from '@core/preferences/index';
import { describe, expect, it } from '@jest/globals';
import { userEvent, within } from '@testing-library/react-native';
import { screen } from 'expo-router/testing-library';
import type { ComponentType, ReactNode } from 'react';

import en from '../../src/core/i18n/en.json';
import fr from '../../src/core/i18n/fr.json';
import { renderRouterAsync } from '../mobile/render-router';
import { providersFor } from '../mobile/render-with-providers';
import { APP_ROUTES } from './app-routes';

// the tab bar order, with the path and the screen of each tab
const TABS = [
  { id: 'discover', path: '/', screenTestId: 'discover-screen' },
  { id: 'search', path: '/search', screenTestId: 'search-screen' },
  { id: 'library', path: '/library', screenTestId: 'library-screen' },
  { id: 'favorites', path: '/favorites', screenTestId: 'favorites-screen' },
  { id: 'settings', path: '/settings', screenTestId: 'settings-screen' },
] as const;

type TabId = (typeof TABS)[number]['id'];

// the tabs group of the app routes, without the root layout
const ROUTES = Object.fromEntries(
  Object.entries(APP_ROUTES).filter(([name]) => name.startsWith('(tabs)/')),
);

const CATALOGS = { en, fr } as const;

const TAB_BUTTON_TEST_ID = /^tab-/;

// react navigation gives a tab button the tab role on android and the button role on ios (the jest
// platform): buttons are found by test id. ios appends the position to the accessible name
// ("Discover, tab, 1 of 5"), android uses the label alone: the name starts with the label
const nameStartingWith = (label: string) => new RegExp(`^${label}(?:,|$)`);

const tabButton = (id: TabId) => screen.getByTestId(`tab-${id}`);

// the settings tab reads the preferences: fixed here, the root layout owns them (settings.test.tsx)
const ignoreTheme: (theme: ThemePreference) => void = () => undefined;
const ignoreLanguage: (language: LanguagePreference) => void = () => undefined;

const withPreferences = (language: Language): ComponentType<{ readonly children: ReactNode }> => {
  const Providers = providersFor(language);
  return function PreferencesAndProviders({ children }) {
    return (
      <PreferencesProvider
        theme="system"
        language={language}
        onThemeChange={ignoreTheme}
        onLanguageChange={ignoreLanguage}
      >
        <Providers>{children}</Providers>
      </PreferencesProvider>
    );
  };
};

// one wrapper per language, built once: a rerender keeps the same providers
const WRAPPERS: Readonly<Record<Language, ComponentType<{ readonly children: ReactNode }>>> = {
  en: withPreferences('en'),
  fr: withPreferences('fr'),
};

const renderTabs = (language: Language = 'en') =>
  renderRouterAsync(ROUTES, { wrapper: WRAPPERS[language] });

describe('tabs layout', () => {
  it.each<Language>(['en', 'fr'])(
    'shows the five tabs in order, labelled and named in %s',
    async (language) => {
      await renderTabs(language);

      expect(screen.getAllByTestId(TAB_BUTTON_TEST_ID)).toStrictEqual(
        TABS.map(({ id }) => tabButton(id)),
      );
      for (const { id } of TABS) {
        const label = CATALOGS[language].tabs[id];
        expect(tabButton(id)).toHaveAccessibleName(nameStartingWith(label));
        expect(within(tabButton(id)).getByText(label)).toBeOnTheScreen();
      }
    },
  );

  it('opens on Discover, its tab selected', async () => {
    const router = await renderTabs();

    expect(router.getPathname()).toBe('/');
    expect(screen.getByTestId('discover-screen')).toBeOnTheScreen();
    expect(tabButton('discover')).toBeSelected();
    expect(tabButton('settings')).not.toBeSelected();
  });

  it.each(TABS.slice(1))('shows the $id screen when its tab is pressed', async (tab) => {
    const user = userEvent.setup();
    const router = await renderTabs();

    await user.press(tabButton(tab.id));

    expect(router.getPathname()).toBe(tab.path);
    expect(screen.getByTestId(tab.screenTestId)).toBeOnTheScreen();
    expect(tabButton(tab.id)).toBeSelected();
    expect(tabButton('discover')).not.toBeSelected();
  });

  it('comes back to Discover from another tab', async () => {
    const user = userEvent.setup();
    const router = await renderTabs();

    await user.press(tabButton('library'));
    await user.press(tabButton('discover'));

    expect(router.getPathname()).toBe('/');
    expect(tabButton('discover')).toBeSelected();
  });
});
