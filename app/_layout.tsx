// first: crypto.getRandomValues and crypto.subtle.digest must exist before the supabase client
// draws a pkce verifier (s256 from a secure source, never Math.random and plain) and before the
// app storage key is drawn: hermes has neither
import '@platform/web-crypto-polyfill';
// then: plural rules must exist before i18next builds its plural resolvers
import '@platform/intl-polyfills';

import { monitorCatalogProvider } from '@core/catalog/catalog-failure-monitor';
import { createJikanCatalogProvider } from '@core/catalog/jikan/jikan-catalog-provider';
import { jikanInstanceFor } from '@core/catalog/jikan/jikan-instances';
import { AuthContextProvider } from '@core/hooks/AuthContextProvider';
import { CatalogContextProvider } from '@core/hooks/CatalogContextProvider';
import { DevicePurgeContextProvider } from '@core/hooks/DevicePurgeContextProvider';
import { settleOwedDevicePurges } from '@core/hooks/owed-device-purges';
import { RecentSearchesContextProvider } from '@core/hooks/RecentSearchesContextProvider';
import { SessionLibraryContextProvider } from '@core/hooks/SessionLibraryContextProvider';
import {
  hasIntlPluralRules,
  I18nProvider,
  resolveLanguage,
  useTranslation,
  type LanguagePreference,
  type MissingKeyHandler,
} from '@core/i18n/index';
import {
  loadPreferences,
  PreferencesProvider,
  saveLanguagePreference,
  saveShowAdultPreference,
  saveThemePreference,
  type ThemePreference,
} from '@core/preferences/index';
import { followConnectivity, isDeviceOnline } from '@core/query/online-manager';
import { createPersistOptions, createQueryPersister } from '@core/query/persister';
import { createQueryClient } from '@core/query/query-client';
import { noCaptcha } from '@core/repositories/auth-repository';
import { createOfflineAccountLibraries } from '@core/repositories/local/account-libraries';
import { createLocalDevicePurgeMarkerRepository } from '@core/repositories/local/device-purge-marker-repository';
import { createLocalLibraryRepository } from '@core/repositories/local/library-repository';
import { createLocalRecentSearchesRepository } from '@core/repositories/local/recent-searches-repository';
import { createSupabaseAuthRepository } from '@core/repositories/supabase/auth-repository';
import { createSupabaseClient } from '@core/repositories/supabase/create-supabase-client';
import { createSupabaseLibraryRepository } from '@core/repositories/supabase/library-repository';
import { createTokenRefreshRefusalSignal } from '@core/repositories/supabase/token-refresh-refusals';
import { appLinkUrl, AUTH_LINK_PATHS } from '@core/schemas/app-links';
import { parseAppEnv } from '@core/schemas/app-env';
import { readAppEnv } from '@platform/app-env';
import { subscribeToForeground } from '@platform/app-state';
import { openAppStorage } from '@platform/app-storage';
import { APP_VERSION } from '@platform/app-version';
import { createConnectivitySubscription } from '@platform/connectivity';
import { useDeviceLanguageTags } from '@platform/locale';
import { createSecureDocumentStorage } from '@platform/secure-documents';
import { createSecureSessionStorage } from '@platform/secure-session';
import { createErrorReporter, initSentry } from '@platform/sentry';
import { secureRandomValues } from '@platform/web-crypto';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { ThemeProvider } from '@ui/index';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

// a cold deep link to a detail screen still gets the tabs below it, so back leads to Discover
export const unstable_settings = { initialRouteName: '(tabs)' };

// the tabs navigator shows the header of each tab itself
const TABS_OPTIONS = { headerShown: false } as const;

// every screen of the root stack: the back button shows no title and no history menu, which would
// show the untranslated route name of the screen below (the "(tabs)" group, on ios)
const ROOT_SCREEN_OPTIONS = {
  headerBackButtonDisplayMode: 'minimal',
  headerBackButtonMenuEnabled: false,
} as const;

// the build-time env, validated again at startup: a missing or invalid env throws here, before
// anything else is created (fail closed, ADR-0012)
const appEnv = readAppEnv(parseAppEnv);

// sentry in release builds with a dsn, the console in development (ADR-0012)
const reporter = createErrorReporter(initSentry(appEnv));

const I18N_SOURCE = 'i18n';
const THEME_SOURCE = 'theme';

// the onlineManager follows the device network (expo-network): catalog queries pause offline, and
// the offline account library and the catalog failure monitor read the same flag (ADR-0017)
followConnectivity(createConnectivitySubscription(reporter));

