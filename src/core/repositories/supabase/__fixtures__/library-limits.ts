// the limits of the database the postgrest fake (library-handlers.ts) applies, configurable per
// backend so a test crosses them with a few rows and bytes: the per-user entry cap of
// private.enforce_library_entry_cap (supabase/migrations/*_per_user_library_caps.sql) on every
// insert path, and the size bound of the input of the two api functions
// (supabase/migrations/*_library_input_byte_bounds.sql: MERGE_INPUT_BYTES_MAX in merge-function.ts,
// REPLAY_INPUT_BYTES_MAX in replay-function.ts)
import { BAD_REQUEST, errorResponse, type LibraryRow } from './postgrest-fake';

/** the limits one fake backend applies; the database's by default (library-handlers.ts). */
export interface LibraryLimits {
  /** the rows one user holds at most: the trigger's max_entries_per_user. */
  readonly entriesPerUser: number;
  /** the jsonb text bytes of one merge_guest_library_entries input at most. */
  readonly mergeInputBytes: number;
  /** the jsonb text bytes of one replay_library_writes input at most. */
  readonly replayInputBytes: number;
}

// the trigger's sqlstate and fixed message, as the migration raises them. spelled out here, not
// taken from the client's LIBRARY_ENTRY_LIMIT_CODE, so a drift of the client shows in its tests
const ENTRY_LIMIT_SQLSTATE = 'TZ001';
const ENTRY_LIMIT_MESSAGE = 'library entry limit reached';

/** the answer of postgrest to the trigger's refusal: a 400, since it lists no TZ001 status. */
export const entryLimitResponse = (): Response =>
  errorResponse(BAD_REQUEST, ENTRY_LIMIT_SQLSTATE, ENTRY_LIMIT_MESSAGE);

/**
 * private.enforce_library_entry_cap for the insert of a key `userId` does not hold yet, among
 * `rows` (the rows the call sees, its own earlier writes included): the refusal when that user
 * already holds `limits.entriesPerUser` rows, else null. an insert of a key the user holds is
 * never counted (the update of an upsert): its caller skips this check.
 */
export const entryCapRefusal = (
  limits: LibraryLimits,
  rows: readonly LibraryRow[],
  userId: string,
): Response | null =>
  rows.filter((row) => row.user_id === userId).length >= limits.entriesPerUser
    ? entryLimitResponse()
    : null;
