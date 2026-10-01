import { describe, expect, it } from '@jest/globals';
import { DarkTheme, DefaultTheme } from 'expo-router';

import { type ColorScheme, palettes } from './colors';
import { navigationThemeFor } from './navigation-theme';

describe('navigationThemeFor', () => {
  it.each<[ColorScheme, boolean, typeof DefaultTheme]>([
    ['light', false, DefaultTheme],
    ['dark', true, DarkTheme],
  ])('maps the %s palette to the navigation colors', (scheme, dark, base) => {
    const palette = palettes[scheme];

    expect(navigationThemeFor(scheme)).toStrictEqual({
      dark,
      colors: {
        primary: palette.primary,
        background: palette.background,
        card: palette.surface,
        text: palette.text,
        border: palette.border,
        notification: palette.danger,
      },
      fonts: base.fonts,
    });
  });

  it('builds each theme once', () => {
    expect(navigationThemeFor('dark')).toBe(navigationThemeFor('dark'));
    expect(navigationThemeFor('light')).not.toBe(navigationThemeFor('dark'));
  });
});
