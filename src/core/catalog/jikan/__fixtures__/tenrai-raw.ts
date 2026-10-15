// the items of the recorded tenrai responses (tenrai/, see its README) as raw json, for the facts
// the adapter relies on. the json is checked against these types at compile time: a recorded null
// status, a missing rating key or genre array would fail the typecheck as well as the tests
import type { MediaKind } from '../../../domain/media';
import animeDetail52991 from './tenrai/anime-detail-52991.json';
import animeGenres from './tenrai/anime-genres.json';
import animeSearch from './tenrai/anime-search.json';
import mangaDetail121496 from './tenrai/manga-detail-121496.json';
import mangaDetail2 from './tenrai/manga-detail-2.json';
import mangaGenres from './tenrai/manga-genres.json';
import mangaSearch from './tenrai/manga-search.json';
import seasonNow from './tenrai/season-now.json';
import topAnime from './tenrai/top-anime.json';
import topManga from './tenrai/top-manga.json';
import yearProbeBounded from './tenrai/year-probe-bounded.json';
import yearProbeOpen from './tenrai/year-probe-open.json';

/** a `titles[]` entry, as recorded. */
export interface RawTitle {
  readonly type: string;
  readonly title: string;
}

/** a genre, explicit genre, theme or demographic reference, or a genre list entry. */
export interface RawGenreRef {
  readonly mal_id: number;
  readonly name: string;
}

interface RawImageVariant {
  readonly image_url: string;
  readonly large_image_url: string;
}

/** the recorded keys of an anime or manga item that the tests read. */
export interface RawItem {
  readonly mal_id: number;
  readonly type: string;
  readonly status: string;
  readonly titles: readonly RawTitle[];
  readonly title_english: string | null;
  readonly score: number | null;
  readonly images: { readonly jpg: RawImageVariant; readonly webp: RawImageVariant };
  readonly genres: readonly RawGenreRef[];
  readonly explicit_genres: readonly RawGenreRef[];
  readonly themes: readonly RawGenreRef[];
  readonly demographics: readonly RawGenreRef[];
}

export interface RawAnime extends RawItem {
  readonly episodes: number | null;
  readonly rating: string | null;
  readonly season: string;
  readonly airing: boolean;
  readonly aired: { readonly prop: { readonly from: { readonly year: number } } };
}

export interface RawManga extends RawItem {
  readonly chapters: number | null;
}

/** a recorded item and the file it comes from. */
export interface RawEntry<T extends RawItem> {
  readonly file: string;
  readonly item: T;
}

const entriesOf = <T extends RawItem>(file: string, items: readonly T[]): RawEntry<T>[] =>
  items.map((item) => ({ file, item }));

/** every recorded anime item: search, top, season, year probe and detail. */
export const RAW_ANIME: readonly RawEntry<RawAnime>[] = [
  ...entriesOf<RawAnime>('anime-search.json', animeSearch.data),
  ...entriesOf<RawAnime>('top-anime.json', topAnime.data),
  ...entriesOf<RawAnime>('season-now.json', seasonNow.data),
  ...entriesOf<RawAnime>('year-probe-open.json', yearProbeOpen.data),
  ...entriesOf<RawAnime>('anime-detail-52991.json', [animeDetail52991.data]),
];

/** every recorded manga item: search, top and details. */
export const RAW_MANGA: readonly RawEntry<RawManga>[] = [
  ...entriesOf<RawManga>('manga-search.json', mangaSearch.data),
  ...entriesOf<RawManga>('top-manga.json', topManga.data),
  ...entriesOf<RawManga>('manga-detail-121496.json', [mangaDetail121496.data]),
  ...entriesOf<RawManga>('manga-detail-2.json', [mangaDetail2.data]),
];

/** every recorded item, anime first. */
export const RAW_ITEMS: readonly RawEntry<RawItem>[] = [...RAW_ANIME, ...RAW_MANGA];

/** the recorded genre lists, by kind. */
export const RAW_GENRES: Readonly<Record<MediaKind, readonly RawGenreRef[]>> = {
  anime: animeGenres.data,
  manga: mangaGenres.data,
};

/**
 * the request of the bounded year probe, as recorded (tenrai/README.md): `start_date` and
 * `end_date` of the year. the adapter never sends it: `end_date` bounds the end of airing.
 */
export const YEAR_PROBE_BOUNDED_REQUEST =
  '/anime?q=one%20piece&start_date=1999-01-01&end_date=1999-12-31&limit=5';

/** the items of the bounded year probe: none, one piece still airs. */
export const RAW_YEAR_PROBE_BOUNDED: readonly unknown[] = yearProbeBounded.data;

/** the raw season list, in recorded order. */
export const RAW_SEASON_NOW: readonly RawAnime[] = seasonNow.data;

/** the mal ids of `file`, in recorded order. */
export const rawIdsOf = (file: string): number[] =>
  RAW_ITEMS.filter((entry) => entry.file === file).map(({ item }) => item.mal_id);

const entryOf = <T extends RawItem>(
  entries: readonly RawEntry<T>[],
  kind: MediaKind,
  malId: number,
): T => {
  const entry = entries.find(({ item }) => item.mal_id === malId);
  if (entry === undefined) {
    throw new Error(`no recorded ${kind} ${String(malId)}`);
  }
  return entry.item;
};

/** the first recorded anime of `malId`; every recording of one id holds the same item. */
export const rawAnimeOf = (malId: number): RawAnime => entryOf(RAW_ANIME, 'anime', malId);

/** the first recorded manga of `malId`. */
export const rawMangaOf = (malId: number): RawManga => entryOf(RAW_MANGA, 'manga', malId);

/** the recorded item of `kind` and `malId`: mal ids are unique per kind. */
export const rawItemOf = (kind: MediaKind, malId: number): RawItem =>
  kind === 'anime' ? rawAnimeOf(malId) : rawMangaOf(malId);

/** the recorded episode or chapter count of an item. */
export const rawUnitsOf = (kind: MediaKind, malId: number): number | null =>
  kind === 'anime' ? rawAnimeOf(malId).episodes : rawMangaOf(malId).chapters;

/** the first `titles[]` entry of `type`, else null. */
export const rawTitleOf = (item: RawItem, type: string): string | null =>
  item.titles.find((entry) => entry.type === type)?.title ?? null;
