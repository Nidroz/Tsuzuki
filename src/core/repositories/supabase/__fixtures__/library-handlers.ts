// an msw fake of the postgrest `library_entries` endpoint, for the account library store tests:
// in-memory rows of every user, the user read from the bearer token (rls), and what supabase-js
// sends for the repository's calls: the paged select (select, eq filters, order, offset and limit,
// `Prefer: count=exact` answered with Content-Range), the upsert (on_conflict, `Prefer:
// resolution=merge-duplicates, return=representation`, the object Accept of `.single()`) and the
// filtered delete. server timestamps in postgrest's form (microseconds, +00:00): created_at kept on
// update, updated_at set on each write. a configurable max_rows caps every page, and every request
// is logged, so a test can assert that nothing was sent
import { http, HttpResponse, type HttpHandler } from 'msw';

import { MEDIA_ID_NAMESPACES, MEDIA_KINDS } from '../../../domain/media';
import type { Tables } from '../database.types';
import { PROJECT_URL } from './auth-handlers';

export const LIBRARY_ENDPOINT = `${PROJECT_URL}/rest/v1/library_entries`;

/** the conflict target the fake accepts, library_entries_user_media_key. */
export const LIBRARY_CONFLICT_COLUMNS = 'user_id,id_namespace,media_kind,external_id';

export type LibraryRow = Tables<'library_entries'>;

/** the access token of a user's fake session; the fake reads the user back from it. */
export const accessTokenOf = (userId: string): string => `access-token-${userId}`;
const ACCESS_TOKEN_PREFIX = 'Bearer access-token-';

// server text quoting the row, as postgres details do: never in an error or a report
export const SERVER_DETAIL_PREFIX = 'Failing row contains';

export interface LibraryRequest {
  readonly method: string;
  readonly search: URLSearchParams;
  readonly prefer: string | null;
  readonly accept: string | null;
  readonly body: unknown;
}

const OK = 200;
const CREATED = 201;
const NO_CONTENT = 204;
const PARTIAL_CONTENT = 206;
const BAD_REQUEST = 400;
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const NOT_ACCEPTABLE = 406;
const DEFAULT_MAX_ROWS = 1000;
const OBJECT_ACCEPT = 'application/vnd.pgrst.object+json';
const EQ_PREFIX = 'eq.';
const RESERVED_PARAMS = new Set(['select', 'order', 'offset', 'limit', 'on_conflict', 'columns']);
// the server clock: 2026-03-01T09:00:00Z, one second and 123 microseconds per write
const CLOCK_START_US = Date.UTC(2026, 2, 1, 9) * 1000;
const CLOCK_STEP_US = 1_000_123;
const US_PER_MS = 1000;
const MS_DIGITS = 23;
const SERVER_ONLY_COLUMNS = ['id', 'user_id', 'created_at', 'updated_at'];
const REQUIRED_COLUMNS = [
  'id_namespace',
  'media_kind',
  'external_id',
  'media_title',
  'media_format',
  'media_is_adult',
];

/** a timestamp in postgrest's form, `2026-03-01T09:00:00.000123+00:00`. */
export const postgrestTimestamp = (micros: number): string => {
  const iso = new Date(Math.floor(micros / US_PER_MS)).toISOString().slice(0, MS_DIGITS);
  return `${iso}${String(micros % US_PER_MS).padStart(3, '0')}+00:00`;
};

const errorResponse = (status: number, code: string, message: string, details = '') =>
  HttpResponse.json({ code, message, details, hint: null }, { status });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readBody = async (request: Request): Promise<unknown> => {
  const text = await request.text();
  return text === '' ? null : JSON.parse(text);
};

// the value of a column by name, without a type assertion
const valueOf = (row: LibraryRow, column: string): unknown =>
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

// postgrest's order param: `column.asc` or `column.desc`, comma separated
const compareByOrder =
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

