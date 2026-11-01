// the writes of the postgrest fake (library-handlers.ts) on the rows of every user, rls applied
// (the rows of the token's user only): the upsert of `save` (one object, merge-duplicates) and the
// filtered delete. what supabase-js would not send for these calls is a 400. the guest merge's
// function is merge-function.ts
import { HttpResponse } from 'msw';

import {
  BAD_REQUEST,
  CREATED,
  FORBIDDEN,
  LIBRARY_CONFLICT_COLUMNS,
  NO_CONTENT,
  OK,
  SERVER_DETAIL_PREFIX,
  defaultRow,
  errorResponse,
  isRecord,
  matchingRows,
  representation,
  type LibraryRow,
} from './postgrest-fake';

const SERVER_ONLY_COLUMNS = ['id', 'user_id', 'created_at', 'updated_at'];
const REQUIRED_COLUMNS = [
  'id_namespace',
  'media_kind',
  'external_id',
  'media_title',
  'media_format',
  'media_is_adult',
];

/** the rows the writes change, the server clock and the row ids. */
export interface RowStore {
  readonly rows: LibraryRow[];
  /** advances the server clock by one write and returns its time in postgrest's form. */
  readonly tick: () => string;
  /** the index of the next inserted row, for its id. */
  readonly nextIndex: () => number;
}

/** a write as the fake reads it: the user of the token (rls), the params and the parsed body. */
export interface WriteRequest {
  readonly request: Request;
  readonly userId: string;
  readonly search: URLSearchParams;
  readonly body: unknown;
}

const preferOf = (request: Request): string => request.headers.get('prefer') ?? '';

// a payload postgres refuses: a server-set column (no grant) or a missing required one
const payloadRefusal = (payload: Record<string, unknown>): Response | null => {
  if (SERVER_ONLY_COLUMNS.some((column) => column in payload)) {
    return errorResponse(FORBIDDEN, '42501', 'permission denied for table library_entries');
  }
  const missing = REQUIRED_COLUMNS.find((column) => payload[column] === undefined);
  if (missing === undefined) {
    return null;
  }
  const detail = `${SERVER_DETAIL_PREFIX} (${JSON.stringify(payload)})`;
  return errorResponse(BAD_REQUEST, '23502', `null value in column "${missing}"`, detail);
};

const rowOfKey = (rows: readonly LibraryRow[], userId: string, payload: Record<string, unknown>) =>
  rows.find(
    (row) =>
      row.user_id === userId &&
      row.id_namespace === payload.id_namespace &&
      row.media_kind === payload.media_kind &&
      row.external_id === payload.external_id,
  );

// the payload over the column defaults, as the fake trusts it
const insertRow = (
  store: RowStore,
  userId: string,
  now: string,
  payload: Record<string, unknown>,
): LibraryRow => {
  const inserted = Object.assign(defaultRow(userId, store.nextIndex(), now), payload);
  store.rows.push(inserted);
  return inserted;
};

// postgrest answers an insert with 201 and an update with 200 (save always asks for the row)
const upsertOne = (store: RowStore, { request, userId, search, body }: WriteRequest): Response => {
  if (!isRecord(body)) {
    return errorResponse(BAD_REQUEST, 'PGRST102', 'expected one object');
  }
  const refusal = payloadRefusal(body);
  if (refusal !== null) {
    return refusal;
  }
  const existing = rowOfKey(store.rows, userId, body);
  const now = store.tick();
  if (existing === undefined) {
    const inserted = insertRow(store, userId, now, body);
    return HttpResponse.json(representation(request, search, [inserted]), { status: CREATED });
  }
  const updated = Object.assign({ ...existing }, body, { updated_at: now });
  store.rows.splice(store.rows.indexOf(existing), 1, updated);
  return HttpResponse.json(representation(request, search, [updated]), { status: OK });
};

/** a POST: the upsert of one object. */
export const handlePost = (store: RowStore, write: WriteRequest): Response => {
  if (write.search.get('on_conflict') !== LIBRARY_CONFLICT_COLUMNS) {
    return errorResponse(BAD_REQUEST, '42P10', 'no unique constraint matches on conflict');
  }
  if (preferOf(write.request).includes('resolution=merge-duplicates')) {
    return upsertOne(store, write);
  }
  return errorResponse(BAD_REQUEST, '42P10', 'unsupported conflict resolution in the fake');
};

/** a DELETE of the matching rows, answering no row. */
export const handleDelete = (store: RowStore, { userId, search }: WriteRequest): Response => {
  const found = matchingRows(store.rows, userId, search);
  if (found instanceof Response) {
    return found;
  }
  for (const row of found) {
    store.rows.splice(store.rows.indexOf(row), 1);
  }
  return new HttpResponse(null, { status: NO_CONTENT });
};