// unreachable with the polyfill above: kept as a guard. a key and a language are not personal data
if (!hasIntlPluralRules()) {
  reporter.captureError(
    new Error('Intl.PluralRules is missing: plural forms fall back to a one/other rule'),
    { source: I18N_SOURCE },
  );
}

// each missing key is reported once per language: a missing key is looked up on every render
const reportedMissingKeys = new Set<string>();
const reportMissingKey: MissingKeyHandler = (language, key) => {
  const id = `${language}:${key}`;
  if (reportedMissingKeys.has(id)) return;
  reportedMissingKeys.add(id);
  reporter.captureError(new Error(`missing translation key "${key}" (${language})`), {
    source: I18N_SOURCE,
    tags: { language, key },
  });
};

// a failure to paint the native root view background (ui ThemeProvider)
const reportThemeError = (error: unknown) => {
  reporter.captureError(error, { source: THEME_SOURCE });
};

// the app's single key-value storage, one aes-256 mmkv instance whose key the secure store keeps
// (ADR-0020), opened once before anything reads it; on memory (persistent false) when the key or
// the files cannot be opened, every file untouched until the next launch
const appStorage = openAppStorage({ reporter, getRandomValues: secureRandomValues });
const { storage, persistent, firstLaunch } = appStorage;

// a new app version or cache schema version drops the persisted cache; the device purge of a sign
// out or an account deletion deletes it (removeClient, ADR-0018)
const queryPersister = createQueryPersister(storage);
const persistOptions = createPersistOptions({ persister: queryPersister, appVersion: APP_VERSION });

// the only place that selects a catalog provider and its instance (ADR-0013): tenrai unless the
// build sets a self-hosted jikan base url. sustained failures are reported, network errors online
const catalogProvider = monitorCatalogProvider(
  createJikanCatalogProvider(jikanInstanceFor(appEnv.jikanBaseUrl)),
  { reporter, isOnline: isDeviceOnline },
);

// the recent searches on the device (FR-02), checked against the provider's search text limit
const recentSearchesRepository = createLocalRecentSearchesRepository(storage, {
  maxQueryLength: catalogProvider.searchQueryMaxLength,
});

// the guest library on the device (FR-20), shown while signed out and merged into the account
// library at sign in (BR-08, ADR-0016); a damaged store is reported, never thrown
const libraryRepository = createLocalLibraryRepository(storage, { reporter });

// the token refreshes the auth server refused, seen by the supabase client's fetch and told to the
// auth repository, which checks whether the user is gone (ADR-0018, update of 2026-11-04)
const refreshRefusals = createTokenRefreshRefusalSignal();

// the supabase client: anon key only, its session in the secure store, never in the app storage
// (§8). a first launch never reads a session stored before it: the ios keychain outlives an
// uninstall, so a reinstall starts signed out. the email links go to the app's routes (ADR-0014)
const supabase = createSupabaseClient({
  url: appEnv.supabaseUrl,
  anonKey: appEnv.supabaseAnonKey,
  sessionStorage: createSecureSessionStorage(reporter, { discardStored: firstLaunch }),
  onTokenRefreshRefused: refreshRefusals.notify,
});
// TODO(A-09): pass the oauth option (the browser session and the per-build provider list)
const authRepository = createSupabaseAuthRepository(supabase, {
  confirmationRedirectUrl: appLinkUrl(AUTH_LINK_PATHS.confirmation),
  passwordResetRedirectUrl: appLinkUrl(AUTH_LINK_PATHS.passwordReset),
  reporter,
  refreshRefusals,
});

// the account library of a signed-in user (FR-23), behind a device copy and a write queue per user
// in the app storage (ADR-0017): the session library switch calls it once per user id
const accountLibraryFor = createOfflineAccountLibraries({
  storage,
  remoteFor: (userId) => createSupabaseLibraryRepository(supabase, { userId, reporter }),
  isOnline: isDeviceOnline,
  reporter,
});

// the users whose device purge is owed (ADR-0018, update of 2026-11-04), marked by a sign out or a
// gone purge and purged by the next launch when it did not complete
const devicePurgeMarkers = createLocalDevicePurgeMarkerRepository(storage, { reporter });

// the purges a memory app storage owes to the files (R-09), in the secure store: each purge on
// memory records its user there first, the next launch on the files carries them into the markers
// above, a first launch drops them. passed to the purge only while on memory
const owedStorage = createSecureDocumentStorage();
const owedDevicePurges = createLocalDevicePurgeMarkerRepository(owedStorage, { reporter });
settleOwedDevicePurges({
  owed: owedDevicePurges,
  markers: devicePurgeMarkers,
  persistent,
  firstLaunch,
  reporter,
});
const owedPurgesProp = persistent ? {} : { owedPurges: owedDevicePurges };

