import { useMemo, type ReactNode } from 'react';

import type { LanguagePreference } from '../i18n/index';
import { PreferencesContext, type Preferences } from './preferences-context';
import type { ThemePreference } from './preferences';

export interface PreferencesProviderProps {
  theme: ThemePreference;
  language: LanguagePreference;
  /** pass a stable function (module level or memoized): a new one creates a new context value */
  onThemeChange: (theme: ThemePreference) => void;
  /** pass a stable function (module level or memoized): a new one creates a new context value */
  onLanguageChange: (language: LanguagePreference) => void;
  /** whether adult titles are shown (BR-06, FR-32) */
  showAdult: boolean;
  /** pass a stable function (module level or memoized): a new one creates a new context value */
  onShowAdultChange: (showAdult: boolean) => void;
  children: ReactNode;
}

/**
 * gives the tree the theme, language and adult content preferences and their setters. controlled:
 * it holds no state, the owner of the preferences (the composition root) passes them with their
 * change handlers
 */
export function PreferencesProvider({
  theme,
  language,
  onThemeChange,
  onLanguageChange,
  showAdult,
  onShowAdultChange,
  children,
}: PreferencesProviderProps) {
  const preferences = useMemo<Preferences>(
    () => ({
      theme,
      language,
      setTheme: onThemeChange,
      setLanguage: onLanguageChange,
      showAdult,
      setShowAdult: onShowAdultChange,
    }),
    [theme, language, onThemeChange, onLanguageChange, showAdult, onShowAdultChange],
  );

  return <PreferencesContext value={preferences}>{children}</PreferencesContext>;
}
