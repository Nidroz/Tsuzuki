// builders of jikan v4 payloads in the shape of its published openapi spec (anime and manga
// resources, pagination_plus, genres), for unit tests. titles are made up; recorded responses
// replace these shapes as the reference once they are captured

type JsonObject = Record<string, unknown>;

const CDN = 'https://cdn.myanimelist.net';
const SITE = 'https://myanimelist.net';
const PAGE_LIMIT = 25;

/** a genre, explicit genre, theme or demographic reference of an item. */
export const genreRef = (malId: number, name: string, kind: 'anime' | 'manga' = 'anime') => ({
  mal_id: malId,
  type: kind,
  name,
  url: `${SITE}/${kind}/genre/${String(malId)}/${name.replaceAll(' ', '_')}`,
});

const imagesOf = (kind: 'anime' | 'manga', malId: number): JsonObject => {
  const base = `${CDN}/images/${kind}/${String(malId % 10)}/${String(malId)}`;
  return {
    jpg: {
      image_url: `${base}.jpg`,
      small_image_url: `${base}t.jpg`,
      large_image_url: `${base}l.jpg`,
    },
    webp: {
      image_url: `${base}.webp`,
      small_image_url: `${base}t.webp`,
      large_image_url: `${base}l.webp`,
    },
  };
};

const dateRange = (fromYear: number | null, toYear: number | null): JsonObject => ({
  from: fromYear === null ? null : `${String(fromYear)}-04-03T00:00:00+00:00`,
  to: toYear === null ? null : `${String(toYear)}-09-25T00:00:00+00:00`,
  prop: {
    from: {
      day: fromYear === null ? null : 3,
      month: fromYear === null ? null : 4,
      year: fromYear,
    },
    to: { day: toYear === null ? null : 25, month: toYear === null ? null : 9, year: toYear },
    string: null,
  },
});

/** an anime resource: a finished tv series of 12 episodes from 2020, rated PG-13, all clean. */
export const buildJikanAnime = (overrides: JsonObject = {}): JsonObject => {
  const malId = typeof overrides.mal_id === 'number' ? overrides.mal_id : 101;
  return {
    mal_id: malId,
    url: `${SITE}/anime/${String(malId)}/Sample_Anime`,
    images: imagesOf('anime', malId),
    trailer: { youtube_id: null, url: null, embed_url: null },
    approved: true,
    titles: [
      { type: 'Default', title: 'Sample Anime' },
      { type: 'Synonym', title: 'Sample Show' },
      { type: 'Japanese', title: 'サンプルアニメ' },
      { type: 'English', title: 'Sample Anime in English' },
    ],
    title: 'Sample Anime',
    title_english: 'Sample Anime in English',
    title_japanese: 'サンプルアニメ',
    title_synonyms: ['Sample Show'],
    type: 'TV',
    source: 'Original',
    episodes: 12,
    status: 'Finished Airing',
    airing: false,
    aired: dateRange(2020, 2020),
    duration: '24 min per ep',
    rating: 'PG-13 - Teens 13 or older',
    score: 7.5,
    scored_by: 1200,
    rank: 900,
    popularity: 1500,
    members: 34000,
    favorites: 120,
    synopsis: 'synopsis placeholder',
    background: null,
    season: 'spring',
    year: 2020,
    broadcast: {
      day: 'Fridays',
      time: '23:00',
      timezone: 'Asia/Tokyo',
      string: 'Fridays at 23:00 (JST)',
    },
    producers: [
      { mal_id: 501, type: 'anime', name: 'Sample Producer', url: `${SITE}/anime/producer/501` },
    ],
    licensors: [],
    studios: [
      { mal_id: 502, type: 'anime', name: 'Sample Studio', url: `${SITE}/anime/producer/502` },
    ],
    genres: [genreRef(1, 'Action'), genreRef(4, 'Comedy')],
    explicit_genres: [],
    themes: [genreRef(23, 'School')],
    demographics: [genreRef(27, 'Shounen')],
    ...overrides,
  };
};

/** a manga resource: a finished manga of 40 chapters from 2015, all clean. manga have no rating. */
export const buildJikanManga = (overrides: JsonObject = {}): JsonObject => {
  const malId = typeof overrides.mal_id === 'number' ? overrides.mal_id : 201;
  return {
    mal_id: malId,
    url: `${SITE}/manga/${String(malId)}/Sample_Manga`,
    images: imagesOf('manga', malId),
    approved: true,
    titles: [
      { type: 'Default', title: 'Sample Manga' },
      { type: 'Japanese', title: 'サンプル漫画' },
      { type: 'English', title: 'Sample Manga in English' },
    ],
    title: 'Sample Manga',
    title_english: 'Sample Manga in English',
    title_japanese: 'サンプル漫画',
    title_synonyms: [],
    type: 'Manga',
    chapters: 40,
    volumes: 5,
    status: 'Finished',
    publishing: false,
    published: dateRange(2015, 2018),
    score: 8.1,
    scored_by: 900,
    rank: 400,
    popularity: 2500,
    members: 21000,
    favorites: 300,
    synopsis: 'synopsis placeholder',
    background: null,
    authors: [{ mal_id: 601, type: 'people', name: 'Sample, Author', url: `${SITE}/people/601` }],
    serializations: [
      { mal_id: 602, type: 'manga', name: 'Sample Magazine', url: `${SITE}/manga/magazine/602` },
    ],
    genres: [genreRef(2, 'Adventure', 'manga')],
    explicit_genres: [],
    themes: [],
    demographics: [genreRef(42, 'Seinen', 'manga')],
    ...overrides,
  };
};

/** an object without the given keys, to model a missing field. */
export const withoutKeys = (object: JsonObject, ...keys: readonly string[]): JsonObject =>
  Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));

/** a search, top or season response (anime_search / manga_search with pagination_plus). */
export const buildJikanPage = (
  items: readonly unknown[],
  pagination: JsonObject = {},
): JsonObject => ({
  pagination: {
    last_visible_page: 1,
    has_next_page: false,
    current_page: 1,
    items: { count: items.length, total: items.length, per_page: PAGE_LIMIT },
    ...pagination,
  },
  data: items,
});

/** a `/anime/{id}` or `/manga/{id}` response. */
export const buildJikanDetail = (item: unknown): JsonObject => ({ data: item });

/** a `/genres/anime` or `/genres/manga` response. */
export const buildJikanGenres = (
  genres: readonly (readonly [malId: number, name: string])[],
  kind: 'anime' | 'manga' = 'anime',
): JsonObject => ({
  data: genres.map(([malId, name]) => ({
    mal_id: malId,
    name,
    url: `${SITE}/${kind}/genre/${String(malId)}/${name.replaceAll(' ', '_')}`,
    count: 100,
  })),
});
