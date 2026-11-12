import { describe, expect, it } from '@jest/globals';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import { server } from '../../../../test/core/msw-server';
import type { LibraryEntry } from '../../domain/library-entry';
import { LIBRARY_ENTRIES_PER_USER_MAX } from '../../domain/database-limits';
import { createAccountLibrary } from './__fixtures__/account-library';
import { USER_ID } from './__fixtures__/auth-handlers';
import { jsonbTextBytes } from './__fixtures__/jsonb-text';
import {
  DATABASE_LIBRARY_LIMITS,
  createLibraryBackend,
  type LibraryRequest,
} from './__fixtures__/library-handlers';
import type { LibraryLimits } from './__fixtures__/library-limits';
import { BAD_REQUEST, isRecord } from './__fixtures__/postgrest-fake';
import type { Json } from './database.types';
import { toLibraryRowPayload } from './library-row';

// the size bound of the input of the two database functions (R-04, pgTAP 072-library-input-size),
// as the postgrest fake models it with small bounds: an input whose jsonb text is longer than its
// bound is refused with 22023 and a fixed message before any per-element check, and writes
// nothing; an input of exactly the bound passes the size check. through the account store, a
// refused call is `rejected`, reported with its code

// a bound a few elements cross, so no test sends megabytes
const SMALL_BOUND = 1000;
// a time before the fake's server clock (2026-03-01T09:00:00Z)
const LATER = '2026-02-20T08:00:00.000Z';

const FIRST_ENTRY = entryOf({ key: keyOf('anime', 1), updatedAt: LATER });
const ENTRIES: readonly LibraryEntry[] = [
  FIRST_ENTRY,
  entryOf({ key: keyOf('manga', 2), notes: null, updatedAt: LATER }),
];

// an entry as the merge function takes it, and a queued save as the replay function does
const mergePayload = (entry: LibraryEntry) => ({
  ...toLibraryRowPayload(entry),
  updated_at: entry.updatedAt,
});
const savePayload = (entry: LibraryEntry) => ({ op: 'save', ...mergePayload(entry) });

/** a store of USER_ID over a fake with `limits`, holding no row. */
const setup = (limits: Partial<LibraryLimits> = {}) => {
  const library = createAccountLibrary({ backend: createLibraryBackend(limits) });
  server.use(library.backend.handler);
  return library;
};

// an input of exactly `bytes` bytes of jsonb text: `prefix`, then one object of a padded string
// (pg_temp.sized_input of pgTAP 072)
const sizedInput = (bytes: number, prefix: readonly Json[] = []): Json[] => {
  const padding = bytes - jsonbTextBytes([...prefix, { notes: '' }]);
  return [...prefix, { notes: 'x'.repeat(padding) }];
};

// the array argument of a function call: `entries` of the merge, `writes` of the replay
const inputOf = (request: LibraryRequest | undefined): unknown =>
  isRecord(request?.body) ? (request.body.entries ?? request.body.writes) : null;

const FUNCTIONS = [
  {
    name: 'merge_guest_library_entries',
    bound: 'mergeInputBytes',
    tooLarge: 'entries are too large',
    nextCheck: 'an entry does not hold exactly the expected keys',
    call: ({ client }: ReturnType<typeof setup>, input: Json[]) =>
      client.rpc('merge_guest_library_entries', { entries: input }),
    valid: mergePayload(FIRST_ENTRY),
  },
  {
    name: 'replay_library_writes',
    bound: 'replayInputBytes',
    tooLarge: 'writes are too large',
    nextCheck: 'a write has no known op',
    call: ({ client }: ReturnType<typeof setup>, input: Json[]) =>
      client.rpc('replay_library_writes', { expected_user_id: USER_ID, writes: input }),
    valid: savePayload(FIRST_ENTRY),
  },
] as const;

describe('the input size bound', () => {
  it('is the database bound unless the backend is given another one', () => {
    expect(DATABASE_LIBRARY_LIMITS).toStrictEqual({
      entriesPerUser: LIBRARY_ENTRIES_PER_USER_MAX,
      mergeInputBytes: 2_805_100,
      replayInputBytes: 2_806_500,
    });
  });

  it.each(FUNCTIONS)(
    'lets an input of exactly the bound of $name through the size check, to the next check',
    async ({ bound, nextCheck, call }) => {
      const input = sizedInput(SMALL_BOUND);

      const { status, error } = await call(setup({ [bound]: SMALL_BOUND }), input);

      expect(jsonbTextBytes(input)).toBe(SMALL_BOUND);
      expect(status).toBe(BAD_REQUEST);
      expect(error).toMatchObject({ code: '22023', message: nextCheck });
    },
  );

  it.each(FUNCTIONS)(
    'refuses an input one byte over the bound of $name before any per-element check',
    async ({ bound, tooLarge, call, valid }) => {
      const library = setup({ [bound]: SMALL_BOUND });
      // a valid element first: the size refuses the call before it is checked or written
      const input = sizedInput(SMALL_BOUND + 1, [valid]);

      const { status, error } = await call(library, input);

      expect(jsonbTextBytes(input)).toBe(SMALL_BOUND + 1);
      expect(status).toBe(BAD_REQUEST);
      expect(error).toMatchObject({ code: '22023', message: tooLarge });
      expect(library.backend.rows).toStrictEqual([]);
    },
  );
});

describe('the input size bound through the account store', () => {
  const STORE_CALLS = [
    {
      operation: 'merge',
      bound: 'mergeInputBytes',
      input: ENTRIES.map(mergePayload),
      write: ({ repository }: ReturnType<typeof setup>) => repository.mergeGuestEntries(ENTRIES),
    },
    {
      operation: 'replay',
      bound: 'replayInputBytes',
      input: ENTRIES.map(savePayload),
      write: ({ repository }: ReturnType<typeof setup>) =>
        repository.replayWrites(ENTRIES.map((entry) => ({ type: 'save', entry }))),
    },
  ] as const;

  it.each(STORE_CALLS)(
    'writes a $operation call of exactly the bound whole',
    async ({ bound, input, write }) => {
      const exact = jsonbTextBytes(input);
      const library = setup({ [bound]: exact });

      await write(library);

      expect(jsonbTextBytes(inputOf(library.backend.requests[0]))).toBe(exact);
      expect(library.backend.rows.map((row) => row.external_id)).toStrictEqual([1, 2]);
    },
  );

  it.each(STORE_CALLS)(
    'refuses a $operation call one byte over the bound as rejected, reported, writing nothing',
    async ({ operation, bound, input, write }) => {
      const library = setup({ [bound]: jsonbTextBytes(input) - 1 });

      await expect(write(library)).rejects.toMatchObject({
        name: 'LibraryRemoteError',
        reason: 'rejected',
      });

      expect(library.backend.rows).toStrictEqual([]);
      expect(library.captureError).toHaveBeenCalledTimes(1);
      expect(library.captureError).toHaveBeenCalledWith(expect.anything(), {
        source: 'library-remote',
        tags: { operation, code: '22023', status: '400' },
      });
    },
  );
});
