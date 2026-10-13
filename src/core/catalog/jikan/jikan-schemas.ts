// zod schemas of the jikan v4 payloads read by the adapter, from its published openapi spec.
// plain objects: unknown keys are stripped. the identity, the default title, the status and the
// BR-06 inputs (the four genre arrays and the anime rating) fail the whole response when wrong;
// display fields fall back to null (jikan-fields.ts). each item becomes a `JikanEntry`
import { z } from 'zod';

import { MAL_ID_MAX, type MediaFormat, type MediaStatus } from '../../domain/media';
import {
  ANIME_STATUS_BY_JIKAN,
  JIKAN_ANIME_STATUSES,
  JIKAN_MANGA_STATUSES,
  JIKAN_TITLE_TYPES,
  MANGA_STATUS_BY_JIKAN,
  animeFormatOf,
  mangaFormatOf,
  scoreOf,
  textOrNull,
  titleOf,
  unitCountOf,
  yearOf,
  type JikanTitleEntry,
} from './jikan-fields';

/** a genre, explicit genre, theme or demographic of an item, and a genre of the genre lists. */
export interface JikanGenreRef {
  readonly mal_id: number;
  readonly name: string;
}

/** an anime or manga item, parsed and normalized; the adapter maps it to the catalog types. */
export interface JikanEntry {
  readonly malId: number;
  readonly title: string;
  readonly titleEnglish: string | null;
  readonly titleNative: string | null;
  readonly synopsis: string | null;
  readonly format: MediaFormat;
  readonly status: MediaStatus;
  readonly totalUnits: number | null;
  readonly score: number | null;
  readonly year: number | null;
  // genres, explicit_genres, themes and demographics, in that order, duplicates kept
  readonly genreRefs: readonly JikanGenreRef[];
  // the anime audience rating; null for a manga or an unrated anime
  readonly rating: string | null;
  // image urls in order of preference, not yet checked
  readonly imageCandidates: readonly (string | null)[];
}

// a display field: a wrong or missing value becomes null
const lenientText = z.string().nullable().catch(null);
const lenientNumber = z.number().nullable().catch(null);

const titleEntrySchema = z.object({ type: z.string(), title: z.string() });

// a malformed or missing titles array reads as empty; a malformed entry is dropped
const titleEntriesSchema = z
  .array(z.unknown())
  .catch([])
  .transform((values): JikanTitleEntry[] =>
    values.flatMap((value) => {
      const entry = titleEntrySchema.safeParse(value);
      return entry.success ? [entry.data] : [];
    }),
  );

const imageVariantSchema = z
  .object({ image_url: lenientText, large_image_url: lenientText })
  .catch({ image_url: null, large_image_url: null });

const imagesSchema = z
  .object({ jpg: imageVariantSchema, webp: imageVariantSchema })
  .transform(({ jpg, webp }) => [webp.large_image_url, jpg.large_image_url, jpg.image_url])
  .catch([]);

// the start year of an `aired` or `published` date range
const startYearSchema = z
  .object({ prop: z.object({ from: z.object({ year: lenientNumber }) }) })
  .transform((range) => range.prop.from.year)
  .catch(null);

// the BR-06 rule reads the names: a malformed reference fails the response, never hides a genre
const genreRefSchema = z.object({ mal_id: z.int().positive(), name: z.string() });
const genreRefsSchema = z.array(genreRefSchema);

const sharedShape = {
  mal_id: z.int().min(1).max(MAL_ID_MAX),
  titles: titleEntriesSchema,
  title: lenientText,
  title_english: lenientText,
  title_japanese: lenientText,
  type: lenientText,
  score: lenientNumber,
  synopsis: lenientText,
  images: imagesSchema,
  genres: genreRefsSchema,
  explicit_genres: genreRefsSchema,
  themes: genreRefsSchema,
  demographics: genreRefsSchema,
};

type SharedItem = z.output<z.ZodObject<typeof sharedShape>>;

type KindFields = Pick<JikanEntry, 'format' | 'status' | 'totalUnits' | 'year' | 'rating'>;

const MISSING_TITLE = 'missing default title';

// fails the item when it has no non-blank default title
const toEntry = (item: SharedItem, fields: KindFields, ctx: z.RefinementCtx): JikanEntry => {
  const title = titleOf(item.titles, JIKAN_TITLE_TYPES.default, item.title);
  if (title === null) {
    ctx.addIssue({ code: 'custom', message: MISSING_TITLE });
    return z.NEVER;
  }
  return {
    malId: item.mal_id,
    title,
    titleEnglish: titleOf(item.titles, JIKAN_TITLE_TYPES.english, item.title_english),
    titleNative: titleOf(item.titles, JIKAN_TITLE_TYPES.native, item.title_japanese),
    synopsis: textOrNull(item.synopsis),
    score: scoreOf(item.score),
    genreRefs: [...item.genres, ...item.explicit_genres, ...item.themes, ...item.demographics],
    imageCandidates: item.images,
    ...fields,
  };
};

const animeItemSchema = z
  .object({
    ...sharedShape,
    status: z.enum(JIKAN_ANIME_STATUSES),
    episodes: lenientNumber,
    year: lenientNumber,
    aired: startYearSchema,
    // the key must be there: an absent rating would hide an Rx title
    rating: z.string().nullable(),
  })
  .transform((item, ctx) =>
    toEntry(
      item,
      {
        format: animeFormatOf(item.type),
        status: ANIME_STATUS_BY_JIKAN[item.status],
        totalUnits: unitCountOf(item.episodes),
        year: yearOf(item.year, item.aired),
        rating: item.rating,
      },
      ctx,
    ),
  );

const mangaItemSchema = z
  .object({
    ...sharedShape,
    status: z.enum(JIKAN_MANGA_STATUSES),
    chapters: lenientNumber,
    published: startYearSchema,
  })
  .transform((item, ctx) =>
    toEntry(
      item,
      {
        format: mangaFormatOf(item.type),
        status: MANGA_STATUS_BY_JIKAN[item.status],
        totalUnits: unitCountOf(item.chapters),
        year: yearOf(item.published),
        rating: null,
      },
      ctx,
    ),
  );

const paginationSchema = z.object({ last_visible_page: z.int(), has_next_page: z.boolean() });

/** search, top and season responses. */
export const jikanAnimePageSchema = z.object({
  data: z.array(animeItemSchema),
  pagination: paginationSchema,
});
export const jikanMangaPageSchema = z.object({
  data: z.array(mangaItemSchema),
  pagination: paginationSchema,
});

/** `/anime/{id}` and `/manga/{id}` responses. */
export const jikanAnimeDetailSchema = z.object({ data: animeItemSchema });
export const jikanMangaDetailSchema = z.object({ data: mangaItemSchema });

/** `/genres/anime` and `/genres/manga` responses. */
export const jikanGenresSchema = z.object({ data: z.array(genreRefSchema) });

export type JikanPagePayload = z.output<typeof jikanAnimePageSchema>;
