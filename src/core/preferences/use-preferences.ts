import { use } from 'react';

import {
  MISSING_PREFERENCES_PROVIDER_MESSAGE,
  PreferencesContext,
  type Preferences,
} from './preferences-context';

export type { Preferences };

/**
 * the theme and language preferences with their setters, from the nearest PreferencesProvider;
 * throws outside of it. the value keeps its identity while the preferences and handlers stay the
 * same
 */
export const usePreferences = (): Preferences => {
  const preferences = use(PreferencesContext);
  if (preferences === null) {
    throw new Error(MISSING_PREFERENCES_PROVIDER_MESSAGE);
  }
  return preferences;
};
