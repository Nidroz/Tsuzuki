import { z } from 'zod';

import {
  DEFAULT_LANGUAGE_PREFERENCE,
  LANGUAGE_PREFERENCES,
  type LanguagePreference,
} from '../i18n/index';
import type { StorageAdapter } from '../repositories/storage-adapter';
import { DEFAULT_THEME_PREFERENCE, THEME_PREFERENCES, type ThemePreference } from './preferences';

export const THEME_PREFERENCE_KEY = 'preferences.theme';
export const LANGUAGE_PREFERENCE_KEY = 'preferences.language';

export interface StoredPreferences {
  readonly theme: ThemePreference;
  readonly language: LanguagePreference;
}

const themeSchema = z.enum(THEME_PREFERENCES);
const languageSchema = z.enum(LANGUAGE_PREFERENCES);

// storage content is untrusted: a missing or unknown value falls back to the default
const parseOrDefault = <T extends string>(
  schema: z.ZodType<T>,
  stored: string | undefined,
  fallback: T,
): T => {
  const parsed = schema.safeParse(stored);
  return parsed.success ? parsed.data : fallback;
};

/** the persisted theme and language preferences, or their defaults (system) */
export const loadPreferences = (storage: StorageAdapter): StoredPreferences => ({
  theme: parseOrDefault(
    themeSchema,
    storage.getString(THEME_PREFERENCE_KEY),
    DEFAULT_THEME_PREFERENCE,
  ),
  language: parseOrDefault(
    languageSchema,
    storage.getString(LANGUAGE_PREFERENCE_KEY),
    DEFAULT_LANGUAGE_PREFERENCE,
  ),
});

export const saveThemePreference = (storage: StorageAdapter, theme: ThemePreference): void => {
  storage.set(THEME_PREFERENCE_KEY, theme);
};

export const saveLanguagePreference = (
  storage: StorageAdapter,
  language: LanguagePreference,
): void => {
  storage.set(LANGUAGE_PREFERENCE_KEY, language);
};
