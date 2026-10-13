// maps parsed jikan payloads to the catalog types: genres, the BR-06 flag, the cover image and
// pages. a payload that fails its schema is a CatalogResponseError without any detail: the issues
// could quote provider text, and catalog errors reach the error reporter
import type { z } from 'zod';

import { isAdultMedia } from '../../domain/content-filter';
import type { MediaKey, MediaKind } from '../../domain/media';
import { CatalogResponseError } from '../../errors/catalog-errors';
import type { Genre, MediaDetail, MediaSummary, Page } from '../catalog-provider';
import { toAllowedImageUrl } from '../image-url';
import {
  jikanAnimeDetailSchema,
  jikanAnimePageSchema,
  jikanGenresSchema,
  jikanMangaDetailSchema,
  jikanMangaPageSchema,
  type JikanEntry,
  type JikanGenreRef,
  type JikanPagePayload,
} from './jikan-schemas';

/** the only hosts a jikan cover url may point to. */
export const JIKAN_IMAGE_HOSTS = ['cdn.myanimelist.net'] as const;

// mal ratings read "Rx - Hentai"; compared trimmed and lowercased
const RX_RATING_PREFIX = 'rx';
const FIRST_PAGE = 1;

const PAGE_SCHEMAS = { anime: jikanAnimePageSchema, manga: jikanMangaPageSchema } as const;
const DETAIL_SCHEMAS = { anime: jikanAnimeDetailSchema, manga: jikanMangaDetailSchema } as const;

// any zod failure is a malformed response; the zod issues are dropped on purpose
const parseOrThrow = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new CatalogResponseError();
  }
  return result.data;
};

// the first occurrence of each id wins, in the given order
const uniqueBy = <T>(values: readonly T[], idOf: (value: T) => number): T[] => {
  const seen = new Set<number>();
  return values.filter((value) => {
    const id = idOf(value);
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
};

const toGenres = (refs: readonly JikanGenreRef[]): Genre[] =>
  uniqueBy(refs, (ref) => ref.mal_id).map((ref) => ({ id: ref.mal_id, name: ref.name }));

const isRxRating = (rating: string | null): boolean =>
  rating !== null && rating.trim().toLowerCase().startsWith(RX_RATING_PREFIX);

const imageUrlOf = (candidates: readonly (string | null)[]): string | null => {
  for (const candidate of candidates) {
    const url = toAllowedImageUrl(candidate, JIKAN_IMAGE_HOSTS);
    if (url !== null) {
      return url;
    }
  }
  return null;
};

/** the summary of a parsed item; `isAdult` reads every genre array and the anime rating (BR-06). */
export const toMediaSummary = (kind: MediaKind, entry: JikanEntry): MediaSummary =>
  ({
    key: { kind, malId: entry.malId },
    title: entry.title,
    titleEnglish: entry.titleEnglish,
    imageUrl: imageUrlOf(entry.imageCandidates),
    format: entry.format,
    status: entry.status,
    totalUnits: entry.totalUnits,
    score: entry.score,
    year: entry.year,
    genres: toGenres(entry.genreRefs),
    // explicit_genres holds Hentai and Erotica: every array counts, duplicates included
    isAdult: isAdultMedia({
      kind,
      genreNames: entry.genreRefs.map((ref) => ref.name),
      isRxRated: isRxRating(entry.rating),
    }),
  }) satisfies MediaSummary;

/** the detail of a parsed item: its summary, synopsis and native title. */
export const toMediaDetail = (kind: MediaKind, entry: JikanEntry): MediaDetail =>
  ({
    ...toMediaSummary(kind, entry),
    synopsis: entry.synopsis,
    titleNative: entry.titleNative,
  }) satisfies MediaDetail;

/**
 * a page of summaries. an id repeated within the page keeps its first item, which is adult when
 * any copy of that id is adult: a clean copy never hides an adult one (BR-06).
 */
export const toSummaryPage = (
  kind: MediaKind,
  requestedPage: number,
  payload: JikanPagePayload,
): Page<MediaSummary> => {
  const summaries = payload.data.map((entry) => toMediaSummary(kind, entry));
  const adultIds = new Set(
    summaries.filter((summary) => summary.isAdult).map((summary) => summary.key.malId),
  );
  return {
    items: uniqueBy(summaries, (summary) => summary.key.malId).map((summary) => ({
      ...summary,
      isAdult: adultIds.has(summary.key.malId),
    })),
    page: requestedPage,
    lastPage: Math.max(FIRST_PAGE, payload.pagination.last_visible_page),
    hasNextPage: payload.pagination.has_next_page,
  };
};

/** parses a search, top or season response of `kind` into a page of summaries. */
export const parseJikanPage = (
  kind: MediaKind,
  requestedPage: number,
  body: unknown,
): Page<MediaSummary> =>
  toSummaryPage(kind, requestedPage, parseOrThrow<JikanPagePayload>(PAGE_SCHEMAS[kind], body));

/** parses a detail response; an item other than the requested one is a malformed response. */
export const parseJikanDetail = (key: MediaKey, body: unknown): MediaDetail => {
  const { data } = parseOrThrow<{ data: JikanEntry }>(DETAIL_SCHEMAS[key.kind], body);
  if (data.malId !== key.malId) {
    throw new CatalogResponseError();
  }
  return toMediaDetail(key.kind, data);
};

/** parses a genre list response: every genre once, in the provider's order. */
export const parseJikanGenres = (body: unknown): readonly Genre[] =>
  toGenres(parseOrThrow(jikanGenresSchema, body).data);
