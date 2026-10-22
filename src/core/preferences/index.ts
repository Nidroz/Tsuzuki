// public api of the preferences module: routes and features import from here only

export { DEFAULT_THEME_PREFERENCE, THEME_PREFERENCES } from './preferences';
export type { ThemePreference } from './preferences';
export { PreferencesProvider } from './PreferencesProvider';
export type { PreferencesProviderProps } from './PreferencesProvider';
export { usePreferences } from './use-preferences';
export type { Preferences } from './use-preferences';
export {
  LANGUAGE_PREFERENCE_KEY,
  loadPreferences,
  saveLanguagePreference,
  saveShowAdultPreference,
  saveThemePreference,
  SHOW_ADULT_PREFERENCE_KEY,
  THEME_PREFERENCE_KEY,
} from './preferences-storage';
export type { StoredPreferences } from './preferences-storage';
