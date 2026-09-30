import { parseDeviceLanguageTags } from './device-language-tags';
import { FALLBACK_LANGUAGE, isLanguage, type Language, type LanguagePreference } from './languages';

// everything from the first subtag separator ("-" or "_") to the end of the tag
const AFTER_PRIMARY_SUBTAG = /[-_].*$/s;

// the primary language subtag, lowercased: "fr-CA" and "FR_ca" both give "fr"
const primarySubtag = (tag: string): string => tag.toLowerCase().replace(AFTER_PRIMARY_SUBTAG, '');

/**
 * the language the ui is shown in: an explicit preference wins; "system" takes the first device
 * language (most preferred first) whose primary subtag has a catalog, and falls back to english
 */
export const resolveLanguage = (preference: LanguagePreference, deviceTags: unknown): Language => {
  if (preference !== 'system') {
    return preference;
  }
  const supported = parseDeviceLanguageTags(deviceTags).map(primarySubtag).find(isLanguage);
  return supported ?? FALLBACK_LANGUAGE;
};
