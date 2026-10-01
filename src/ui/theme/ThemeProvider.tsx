// the only import of the stylesheet: nativewind compiles it in metro (a stub in jest)
import './global.css';

import { ThemeProvider as NavigationThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { colorScheme as nativewindColorScheme, useColorScheme, vars } from 'nativewind';
import { useEffect, useMemo, type ReactNode } from 'react';
import { View } from 'react-native';

import { palettes, type ColorScheme } from './colors';
import { paletteVariables } from './css-variables';
import { navigationThemeFor } from './navigation-theme';
import { ThemeContext, type ThemeContextValue } from './theme-context';

export type ColorSchemePreference = 'system' | 'light' | 'dark';

export interface ThemeProviderProps {
  /** the user's theme setting: system follows the device light/dark setting (FR-30) */
  preference: ColorSchemePreference;
  children: ReactNode;
}

// the palettes never change at run time: their css variables are built once
const SCHEME_VARIABLES: Readonly<Record<ColorScheme, ReturnType<typeof vars>>> = {
  light: vars(paletteVariables(palettes.light)),
  dark: vars(paletteVariables(palettes.dark)),
};

// light content (status bar icons and text) on the dark palette, dark content on the light one
const STATUS_BAR_STYLE = { light: 'dark', dark: 'light' } as const;

const FALLBACK_SCHEME: ColorScheme = 'light';

const warnRootBackgroundFailure = (error: unknown) => {
  // TODO(F-10): report to Sentry
  if (__DEV__) {
    console.warn('could not set the root view background color', error);
  }
};

/**
 * applies the palette of the resolved color scheme to the whole tree as css variables, and drives
 * the native appearance (keyboard, system dialogs) through nativewind, which sets Appearance. it
 * also gives navigators a theme built from the palette, and paints the native root view with the
 * palette background, so no light frame shows behind a dark screen during transitions
 */
export function ThemeProvider({ preference, children }: ThemeProviderProps) {
  const { colorScheme: current } = useColorScheme();

  useEffect(() => {
    nativewindColorScheme.set(preference);
  }, [preference]);

  // resolved from the preference first: the appearance override lands after this render
  const scheme: ColorScheme = preference === 'system' ? (current ?? FALLBACK_SCHEME) : preference;
  const theme = useMemo<ThemeContextValue>(() => ({ scheme, colors: palettes[scheme] }), [scheme]);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(palettes[scheme].background).catch(warnRootBackgroundFailure);
  }, [scheme]);

  return (
    <ThemeContext value={theme}>
      <NavigationThemeProvider value={navigationThemeFor(scheme)}>
        <View className="flex-1" style={SCHEME_VARIABLES[scheme]}>
          {children}
        </View>
      </NavigationThemeProvider>
      <StatusBar style={STATUS_BAR_STYLE[scheme]} />
    </ThemeContext>
  );
}
