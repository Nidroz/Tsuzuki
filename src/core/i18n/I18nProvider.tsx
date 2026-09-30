import { useMemo, type ReactNode } from 'react';

import { createI18n, type MissingKeyHandler } from './create-i18n';
import { formatDate, formatNumber } from './format';
import { I18nContext, type Translation } from './i18n-context';
import type { Language } from './languages';
import { DEFAULT_NAMESPACE } from './resources';

export interface I18nProviderProps {
  /** the resolved language (resolveLanguage): switching it re-renders every consumer in it */
  language: Language;
  /**
   * called for each key missing from every catalog, e.g. to warn in development. pass a stable
   * function (module level or memoized): a new one creates a new i18next instance
   */
  onMissingKey?: MissingKeyHandler | undefined;
  children: ReactNode;
}

/**
 * gives the tree the translations of `language`.
 *
 * one i18next instance per language (and missing key handler), created during render and never
 * mutated afterwards: the render that receives a new language already translates with it, and
 * every consumer gets a new context value. calling changeLanguage on a shared instance instead
 * would either leave one frame in the old language (from an effect) or mutate shared state during
 * render (a discarded concurrent render would leave it switched). the catalogs are in memory, so
 * an instance is cheap and ready as soon as it is created.
 *
 * the module provides its own context instead of a react binding library because t must follow
 * the instance (getFixedT on each new one, never a t cached per language) and that binding is a
 * few lines
 */
export function I18nProvider({ language, onMissingKey, children }: I18nProviderProps) {
  const i18n = useMemo(() => createI18n({ language, onMissingKey }), [language, onMissingKey]);

  const translation = useMemo<Translation>(
    () => ({
      t: i18n.getFixedT(language, DEFAULT_NAMESPACE),
      language,
      formatNumber: (value, options) => formatNumber(value, language, options),
      formatDate: (value, options) => formatDate(value, language, options),
    }),
    [i18n, language],
  );

  return <I18nContext value={translation}>{children}</I18nContext>;
}
