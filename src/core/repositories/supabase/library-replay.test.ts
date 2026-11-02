import { describe, expect, it, jest } from '@jest/globals';
import { HttpResponse } from 'msw';

import { ENTRY_KEY, entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import { INVALID_ENTRIES } from '../../../../test/core/library-repository-contract-support';
import { server } from '../../../../test/core/msw-server';
import type { LibraryEntry } from '../../domain/library-entry';
import { LIBRARY_REPLAY_BATCH_SIZE, type LibraryQueuedWrite } from '../../domain/library-sync';
import type { MediaKey } from '../../domain/media';
import { OTHER_USER_ID, createAccountLibrary, seedEntries } from './__fixtures__/account-library';
import { USER_ID } from './__fixtures__/auth-handlers';
import { REPLAY_ENDPOINT } from './__fixtures__/library-handlers';
import { instantOf } from './__fixtures__/postgrest-fake';
import { toLibraryRowPayload } from './library-row';

// the replay of queued writes with the time of their change (BR-08, ADR-0017): the rule as the
// postgrest fake models the database function, and what the store sends

// times before the fake's server clock (2026-03-01T09:00:00Z, a second per write), and one after
const EARLIER = '2026-02-01T08:00:00.000Z';
const LATER = '2026-02-20T08:00:00.000Z';
const FUTURE = '2100-01-01T00:00:00.000Z';
const OTHER_KEY = keyOf('manga', 8);

const STORED = entryOf({ progress: 3, notes: 'stored', updatedAt: EARLIER });

const setup = (seed: readonly LibraryEntry[] = []) => {
  const library = createAccountLibrary();
  server.use(library.backend.handler);
  seedEntries(library.backend, seed);
  return library;
};

const save = (entry: LibraryEntry): LibraryQueuedWrite => ({ type: 'save', entry });
const removal = (removedAt: string, key: MediaKey = ENTRY_KEY): LibraryQueuedWrite => ({
  type: 'remove',
  key,
  removedAt,
});

describe('replayWrites requests', () => {
  it('calls the replay function once with the user id as a guard and each write with its time', async () => {
    const { backend, repository } = setup([STORED]);
    const saved = entryOf({ key: OTHER_KEY, updatedAt: LATER });

    await repository.replayWrites([save(saved), removal(LATER)]);

    expect(backend.requests).toHaveLength(1);
    const [call] = backend.requests;
    expect(call?.endpoint).toBe(REPLAY_ENDPOINT);
    expect(call?.method).toBe('POST');
    expect([...(call?.search.keys() ?? [])]).toStrictEqual([]);
    expect(call?.body).toStrictEqual({
      expected_user_id: USER_ID,
      writes: [
        { op: 'save', ...toLibraryRowPayload(saved), updated_at: LATER },
        {
          op: 'remove',
          id_namespace: 'mal',
          media_kind: 'anime',
          external_id: 52991,
          updated_at: LATER,
        },
      ],
    });
  });

  it('sends each time in the Date#toISOString form', async () => {
    const { backend, repository } = setup();

    await repository.replayWrites([
      save(entryOf({ updatedAt: '2026-02-20T09:00:00+01:00' })),
      removal('2026-02-20T09:00:00.000000+01:00', OTHER_KEY),
    ]);

    expect(backend.requests[0]?.body).toMatchObject({
      writes: [{ updated_at: LATER }, { updated_at: LATER }],
    });
  });

  it('sends nothing for an empty list, not even a session read', async () => {
    const { backend, repository, client } = setup();
    const getSession = jest.spyOn(client.auth, 'getSession');

    await expect(repository.replayWrites([])).resolves.toStrictEqual([]);

    expect(getSession).not.toHaveBeenCalled();
    expect(backend.requests).toStrictEqual([]);
  });

  it('replays LIBRARY_REPLAY_BATCH_SIZE writes in one call', async () => {
    const { backend, repository } = setup();
    const writes = Array.from({ length: LIBRARY_REPLAY_BATCH_SIZE }, (_, index) =>
      removal(LATER, keyOf('anime', index + 1)),
    );

    await expect(repository.replayWrites(writes)).resolves.toHaveLength(LIBRARY_REPLAY_BATCH_SIZE);
    expect(backend.requests).toHaveLength(1);
  });

  it.each([
    {
      label: 'more than LIBRARY_REPLAY_BATCH_SIZE writes',
      writes: Array.from({ length: LIBRARY_REPLAY_BATCH_SIZE + 1 }, (_, index) =>
        removal(LATER, keyOf('anime', index + 1)),
      ),
    },
    ...INVALID_ENTRIES.map(({ label, entry }) => ({
      label: `a save of ${label}`,
      writes: [removal(LATER, OTHER_KEY), save(entry)],
    })),
    {
      label: 'a removal of an invalid key',
      writes: [removal(LATER, { ...ENTRY_KEY, externalId: 0 })],
    },
    { label: 'a removal at an invalid time', writes: [removal('yesterday')] },
    { label: 'a removal at a time without offset', writes: [removal('2026-02-20T08:00:00')] },
    { label: 'two writes of one key', writes: [save(STORED), removal(LATER)] },
  ])('rejects $label with a RangeError, before any session read or request', async ({ writes }) => {
    const { backend, repository, client, captureError } = setup();
    const getSession = jest.spyOn(client.auth, 'getSession');

    const error = await repository.replayWrites(writes).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RangeError);
    expect(String(error)).not.toMatch(/52991|Frieren|finale/);
    expect(getSession).not.toHaveBeenCalled();
    expect(backend.requests).toStrictEqual([]);
    expect(captureError).not.toHaveBeenCalled();
  });
});

