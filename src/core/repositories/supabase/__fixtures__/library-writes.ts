// the writes of the postgrest fake (library-handlers.ts) on the rows of every user, rls applied
// (the rows of the token's user only): the upsert of `save` (one object, merge-duplicates), the
// insert of the guest merge (an array, ignore-duplicates: new keys inserted, existing ones
// skipped), the conditional update of the merge (eq filters and `updated_at=lt.`) and the filtered
// delete. what supabase-js would not send for these calls is a 400
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
const RETURN_REPRESENTATION = 'return=representation';
// the quotes supabase-js puts around each name of the `columns` param
const COLUMN_QUOTES = /^"|"$/g;

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

// `insert … on conflict do nothing` of an array: each object read through the `columns` param;
// a key the user already has (or an earlier object of the array) is skipped. answers the
// inserted rows only
const insertIgnoringDuplicates = (
  store: RowStore,
  { request, userId, search }: WriteRequest,
  body: readonly unknown[],
): Response => {
  const columns = search
    .get('columns')
    ?.split(',')
    .map((column) => column.replaceAll(COLUMN_QUOTES, ''));
  if (columns === undefined || !body.every(isRecord)) {
    return errorResponse(BAD_REQUEST, 'PGRST102', 'expected objects and their columns');
  }
  const payloads = body.map((item) =>
    Object.fromEntries(
      columns.filter((column) => column in item).map((column) => [column, item[column]]),
    ),
  );
  for (const payload of payloads) {
    const refusal = payloadRefusal(payload);
    if (refusal !== null) {
      return refusal;
    }
  }
  const now = store.tick();
  const inserted = payloads.flatMap((payload) =>
    rowOfKey(store.rows, userId, payload) === undefined
      ? [insertRow(store, userId, now, payload)]
      : [],
  );
  return preferOf(request).includes(RETURN_REPRESENTATION)
    ? HttpResponse.json(representation(request, search, inserted), { status: CREATED })
    : new HttpResponse(null, { status: CREATED });
};

/** a POST: the upsert of one object, or the insert of an array ignoring duplicates. */
export const handlePost = (store: RowStore, write: WriteRequest): Response => {
  const prefer = preferOf(write.request);
  if (write.search.get('on_conflict') !== LIBRARY_CONFLICT_COLUMNS) {
    return errorResponse(BAD_REQUEST, '42P10', 'no unique constraint matches on conflict');
  }
  if (Array.isArray(write.body) && prefer.includes('resolution=ignore-duplicates')) {
    return insertIgnoringDuplicates(store, write, write.body);
  }
  if (prefer.includes('resolution=merge-duplicates')) {
    return upsertOne(store, write);
  }
  return errorResponse(BAD_REQUEST, '42P10', 'unsupported conflict resolution in the fake');
};

/**
 * a PATCH: the body applied to the matching rows (eq filters, `lt.` on a timestamp), updated_at
 * from the server clock; answers the updated rows, an empty array when none matched.
 */
export const handlePatch = (store: RowStore, write: WriteRequest): Response => {
  const { request, userId, search, body } = write;
  if (!isRecord(body)) {
    return errorResponse(BAD_REQUEST, 'PGRST102', 'expected one object');
  }
  if (SERVER_ONLY_COLUMNS.some((column) => column in body)) {
    return errorResponse(FORBIDDEN, '42501', 'permission denied for table library_entries');
  }
  const found = matchingRows(store.rows, userId, search);
  if (found instanceof Response) {
    return found;
  }
  const now = store.tick();
  const updated = found.map((row) => {
    const next = Object.assign({ ...row }, body, { updated_at: now });
    store.rows.splice(store.rows.indexOf(row), 1, next);
    return next;
  });
  return preferOf(request).includes(RETURN_REPRESENTATION)
    ? HttpResponse.json(representation(request, search, updated), { status: OK })
    : new HttpResponse(null, { status: NO_CONTENT });
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
