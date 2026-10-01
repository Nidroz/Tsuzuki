import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';

import { palettes, type ColorScheme } from './colors';

const buildNavigationTheme = (scheme: ColorScheme): Theme => {
  const palette = palettes[scheme];
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    dark: scheme === 'dark',
    colors: {
      primary: palette.primary,
      background: palette.background,
      card: palette.surface,
      text: palette.text,
      border: palette.border,
      notification: palette.danger,
    },
    fonts: base.fonts,
  };
};

// the palettes never change at run time: each navigation theme is built once
const NAVIGATION_THEMES: Readonly<Record<ColorScheme, Theme>> = {
  light: buildNavigationTheme('light'),
  dark: buildNavigationTheme('dark'),
};

/**
 * the react navigation theme of a color scheme, built from its palette: navigator backgrounds,
 * headers and the tab bar follow the app colors. internal to src/ui
 */
export const navigationThemeFor = (scheme: ColorScheme): Theme => NAVIGATION_THEMES[scheme];
