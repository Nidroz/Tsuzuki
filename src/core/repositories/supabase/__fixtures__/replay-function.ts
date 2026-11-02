// the fake of the database function replay_library_writes
// (supabase/migrations/*_replay_library_writes.sql) for the postgrest fake (library-handlers.ts):
// the user from the token only, expected_user_id a guard (a 403 with code 42501 when it is not the
// token's user), the input checks in the function's order (each a 400 with code 22023), then per
// write in input order, among the rows of that user: a save as in the guest merge
// (merge-function.ts), a removal deleting the stored row only when its time is strictly earlier
// than the removal's time capped at the server clock of the call (compared as instants), `written`
// as well when the user has no row of the key. the call is applied whole or not at all. answers
// one row per write: its key, the user id and `written` or `kept`
import { HttpResponse } from 'msw';

import {
  CLIENT_TIME_PATTERN,
  EARLIEST_TIME,
  ENTRY_KEYS,
  KEY_COLUMNS,
  invalid,
  keyIdOf,
  writeEntry,
  type Entry,
  type MergeOutcome,
} from './merge-function';
import type { RowStore } from './library-writes';
import {
  BAD_REQUEST,
  FORBIDDEN,
  NOT_FOUND,
  OK,
  errorResponse,
  instantOf,
  isRecord,
  valueOf,
  type LibraryRow,
} from './postgrest-fake';

/** the writes one call takes at most: the function's max_writes. */
export const REPLAY_MAX_WRITES = 100;

const OP = 'op';
const OPS = ['save', 'remove'];
// the arguments of the function, by name
const ARGUMENTS = ['expected_user_id', 'writes'];
// the keys of a write, exactly, by op: a save holds every writable column and updated_at, a
// removal the media key and updated_at (the time of the removal)
const SAVE_KEYS = [OP, ...ENTRY_KEYS];
const REMOVE_KEYS = [OP, ...KEY_COLUMNS, 'updated_at'];

const hasExactKeys = (write: Entry): boolean => {
  const expected = write[OP] === 'save' ? SAVE_KEYS : REMOVE_KEYS;
  return Object.keys(write).length === expected.length && expected.every((key) => key in write);
};

const timeOf = (write: Entry): string =>
  typeof write.updated_at === 'string' ? write.updated_at : '';

// the function's checks of `writes`, in its order: the writes, or the refusal of the first failing
// check
const validWrites = (writes: unknown): Entry[] | Response => {
  if (!Array.isArray(writes)) {
    return invalid('writes must be a json array');
  }
  if (writes.length > REPLAY_MAX_WRITES) {
    return invalid('too many writes');
  }
  if (!writes.every(isRecord)) {
    return invalid('a write is not a json object');
  }
  if (!writes.every((write) => typeof write[OP] === 'string' && OPS.includes(write[OP]))) {
    return invalid('a write has no known op');
  }
  if (!writes.every(hasExactKeys)) {
    return invalid('a write does not hold exactly the expected keys');
  }
  if (!writes.every((write) => typeof write.updated_at === 'string')) {
    return invalid('a write has no updated_at string');
  }
  if (!writes.every((write) => CLIENT_TIME_PATTERN.test(timeOf(write)))) {
    return invalid('a write has no rfc 3339 updated_at');
  }
  const earliestUs = instantOf(EARLIEST_TIME) ?? 0;
  const instants = writes.map((write) => instantOf(write.updated_at));
  if (instants.includes(null)) {
    return errorResponse(BAD_REQUEST, '22008', 'date/time field value out of range');
  }
  if (instants.some((instant) => instant !== null && instant < earliestUs)) {
    return invalid('a write has an updated_at before the year 1');
  }
  if (new Set(writes.map(keyIdOf)).size !== writes.length) {
    return invalid('writes hold a key twice');
  }
  return writes;
};

// private.remove_client_library_entry: removes the row of `userId` and the key of `write` from
// `rows` when strictly older than the removal's time capped at `now`: its outcome, or a refusal
const removeEntry = (
  rows: LibraryRow[],
  { userId, now }: { readonly userId: string; readonly now: string },
  write: Entry,
): MergeOutcome | Response => {
  if (KEY_COLUMNS.some((column) => write[column] === null)) {
    return invalid('the media key must be complete');
  }
  const removalUs = instantOf(write.updated_at);
  const nowUs = instantOf(now);
  if (removalUs === null || nowUs === null) {
    return errorResponse(BAD_REQUEST, '22007', 'invalid input syntax for type timestamp');
  }
  const stored = rows.find(
    (row) =>
      row.user_id === userId &&
      KEY_COLUMNS.every((column) => valueOf(row, column) === write[column]),
  );
  if (stored === undefined) {
    return 'written';
  }
  const storedUs = instantOf(stored.updated_at);
  if (storedUs === null || storedUs >= Math.min(removalUs, nowUs)) {
    return 'kept';
  }
  rows.splice(rows.indexOf(stored), 1);
  return 'written';
};

/**
 * a POST to the function by `userId`: `{ expected_user_id, writes }` applied to the rows of that
 * user, all or nothing, at one tick of the server clock (the call's transaction time).
 */
export const handleReplay = (store: RowStore, userId: string, body: unknown): Response => {
  if (
    !isRecord(body) ||
    Object.keys(body).length !== ARGUMENTS.length ||
    !ARGUMENTS.every((name) => name in body)
  ) {
    return errorResponse(NOT_FOUND, 'PGRST202', 'no function matches the arguments');
  }
  if (body.expected_user_id !== userId) {
    return errorResponse(FORBIDDEN, '42501', 'not the expected user');
  }
  const writes = validWrites(body.writes);
  if (writes instanceof Response) {
    return writes;
  }
  const call = { userId, now: store.tick() };
  const rows = [...store.rows];
  const answer: Entry[] = [];
  for (const write of writes) {
    const { [OP]: op, ...entry } = write;
    const outcome =
      op === 'save' ? writeEntry(store, rows, call, entry) : removeEntry(rows, call, entry);
    if (outcome instanceof Response) {
      return outcome;
    }
    const key = Object.fromEntries(KEY_COLUMNS.map((column) => [column, write[column]]));
    answer.push({ ...key, user_id: userId, outcome });
  }
  store.rows.splice(0, store.rows.length, ...rows);
  return HttpResponse.json(answer, { status: OK });
};
