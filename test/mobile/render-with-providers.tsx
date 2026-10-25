import type { CatalogProvider } from '@core/catalog/catalog-provider';
import { AuthContextProvider } from '@core/hooks/AuthContextProvider';
import { CatalogContextProvider } from '@core/hooks/CatalogContextProvider';
import { RecentSearchesContextProvider } from '@core/hooks/RecentSearchesContextProvider';
import {
  I18nProvider,
  type Language,
  type LanguagePreference,
  type MissingKeyHandler,
} from '@core/i18n/index';
import {
  DEFAULT_THEME_PREFERENCE,
  PreferencesProvider,
  type ThemePreference,
} from '@core/preferences/index';
import { createQueryClient } from '@core/query/query-client';
import { noCaptcha, type AuthRepository } from '@core/repositories/auth-repository';
import type { RecentSearchesRepository } from '@core/repositories/recent-searches-repository';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '@ui/index';
import type { ComponentType, ReactElement, ReactNode } from 'react';

import { createStrictFakeCatalogProvider } from '../../src/core/catalog/__fixtures__/fake-catalog-provider';
import { createSessionAuthRepository } from '../core/fake-auth-repository';
import { createFakeRecentSearchesRepository } from '../core/fake-recent-searches-repository';

interface WrapperProps {
  readonly children: ReactNode;
}

/** what a test may set; every option has a fresh default per providersFor call */
export interface ProvidersOptions {
  /** the language of the real catalogs, english by default */
  readonly language?: Language;
  /**
   * the auth repository of the tree; by default a strict fake reporting a signed-out session,
   * whose every other call rejects
   */
  readonly authRepository?: AuthRepository;
  /** the catalog provider of the tree; by default a strict fake whose every method rejects */
  readonly catalogProvider?: CatalogProvider;
  /** the recent searches of the tree; by default an empty in-memory repository */
  readonly recentSearchesRepository?: RecentSearchesRepository;
  /** the query cache of the tree; by default a new createQueryClient(), not persisted */
  readonly queryClient?: QueryClient;
  /** the adult content setting of the tree (BR-06), off by default as in the app */
  readonly showAdult?: boolean;
}

interface AppProvidersProps extends WrapperProps {
  readonly language: Language;
  readonly showAdult: boolean;
  readonly authRepository: AuthRepository;
  readonly catalogProvider: CatalogProvider;
  readonly recentSearchesRepository: RecentSearchesRepository;
  readonly queryClient: QueryClient;
}

export const missingKeyMessage = (language: string, key: string): string =>
  `missing translation key "${key}" (${language}): add it to en.json and fr.json`;

// a key missing from every catalog fails the test through fail-on-console (test/core), which
// points the failure at the t call. not a throw: an aborted render leaves listeners of the discarded
// tree (nativewind's color scheme) that log in the next test. module level: a new handler would
// give the provider a new i18next instance
const failOnMissingKey: MissingKeyHandler = (language, key) => {
  console.error(missingKeyMessage(language, key));
};

// fixed preferences: the composition root owns the changes (test/app/settings.test.tsx). module
// level, so the context value keeps its identity across renders
const ignoreTheme: (theme: ThemePreference) => void = () => undefined;
const ignoreLanguage: (language: LanguagePreference) => void = () => undefined;
const ignoreShowAdult: (showAdult: boolean) => void = () => undefined;

export interface TestPreferencesProps extends WrapperProps {
  /** the adult content setting (BR-06) */
  readonly showAdult: boolean;
  /** the language setting the settings screen shows, english by default */
  readonly language?: LanguagePreference;
}

/**
 * fixed preferences, the theme setting at its default: AppProviders gives one to every tree; a
 * test that changes the adult content setting wraps its component in one and rerenders it with
 * another `showAdult` (the nearest provider wins)
 */
export function TestPreferences({ showAdult, language = 'en', children }: TestPreferencesProps) {
  return (
    <PreferencesProvider
      theme={DEFAULT_THEME_PREFERENCE}
      language={language}
      onThemeChange={ignoreTheme}
      onLanguageChange={ignoreLanguage}
      showAdult={showAdult}
      onShowAdultChange={ignoreShowAdult}
    >
      {children}
    </PreferencesProvider>
  );
}

/**
 * the providers the composition root (app/_layout.tsx) gives every route and feature, in its
 * order: the query cache (not persisted here), the auth (noCaptcha), the catalog provider, the
 * recent searches, fixed preferences with `showAdult`, the real catalogs in `language` with a
 * missing key failing the test, and the light palette for predictable colors
 */
export function AppProviders({
  language,
  showAdult,
  authRepository,
  catalogProvider,
  recentSearchesRepository,
  queryClient,
  children,
}: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthContextProvider repository={authRepository} captcha={noCaptcha}>
        <CatalogContextProvider provider={catalogProvider}>
          <RecentSearchesContextProvider repository={recentSearchesRepository}>
            <TestPreferences showAdult={showAdult} language={language}>
              <I18nProvider language={language} onMissingKey={failOnMissingKey}>
                <ThemeProvider preference="light">{children}</ThemeProvider>
              </I18nProvider>
            </TestPreferences>
          </RecentSearchesContextProvider>
        </CatalogContextProvider>
      </AuthContextProvider>
    </QueryClientProvider>
  );
}

/**
 * the wrapper option of render and renderRouterAsync: AppProviders with `options`, english by
 * default. the defaults are created once here, so one wrapper component per call: a rerender keeps
 * the same providers and query client
 */
export const providersFor = ({
  language = 'en',
  authRepository = createSessionAuthRepository(),
  catalogProvider = createStrictFakeCatalogProvider(),
  recentSearchesRepository = createFakeRecentSearchesRepository(),
  queryClient = createQueryClient(),
  showAdult = false,
}: ProvidersOptions = {}): ComponentType<WrapperProps> =>
  function Providers({ children }: WrapperProps) {
    return (
      <AppProviders
        language={language}
        showAdult={showAdult}
        authRepository={authRepository}
        catalogProvider={catalogProvider}
        recentSearchesRepository={recentSearchesRepository}
        queryClient={queryClient}
      >
        {children}
      </AppProviders>
    );
  };

/** renders a route or feature component inside AppProviders with `options`, english by default */
export const renderWithProviders = (element: ReactElement, options?: ProvidersOptions) =>
  render(element, { wrapper: providersFor(options) });
