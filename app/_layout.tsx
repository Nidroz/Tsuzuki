// first: plural rules must exist before i18next builds its plural resolvers
import '@platform/intl-polyfills';

import { monitorCatalogProvider } from '@core/catalog/catalog-failure-monitor';
import { createJikanCatalogProvider } from '@core/catalog/jikan/jikan-catalog-provider';
import { jikanInstanceFor } from '@core/catalog/jikan/jikan-instances';
import { AuthContextProvider } from '@core/hooks/AuthContextProvider';
import { CatalogContextProvider } from '@core/hooks/CatalogContextProvider';
import { LibraryContextProvider } from '@core/hooks/LibraryContextProvider';
import { RecentSearchesContextProvider } from '@core/hooks/RecentSearchesContextProvider';
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
import { createPersistOptions, createQueryPersister } from '@core/query/persister';
import { createQueryClient } from '@core/query/query-client';
import { noCaptcha } from '@core/repositories/auth-repository';
import { createLocalLibraryRepository } from '@core/repositories/local/library-repository';
import { createLocalRecentSearchesRepository } from '@core/repositories/local/recent-searches-repository';
import { createSupabaseAuthRepository } from '@core/repositories/supabase/auth-repository';
import { createSupabaseClient } from '@core/repositories/supabase/create-supabase-client';
import { appLinkUrl, AUTH_LINK_PATHS } from '@core/schemas/app-links';
import { parseAppEnv } from '@core/schemas/app-env';
import { readAppEnv } from '@platform/app-env';
import { subscribeToForeground } from '@platform/app-state';
import { APP_VERSION } from '@platform/app-version';
import { useDeviceLanguageTags } from '@platform/locale';
import { createSecureSessionStorage } from '@platform/secure-session';
import { createErrorReporter, initSentry } from '@platform/sentry';
import { createStorage } from '@platform/storage';
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
// anything else is created (fail closed, ADR-0012). the supabase client and the catalog instance
// come from it below
const appEnv = readAppEnv(parseAppEnv);

// sentry in release builds with a dsn, the console in development (ADR-0012)
const reporter = createErrorReporter(initSentry(appEnv));

const I18N_SOURCE = 'i18n';
const THEME_SOURCE = 'theme';

// a key and a language are not personal data. the polyfill above should make the plural report
// unreachable; it stays as a guard
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

// the app's single key-value storage: it holds the preferences, the recent searches, the guest
// library and the persisted query cache. module level, so the persist options stay one stable
// object for PersistQueryClientProvider
const storage = createStorage();

// a new app version or cache schema version drops the persisted cache
const persistOptions = createPersistOptions({
  persister: createQueryPersister(storage),
  appVersion: APP_VERSION,
});

// the only place that selects a catalog provider and its instance (ADR-0013): tenrai unless the
// build sets a self-hosted jikan base url. sustained provider failures go to the reporter.
// module level, like the repository below: each is one stable object for its context
const catalogProvider = monitorCatalogProvider(
  createJikanCatalogProvider(jikanInstanceFor(appEnv.jikanBaseUrl)),
  { reporter },
);

// the recent searches on the device (FR-02), checked against the provider's search text limit
const recentSearchesRepository = createLocalRecentSearchesRepository(storage, {
  maxQueryLength: catalogProvider.searchQueryMaxLength,
});

// the guest library on the device (FR-20); a damaged store is reported, never thrown. the only
// library until A-03 picks the repository from the auth state, in this provider's prop only
const libraryRepository = createLocalLibraryRepository(storage, { reporter });

// the supabase client of the app: anon key only, its session in the secure store, never in the
// app storage (§8). the auth repository sends the email links to the app's own routes (ADR-0014);
// the supabase library repository of A-03 will share the client
const supabase = createSupabaseClient({
  url: appEnv.supabaseUrl,
  anonKey: appEnv.supabaseAnonKey,
  sessionStorage: createSecureSessionStorage(reporter),
});
// TODO(A-09): pass the oauth option (the browser session and the per-build provider list)
const authRepository = createSupabaseAuthRepository(supabase, {
  confirmationRedirectUrl: appLinkUrl(AUTH_LINK_PATHS.confirmation),
  passwordResetRedirectUrl: appLinkUrl(AUTH_LINK_PATHS.passwordReset),
  reporter,
});

// the token auto refresh runs only while the app is in the foreground (supabase-js on react
// native): no timer in the background, and a token close to expiry is refreshed on return
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
      <Stack.Screen name="+not-found" options={options.notFound} />
    </Stack>
  );
}

// the composition root: it owns the storage, the auth repository, the catalog provider, the recent
// searches and library repositories, the query client and the preferences, and gives the tree the
// query cache (persisted to the storage), the auth (its mutations need the query client), the
// catalog provider, the recent searches and the library (the data dependencies, next to the query
// client; the library writer keeps its optimistic entries in that cache), then the preferences,
// the translations and the theme. the stored preferences are read
// synchronously on mount, so the first frame already uses them. expo-router's root already
// provides the SafeAreaProvider that Screen relies on; ThemeProvider renders the status bar and
// gives navigators their theme
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
            <LibraryContextProvider repository={libraryRepository}>
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
            </LibraryContextProvider>
          </RecentSearchesContextProvider>
        </CatalogContextProvider>
      </AuthContextProvider>
    </PersistQueryClientProvider>
  );
}
