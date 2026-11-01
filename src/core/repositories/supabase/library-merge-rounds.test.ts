import { describe, expect, it } from '@jest/globals';
import { HttpResponse, type JsonBodyType } from 'msw';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import { failureOf } from '../../../../test/core/library-repository-contract-support';
import { server } from '../../../../test/core/msw-server';
import type { LibraryEntry } from '../../domain/library-entry';
import { OTHER_USER_ID, createAccountLibrary, seedEntries } from './__fixtures__/account-library';
import { USER_ID } from './__fixtures__/auth-handlers';
import type { LibraryRequest } from './__fixtures__/library-handlers';
import { rowOfEntry } from './__fixtures__/postgrest-fake';
import { GUEST_MERGE_MAX_ROUNDS } from './library-merge';

const EARLIER = '2026-02-01T08:00:00.000Z';
const LATER = '2026-02-20T08:00:00.000Z';
// a write from another device, after the guest change
const CONCURRENT = '2026-02-25T08:00:00.000Z';

// an account entry of ENTRY_KEY, a newer guest entry of the same key, and a new one
const ACCOUNT_ENTRY = entryOf({ progress: 3, updatedAt: EARLIER });
const GUEST_ENTRY = entryOf({ progress: 13, updatedAt: LATER });
const NEW_ENTRY = entryOf({ key: keyOf('manga', 8), updatedAt: LATER });

/** an account store over a fresh fake holding `seed`. */
const setup = (seed: readonly LibraryEntry[] = []) => {
  const library = createAccountLibrary();
  server.use(library.backend.handler);
  seedEntries(library.backend, seed);
  return library;
};

const methodsOf = (requests: readonly LibraryRequest[]) =>
  requests.map((request) => request.method);

// the row of ENTRY_KEY as another device wrote it, at `updatedAt`
const concurrentRow = (updatedAt: string) =>
  rowOfEntry(USER_ID, 1, entryOf({ progress: 20, notes: 'other device', updatedAt }));

// a written row as postgrest returns it for the merge's select
const writtenRow = (userId: string, overrides: Record<string, unknown> = {}) => ({
  id_namespace: 'mal',
  media_kind: 'anime',
  external_id: 52991,
  user_id: userId,
  ...overrides,
});

const answer = (status: number, body: JsonBodyType) => () => HttpResponse.json(body, { status });

