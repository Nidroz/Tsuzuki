import { describe, expect, it } from '@jest/globals';

import {
  NOTES_TEXT,
  TITLE_TEXT,
  entryOf,
  keyOf,
} from '../../../../test/core/library-entry-fixtures';
import { failureOf } from '../../../../test/core/library-repository-contract-support';
import { server } from '../../../../test/core/msw-server';
import type { LibraryEntry } from '../../domain/library-entry';
import type { LibraryQueuedWrite } from '../../domain/library-sync';
import { OTHER_USER_ID, createAccountLibrary, seedEntries } from './__fixtures__/account-library';
import { USER_ID } from './__fixtures__/auth-handlers';
import {
  MERGE_ENDPOINT,
  createLibraryBackend,
  type LibraryBackend,
} from './__fixtures__/library-handlers';
import {
  BAD_REQUEST,
  LIBRARY_CONFLICT_COLUMNS,
  SERVER_DETAIL_PREFIX,
  errorResponse,
} from './__fixtures__/postgrest-fake';
import { LIBRARY_ENTRY_LIMIT_CODE } from './library-error-mapper';
import { GUEST_MERGE_BATCH_SIZE } from './library-merge';
import { toLibraryRowPayload } from './library-row';

// the per-user entry cap of the database (R-04, pgTAP 090-library-entry-cap), as the postgrest
// fake models it with a small cap: an insert of a new key once the user holds the cap is refused
// with the sqlstate TZ001, which postgrest answers with 400, and nothing of the call is written; a
// write of a key the user holds passes. on every write of the account store it is `library-full`,
// a condition of the user, never reported; another code of a 400 stays `rejected`, reported

// a small cap, so no test builds LIBRARY_ENTRIES_PER_USER_MAX rows
const ENTRY_CAP = 3;
// times before the fake's server clock (2026-03-01T09:00:00Z)
const EARLIER = '2026-02-01T08:00:00.000Z';
const LATER = '2026-02-20T08:00:00.000Z';
// a second merge call of a few entries after a full first one
const SECOND_BATCH_SIZE = 5;

const entryOfId = (externalId: number, overrides: Partial<LibraryEntry> = {}): LibraryEntry =>
  entryOf({ key: keyOf('anime', externalId), updatedAt: EARLIER, ...overrides });

// the owner at the cap: keys 1 to ENTRY_CAP
const AT_CAP = Array.from({ length: ENTRY_CAP }, (_, index) => entryOfId(index + 1));
const ONE_SHORT = AT_CAP.slice(0, -1);
// keys the owner never holds, with the title and notes no error may quote
const NEW_ENTRY = entryOf({ updatedAt: LATER });
const OTHER_NEW_ENTRY = entryOfId(9, { updatedAt: LATER });
// a newer copy of a key the owner holds
const HELD_NEWER = entryOfId(1, { progress: 20, updatedAt: LATER });

const save = (entry: LibraryEntry): LibraryQueuedWrite => ({ type: 'save', entry });
// a removal of the owner's second key, newer than its stored copy
const REMOVE_SECOND: LibraryQueuedWrite = {
  type: 'remove',
  key: keyOf('anime', 2),
  removedAt: LATER,
};

type Repository = ReturnType<typeof createAccountLibrary>['repository'];

// each write of the store, and its operation as reports name it
const WRITES: readonly {
  readonly operation: string;
  readonly write: (repository: Repository, entry: LibraryEntry) => Promise<unknown>;
}[] = [
  { operation: 'save', write: (repository, entry) => repository.save(entry) },
  { operation: 'merge', write: (repository, entry) => repository.mergeGuestEntries([entry]) },
  { operation: 'replay', write: (repository, entry) => repository.replayWrites([save(entry)]) },
];

/** the owner's store over a fake capped at `entriesPerUser` rows a user, holding `seed`. */
const setup = (seed: readonly LibraryEntry[] = AT_CAP, entriesPerUser = ENTRY_CAP) => {
  const library = createAccountLibrary({ backend: createLibraryBackend({ entriesPerUser }) });
  server.use(library.backend.handler);
  seedEntries(library.backend, seed);
  return library;
};

