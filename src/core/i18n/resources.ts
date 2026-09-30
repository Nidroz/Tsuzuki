import en from './en.json';
import fr from './fr.json';
import type { Language } from './languages';

/** the single i18next namespace: keys are nested by feature inside it */
export const DEFAULT_NAMESPACE = 'translation';

/** a catalog: nested objects whose leaves are the translated strings */
export interface Catalog {
  readonly [key: string]: string | Catalog;
}

export type Resources = Readonly<
  Record<Language, Readonly<Record<typeof DEFAULT_NAMESPACE, Catalog>>>
>;

/** the bundled catalogs, loaded in memory: no catalog is fetched at run time */
export const resources = {
  en: { translation: en },
  fr: { translation: fr },
} as const satisfies Resources;
