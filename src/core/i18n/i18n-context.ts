import type { TFunction } from 'i18next';
import { createContext } from 'react';

import type { Language } from './languages';

export interface Translation {
  /** translates a key of the catalogs in the active language; an unknown key is a type error */
  t: TFunction;
  language: Language;
  /** formats with the active language */
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  /** formats with the active language */
  formatDate: (value: Date, options?: Intl.DateTimeFormatOptions) => string;
}

/** the translation of the active language, set by I18nProvider */
export const I18nContext = createContext<Translation | null>(null);

export const MISSING_I18N_PROVIDER_MESSAGE =
  'useTranslation is used outside I18nProvider: render the tree inside I18nProvider';