// the external ids of the owner's rows, in order
const ownedIds = (backend: LibraryBackend): number[] =>
  backend.rows
    .filter((row) => row.user_id === USER_ID)
    .map((row) => row.external_id)
    .sort((a, b) => a - b);

const progressOf = (backend: LibraryBackend, externalId: number): number | undefined =>
  backend.rows.find((row) => row.user_id === USER_ID && row.external_id === externalId)?.progress;

const expectLibraryFull = (error: unknown): void => {
  expect(error).toMatchObject({ name: 'LibraryRemoteError', reason: 'library-full' });
  expect(JSON.stringify(error)).not.toContain(TITLE_TEXT);
  expect(String(error)).not.toContain(NOTES_TEXT);
};

describe('the entry cap', () => {
  it.each(WRITES)(
    'refuses $operation of a new key at the cap as library-full, not reported, writing nothing',
    async ({ write }) => {
      const { backend, repository, captureError } = setup();
      const before = [...backend.rows];

      expectLibraryFull(await failureOf(write(repository, NEW_ENTRY)));

      expect(backend.rows).toStrictEqual(before);
      expect(captureError).not.toHaveBeenCalled();
      expect(backend.requests).toHaveLength(1);
    },
  );

  it.each(WRITES)(
    'lets $operation of a key the user holds through at the cap',
    async ({ write }) => {
      const { backend, repository, captureError } = setup();

      await write(repository, HELD_NEWER);

      expect(ownedIds(backend)).toStrictEqual([1, 2, 3]);
      expect(progressOf(backend, 1)).toBe(HELD_NEWER.progress);
      expect(captureError).not.toHaveBeenCalled();
    },
  );

  it.each(WRITES)(
    'lets $operation take the last free row, then refuses the next new key',
    async ({ write }) => {
      const { backend, repository } = setup(ONE_SHORT);

      await write(repository, NEW_ENTRY);
      expectLibraryFull(await failureOf(write(repository, OTHER_NEW_ENTRY)));

      expect(ownedIds(backend)).toStrictEqual([1, 2, NEW_ENTRY.key.externalId]);
    },
  );

  it('counts the rows of each user apart', async () => {
    const { backend, repository } = setup();
    seedEntries(backend, ONE_SHORT, OTHER_USER_ID);
    const other = createAccountLibrary({ userId: OTHER_USER_ID, backend });

    await other.repository.save(NEW_ENTRY);
    expectLibraryFull(await failureOf(repository.save(NEW_ENTRY)));

    expect(backend.rows.filter((row) => row.user_id === OTHER_USER_ID)).toHaveLength(ENTRY_CAP);
    expect(ownedIds(backend)).toStrictEqual([1, 2, 3]);
  });

  it.each([
    {
      label: 'a merge',
      write: (repository: Repository) => repository.mergeGuestEntries([HELD_NEWER, NEW_ENTRY]),
    },
    {
      label: 'a replay',
      write: (repository: Repository) =>
        repository.replayWrites([save(HELD_NEWER), save(NEW_ENTRY)]),
    },
  ])(
    'refuses $label holding a new key whole: its write of a held key is undone',
    async ({ write }) => {
      const { backend, repository } = setup();

      expectLibraryFull(await failureOf(write(repository)));

      expect(progressOf(backend, 1)).toBe(AT_CAP[0]?.progress);
      expect(ownedIds(backend)).toStrictEqual([1, 2, 3]);
    },
  );

  it('keeps the earlier calls of a merge whose later call crosses the cap', async () => {
    const entries = Array.from({ length: GUEST_MERGE_BATCH_SIZE + SECOND_BATCH_SIZE }, (_, index) =>
      entryOfId(index + 1, { updatedAt: LATER }),
    );
    // room for the first call and one entry of the second
    const { backend, repository } = setup([], GUEST_MERGE_BATCH_SIZE + 1);

    expectLibraryFull(await failureOf(repository.mergeGuestEntries(entries)));

    const merges = backend.requests.filter((request) => request.endpoint === MERGE_ENDPOINT);
    expect(merges).toHaveLength(2);
    expect(ownedIds(backend)).toStrictEqual(
      entries.slice(0, GUEST_MERGE_BATCH_SIZE).map((entry) => entry.key.externalId),
    );
  });

  it('keeps an earlier replay call when a later one is refused', async () => {
    const { backend, repository } = setup(ONE_SHORT);

    await expect(repository.replayWrites([save(NEW_ENTRY)])).resolves.toStrictEqual(['written']);
    expectLibraryFull(await failureOf(repository.replayWrites([save(OTHER_NEW_ENTRY)])));

    expect(ownedIds(backend)).toStrictEqual([1, 2, NEW_ENTRY.key.externalId]);
  });

  it('counts a removal made earlier in a replay call: its row is free for a new key', async () => {
    const { backend, repository } = setup();

    await expect(repository.replayWrites([REMOVE_SECOND, save(NEW_ENTRY)])).resolves.toStrictEqual([
      'written',
      'written',
    ]);

    expect(ownedIds(backend)).toStrictEqual([1, 3, NEW_ENTRY.key.externalId]);
  });

  it('refuses a replay whose new key comes before the removal that would free a row', async () => {
    const { backend, repository } = setup();

    expectLibraryFull(await failureOf(repository.replayWrites([save(NEW_ENTRY), REMOVE_SECOND])));

    expect(ownedIds(backend)).toStrictEqual([1, 2, 3]);
  });
});

