// public api of the i18n module: routes, features and platform adapters import from here only,
// never from i18next

export { hasIntlPluralRules } from './create-i18n';
export type { MissingKeyHandler } from './create-i18n';
export { formatDate, formatNumber } from './format';
export { I18nProvider } from './I18nProvider';
export type { I18nProviderProps } from './I18nProvider';
export {
  DEFAULT_LANGUAGE_PREFERENCE,
  FALLBACK_LANGUAGE,
  isLanguage,
  LANGUAGE_PREFERENCES,
  SUPPORTED_LANGUAGES,
} from './languages';
export type { Language, LanguagePreference } from './languages';
export type { LocaleAdapter } from './locale-adapter';
export { resolveLanguage } from './resolve-language';
export { useTranslation } from './use-translation';
export type { Translation, TranslationKey } from './use-translation';
