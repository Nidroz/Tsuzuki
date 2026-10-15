// provider genres for the filters sheet tests: mal ids and names as the jikan adapter maps them,
// two adult genres among them (BR-06)
import type { CatalogProvider, Genre } from '@core/catalog/catalog-provider';

/** the anime genres: nine general ones, then the two adult ones */
export const ANIME_GENRES: readonly Genre[] = [
  { id: 1, name: 'Action' },
  { id: 2, name: 'Adventure' },
  { id: 4, name: 'Comedy' },
  { id: 8, name: 'Drama' },
  { id: 10, name: 'Fantasy' },
  { id: 14, name: 'Horror' },
  { id: 7, name: 'Mystery' },
  { id: 22, name: 'Romance' },
  { id: 24, name: 'Sci-Fi' },
  { id: 12, name: 'Hentai' },
  { id: 49, name: 'Erotica' },
];

/** the adult genres of ANIME_GENRES */
export const ADULT_GENRE_IDS: readonly number[] = [12, 49];

/** the manga genres: a short list, so a kind change shows */
export const MANGA_GENRES: readonly Genre[] = [
  { id: 1, name: 'Action' },
  { id: 62, name: 'Isekai' },
];

/** a provider getGenres answering each kind with its genres */
export const genresByKind: CatalogProvider['getGenres'] = (kind) =>
  Promise.resolve(kind === 'anime' ? ANIME_GENRES : MANGA_GENRES);