describe('the entry cap answer of the fake', () => {
  const payload = { ...toLibraryRowPayload(NEW_ENTRY), updated_at: LATER };

  it.each([
    {
      path: 'the table upsert',
      call: ({ client }: ReturnType<typeof setup>) =>
        client
          .from('library_entries')
          .upsert(toLibraryRowPayload(NEW_ENTRY), { onConflict: LIBRARY_CONFLICT_COLUMNS }),
    },
    {
      path: 'the merge function',
      call: ({ client }: ReturnType<typeof setup>) =>
        client.rpc('merge_guest_library_entries', { entries: [payload] }),
    },
    {
      path: 'the replay function',
      call: ({ client }: ReturnType<typeof setup>) =>
        client.rpc('replay_library_writes', {
          expected_user_id: USER_ID,
          writes: [{ op: 'save', ...payload }],
        }),
    },
  ])('is a 400 with TZ001 and the fixed message on $path, writing nothing', async ({ call }) => {
    const library = setup();
    const before = [...library.backend.rows];

    const { status, error } = await call(library);

    // the fake spells the code as the migration does: a drift of the client's constant shows here
    expect(status).toBe(BAD_REQUEST);
    expect(error).toMatchObject({
      code: LIBRARY_ENTRY_LIMIT_CODE,
      message: 'library entry limit reached',
    });
    expect(library.backend.rows).toStrictEqual(before);
  });
});

describe('another refusal', () => {
  // a refusal whose text quotes the row, as postgres messages and details can
  const refusal = (code: string) => () =>
    errorResponse(
      BAD_REQUEST,
      code,
      `refused ${TITLE_TEXT}`,
      `${SERVER_DETAIL_PREFIX} (${USER_ID}, mal, anime, 52991, ${NOTES_TEXT})`,
    );

  it.each(WRITES)(
    'keeps a 400 with another code on $operation rejected, reported with its code',
    async ({ operation, write }) => {
      const { backend, repository, captureError } = setup(ONE_SHORT);
      backend.respondNext(refusal('23514'), 'POST');

      await expect(write(repository, NEW_ENTRY)).rejects.toMatchObject({ reason: 'rejected' });

      expect(captureError).toHaveBeenCalledTimes(1);
      expect(captureError).toHaveBeenCalledWith(expect.anything(), {
        source: 'library-remote',
        tags: { operation, code: '23514', status: '400' },
      });
    },
  );
});
