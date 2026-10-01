// first: plural rules must exist before i18next builds its plural resolvers
import '@platform/intl-polyfills';

import {
  DEFAULT_LANGUAGE_PREFERENCE,
  hasIntlPluralRules,
  I18nProvider,
  resolveLanguage,
  useTranslation,
  type LanguagePreference,
  type MissingKeyHandler,
} from '@core/i18n/index';
import {
  DEFAULT_THEME_PREFERENCE,
  PreferencesProvider,
  type ThemePreference,
} from '@core/preferences/index';
import { useDeviceLanguageTags } from '@platform/locale';
import { ThemeProvider } from '@ui/index';
import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';

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

// development logs only: a key is not personal data. the polyfill above should make the plural
// warning unreachable; it stays as a guard
// TODO(F-10): report missing keys and the missing plural rules to Sentry in release builds
if (__DEV__ && !hasIntlPluralRules()) {
  console.warn('Intl.PluralRules is missing: plural forms fall back to a one/other rule');
}

const warnMissingKey: MissingKeyHandler | undefined = __DEV__
  ? (language, key) => {
      console.warn(`missing translation key "${key}" (${language})`);
    }
  : undefined;

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

// the composition root: it owns the preferences and gives the tree the preferences, the
// translations and the theme. expo-router's root already provides the SafeAreaProvider that
// Screen relies on; ThemeProvider renders the status bar and gives navigators their theme
export default function RootLayout() {
  // TODO(F-09): persist the preferences
  const [themePreference, setThemePreference] = useState<ThemePreference>(DEFAULT_THEME_PREFERENCE);
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>(
    DEFAULT_LANGUAGE_PREFERENCE,
  );
  const language = resolveLanguage(languagePreference, useDeviceLanguageTags());

  // the state setters are stable, as PreferencesProvider expects of its handlers
  return (
    <PreferencesProvider
      theme={themePreference}
      language={languagePreference}
      onThemeChange={setThemePreference}
      onLanguageChange={setLanguagePreference}
    >
      <I18nProvider language={language} onMissingKey={warnMissingKey}>
        <ThemeProvider preference={themePreference}>
          <RootStack />
        </ThemeProvider>
      </I18nProvider>
    </PreferencesProvider>
  );
}
