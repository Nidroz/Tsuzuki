// languages the app ships a catalog for (en.json, fr.json)
export const SUPPORTED_LANGUAGES = ['en', 'fr'] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** used when no device language is supported, and for keys missing from the active catalog */
export const FALLBACK_LANGUAGE: Language = 'en';

/** the user's language setting: system follows the device languages (FR-31) */
export const LANGUAGE_PREFERENCES = ['system', ...SUPPORTED_LANGUAGES] as const;

export type LanguagePreference = (typeof LANGUAGE_PREFERENCES)[number];

export const DEFAULT_LANGUAGE_PREFERENCE: LanguagePreference = 'system';

export const isLanguage = (value: string): value is Language =>
  SUPPORTED_LANGUAGES.some((language) => language === value);
