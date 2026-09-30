import {
  DEFAULT_LANGUAGE_PREFERENCE,
  hasIntlPluralRules,
  I18nProvider,
  resolveLanguage,
  type LanguagePreference,
  type MissingKeyHandler,
} from '@core/i18n/index';
import { useDeviceLanguageTags } from '@platform/locale';
import { ThemeProvider, type ColorSchemePreference } from '@ui/index';
import { Stack } from 'expo-router';
import { useState } from 'react';

// the header stays hidden until the tabs shell (F-07) gives every route a translated title
const screenOptions = { headerShown: false } as const;

const DEFAULT_THEME_PREFERENCE: ColorSchemePreference = 'system';

// development logs only: a key is not personal data
// TODO(F-10): report missing keys and the missing plural rules to Sentry in release builds
if (__DEV__ && !hasIntlPluralRules()) {
  console.warn('Intl.PluralRules is missing: plural forms fall back to a one/other rule');
}

const warnMissingKey: MissingKeyHandler | undefined = __DEV__
  ? (language, key) => {
      console.warn(`missing translation key "${key}" (${language})`);
    }
  : undefined;

// expo-router's root already provides the SafeAreaProvider that Screen relies on; ThemeProvider
// renders the status bar
export default function RootLayout() {
  // the theme and language pickers are wired in F-07 and the preferences persisted in F-09
  const [themePreference] = useState<ColorSchemePreference>(DEFAULT_THEME_PREFERENCE);
  const [languagePreference] = useState<LanguagePreference>(DEFAULT_LANGUAGE_PREFERENCE);
  const language = resolveLanguage(languagePreference, useDeviceLanguageTags());

  return (
    <I18nProvider language={language} onMissingKey={warnMissingKey}>
      <ThemeProvider preference={themePreference}>
        <Stack screenOptions={screenOptions} />
      </ThemeProvider>
    </I18nProvider>
  );
}
