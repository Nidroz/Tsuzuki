// the recorded tenrai responses of tenrai/ (see its README), each with the msw path that serves it
// and the provider call that requests it, and the helpers that run them through a tenrai provider.
// the raw items are in tenrai-raw.ts
import type { HttpHandler } from 'msw';

import type { MediaKind } from '../../../domain/media';
import type {
  CatalogProvider,
  Genre,
  MediaDetail,
  MediaSummary,
  Page,
} from '../../catalog-provider';
import animeDetail52991 from './tenrai/anime-detail-52991.json';
import animeGenres from './tenrai/anime-genres.json';
import animeSearch from './tenrai/anime-search.json';
import mangaDetail121496 from './tenrai/manga-detail-121496.json';
import mangaDetail2 from './tenrai/manga-detail-2.json';
import mangaGenres from './tenrai/manga-genres.json';
import mangaSearch from './tenrai/manga-search.json';
import searchEmpty from './tenrai/search-empty.json';
import seasonNow from './tenrai/season-now.json';
import topAnime from './tenrai/top-anime.json';
import topManga from './tenrai/top-manga.json';
import yearProbeOpen from './tenrai/year-probe-open.json';
import { createJikanCatalogProvider } from '../jikan-catalog-provider';
import { TENRAI_INSTANCE } from '../jikan-instances';
import { jikanHandler, jsonAnswer } from './jikan-handlers';

/** a recorded response, where msw serves it, and the provider call that requests it. */
export interface Recording<T> {
  readonly file: string;
  // the msw path, without the query
  readonly path: string;
  readonly body: Record<string, unknown>;
  readonly call: (provider: CatalogProvider) => Promise<T>;
}

/** the year of the year probe: one piece started airing in 1999 and still airs. */
export const YEAR_PROBE_YEAR = 1999;

/** the paginated recordings: search, top, season and the year probe. */
export const PAGE_RECORDINGS = {
  animeSearch: {
    file: 'anime-search.json',
    path: '/anime',
    body: animeSearch,
    call: (provider) => provider.search({ kind: 'anime', query: 'frieren', page: 1 }),
  },
  mangaSearch: {
    file: 'manga-search.json',
    path: '/manga',
    body: mangaSearch,
    call: (provider) =>
      provider.search({ kind: 'manga', query: 'solo leveling', formats: ['manhwa'], page: 1 }),
  },
  searchEmpty: {
    file: 'search-empty.json',
    path: '/anime',
    body: searchEmpty,
    call: (provider) => provider.search({ kind: 'anime', query: 'zzqxjvwkpt', page: 1 }),
  },
  topAnime: {
    file: 'top-anime.json',
    path: '/top/anime',
    body: topAnime,
    call: (provider) => provider.getTop({ kind: 'anime', page: 1 }),
  },
  topManga: {
    file: 'top-manga.json',
    path: '/top/manga',
    body: topManga,
    call: (provider) => provider.getTop({ kind: 'manga', page: 1 }),
  },
  seasonNow: {
    file: 'season-now.json',
    path: '/seasons/now',
    body: seasonNow,
    call: (provider) => provider.getCurrentSeason(1),
  },
  // the adapter's own year filter, recorded with start_date alone. the bounded probe, recorded with
  // end_date too, is a raw fact only (tenrai-raw.ts): the adapter never sends end_date
  yearProbeOpen: {
    file: 'year-probe-open.json',
    path: '/anime',
    body: yearProbeOpen,
    call: (provider) =>
      provider.search({ kind: 'anime', query: 'one piece', yearFrom: YEAR_PROBE_YEAR, page: 1 }),
  },
} as const satisfies Record<string, Recording<Page<MediaSummary>>>;

/** the detail recordings. */
export const DETAIL_RECORDINGS = {
  anime52991: {
    file: 'anime-detail-52991.json',
    path: '/anime/52991',
    body: animeDetail52991,
    call: (provider) => provider.getDetail({ namespace: 'mal', kind: 'anime', externalId: 52991 }),
  },
  manga121496: {
    file: 'manga-detail-121496.json',
    path: '/manga/121496',
    body: mangaDetail121496,
    call: (provider) => provider.getDetail({ namespace: 'mal', kind: 'manga', externalId: 121496 }),
  },
  manga2: {
    file: 'manga-detail-2.json',
    path: '/manga/2',
    body: mangaDetail2,
    call: (provider) => provider.getDetail({ namespace: 'mal', kind: 'manga', externalId: 2 }),
  },
} as const satisfies Record<string, Recording<MediaDetail>>;

/** the genre list recordings. */
export const GENRE_RECORDINGS = {
  anime: {
    file: 'anime-genres.json',
    path: '/genres/anime',
    body: animeGenres,
    call: (provider) => provider.getGenres('anime'),
  },
  manga: {
    file: 'manga-genres.json',
    path: '/genres/manga',
    body: mangaGenres,
    call: (provider) => provider.getGenres('manga'),
  },
} as const satisfies Record<string, Recording<readonly Genre[]>>;

/** the msw server of the test setup, passed in: fixtures never import the test infrastructure. */
export interface HandlerHost {
  readonly use: (...handlers: HttpHandler[]) => void;
}

/** serves `recording` on tenrai, then returns the result of its call and the urls it requested. */
export const fetchRecorded = async <T>(
  host: HandlerHost,
  recording: Recording<T>,
): Promise<{ readonly result: T; readonly urls: readonly string[] }> => {
  const { handler, requests } = jikanHandler(recording.path, jsonAnswer(recording.body));
  host.use(handler);
  const result = await recording.call(createJikanCatalogProvider(TENRAI_INSTANCE));
  return { result, urls: requests.map(({ url }) => url) };
};

/** the mapped summaries of every page and detail recording, in recording order, one at a time. */
export const fetchAllSummaries = async (host: HandlerHost): Promise<readonly MediaSummary[]> => {
  const summaries: MediaSummary[] = [];
  for (const recording of Object.values(PAGE_RECORDINGS)) {
    summaries.push(...(await fetchRecorded(host, recording)).result.items);
  }
  for (const recording of Object.values(DETAIL_RECORDINGS)) {
    summaries.push((await fetchRecorded(host, recording)).result);
  }
  return summaries;
};

/** the summary of `kind` and `malId` among `summaries`. */
export const summaryOf = (
  summaries: readonly MediaSummary[],
  kind: MediaKind,
  malId: number,
): MediaSummary | undefined =>
  summaries.find(({ key }) => key.kind === kind && key.externalId === malId);
