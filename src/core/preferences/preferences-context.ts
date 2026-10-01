import { createContext } from 'react';

import type { LanguagePreference } from '../i18n/index';
import type { ThemePreference } from './preferences';

export interface Preferences {
  readonly theme: ThemePreference;
  readonly language: LanguagePreference;
  readonly setTheme: (theme: ThemePreference) => void;
  readonly setLanguage: (language: LanguagePreference) => void;
}

/** the preferences and their setters, set by PreferencesProvider */
export const PreferencesContext = createContext<Preferences | null>(null);

export const MISSING_PREFERENCES_PROVIDER_MESSAGE =
  'usePreferences is used outside PreferencesProvider: render the tree inside PreferencesProvider';
