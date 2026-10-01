import { useTranslation } from '@core/i18n/index';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
// react native testing library 14's act is async; expo-router re-exports it typed as react's act
import { act, within } from '@testing-library/react-native';
import { Spinner } from '@ui/index';
import type * as Localization from 'expo-localization';
import type * as React from 'react';
import { screen } from 'expo-router/testing-library';
import { Text } from 'react-native';

import en from '../../src/core/i18n/en.json';
import fr from '../../src/core/i18n/fr.json';
import { renderRouterAsync } from '../mobile/render-router';
import { APP_ROUTES, appRoutesWithDiscover } from './app-routes';

const ROOT_PATHNAME = '/';
const STUB_TEXT = 'stub discover route';
const DISCOVER_TAB_TEST_ID = 'tab-discover';
// the native stack header is a native view: in tests it only shows up as this react-native-screens
// host component, whose `hidden` prop mirrors the headerShown option (its title is not rendered text)
const NATIVE_HEADER_HOST = 'RNSScreenStackHeaderConfig';

// only the tag of a device locale is read
type DeviceLocale = Pick<Localization.Locale, 'languageTag'>;

const localesOf = (...tags: string[]): readonly DeviceLocale[] =>
  tags.map((languageTag) => ({ languageTag }));

// the device locales, which a test may change while the app runs: like expo-localization's
// useLocales, the mock re-renders its users on a change
const mockDeviceLocales = {
  current: localesOf('en-US'),
  listeners: new Set<() => void>(),
  subscribe: (listener: () => void) => {
    mockDeviceLocales.listeners.add(listener);
    return () => {
      mockDeviceLocales.listeners.delete(listener);
    };
  },
  set: (locales: readonly DeviceLocale[]) => {
    mockDeviceLocales.current = locales;
    for (const listener of mockDeviceLocales.listeners) {
      listener();
    }
  },
};

// the device locales reach the layout through the platform adapter (src/platform/locale.ts), which
// reads useLocales. the factory runs when the layout is imported, before the store above is
// initialized: it reads it lazily
jest.mock('expo-localization', () => {
  const { useSyncExternalStore } = jest.requireActual<typeof React>('react');
  return {
    ...jest.requireActual<typeof Localization>('expo-localization'),
    useLocales: () =>
      useSyncExternalStore(mockDeviceLocales.subscribe, () => mockDeviceLocales.current),
  };
});

// the store outlives each test: every test starts on an english device
beforeEach(() => {
  mockDeviceLocales.set(localesOf('en-US'));
});

// the discover route is a stub: this test covers the layouts alone
function StubDiscoverScreen() {
  return <Text>{STUB_TEXT}</Text>;
}

const SPINNER_LABEL = 'stub loading';

// a themed primitive: it reads the palette from ThemeProvider and throws outside of it
function ThemedDiscoverScreen() {
  return <Spinner accessibilityLabel={SPINNER_LABEL} />;
}

const MISSING_KEY = 'missing.key';

// asks for a key of no catalog
function MissingKeyDiscoverScreen() {
  const { t } = useTranslation();
  // @ts-expect-error(type-test): the key is in no catalog, which typecheck rejects before run time
  return <Text>{t(MISSING_KEY)}</Text>;
}

const renderLayout = () => renderRouterAsync(appRoutesWithDiscover(StubDiscoverScreen));

const renderApp = () => renderRouterAsync(APP_ROUTES);

// the label of the Discover tab button, in the language the app resolved
const discoverTabLabel = (label: string) =>
  within(screen.getByTestId(DISCOVER_TAB_TEST_ID)).getByText(label);

