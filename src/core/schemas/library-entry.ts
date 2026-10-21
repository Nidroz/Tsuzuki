// the single boundary of every stored library entry (docs/ARCHITECTURE.md §5): the guest store
// parses with these schemas on read and validates with them on save, and the account rows map to
// the same shape, so both sides accept exactly what the database accepts. issues hold no value:
// entries hold personal data (notes, titles)
import { z } from 'zod';

import type { MediaSummary } from '../catalog/catalog-provider';
import {
  MEDIA_IMAGE_URL_MAX_LENGTH,
  MEDIA_TITLE_MAX_LENGTH,
  POSTGRES_INTEGER_MAX,
  codePointLength,
  isStorableText,
  toStorableText,
  truncateToCodePoints,
} from '../domain/database-limits';
import {
  LIBRARY_STATUSES,
  isValidNotes,
  isValidScore,
  type LibraryEntry,
  type LibraryMediaSnapshot,
} from '../domain/library-entry';
import { PROGRESS_MAX } from '../domain/library-progress';
import { EXTERNAL_ID_MAX, MEDIA_FORMATS, MEDIA_ID_NAMESPACES, MEDIA_KINDS } from '../domain/media';
import { LibrarySnapshotError } from '../errors/library-errors';
import { calendarDateSchema, timestampSchema } from './timestamp';

// library_entries_media_image_url_check: like 'https://%'
const IMAGE_URL_PREFIX = 'https://';
// library_entries_media_title_check: char_length between 1 and 500
const MEDIA_TITLE_MIN_LENGTH = 1;
// library_entries_media_total_units_check and library_entries_external_id_check: > 0
const POSITIVE_INTEGER_MIN = 1;
// library_entries_progress_check: >= 0
const PROGRESS_MIN = 0;

const isMediaTitle = (title: string): boolean => {
  const length = codePointLength(title);
  return (
    length >= MEDIA_TITLE_MIN_LENGTH && length <= MEDIA_TITLE_MAX_LENGTH && isStorableText(title)
  );
};

const isMediaImageUrl = (url: string): boolean =>
  codePointLength(url) <= MEDIA_IMAGE_URL_MAX_LENGTH && isStorableText(url);

/**
 * the media snapshot of an entry (ADR-0009), within the library_entries checks; the title and
 * the image url are storable text (isStorableText).
 */
export const libraryMediaSnapshotSchema: z.ZodType<LibraryMediaSnapshot> = z.object({
  title: z.string().refine(isMediaTitle, { message: 'invalid media title' }),
  imageUrl: z
    .string()
    .startsWith(IMAGE_URL_PREFIX)
    .refine(isMediaImageUrl, { message: 'invalid media image url' })
    .nullable(),
  format: z.enum(MEDIA_FORMATS),
  totalUnits: z.number().int().min(POSITIVE_INTEGER_MIN).max(POSTGRES_INTEGER_MAX).nullable(),
  isAdult: z.boolean(),
});

const mediaKeySchema = z.object({
  namespace: z.enum(MEDIA_ID_NAMESPACES),
  kind: z.enum(MEDIA_KINDS),
  externalId: z.number().int().min(POSITIVE_INTEGER_MIN).max(EXTERNAL_ID_MAX),
});

/**
 * a library entry within the database limits and BR-07, its timestamps normalized to the
 * Date#toISOString form. unknown fields are stripped. progress is never bounded by the total, like
 * the database (a snapshot refresh may lower the total below the saved progress).
 */
export const libraryEntrySchema: z.ZodType<LibraryEntry> = z.object({
  key: mediaKeySchema,
  media: libraryMediaSnapshotSchema,
  status: z.enum(LIBRARY_STATUSES),
  progress: z.number().int().min(PROGRESS_MIN).max(PROGRESS_MAX),
  score: z.number().nullable().refine(isValidScore, { message: 'invalid score' }),
  notes: z.string().nullable().refine(isValidNotes, { message: 'invalid notes' }),
  isFavorite: z.boolean(),
  startedAt: calendarDateSchema.nullable(),
  finishedAt: calendarDateSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/**
 * the snapshot written with an entry (FR-10, ADR-0009), from a search or Discover row or the detail
 * (MediaDetail extends MediaSummary). the title, untrusted provider text the catalog adapter does
 * not bound, is first made storable (toStorableText: NUL removed, lone surrogates replaced with
 * U+FFFD), then cut to MEDIA_TITLE_MAX_LENGTH code points without splitting a surrogate pair;
 * `isAdult` is always copied, since the column default false would fail open (BR-06). anything
 * else outside the database limits (a title empty after cleaning included) throws a
 * LibrarySnapshotError (a RangeError) whose message holds no value.
 */
export const toLibraryMediaSnapshot = (summary: MediaSummary): LibraryMediaSnapshot => {
  const result = libraryMediaSnapshotSchema.safeParse({
    title: truncateToCodePoints(toStorableText(summary.title), MEDIA_TITLE_MAX_LENGTH),
    imageUrl: summary.imageUrl,
    format: summary.format,
    totalUnits: summary.totalUnits,
    isAdult: summary.isAdult,
  });
  if (!result.success) {
    throw new LibrarySnapshotError();
  }
  return result.data;
};