// the token auto refresh runs only in the foreground (supabase-js on react native): no timer in
// the background, and a token close to expiry is refreshed on return
const bindAutoRefreshToForeground = () =>
  subscribeToForeground((foreground) => {
    authRepository.setAutoRefresh(foreground);
  });

// the root stack, inside I18nProvider because its header titles are translated
function RootStack() {
  const { t } = useTranslation();
  const options = useMemo(
    () => ({
      media: { title: t('mediaDetail.title') },
      signIn: { title: t('auth.signIn.title') },
      signUp: { title: t('auth.signUp.title') },
      forgotPassword: { title: t('auth.forgotPassword.title') },
      emailConfirmed: { title: t('auth.emailConfirmed.title') },
      resetPassword: { title: t('auth.resetPassword.title') },
      oauthCallback: { title: t('auth.oauthCallback.title') },
      deleteAccount: { title: t('settings.deleteAccount.title') },
      notFound: { title: t('notFound.title') },
    }),
    [t],
  );

  return (
    <Stack screenOptions={ROOT_SCREEN_OPTIONS}>
      <Stack.Screen name="(tabs)" options={TABS_OPTIONS} />
      <Stack.Screen name="media/[namespace]/[kind]/[id]" options={options.media} />
      <Stack.Screen name="auth/sign-in" options={options.signIn} />
      <Stack.Screen name="auth/sign-up" options={options.signUp} />
      <Stack.Screen name="auth/forgot-password" options={options.forgotPassword} />
      <Stack.Screen name="auth/callback" options={options.emailConfirmed} />
      <Stack.Screen name="auth/reset-password" options={options.resetPassword} />
      <Stack.Screen name="auth/oauth-callback" options={options.oauthCallback} />
      <Stack.Screen name="account/delete" options={options.deleteAccount} />
      <Stack.Screen name="+not-found" options={options.notFound} />
    </Stack>
  );
}

// the composition root: it gives the tree the query cache (persisted to the storage), the auth (its
// mutations need the query client), the catalog provider, the recent searches and the library of
// the session (the library switch reads the session, inside the auth), the device purges (inside
// all of them, whose data they delete), then the preferences, the translations and the theme. the
// stored preferences are read synchronously on mount, so the first frame already uses them.
// expo-router's root provides the SafeAreaProvider; ThemeProvider renders the status bar
export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  const [initialPreferences] = useState(() => loadPreferences(storage));
  const [themePreference, setThemePreference] = useState<ThemePreference>(initialPreferences.theme);
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>(
    initialPreferences.language,
  );
  const [showAdult, setShowAdult] = useState(initialPreferences.showAdult);
  const language = resolveLanguage(languagePreference, useDeviceLanguageTags());

  // stable handlers, as PreferencesProvider expects: they save the choice, then apply it
  const changeTheme = useCallback((theme: ThemePreference) => {
    saveThemePreference(storage, theme);
    setThemePreference(theme);
  }, []);
  const changeLanguage = useCallback((next: LanguagePreference) => {
    saveLanguagePreference(storage, next);
    setLanguagePreference(next);
  }, []);
  const changeShowAdult = useCallback((next: boolean) => {
    saveShowAdultPreference(storage, next);
    setShowAdult(next);
  }, []);

  useEffect(bindAutoRefreshToForeground, []);

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <AuthContextProvider repository={authRepository} captcha={noCaptcha}>
        <CatalogContextProvider provider={catalogProvider}>
          <RecentSearchesContextProvider repository={recentSearchesRepository}>
            <SessionLibraryContextProvider
              guest={libraryRepository}
              accountRepositoryFor={accountLibraryFor}
              reporter={reporter}
              subscribeToForeground={subscribeToForeground}
            >
              <DevicePurgeContextProvider
                removePersistedCache={queryPersister.removeClient}
                reporter={reporter}
                markers={devicePurgeMarkers}
                {...owedPurgesProp}
              >
                <PreferencesProvider
                  theme={themePreference}
                  language={languagePreference}
                  onThemeChange={changeTheme}
                  onLanguageChange={changeLanguage}
                  showAdult={showAdult}
                  onShowAdultChange={changeShowAdult}
                >
                  <I18nProvider language={language} onMissingKey={reportMissingKey}>
                    <ThemeProvider preference={themePreference} onError={reportThemeError}>
                      <RootStack />
                    </ThemeProvider>
                  </I18nProvider>
                </PreferencesProvider>
              </DevicePurgeContextProvider>
            </SessionLibraryContextProvider>
          </RecentSearchesContextProvider>
        </CatalogContextProvider>
      </AuthContextProvider>
    </PersistQueryClientProvider>
  );
}
