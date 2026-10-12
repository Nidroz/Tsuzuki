// adult content rule BR-06 (SPEC.md) and its client-side filter, see ADR-0004.
// providers are never asked to filter: everything is fetched and hidden here when the setting is off
import type { MediaKind } from './media';

/** genre names that mark a title as adult content (BR-06), lowercase for comparison. */
export const ADULT_GENRE_NAMES: readonly string[] = ['hentai', 'erotica'];

const ADULT_RATED_KIND: MediaKind = 'anime';

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
  return input.genreNames.some((name) => ADULT_GENRE_NAMES.includes(name.trim().toLowerCase()));
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