describe('replayWrites saves (BR-08)', () => {
  it('inserts a save of a key the account does not hold, at its own time', async () => {
    const { backend, repository } = setup();
    const saved = entryOf({ updatedAt: LATER });

    await expect(repository.replayWrites([save(saved)])).resolves.toStrictEqual(['written']);

    expect(instantOf(backend.rows[0]?.updated_at)).toBe(instantOf(LATER));
    await expect(repository.get(ENTRY_KEY)).resolves.toMatchObject({ progress: saved.progress });
  });

  it.each([
    { label: 'a later save', time: LATER, outcome: 'written', progress: 13 },
    { label: 'an earlier save', time: '2026-01-20T08:00:00.000Z', outcome: 'kept', progress: 3 },
    { label: 'a save at the stored time', time: EARLIER, outcome: 'kept', progress: 3 },
  ])('answers $outcome for $label', async ({ time, outcome, progress }) => {
    const { repository } = setup([STORED]);

    await expect(
      repository.replayWrites([save(entryOf({ progress: 13, updatedAt: time }))]),
    ).resolves.toStrictEqual([outcome]);

    await expect(repository.get(ENTRY_KEY)).resolves.toMatchObject({ progress });
  });

  it('caps a future time at the server time of the call', async () => {
    const { backend, repository } = setup();

    await repository.replayWrites([save(entryOf({ updatedAt: FUTURE }))]);

    const [row] = backend.rows;
    expect(row?.updated_at).toBe(row?.created_at);
    expect((instantOf(row?.updated_at) ?? Infinity) < (instantOf(FUTURE) ?? 0)).toBe(true);
  });
});

describe('replayWrites removals (BR-08)', () => {
  it.each([
    { label: 'a later removal', time: LATER, outcome: 'written', rows: 0 },
    { label: 'an earlier removal', time: '2026-01-20T08:00:00.000Z', outcome: 'kept', rows: 1 },
    { label: 'a removal at the stored time', time: EARLIER, outcome: 'kept', rows: 1 },
  ])('answers $outcome for $label', async ({ time, outcome, rows }) => {
    const { backend, repository } = setup([STORED]);

    await expect(repository.replayWrites([removal(time)])).resolves.toStrictEqual([outcome]);

    expect(backend.rows).toHaveLength(rows);
  });

  it('answers written for a removal of a key the account does not hold', async () => {
    const { backend, repository } = setup([STORED]);

    await expect(repository.replayWrites([removal(LATER, OTHER_KEY)])).resolves.toStrictEqual([
      'written',
    ]);
    expect(backend.rows).toHaveLength(1);
  });

  it('caps a future removal at the server time: a row newer than the call is kept', async () => {
    const { backend, repository } = setup([entryOf({ updatedAt: FUTURE })]);

    await expect(
      repository.replayWrites([removal('2100-01-02T00:00:00.000Z')]),
    ).resolves.toStrictEqual(['kept']);
    expect(backend.rows).toHaveLength(1);
  });
});

describe('replayWrites outcomes', () => {
  it('answers each write in input order', async () => {
    const { repository } = setup([STORED]);

    await expect(
      repository.replayWrites([
        removal(LATER, OTHER_KEY),
        save(entryOf({ updatedAt: '2026-01-20T08:00:00.000Z' })),
        save(entryOf({ key: keyOf('anime', 1), updatedAt: LATER })),
      ]),
    ).resolves.toStrictEqual(['written', 'kept', 'written']);
  });

  it('follows the input order whatever the order of the answer', async () => {
    const { backend, repository } = setup();
    const answerRow = (externalId: number, outcome: string) => ({
      id_namespace: 'mal',
      media_kind: 'anime',
      external_id: externalId,
      user_id: USER_ID,
      outcome,
    });
    backend.respondNext(
      () => HttpResponse.json([answerRow(2, 'kept'), answerRow(1, 'written')], { status: 200 }),
      'POST',
    );

    await expect(
      repository.replayWrites([
        removal(LATER, keyOf('anime', 1)),
        removal(LATER, keyOf('anime', 2)),
      ]),
    ).resolves.toStrictEqual(['written', 'kept']);
  });

  it('reaches the same values when the same writes are replayed again', async () => {
    const { backend, repository } = setup([
      STORED,
      entryOf({ key: OTHER_KEY, updatedAt: EARLIER }),
    ]);
    const writes = [save(entryOf({ progress: 13, updatedAt: LATER })), removal(LATER, OTHER_KEY)];

    await expect(repository.replayWrites(writes)).resolves.toStrictEqual(['written', 'written']);
    const first = await repository.list();
    await expect(repository.replayWrites(writes)).resolves.toStrictEqual(['kept', 'written']);

    await expect(repository.list()).resolves.toStrictEqual(first);
    expect(backend.rows).toHaveLength(1);
  });

  it("never reads, writes or removes another user's row of the key", async () => {
    const { backend, repository } = setup();
    seedEntries(backend, [entryOf({ progress: 7, updatedAt: EARLIER })], OTHER_USER_ID);
    seedEntries(backend, [entryOf({ key: OTHER_KEY, updatedAt: EARLIER })], OTHER_USER_ID);

    await expect(
      repository.replayWrites([save(entryOf({ updatedAt: LATER })), removal(LATER, OTHER_KEY)]),
    ).resolves.toStrictEqual(['written', 'written']);

    const others = backend.rows.filter((row) => row.user_id === OTHER_USER_ID);
    expect(others).toHaveLength(2);
    expect(others.map((row) => row.progress)).toContain(7);
    expect(backend.rows.filter((row) => row.user_id === USER_ID)).toHaveLength(1);
  });
});
