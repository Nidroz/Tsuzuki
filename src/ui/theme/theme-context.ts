import { createContext, use } from 'react';

import type { ColorScheme, Palette } from './colors';

export interface ThemeContextValue {
  readonly scheme: ColorScheme;
  readonly colors: Palette;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export const MISSING_THEME_PROVIDER_MESSAGE =
  'useThemeColors is used outside ThemeProvider: render the tree inside ThemeProvider';

/**
 * palette of the resolved color scheme, for props that take a color value instead of a class
 * (ActivityIndicator color, placeholderTextColor, icon color). internal to src/ui
 */
export const useThemeColors = (): Palette => {
  const theme = use(ThemeContext);
  if (!theme) {
    throw new Error(MISSING_THEME_PROVIDER_MESSAGE);
  }
  return theme.colors;
};
