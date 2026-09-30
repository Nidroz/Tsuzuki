import i18next, { type i18n as I18nInstance } from 'i18next';

import { FALLBACK_LANGUAGE, SUPPORTED_LANGUAGES, type Language } from './languages';
import { DEFAULT_NAMESPACE, resources as bundledResources, type Resources } from './resources';

/** called with the active language and the key, when a key is in no catalog of the chain */
export type MissingKeyHandler = (language: string, key: string) => void;

export interface CreateI18nOptions {
  language: Language;
  onMissingKey?: MissingKeyHandler | undefined;
  /** the bundled catalogs by default; tests pass fixture catalogs */
  resources?: Resources;
}

/**
 * a new, initialized i18next instance showing `language` (no global singleton). init is
 * synchronous: the catalogs are in memory, so t works as soon as this returns
 */
export const createI18n = ({
  language,
  onMissingKey,
  resources = bundledResources,
}: CreateI18nOptions): I18nInstance => {
  const instance = i18next.createInstance();
  // with initAsync false and in-memory resources, init completes before it returns; the returned
  // promise never rejects
  void instance.init({
    initAsync: false,
    resources,
    lng: language,
    fallbackLng: FALLBACK_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES,
    ns: [DEFAULT_NAMESPACE],
    defaultNS: DEFAULT_NAMESPACE,
    // react escapes rendered strings
    interpolation: { escapeValue: false },
    returnNull: false,
    // saveMissing is what makes i18next call missingKeyHandler; "current" reports the active
    // language (the default, "fallback", would report english). a key found in the fallback
    // catalog only is not missing here: fr.json must mirror en.json (README.md)
    saveMissing: onMissingKey !== undefined,
    saveMissingTo: 'current',
    missingKeyHandler:
      onMissingKey === undefined
        ? false
        : (languages, _namespace, key) => {
            for (const missingIn of languages) {
              onMissingKey(missingIn, key);
            }
          },
  });
  return instance;
};

/**
 * i18next picks plural forms with Intl.PluralRules and silently falls back to a naive one/other
 * rule without it (french needs one/many/other), which some javascript engines lack
 */
export const hasIntlPluralRules = (): boolean =>
  typeof Intl !== 'undefined' && typeof Intl.PluralRules === 'function';
