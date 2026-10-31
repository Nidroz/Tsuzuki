// the parts of the postgrest fake (library-handlers.ts) that read a request: statuses and error
// bodies, timestamps in postgrest's form, the filters, order and select params supabase-js sends,
// and the stored rows of library_entries with their column defaults
import { HttpResponse } from 'msw';

import type { LibraryEntry } from '../../../domain/library-entry';
import { MEDIA_ID_NAMESPACES, MEDIA_KINDS } from '../../../domain/media';
import type { Tables } from '../database.types';
import { toLibraryRowPayload } from '../library-row';

export type LibraryRow = Tables<'library_entries'>;

/** the conflict target the fake accepts, library_entries_user_media_key. */
export const LIBRARY_CONFLICT_COLUMNS = 'user_id,id_namespace,media_kind,external_id';

// server text quoting the row, as postgres details do: never in an error or a report
export const SERVER_DETAIL_PREFIX = 'Failing row contains';

export const OK = 200;
export const CREATED = 201;
export const NO_CONTENT = 204;
export const PARTIAL_CONTENT = 206;
export const BAD_REQUEST = 400;
export const UNAUTHORIZED = 401;
export const FORBIDDEN = 403;
export const NOT_ACCEPTABLE = 406;

const OBJECT_ACCEPT = 'application/vnd.pgrst.object+json';
const EQ_PREFIX = 'eq.';
const LT_PREFIX = 'lt.';
const RESERVED_PARAMS = new Set(['select', 'order', 'offset', 'limit', 'on_conflict', 'columns']);
const TIMESTAMP_COLUMNS = new Set(['created_at', 'updated_at']);
const US_PER_MS = 1000;
const MS_DIGITS = 23;
const US_DIGITS = 6;
// a timestamp in postgrest's form or the Date#toISOString form: seconds, fraction, offset
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;

/** a timestamp in postgrest's form, `2026-03-01T09:00:00.000123+00:00`. */
export const postgrestTimestamp = (micros: number): string => {
  const iso = new Date(Math.floor(micros / US_PER_MS)).toISOString().slice(0, MS_DIGITS);
  return `${iso}${String(micros % US_PER_MS).padStart(3, '0')}+00:00`;
};

/** the instant of a timestamp in either form, in microseconds since the epoch; null otherwise. */
export const instantOf = (value: unknown): number | null => {
  const match = typeof value === 'string' ? TIMESTAMP.exec(value) : null;
  if (match === null) {
    return null;
  }
  const [, seconds = '', fraction = '', offset = ''] = match;
  const millis = Date.parse(`${seconds}${offset}`);
  return Number.isNaN(millis) ? null : millis * US_PER_MS + Number(fraction.padEnd(US_DIGITS, '0'));
};

export const errorResponse = (status: number, code: string, message: string, details = '') =>
  HttpResponse.json({ code, message, details, hint: null }, { status });

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const readBody = async (request: Request): Promise<unknown> => {
  const text = await request.text();
  return text === '' ? null : JSON.parse(text);
};

// the value of a column by name, without a type assertion
export const valueOf = (row: LibraryRow, column: string): unknown =>
  Object.entries(row).find(([name]) => name === column)?.[1];

const rankOf = (column: string, value: unknown): number | string => {
  if (column === 'id_namespace') {
    return MEDIA_ID_NAMESPACES.findIndex((namespace) => namespace === value);
  }
  if (column === 'media_kind') {
    return MEDIA_KINDS.findIndex((kind) => kind === value);
  }
  return typeof value === 'number' ? value : String(value);
};

/** postgrest's order param: `column.asc` or `column.desc`, comma separated. */
export const compareByOrder =
  (order: string | null) =>
  (a: LibraryRow, b: LibraryRow): number => {
    for (const part of (order ?? '').split(',').filter((item) => item !== '')) {
      const [column = '', direction] = part.split('.');
      const left = rankOf(column, valueOf(a, column));
      const right = rankOf(column, valueOf(b, column));
      if (left !== right) {
        const ascending = left < right ? -1 : 1;
        return direction === 'desc' ? -ascending : ascending;
      }
    }
    return 0;
  };

const selectColumns = (row: LibraryRow, select: string | null): Record<string, unknown> => {
  const columns = (select ?? '*').split(',');
  return columns.includes('*')
    ? { ...row }
    : Object.fromEntries(columns.map((column) => [column, valueOf(row, column)]));
};

/** the rows as the select param shapes them: an array, or the one row `.single()` asks for. */
export const representation = (request: Request, search: URLSearchParams, found: LibraryRow[]) => {
  const shaped = found.map((row) => selectColumns(row, search.get('select')));
  if (request.headers.get('accept') !== OBJECT_ACCEPT) {
    return shaped;
  }
  return shaped.length === 1 ? shaped[0] : null;
};

// one filter param: `eq.` on any column, `lt.` on a timestamp column compared as instants (the
// stored microseconds against the filter's milliseconds); null for anything else
const filterOf = (column: string, value: string): ((row: LibraryRow) => boolean) | null => {
  if (value.startsWith(EQ_PREFIX)) {
    const operand = value.slice(EQ_PREFIX.length);
    return (row) => String(valueOf(row, column)) === operand;
  }
  const bound = value.startsWith(LT_PREFIX) ? instantOf(value.slice(LT_PREFIX.length)) : null;
  if (bound === null || !TIMESTAMP_COLUMNS.has(column)) {
    return null;
  }
  return (row) => {
    const instant = instantOf(valueOf(row, column));
    return instant !== null && instant < bound;
  };
};

/** the rows of `userId` (rls) matching every filter of `search`, or a 400 for one the fake lacks. */
export const matchingRows = (
  rows: readonly LibraryRow[],
  userId: string,
  search: URLSearchParams,
): LibraryRow[] | Response => {
  const filters: ((row: LibraryRow) => boolean)[] = [];
  for (const [column, value] of search) {
    if (RESERVED_PARAMS.has(column)) {
      continue;
    }
    const filter = filterOf(column, value);
    if (filter === null) {
      return errorResponse(BAD_REQUEST, 'PGRST100', 'unsupported filter in the fake');
    }
    filters.push(filter);
  }
  return rows.filter((row) => row.user_id === userId && filters.every((filter) => filter(row)));
};

/** a stored row of `userId` with the column defaults, its timestamps at `now`. */
export const defaultRow = (userId: string, index: number, now: string): LibraryRow => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  user_id: userId,
  id_namespace: 'mal',
  media_kind: 'anime',
  external_id: index,
  media_title: 'Cowboy Bebop',
  media_image_url: null,
  media_format: 'tv',
  media_total_units: null,
  media_is_adult: false,
  status: 'planned',
  progress: 0,
  score: null,
  notes: null,
  is_favorite: false,
  started_at: null,
  finished_at: null,
  created_at: now,
  updated_at: now,
});

/** the stored row of `entry` for `userId`, with the entry's own timestamps in postgrest's form. */
export const rowOfEntry = (userId: string, index: number, entry: LibraryEntry): LibraryRow => ({
  ...defaultRow(userId, index, postgrestTimestamp(Date.parse(entry.updatedAt) * US_PER_MS)),
  ...toLibraryRowPayload(entry),
  created_at: postgrestTimestamp(Date.parse(entry.createdAt) * US_PER_MS),
});
