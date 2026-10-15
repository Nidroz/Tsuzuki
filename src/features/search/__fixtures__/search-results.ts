// search results for the search feature tests, from the recorded tenrai search responses
// (src/core/catalog/jikan/__fixtures__/tenrai/, 2026-10-14) as the jikan adapter maps them; the
// adult items are synthetic placeholders, the recordings hold no adult title
import type { MediaSummary, Page } from '@core/catalog/catalog-provider';
import type { FilteredPage } from '@core/hooks/filtered-page';

/** an anime whose english title differs from its title, with a cover, a year and a score */
export const FRIEREN: MediaSummary = {
  key: { namespace: 'mal', kind: 'anime', externalId: 52991 },
  title: 'Sousou no Frieren',
  titleEnglish: "Frieren: Beyond Journey's End",
  imageUrl: 'https://cdn.myanimelist.net/images/anime/1015/138006l.webp',
  format: 'tv',
  status: 'finished',
  totalUnits: 28,
  score: 9.24,
  year: 2023,
  genres: [
    { id: 2, name: 'Adventure' },
    { id: 8, name: 'Drama' },
    { id: 10, name: 'Fantasy' },
  ],
  isAdult: false,
};

/** an upcoming anime: no score yet */
export const FRIEREN_GOLDEN_LAND: MediaSummary = {
  key: { namespace: 'mal', kind: 'anime', externalId: 63816 },
  title: 'Sousou no Frieren: Ougonkyou-hen',
  titleEnglish: "Frieren: Beyond Journey's End - Golden Land Arc",
  imageUrl: 'https://cdn.myanimelist.net/images/anime/1619/156313l.webp',
  format: 'tv',
  status: 'upcoming',
  totalUnits: null,
  score: null,
  year: 2027,
  genres: [],
  isAdult: false,
};

/** a manga whose english title is its title */
export const SOLO_LEVELING: MediaSummary = {
  key: { namespace: 'mal', kind: 'manga', externalId: 121496 },
  title: 'Solo Leveling',
  titleEnglish: 'Solo Leveling',
  imageUrl: 'https://cdn.myanimelist.net/images/manga/3/222295l.webp',
  format: 'manhwa',
  status: 'finished',
  totalUnits: 201,
  score: 8.55,
  year: 2018,
  genres: [],
  isAdult: false,
};

/** a synthetic adult anime (BR-06) with the given id */
export const adultItem = (externalId: number): MediaSummary => ({
  key: { namespace: 'mal', kind: 'anime', externalId },
  title: `Adult placeholder ${String(externalId)}`,
  titleEnglish: null,
  imageUrl: null,
  format: 'ova',
  status: 'finished',
  totalUnits: 2,
  score: null,
  year: null,
  genres: [{ id: 12, name: 'Hentai' }],
  isAdult: true,
});

/** a single page of `items`, as a provider returns it */
export const pageOf = (...items: MediaSummary[]): Page<MediaSummary> => ({
  items,
  page: 1,
  lastPage: 1,
  hasNextPage: false,
});

/** a single filtered page of the visible `items`, `hiddenCount` adult items left out */
export const filteredPageOf = (
  hiddenCount: number,
  ...items: MediaSummary[]
): FilteredPage<MediaSummary> => ({ ...pageOf(...items), hiddenCount });