describe('mergeGuestEntries concurrent writes', () => {
  it('keeps a newer row another device inserted after the read, in the next round', async () => {
    const { backend, repository, captureError } = setup();
    const concurrent = concurrentRow(CONCURRENT);
    backend.changeBefore('POST', () => {
      backend.seed(concurrent);
    });

    await repository.mergeGuestEntries([GUEST_ENTRY]);

    expect(methodsOf(backend.requests)).toStrictEqual(['GET', 'POST', 'GET']);
    expect(backend.rows).toStrictEqual([concurrent]);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('keeps a row another device made newer after the read, in the next round', async () => {
    const { backend, repository } = setup([ACCOUNT_ENTRY]);
    const concurrent = concurrentRow(CONCURRENT);
    backend.changeBefore('PATCH', () => {
      backend.rows.splice(0, 1, concurrent);
    });

    await repository.mergeGuestEntries([GUEST_ENTRY]);

    expect(methodsOf(backend.requests)).toStrictEqual(['GET', 'PATCH', 'GET']);
    expect(backend.rows).toStrictEqual([concurrent]);
  });

  // the update matches no row, so the entry is not confirmed: the next round reads no row of its
  // key and inserts it, so it is never left out of the account while the merge resolves
  it('inserts an entry whose row another device deleted after the read, in the next round', async () => {
    const { backend, repository, captureError } = setup([ACCOUNT_ENTRY]);
    backend.changeBefore('PATCH', () => {
      backend.rows.splice(0, 1);
    });

    await repository.mergeGuestEntries([GUEST_ENTRY]);

    expect(methodsOf(backend.requests)).toStrictEqual(['GET', 'PATCH', 'GET', 'POST']);
    expect(backend.rows).toHaveLength(1);
    expect(backend.rows[0]).toMatchObject({
      user_id: USER_ID,
      external_id: GUEST_ENTRY.key.externalId,
      progress: GUEST_ENTRY.progress,
    });
    expect(captureError).not.toHaveBeenCalled();
  });

  // the server keeps microseconds, the guest time milliseconds (ADR-0016)
  it.each([
    { stored: '2026-02-20T08:00:00.123456+00:00', guest: '2026-02-20T08:00:00.123Z', rounds: 2 },
    { stored: '2026-02-20T08:00:00.123456+00:00', guest: '2026-02-20T08:00:00.124Z', rounds: 1 },
  ])(
    'compares a row changed at $stored with a guest time of $guest as instants',
    async ({ stored, guest, rounds }) => {
      const { backend, repository } = setup([ACCOUNT_ENTRY]);
      const concurrent = { ...concurrentRow(CONCURRENT), updated_at: stored };
      backend.changeBefore('PATCH', () => {
        backend.rows.splice(0, 1, concurrent);
      });

      await repository.mergeGuestEntries([{ ...GUEST_ENTRY, updatedAt: guest }]);

      const reads = methodsOf(backend.requests).filter((method) => method === 'GET');
      expect(reads).toHaveLength(rounds);
      expect(backend.rows[0]?.progress).toBe(rounds === 1 ? GUEST_ENTRY.progress : 20);
    },
  );

  it('rejects an entry still unresolved after the last round with unknown, reported once', async () => {
    const { backend, repository, captureError } = setup();
    // a row it cannot read: its entry goes to the insert, which never overwrites it
    const unreadable = { ...rowOfEntry(USER_ID, 1, ACCOUNT_ENTRY), updated_at: 'yesterday' };
    backend.seed(unreadable);

    const error = await failureOf(repository.mergeGuestEntries([GUEST_ENTRY, NEW_ENTRY]));

    expect(error).toMatchObject({ name: 'LibraryRemoteError', reason: 'unknown' });
    expect(GUEST_MERGE_MAX_ROUNDS).toBe(3);
    expect(methodsOf(backend.requests)).toStrictEqual([
      'GET',
      'POST',
      'GET',
      'POST',
      'GET',
      'POST',
    ]);
    expect(backend.rows[0]).toStrictEqual(unreadable);
    expect(backend.rows).toHaveLength(2);
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(error, {
      source: 'library-remote',
      tags: { operation: 'merge' },
    });
  });
});

describe('mergeGuestEntries written rows', () => {
  it("rejects an inserted row of another user's with signed-out, never reported", async () => {
    const { backend, repository, captureError } = setup([ACCOUNT_ENTRY]);
    backend.respondNext(answer(201, [writtenRow(OTHER_USER_ID)]), 'POST');

    const error = await failureOf(repository.mergeGuestEntries([NEW_ENTRY, GUEST_ENTRY]));

    expect(error).toMatchObject({ name: 'LibraryRemoteError', reason: 'signed-out' });
    expect(String(error)).not.toContain(OTHER_USER_ID);
    // stops at once: the guest entry of the account row is not replaced
    expect(methodsOf(backend.requests)).toStrictEqual(['GET', 'POST']);
    expect(captureError).not.toHaveBeenCalled();
  });

  it("rejects an updated row of another user's with signed-out", async () => {
    const { backend, repository, captureError } = setup([ACCOUNT_ENTRY]);
    backend.respondNext(answer(200, [writtenRow(OTHER_USER_ID)]), 'PATCH');

    await expect(repository.mergeGuestEntries([GUEST_ENTRY])).rejects.toMatchObject({
      reason: 'signed-out',
    });
    expect(captureError).not.toHaveBeenCalled();
  });

  it('confirms only the rows of its own user and batch', async () => {
    const { backend, repository } = setup();
    const unknownKey = writtenRow(USER_ID, { external_id: 404 });
    // the first insert answers a row of a key it did not send: its entry is inserted next round
    backend.respondNext(answer(201, [unknownKey]), 'POST');

    await repository.mergeGuestEntries([GUEST_ENTRY]);

    expect(methodsOf(backend.requests)).toStrictEqual(['GET', 'POST', 'GET', 'POST']);
    expect(backend.rows).toHaveLength(1);
  });

  it.each([
    { label: 'a write without rows', status: 201, body: null, method: 'POST' },
    {
      label: 'a row without its owner',
      status: 201,
      body: [{ external_id: 52991 }],
      method: 'POST',
    },
    {
      label: 'a row of an unknown kind',
      status: 200,
      body: [writtenRow(USER_ID, { media_kind: 'novel' })],
      method: 'PATCH',
    },
  ])('rejects $label with unknown, reported with its status', async ({ status, body, method }) => {
    const { backend, repository, captureError } = setup([ACCOUNT_ENTRY]);
    backend.respondNext(
      body === null ? () => new HttpResponse(null, { status }) : answer(status, body),
      method,
    );

    const error = await failureOf(repository.mergeGuestEntries([NEW_ENTRY, GUEST_ENTRY]));

    expect(error).toMatchObject({ reason: 'unknown' });
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(error, {
      source: 'library-remote',
      tags: { operation: 'merge', status: String(status) },
    });
  });
});
