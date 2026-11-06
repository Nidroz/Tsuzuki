import type { CatalogProvider } from '@core/catalog/catalog-provider';
import { AuthContextProvider } from '@core/hooks/AuthContextProvider';
import type { ErrorContext, ErrorReporter } from '@core/errors/error-reporter';
import { CatalogContextProvider } from '@core/hooks/CatalogContextProvider';
import { DevicePurgeContextProvider } from '@core/hooks/DevicePurgeContextProvider';
import { GuestMergeContext, type GuestMergeValue } from '@core/hooks/guest-merge-context';
import { LibraryContextProvider } from '@core/hooks/LibraryContextProvider';
import { RecentSearchesContextProvider } from '@core/hooks/RecentSearchesContextProvider';
import {
  SessionLibraryContext,
  type SessionLibraryValue,
} from '@core/hooks/session-library-context';
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
import type { DevicePurgeMarkerRepository } from '@core/repositories/device-purge-marker-repository';
import type { OfflineAccountLibraryRepository } from '@core/repositories/offline-account-library-repository';
import type { RecentSearchesRepository } from '@core/repositories/recent-searches-repository';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '@ui/index';
import type { ComponentType, ReactElement, ReactNode } from 'react';

import { createStrictFakeCatalogProvider } from '../../src/core/catalog/__fixtures__/fake-catalog-provider';
import { createSessionAuthRepository } from '../core/fake-auth-repository';
import { createFakeDevicePurgeMarkers } from '../core/fake-device-purge-markers';
import { createFakeGuestLibraryRepository } from '../core/fake-library-repository';
import { createFakeRecentSearchesRepository } from '../core/fake-recent-searches-repository';

interface WrapperProps {
  readonly children: ReactNode;
}

/**
 * the session libraries a test gives: the account instance and the guest library; the user id
 * defaults to SESSION_LIBRARY_USER_ID with an account instance, and the account library factory to
 * one that throws (no marker or gone user in these trees calls it)
 */
export type SessionLibraryOption = Pick<SessionLibraryValue, 'account' | 'guest'> &
  Partial<Pick<SessionLibraryValue, 'userId' | 'accountRepositoryFor'>>;

/** the user id of a given account instance, unless the test gives another one */
export const SESSION_LIBRARY_USER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

const noAccountLibraryFactory = (): OfflineAccountLibraryRepository => {
  throw new Error('unexpected call to the account library factory of the test providers');
};

const toSessionLibrary = ({
  account,
  guest,
  userId = account === null ? null : SESSION_LIBRARY_USER_ID,
  accountRepositoryFor = noAccountLibraryFactory,
}: SessionLibraryOption): SessionLibraryValue => ({ account, userId, guest, accountRepositoryFor });

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
  /** the guest merge state the library screens read, IDLE_GUEST_MERGE by default */
  readonly guestMerge?: GuestMergeValue;
  /**
   * the libraries of the session the sign out and the account deletion read; by default no
   * account instance and an empty fake guest library. the tree's library is `account ?? guest`
   */
  readonly sessionLibrary?: SessionLibraryOption;
  /** the purge-pending markers of the device purge; by default none, in memory */
  readonly markers?: DevicePurgeMarkerRepository;
  /** the persisted cache removal of the device purge; by default it does nothing */
  readonly removePersistedCache?: () => void | PromiseLike<void>;
  /** the reporter of the device purge, sign out and account deletion; by default a report fails */
  readonly reporter?: ErrorReporter;
}

interface AppProvidersProps extends WrapperProps {
  readonly language: Language;
  readonly showAdult: boolean;
  readonly guestMerge: GuestMergeValue;
  readonly sessionLibrary: SessionLibraryValue;
  readonly markers: DevicePurgeMarkerRepository;
  readonly removePersistedCache: () => void | PromiseLike<void>;
  readonly reporter: ErrorReporter;
  readonly authRepository: AuthRepository;
  readonly catalogProvider: CatalogProvider;
  readonly recentSearchesRepository: RecentSearchesRepository;
  readonly queryClient: QueryClient;
}

const ignoreRetry = (): void => undefined;

// no persisted cache in the tests
const keepPersistedCache = (): void => undefined;

// a report the test did not set up a reporter for fails it through fail-on-console (test/core)
const failOnReport: ErrorReporter = Object.freeze({
  captureError: (_error: unknown, context?: ErrorContext): void => {
    console.error(`unexpected error report (${context?.source ?? 'no source'})`);
  },
});

/**
 * no guest merge running or failed, as signed out or once merged: the default fixed state of
 * AppProviders, whose library is a fixed session library, not the session library switch
 */
export const IDLE_GUEST_MERGE: GuestMergeValue = Object.freeze({
  status: 'idle',
  retry: ignoreRetry,
});

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
 * recent searches, a fixed session library where the root has the session library switch (the
 * session libraries `sessionLibrary`, the guest merge state `guestMerge` and a library over
 * `account ?? guest`; a test may nest its own LibraryContextProvider), the device purge, fixed
 * preferences with `showAdult`, the real catalogs in `language` with a missing key failing the
 * test, and the light palette for predictable colors
 */
export function AppProviders({
  language,
  showAdult,
  guestMerge,
  sessionLibrary,
  markers,
  removePersistedCache,
  reporter,
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
            <SessionLibraryContext value={sessionLibrary}>
              <GuestMergeContext value={guestMerge}>
                <LibraryContextProvider repository={sessionLibrary.account ?? sessionLibrary.guest}>
                  <DevicePurgeContextProvider
                    removePersistedCache={removePersistedCache}
                    reporter={reporter}
                    markers={markers}
                  >
                    <TestPreferences showAdult={showAdult} language={language}>
                      <I18nProvider language={language} onMissingKey={failOnMissingKey}>
                        <ThemeProvider preference="light">{children}</ThemeProvider>
                      </I18nProvider>
                    </TestPreferences>
                  </DevicePurgeContextProvider>
                </LibraryContextProvider>
              </GuestMergeContext>
            </SessionLibraryContext>
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
  guestMerge = IDLE_GUEST_MERGE,
  sessionLibrary: sessionLibraryOption = {
    account: null,
    guest: createFakeGuestLibraryRepository(),
  },
  markers = createFakeDevicePurgeMarkers(),
  removePersistedCache = keepPersistedCache,
  reporter = failOnReport,
}: ProvidersOptions = {}): ComponentType<WrapperProps> => {
  const sessionLibrary = toSessionLibrary(sessionLibraryOption);
  return function Providers({ children }: WrapperProps) {
    return (
      <AppProviders
        language={language}
        showAdult={showAdult}
        guestMerge={guestMerge}
        sessionLibrary={sessionLibrary}
        markers={markers}
        removePersistedCache={removePersistedCache}
        reporter={reporter}
        authRepository={authRepository}
        catalogProvider={catalogProvider}
        recentSearchesRepository={recentSearchesRepository}
        queryClient={queryClient}
      >
        {children}
      </AppProviders>
    );
  };
};

/** renders a route or feature component inside AppProviders with `options`, english by default */
export const renderWithProviders = (element: ReactElement, options?: ProvidersOptions) =>
  render(element, { wrapper: providersFor(options) });
