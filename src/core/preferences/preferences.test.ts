import { describe, expect, it } from '@jest/globals';

import { DEFAULT_THEME_PREFERENCE, THEME_PREFERENCES, type ThemePreference } from './preferences';

describe('theme preferences', () => {
  it('are system, light and dark', () => {
    expect(THEME_PREFERENCES).toStrictEqual(['system', 'light', 'dark']);
  });

  // the theme follows the device until the user picks one (FR-30)
  it('default to system', () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe('system');
    expect(THEME_PREFERENCES).toContain(DEFAULT_THEME_PREFERENCE);
  });

  it('reject a value outside the list', () => {
    // @ts-expect-error(type-test): a theme preference is system, light or dark
    const unknown: ThemePreference = 'sepia';

    expect(THEME_PREFERENCES).not.toContain(unknown);
  });
});
