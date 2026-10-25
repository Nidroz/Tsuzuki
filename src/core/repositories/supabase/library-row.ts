// the rows of library_entries as the account store reads and writes them (docs/ARCHITECTURE.md §4
// "Account store", §5). column names are this implementation's concern; the value rules are those
// of libraryEntrySchema, the only value check, so the account side accepts exactly what the guest
// side does. rows hold personal data (notes, titles): nothing here logs or reports them
import type { LibraryEntry } from '../../domain/library-entry';
import { libraryEntrySchema } from '../../schemas/library-entry';
import type { TablesInsert } from './database.types';

/** the columns every read selects, never `*`: no `id`, no `user_id`. */
export const LIBRARY_ROW_COLUMNS =
  'id_namespace, media_kind, external_id, media_title, media_image_url, media_format, media_total_units, media_is_adult, status, progress, score, notes, is_favorite, started_at, finished_at, created_at, updated_at';

const LIBRARY_ROW_COLUMN_NAMES: readonly string[] = LIBRARY_ROW_COLUMNS.split(',').map((column) =>
  column.trim(),
);

/**
 * the payload of a write: every column `authenticated` may write (docs/ARCHITECTURE.md §5
 * "Grants"), all required, so a column added to the table without a value here fails to compile.
 * never `id`, `user_id` (its auth.uid() default), `created_at` or `updated_at` (server-set).
 */
export type LibraryRowPayload = Required<
  Omit<TablesInsert<'library_entries'>, 'id' | 'user_id' | 'created_at' | 'updated_at'>
>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * the entry of a row holding every column of LIBRARY_ROW_COLUMNS, parsed with libraryEntrySchema
 * (timestamps normalized to the Date#toISOString form); null when a column is missing or a value
 * is one this version does not accept (such as a format a newer version wrote).
 */
export const parseLibraryRow = (row: unknown): LibraryEntry | null => {
  // `in` reads the prototype too, which holds no column name
  if (!isRecord(row) || !LIBRARY_ROW_COLUMN_NAMES.every((column) => column in row)) {
    return null;
  }
  const parsed = libraryEntrySchema.safeParse({
    key: { namespace: row.id_namespace, kind: row.media_kind, externalId: row.external_id },
    media: {
      title: row.media_title,
      imageUrl: row.media_image_url,
      format: row.media_format,
      totalUnits: row.media_total_units,
      isAdult: row.media_is_adult,
    },
    status: row.status,
    progress: row.progress,
    score: row.score,
    notes: row.notes,
    isFavorite: row.is_favorite,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  return parsed.success ? parsed.data : null;
};

/**
 * the write payload of an entry, always with `id_namespace` (no default, ADR-0013) and
 * `media_is_adult` (no default, BR-06). the entry has passed libraryEntrySchema.
 */
export const toLibraryRowPayload = (entry: LibraryEntry): LibraryRowPayload => ({
  id_namespace: entry.key.namespace,
  media_kind: entry.key.kind,
  external_id: entry.key.externalId,
  media_title: entry.media.title,
  media_image_url: entry.media.imageUrl,
  media_format: entry.media.format,
  media_total_units: entry.media.totalUnits,
  media_is_adult: entry.media.isAdult,
  status: entry.status,
  progress: entry.progress,
  score: entry.score,
  notes: entry.notes,
  is_favorite: entry.isFavorite,
  started_at: entry.startedAt,
  finished_at: entry.finishedAt,
});
