import { ThemeProvider, type ColorSchemePreference } from '@ui/index';
import { Stack } from 'expo-router';
import { useState } from 'react';

// the header is hidden so no untranslated title is shown before i18n lands (F-06)
const screenOptions = { headerShown: false } as const;

const DEFAULT_THEME_PREFERENCE: ColorSchemePreference = 'system';

// expo-router's root already provides the SafeAreaProvider that Screen relies on; ThemeProvider
// renders the status bar
export default function RootLayout() {
  // the theme picker is wired in F-07 and the preference persisted in F-09
  const [themePreference] = useState<ColorSchemePreference>(DEFAULT_THEME_PREFERENCE);

  return (
    <ThemeProvider preference={themePreference}>
      <Stack screenOptions={screenOptions} />
    </ThemeProvider>
  );
}