describe('root layout', () => {
  it('opens on the discover route of the tabs at the root pathname', async () => {
    const router = await renderLayout();

    expect(router.getPathname()).toBe(ROOT_PATHNAME);
    expect(screen.getByText(STUB_TEXT)).toBeOnTheScreen();
  });

  it('hides the stack header above the tabs, which show their own translated header', async () => {
    await renderLayout();

    const headers = screen.container.queryAll(({ type }) => type === NATIVE_HEADER_HOST);

    expect(headers).toHaveLength(1);
    expect(headers[0]?.props).toMatchObject({ hidden: true });
    expect(screen.getByRole('heading', { name: en.tabs.discover })).toBeOnTheScreen();
  });

  it('wraps the routes in the theme provider', async () => {
    await renderRouterAsync(appRoutesWithDiscover(ThemedDiscoverScreen));

    expect(screen.getByRole('progressbar', { name: SPINNER_LABEL })).toBeOnTheScreen();
  });

  describe('with the system language preference', () => {
    it.each([
      ['a french device', ['fr-FR'], fr.tabs.discover],
      ['a canadian french device', ['fr-CA', 'en-CA'], fr.tabs.discover],
      ['an english device', ['en-US'], en.tabs.discover],
      [
        'a device preferring an unsupported language, then french',
        ['de-DE', 'fr-FR'],
        fr.tabs.discover,
      ],
      [
        'a device with invalid locale tags, falling back to english',
        ['', 'not a tag'],
        en.tabs.discover,
      ],
    ])('shows the routes in the language of %s', async (_label, tags, label) => {
      mockDeviceLocales.set(localesOf(...tags));

      await renderApp();

      expect(discoverTabLabel(label)).toBeOnTheScreen();
    });

    it('switches the language when the device languages change while the app runs', async () => {
      await renderApp();
      expect(discoverTabLabel(en.tabs.discover)).toBeOnTheScreen();

      await act(() => {
        mockDeviceLocales.set(localesOf('fr-FR'));
      });

      expect(discoverTabLabel(fr.tabs.discover)).toBeOnTheScreen();
      expect(screen.queryByText(en.tabs.discover)).not.toBeOnTheScreen();
    });
  });

  it('warns in development about a key found in no catalog', async () => {
    mockDeviceLocales.set(localesOf('fr-FR'));
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await renderRouterAsync(appRoutesWithDiscover(MissingKeyDiscoverScreen));

    expect(screen.getByText(MISSING_KEY)).toBeOnTheScreen();
    expect(consoleWarn).toHaveBeenCalledWith(`missing translation key "${MISSING_KEY}" (fr)`);
  });

  it('installs the plural rules polyfill first, so development logs no missing plural rules', () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    loadLayoutWithoutPluralRules({ dev: true, polyfill: true });

    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('warns in development when Intl.PluralRules is still missing, as the layout module loads', () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    loadLayoutWithoutPluralRules({ dev: true, polyfill: false });

    expect(consoleWarn.mock.calls).toStrictEqual([
      ['Intl.PluralRules is missing: plural forms fall back to a one/other rule'],
    ]);
  });

  it('logs nothing in a release build when Intl.PluralRules is still missing', () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    loadLayoutWithoutPluralRules({ dev: false, polyfill: false });

    expect(consoleWarn).not.toHaveBeenCalled();
  });
});

const INTL_POLYFILLS = '../../src/platform/intl-polyfills';

// loads a fresh copy of the layout module, so its top level runs again, without the plural rules
// and in a development or release build, with the real polyfill or a stub that installs nothing;
// both globals and the polyfill module are restored afterwards
function loadLayoutWithoutPluralRules({
  dev,
  polyfill,
}: {
  readonly dev: boolean;
  readonly polyfill: boolean;
}) {
  const { PluralRules } = Intl;
  const wasDev = __DEV__;
  Reflect.deleteProperty(Intl, 'PluralRules');
  Reflect.set(globalThis, '__DEV__', dev);
  try {
    jest.isolateModules(() => {
      if (!polyfill) {
        jest.doMock(INTL_POLYFILLS, () => ({}));
      }
      jest.requireActual('../../app/_layout');
    });
  } finally {
    jest.dontMock(INTL_POLYFILLS);
    Reflect.set(globalThis, '__DEV__', wasDev);
    Object.defineProperty(Intl, 'PluralRules', {
      configurable: true,
      writable: true,
      value: PluralRules,
    });
  }
}
