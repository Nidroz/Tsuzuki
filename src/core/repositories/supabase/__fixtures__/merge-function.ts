// the fake of the database function merge_guest_library_entries
// (supabase/migrations/*_guest_merge_client_time.sql, *_guest_merge_time_format.sql) for the
// postgrest fake (library-handlers.ts): the user from the token only, the input checks in the
// function's order (each a 400 with code 22023), then per entry, among the rows of that user: a
// time before the year 1 refused, its time capped at the server clock of the call, an insert when
// the user has no row of its key, a replace when the capped time is strictly later than the
// stored one (compared as instants: stored microseconds against the entry's milliseconds), else
// kept. the batch is written whole or not at all. answers one row per entry: its key, the user id
// and `written` or `kept`
import { HttpResponse } from 'msw';

import type { RowStore } from './library-writes';
import {
  BAD_REQUEST,
  NOT_FOUND,
  OK,
  SERVER_DETAIL_PREFIX,
  defaultRow,
  errorResponse,
  instantOf,
  isRecord,
  postgrestTimestamp,
  valueOf,
  type LibraryRow,
} from './postgrest-fake';

/** the entries one call takes at most: the function's max_entries. */
export const MERGE_MAX_ENTRIES = 100;

const INVALID_PARAMETER = '22023';
const KEY_COLUMNS = ['id_namespace', 'media_kind', 'external_id'];
// the keys of every entry, exactly: the writable columns and updated_at
const ENTRY_KEYS = [
  ...KEY_COLUMNS,
  'media_title',
  'media_image_url',
  'media_format',
  'media_total_units',
  'media_is_adult',
  'status',
  'progress',
  'score',
  'notes',
  'is_favorite',
  'started_at',
  'finished_at',
  'updated_at',
];
// the rfc 3339 form the function accepts for updated_at, its client_time_pattern
const CLIENT_TIME_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
// the earliest time the function writes, its earliest_time: postgres serves an earlier one as BC
const EARLIEST_TIME = '0001-01-01T00:00:00.000Z';
// the not null columns an entry sets
const NOT_NULL_COLUMNS = [
  ...KEY_COLUMNS,
  'media_title',
  'media_format',
  'media_is_adult',
  'status',
  'progress',
  'is_favorite',
];

type Entry = Record<string, unknown>;

// what the function answers for one entry
type MergeOutcome = 'written' | 'kept';

const invalid = (message: string): Response =>
  errorResponse(BAD_REQUEST, INVALID_PARAMETER, message);

const hasExactKeys = (entry: Entry): boolean =>
  Object.keys(entry).length === ENTRY_KEYS.length && ENTRY_KEYS.every((key) => key in entry);

const keyIdOf = (entry: Entry): string =>
  KEY_COLUMNS.map((column) => String(entry[column])).join(':');

// the function's checks of `entries`, in its order: the entries, or the refusal of the first
// failing check
const validEntries = (entries: unknown): Entry[] | Response => {
  if (!Array.isArray(entries)) {
    return invalid('entries must be a json array');
  }
  if (entries.length > MERGE_MAX_ENTRIES) {
    return invalid('too many entries');
  }
  if (!entries.every(isRecord)) {
    return invalid('an entry is not a json object');
  }
  if (!entries.every(hasExactKeys)) {
    return invalid('an entry does not hold exactly the expected keys');
  }
  if (!entries.every((entry) => typeof entry.updated_at === 'string')) {
    return invalid('an entry has no updated_at string');
  }
  if (
    !entries.every(
      (entry) => typeof entry.updated_at === 'string' && CLIENT_TIME_PATTERN.test(entry.updated_at),
    )
  ) {
    return invalid('an entry has no rfc 3339 updated_at');
  }
  if (new Set(entries.map(keyIdOf)).size !== entries.length) {
    return invalid('entries hold a key twice');
  }
  return entries;
};

// writes one entry into `rows` at `now` (the call's server time): its outcome, or the refusal of a
// value postgres would reject
const writeEntry = (
  store: RowStore,
  rows: LibraryRow[],
  { userId, now }: { readonly userId: string; readonly now: string },
  entry: Entry,
): MergeOutcome | Response => {
  const missing = NOT_NULL_COLUMNS.find((column) => entry[column] === null);
  if (missing !== undefined) {
    const detail = `${SERVER_DETAIL_PREFIX} (${JSON.stringify(entry)})`;
    return errorResponse(BAD_REQUEST, '23502', `null value in column "${missing}"`, detail);
  }
  const entryUs = instantOf(entry.updated_at);
  const nowUs = instantOf(now);
  const earliestUs = instantOf(EARLIEST_TIME);
  if (entryUs === null || nowUs === null || earliestUs === null) {
    return errorResponse(BAD_REQUEST, '22007', 'invalid input syntax for type timestamp');
  }
  if (entryUs < earliestUs) {
    return invalid('updated_at must not be before the year 1');
  }
  // least(updated_at, now())
  const updatedAt = entryUs < nowUs ? postgrestTimestamp(entryUs) : now;
  const stored = rows.find(
    (row) =>
      row.user_id === userId &&
      KEY_COLUMNS.every((column) => valueOf(row, column) === entry[column]),
  );
  if (stored === undefined) {
    rows.push(
      Object.assign(defaultRow(userId, store.nextIndex(), now), entry, { updated_at: updatedAt }),
    );
    return 'written';
  }
  const storedUs = instantOf(stored.updated_at);
  if (storedUs === null || storedUs >= Math.min(entryUs, nowUs)) {
    return 'kept';
  }
  // the stored id, user_id and created_at kept
  rows.splice(
    rows.indexOf(stored),
    1,
    Object.assign({ ...stored }, entry, { updated_at: updatedAt }),
  );
  return 'written';
};

/**
 * a POST to the function by `userId`: `{ entries }` merged into the rows of that user, all or
 * nothing, at one tick of the server clock (the call's transaction time).
 */
export const handleMerge = (store: RowStore, userId: string, body: unknown): Response => {
  if (!isRecord(body) || Object.keys(body).join() !== 'entries') {
    return errorResponse(NOT_FOUND, 'PGRST202', 'no function matches the arguments');
  }
  const entries = validEntries(body.entries);
  if (entries instanceof Response) {
    return entries;
  }
  const call = { userId, now: store.tick() };
  const rows = [...store.rows];
  const answer: Entry[] = [];
  for (const entry of entries) {
    const outcome = writeEntry(store, rows, call, entry);
    if (outcome instanceof Response) {
      return outcome;
    }
    const key = Object.fromEntries(KEY_COLUMNS.map((column) => [column, entry[column]]));
    answer.push({ ...key, user_id: userId, outcome });
  }
  store.rows.splice(0, store.rows.length, ...rows);
  return HttpResponse.json(answer, { status: OK });
};
