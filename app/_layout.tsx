// first: plural rules must exist before i18next builds its plural resolvers
import '@platform/intl-polyfills';

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
  saveThemePreference,
  type ThemePreference,
} from '@core/preferences/index';
import { createPersistOptions, createQueryPersister } from '@core/query/persister';
import { createQueryClient } from '@core/query/query-client';
import { parseAppEnv } from '@core/schemas/app-env';
import { readAppEnv } from '@platform/app-env';
import { APP_VERSION } from '@platform/app-version';
import { useDeviceLanguageTags } from '@platform/locale';
import { createErrorReporter, initSentry } from '@platform/sentry';
import { createStorage } from '@platform/storage';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { ThemeProvider } from '@ui/index';
import { Stack } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

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
// anything else is created (fail closed, ADR-0012). the supabase client is wired from it with its
// first consumer (the auth or library repositories)
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

// the app's single key-value storage: it holds the preferences and the persisted query cache.
// module level, so the persist options stay one stable object for PersistQueryClientProvider
const storage = createStorage();

// a new app version or cache schema version drops the persisted cache
const persistOptions = createPersistOptions({
  persister: createQueryPersister(storage),
  appVersion: APP_VERSION,
});

// the root stack, inside I18nProvider because its header titles are translated
function RootStack() {
  const { t } = useTranslation();
  const mediaOptions = useMemo(() => ({ title: t('mediaDetail.title') }), [t]);
  const notFoundOptions = useMemo(() => ({ title: t('notFound.title') }), [t]);

  return (
    <Stack screenOptions={ROOT_SCREEN_OPTIONS}>
      <Stack.Screen name="(tabs)" options={TABS_OPTIONS} />
      <Stack.Screen name="media/[kind]/[id]" options={mediaOptions} />
      <Stack.Screen name="+not-found" options={notFoundOptions} />
    </Stack>
  );
}

// the composition root: it owns the storage, the query client and the preferences, and gives the
// tree the query cache (persisted to the storage), the preferences, the translations and the
// theme. the stored preferences are read synchronously on mount, so the first frame already uses
// them. expo-router's root already provides the SafeAreaProvider that Screen relies on;
// ThemeProvider renders the status bar and gives navigators their theme
export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  const [initialPreferences] = useState(() => loadPreferences(storage));
  const [themePreference, setThemePreference] = useState<ThemePreference>(initialPreferences.theme);
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>(
    initialPreferences.language,
  );
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

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <PreferencesProvider
        theme={themePreference}
        language={languagePreference}
        onThemeChange={changeTheme}
        onLanguageChange={changeLanguage}
      >
        <I18nProvider language={language} onMissingKey={reportMissingKey}>
          <ThemeProvider preference={themePreference} onError={reportThemeError}>
            <RootStack />
          </ThemeProvider>
        </I18nProvider>
      </PreferencesProvider>
    </PersistQueryClientProvider>
  );
}
