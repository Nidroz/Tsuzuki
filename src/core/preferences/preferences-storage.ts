import { z } from 'zod';

import {
  DEFAULT_LANGUAGE_PREFERENCE,
  LANGUAGE_PREFERENCES,
  type LanguagePreference,
} from '../i18n/index';
import { DEFAULT_SHOW_ADULT } from '../domain/content-filter';
import type { StorageAdapter } from '../repositories/storage-adapter';
import { DEFAULT_THEME_PREFERENCE, THEME_PREFERENCES, type ThemePreference } from './preferences';

export const THEME_PREFERENCE_KEY = 'preferences.theme';
export const LANGUAGE_PREFERENCE_KEY = 'preferences.language';
export const SHOW_ADULT_PREFERENCE_KEY = 'preferences.showAdult';

export interface StoredPreferences {
  readonly theme: ThemePreference;
  readonly language: LanguagePreference;
  /** whether adult titles are shown (BR-06, FR-32) */
  readonly showAdult: boolean;
}

const themeSchema = z.enum(THEME_PREFERENCES);
const languageSchema = z.enum(LANGUAGE_PREFERENCES);

// the adult content setting is stored as text: only these exact strings are accepted
const STORED_TRUE = 'true';
const STORED_FALSE = 'false';
const showAdultSchema = z.enum([STORED_TRUE, STORED_FALSE]);

// storage content is untrusted: a missing or unknown value falls back to the default
const parseOrDefault = <T extends string>(
  schema: z.ZodType<T>,
  stored: string | undefined,
  fallback: T,
): T => {
  const parsed = schema.safeParse(stored);
  return parsed.success ? parsed.data : fallback;
};

// fail closed: anything but the exact stored strings keeps adult titles hidden (BR-06)
const parseShowAdult = (stored: string | undefined): boolean => {
  const parsed = showAdultSchema.safeParse(stored);
  return parsed.success ? parsed.data === STORED_TRUE : DEFAULT_SHOW_ADULT;
};

/**
 * the persisted theme, language and adult content preferences, or their defaults (system, system,
 * adult content hidden)
 */
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
  showAdult: parseShowAdult(storage.getString(SHOW_ADULT_PREFERENCE_KEY)),
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

export const saveShowAdultPreference = (storage: StorageAdapter, showAdult: boolean): void => {
  storage.set(SHOW_ADULT_PREFERENCE_KEY, showAdult ? STORED_TRUE : STORED_FALSE);
};