/** the fake backend: its handler, its rows, its request log and its knobs. */
export const createLibraryBackend = () => {
  const rows: LibraryRow[] = [];
  const requests: LibraryRequest[] = [];
  const pendingResponses: (() => Response | Promise<Response>)[] = [];
  let maxRows = DEFAULT_MAX_ROWS;
  let clockUs = CLOCK_START_US;
  let rowCount = 0;

  const tick = (): string => {
    clockUs += CLOCK_STEP_US;
    return postgrestTimestamp(clockUs);
  };

  // the eq filters of a request, applied with rls: the rows of `userId` only
  const matching = (userId: string, search: URLSearchParams): LibraryRow[] | Response => {
    const filters: [string, string][] = [];
    for (const [column, value] of search) {
      if (RESERVED_PARAMS.has(column)) {
        continue;
      }
      if (!value.startsWith(EQ_PREFIX)) {
        return errorResponse(BAD_REQUEST, 'PGRST100', 'unsupported filter in the fake');
      }
      filters.push([column, value.slice(EQ_PREFIX.length)]);
    }
    return rows.filter(
      (row) =>
        row.user_id === userId &&
        filters.every(([column, value]) => String(valueOf(row, column)) === value),
    );
  };

  const representation = (request: Request, search: URLSearchParams, found: LibraryRow[]) => {
    const shaped = found.map((row) => selectColumns(row, search.get('select')));
    if (request.headers.get('accept') !== OBJECT_ACCEPT) {
      return shaped;
    }
    return shaped.length === 1 ? shaped[0] : null;
  };

  const handleGet = (request: Request, userId: string, search: URLSearchParams): Response => {
    const found = matching(userId, search);
    if (found instanceof Response) {
      return found;
    }
    const sorted = [...found].sort(compareByOrder(search.get('order')));
    const offset = Number(search.get('offset') ?? '0');
    const limit = Math.min(Number(search.get('limit') ?? String(maxRows)), maxRows);
    const page = sorted.slice(offset, offset + limit);
    const body = representation(request, search, page);
    if (body === null) {
      return errorResponse(NOT_ACCEPTABLE, 'PGRST116', 'Cannot coerce the result to one object');
    }
    const hasCount = request.headers.get('prefer')?.includes('count=exact') === true;
    const range = page.length === 0 ? '*' : `${String(offset)}-${String(offset + page.length - 1)}`;
    const total = hasCount ? String(sorted.length) : '*';
    const status = hasCount && page.length < sorted.length ? PARTIAL_CONTENT : OK;
    return HttpResponse.json(body, { status, headers: { 'Content-Range': `${range}/${total}` } });
  };

  const handleUpsert = (
    request: Request,
    userId: string,
    search: URLSearchParams,
    body: unknown,
  ) => {
    const prefer = request.headers.get('prefer') ?? '';
    if (
      search.get('on_conflict') !== LIBRARY_CONFLICT_COLUMNS ||
      !prefer.includes('resolution=merge-duplicates')
    ) {
      return errorResponse(BAD_REQUEST, '42P10', 'no unique constraint matches on conflict');
    }
    if (!isRecord(body)) {
      return errorResponse(BAD_REQUEST, 'PGRST102', 'expected one object');
    }
    if (SERVER_ONLY_COLUMNS.some((column) => column in body)) {
      return errorResponse(FORBIDDEN, '42501', 'permission denied for table library_entries');
    }
    const missing = REQUIRED_COLUMNS.find((column) => body[column] === undefined);
    if (missing !== undefined) {
      const detail = `${SERVER_DETAIL_PREFIX} (${JSON.stringify(body)})`;
      return errorResponse(BAD_REQUEST, '23502', `null value in column "${missing}"`, detail);
    }
    const existing = rows.find(
      (row) =>
        row.user_id === userId &&
        row.id_namespace === body.id_namespace &&
        row.media_kind === body.media_kind &&
        row.external_id === body.external_id,
    );
    const now = tick();
    // the payload over the column defaults or the stored row, as the fake trusts it; postgrest
    // answers an insert with 201 and an update with 200 (the repository always asks for the row)
    if (existing === undefined) {
      rowCount += 1;
      const inserted = Object.assign(defaultRow(userId, rowCount, now), body);
      rows.push(inserted);
      return HttpResponse.json(representation(request, search, [inserted]), { status: CREATED });
    }
    const updated = Object.assign({ ...existing }, body, { updated_at: now });
    rows.splice(rows.indexOf(existing), 1, updated);
    return HttpResponse.json(representation(request, search, [updated]), { status: OK });
  };

  const handleDelete = (userId: string, search: URLSearchParams): Response => {
    const found = matching(userId, search);
    if (found instanceof Response) {
      return found;
    }
    for (const row of found) {
      rows.splice(rows.indexOf(row), 1);
    }
    return new HttpResponse(null, { status: NO_CONTENT });
  };

  const handler: HttpHandler = http.all(LIBRARY_ENDPOINT, async ({ request }) => {
    const search = new URL(request.url).searchParams;
    const body = await readBody(request.clone());
    requests.push({
      method: request.method,
      search,
      prefer: request.headers.get('prefer'),
      accept: request.headers.get('accept'),
      body,
    });
    const pending = pendingResponses.shift();
    if (pending !== undefined) {
      return pending();
    }
    const authorization = request.headers.get('authorization') ?? '';
    if (!authorization.startsWith(ACCESS_TOKEN_PREFIX)) {
      return errorResponse(UNAUTHORIZED, '42501', 'permission denied for table library_entries');
    }
    const userId = authorization.slice(ACCESS_TOKEN_PREFIX.length);
    switch (request.method) {
      case 'GET':
        return handleGet(request, userId, search);
      case 'POST':
        return handleUpsert(request, userId, search, body);
      case 'DELETE':
        return handleDelete(userId, search);
      default:
        return errorResponse(BAD_REQUEST, 'PGRST000', 'unsupported method in the fake');
    }
  });

  return {
    handler,
    rows,
    requests,
    /** caps every page at `value` rows, like a project's max_rows. */
    setMaxRows: (value: number): void => {
      maxRows = value;
    },
    /** answers the next request with `respond` instead of the fake (the request is still logged). */
    respondNext: (respond: () => Response | Promise<Response>): void => {
      pendingResponses.push(respond);
    },
    /** stores rows as they are, for rows the repository could not write itself. */
    seed: (...seeded: LibraryRow[]): void => {
      rows.push(...seeded);
    },
  };
};

export type LibraryBackend = ReturnType<typeof createLibraryBackend>;

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
