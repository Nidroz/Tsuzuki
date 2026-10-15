// adult content rule BR-06 (SPEC.md) and its client-side filter, see ADR-0004.
// providers are never asked to filter: everything is fetched and hidden here when the setting is off
import type { MediaKind } from './media';

/** genre names that mark a title as adult content (BR-06), lowercase for comparison. */
export const ADULT_GENRE_NAMES = ['hentai', 'erotica'] as const;

// lookup of any trimmed, lowercased genre name
const ADULT_GENRE_NAME_SET: ReadonlySet<string> = new Set<string>(ADULT_GENRE_NAMES);

const ADULT_RATED_KIND: MediaKind = 'anime';

/** the adult content setting of a new user (BR-06): adult titles are hidden. */
export const DEFAULT_SHOW_ADULT = false;

/**
 * whether a genre name marks adult content (BR-06): Hentai or Erotica, case-insensitive, trimmed.
 * the comparison isAdultMedia uses; the filters sheet hides the chips of such genres.
 */
export const isAdultGenreName = (name: string): boolean =>
  ADULT_GENRE_NAME_SET.has(name.trim().toLowerCase());

/**
 * whether a title is adult content (BR-06): a genre named Hentai or Erotica
 * (case-insensitive, trimmed), or an anime rated Rx. an Rx rating on a manga is ignored.
 */
export const isAdultMedia = (input: {
  readonly kind: MediaKind;
  readonly genreNames: readonly string[];
  readonly isRxRated: boolean;
}): boolean => {
  if (input.kind === ADULT_RATED_KIND && input.isRxRated) {
    return true;
  }
  return input.genreNames.some(isAdultGenreName);
};

/**
 * hides adult items when `showAdult` is off (BR-06, ADR-0004), keeping the order.
 * `hiddenCount` lets a screen explain why a page has fewer items than the provider page size.
 */
export const applyContentFilter = <T extends { readonly isAdult: boolean }>(
  items: readonly T[],
  showAdult: boolean,
): { readonly items: readonly T[]; readonly hiddenCount: number } => {
  if (showAdult) {
    return { items, hiddenCount: 0 };
  }
  const visible = items.filter((item) => !item.isAdult);
  return { items: visible, hiddenCount: items.length - visible.length };
};
