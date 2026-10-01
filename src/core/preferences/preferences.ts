// the user's theme setting: system follows the device light/dark setting (FR-30). declared in core
// because core cannot import src/ui; it matches the ui ColorSchemePreference
export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';
