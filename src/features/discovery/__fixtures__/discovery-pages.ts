// pages of the discovery lists, synthetic summaries per list and page, for the discovery tests
import type { CatalogProvider, MediaSummary, Page } from '@core/catalog/catalog-provider';
import type { MediaKind } from '@core/domain/media';

import { FRIEREN, SOLO_LEVELING } from '../../search/__fixtures__/search-results';

/** the last page of every list of these fixtures */
export const LAST_PAGE = 5;

// the mal ids of the items: page n of a list holds the id of its base + n
const ID_BASE = { anime: 1000, manga: 2000, season: 3000 } as const;
type ListOf = keyof typeof ID_BASE;

const itemOf = (list: ListOf, page: number): MediaSummary => {
  const sample = list === 'manga' ? SOLO_LEVELING : FRIEREN;
  return {
    ...sample,
    key: { ...sample.key, externalId: ID_BASE[list] + page },
    title: `${list} page ${String(page)}`,
    titleEnglish: null,
  };
};

const pageOf = (list: ListOf, page: number): Page<MediaSummary> => ({
  items: page > LAST_PAGE ? [] : [itemOf(list, page)],
  page,
  lastPage: LAST_PAGE,
  hasNextPage: page < LAST_PAGE,
});

/** the test id of the row of page `page` of the top list of `kind`, or of the season */
export const rowOf = (list: ListOf, page: number): string => {
  const kind: MediaKind = list === 'manga' ? 'manga' : 'anime';
  return `discover-result-mal-${kind}-${String(ID_BASE[list] + page)}`;
};

/** every page of the top lists, of any kind and format, foreground and background */
export const answersEveryTopPage: CatalogProvider['getTop'] = (params) =>
  Promise.resolve(pageOf(params.kind, params.page));

/** every page of the current season, foreground and background */
export const answersEverySeasonPage: CatalogProvider['getCurrentSeason'] = (page) =>
  Promise.resolve(pageOf('season', page));
