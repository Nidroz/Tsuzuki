import { THEME_PREFERENCES, type ThemePreference } from '@core/preferences/index';
import { describe, expect, it } from '@jest/globals';
import type { ColorSchemePreference } from '@ui/index';

// core cannot import src/ui, so the theme preference is declared twice: the composition root
// passes the core value to ThemeProvider. each helper compiles only if its argument type is
// assignable to its parameter type: typecheck fails as soon as the two unions drift apart
const toColorSchemePreference = (preference: ThemePreference): ColorSchemePreference => preference;
const toThemePreference = (preference: ColorSchemePreference): ThemePreference => preference;

// every ui preference, listed through a record so a member added to the ui union fails typecheck
const COLOR_SCHEME_PREFERENCES = Object.keys({
  system: true,
  light: true,
  dark: true,
} satisfies Record<ColorSchemePreference, true>) as ColorSchemePreference[];

describe('theme preference types', () => {
  it('lists the same preferences in core and in the design system', () => {
    expect(THEME_PREFERENCES.map(toColorSchemePreference).toSorted()).toStrictEqual(
      COLOR_SCHEME_PREFERENCES.map(toThemePreference).toSorted(),
    );
  });
});
