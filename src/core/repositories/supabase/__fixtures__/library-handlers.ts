// an msw fake of the postgrest `library_entries` endpoint, for the account library store tests:
// in-memory rows of every user, the user read from the bearer token (rls), and what supabase-js
// sends for the repository's calls: the paged select (select, eq filters, order, offset and limit,
// `Prefer: count=exact` answered with Content-Range) and the writes of library-writes.ts (the
// upsert of save, the insert and the conditional update of the guest merge, the filtered delete).
// server timestamps in postgrest's form (microseconds, +00:00): created_at kept on update,
// updated_at set on each write. a configurable max_rows caps every page, every request is logged,
// so a test can assert that nothing was sent, and a test can answer a request itself or change the
// rows before one
import { http, HttpResponse, type HttpHandler } from 'msw';

import { PROJECT_URL } from './auth-handlers';
import { handleDelete, handlePatch, handlePost, type RowStore } from './library-writes';
import {
  BAD_REQUEST,
  NOT_ACCEPTABLE,
  OK,
  PARTIAL_CONTENT,
  UNAUTHORIZED,
  compareByOrder,
  errorResponse,
  matchingRows,
  postgrestTimestamp,
  readBody,
  representation,
  type LibraryRow,
} from './postgrest-fake';

export const LIBRARY_ENDPOINT = `${PROJECT_URL}/rest/v1/library_entries`;

/** the access token of a user's fake session; the fake reads the user back from it. */
export const accessTokenOf = (userId: string): string => `access-token-${userId}`;
const ACCESS_TOKEN_PREFIX = 'Bearer access-token-';

export interface LibraryRequest {
  readonly method: string;
  readonly search: URLSearchParams;
  readonly prefer: string | null;
  readonly accept: string | null;
  readonly body: unknown;
}

type Respond = () => Response | Promise<Response>;

// a test's answer or change for the next request of `method`, null for any method
interface Pending<T> {
  readonly method: string | null;
  readonly value: T;
}

const DEFAULT_MAX_ROWS = 1000;
// the server clock: 2026-03-01T09:00:00Z, one second and 123 microseconds per write
const CLOCK_START_US = Date.UTC(2026, 2, 1, 9) * 1000;
const CLOCK_STEP_US = 1_000_123;

// removes and returns the first pending value for a request of `method`
const takeFor = <T>(pending: Pending<T>[], method: string): T | undefined => {
  const index = pending.findIndex((item) => item.method === null || item.method === method);
  return index === -1 ? undefined : pending.splice(index, 1)[0]?.value;
};

/** the fake backend: its handler, its rows, its request log and its knobs. */
export const createLibraryBackend = () => {
  const rows: LibraryRow[] = [];
  const requests: LibraryRequest[] = [];
  const pendingResponses: Pending<Respond>[] = [];
  const pendingChanges: Pending<() => void>[] = [];
  let maxRows = DEFAULT_MAX_ROWS;
  let clockUs = CLOCK_START_US;
  let rowCount = 0;

  const store: RowStore = {
    rows,
    tick: () => {
      clockUs += CLOCK_STEP_US;
      return postgrestTimestamp(clockUs);
    },
    nextIndex: () => {
      rowCount += 1;
      return rowCount;
    },
  };

  const handleGet = (request: Request, userId: string, search: URLSearchParams): Response => {
    const found = matchingRows(rows, userId, search);
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
    takeFor(pendingChanges, request.method)?.();
    const respond = takeFor(pendingResponses, request.method);
    if (respond !== undefined) {
      return respond();
    }
    const authorization = request.headers.get('authorization') ?? '';
    if (!authorization.startsWith(ACCESS_TOKEN_PREFIX)) {
      return errorResponse(UNAUTHORIZED, '42501', 'permission denied for table library_entries');
    }
    const userId = authorization.slice(ACCESS_TOKEN_PREFIX.length);
    const write = { request, userId, search, body };
    switch (request.method) {
      case 'GET':
        return handleGet(request, userId, search);
      case 'POST':
        return handlePost(store, write);
      case 'PATCH':
        return handlePatch(store, write);
      case 'DELETE':
        return handleDelete(store, write);
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
    /**
     * answers the next request, or the next one of `method` when given, with `respond` instead of
     * the fake (the request is still logged).
     */
    respondNext: (respond: Respond, method: string | null = null): void => {
      pendingResponses.push({ method, value: respond });
    },
    /**
     * runs `change` when the next request of `method` arrives, before the fake answers it: a write
     * from another device landing between two requests of the repository.
     */
    changeBefore: (method: string, change: () => void): void => {
      pendingChanges.push({ method, value: change });
    },
    /** stores rows as they are, for rows the repository could not write itself. */
    seed: (...seeded: LibraryRow[]): void => {
      rows.push(...seeded);
    },
  };
};

export type LibraryBackend = ReturnType<typeof createLibraryBackend>;
