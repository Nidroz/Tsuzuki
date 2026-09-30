import type { ParseKeys } from 'i18next';
import { use } from 'react';

import { I18nContext, MISSING_I18N_PROVIDER_MESSAGE, type Translation } from './i18n-context';

/** a key of the catalogs, for props that take a key to translate */
export type TranslationKey = ParseKeys;

export type { Translation };

/**
 * translation and formatting in the active language, from the nearest I18nProvider; throws
 * outside of it. the value keeps its identity until the language changes
 */
export const useTranslation = (): Translation => {
  const translation = use(I18nContext);
  if (translation === null) {
    throw new Error(MISSING_I18N_PROVIDER_MESSAGE);
  }
  return translation;
};
