import { describe, expect, it, jest } from '@jest/globals';
import { HttpResponse } from 'msw';

import {
  GUEST_ONLY,
  describeAccountLibraryMergeContract,
} from '../../../../test/core/account-library-merge-contract';
import { ENTRY_KEY, entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import { INVALID_ENTRIES } from '../../../../test/core/library-repository-contract-support';
import { server } from '../../../../test/core/msw-server';
import type { LibraryEntry } from '../../domain/library-entry';
import { createAccountLibrary, seedEntries } from './__fixtures__/account-library';
import { USER_ID } from './__fixtures__/auth-handlers';
import type { LibraryRequest } from './__fixtures__/library-handlers';
import {
  LIBRARY_CONFLICT_COLUMNS,
  rowOfEntry,
  type LibraryRow,
} from './__fixtures__/postgrest-fake';
import { GUEST_MERGE_INSERT_BATCH_SIZE } from './library-merge';
import { LIBRARY_PAGE_SIZE } from './library-requests';
import { toLibraryRowPayload, toLibraryRowValues } from './library-row';

const EARLIER = '2026-02-01T08:00:00.000Z';
const BETWEEN = '2026-02-10T08:00:00.000Z';
const LATER = '2026-02-20T08:00:00.000Z';
const WRITTEN_COLUMNS = 'id_namespace,media_kind,external_id,user_id';

// an account entry of ENTRY_KEY and a newer guest entry of the same key
const ACCOUNT_ENTRY = entryOf({ progress: 3, updatedAt: EARLIER });
const GUEST_ENTRY = entryOf({ progress: 13, notes: 'later on the device', updatedAt: LATER });

/** an account store over a fresh fake holding `seed`. */
const setup = (seed: readonly LibraryEntry[] = []) => {
  const library = createAccountLibrary();
  server.use(library.backend.handler);
  seedEntries(library.backend, seed);
  return library;
};

const methodsOf = (requests: readonly LibraryRequest[]) =>
  requests.map((request) => request.method);

/** a page as postgrest answers it, with its Content-Range. */
const pageOf = (rows: readonly LibraryRow[], contentRange: string) => () =>
  HttpResponse.json(rows, { headers: { 'Content-Range': contentRange } });

const animeEntries = (count: number): LibraryEntry[] =>
  Array.from({ length: count }, (_, index) => entryOf({ key: keyOf('anime', index + 1) }));

describeAccountLibraryMergeContract('supabase account', (seed) => setup(seed).repository);

describe('mergeGuestEntries requests', () => {
  it('reads the key and time of every row of its user in key order, counting them', async () => {
    const { backend, repository } = setup();

    await repository.mergeGuestEntries([GUEST_ONLY]);

    const [read] = backend.requests;
    expect(read?.method).toBe('GET');
    expect(read?.search.get('select')).toBe('id_namespace,media_kind,external_id,updated_at');
    expect(read?.search.get('user_id')).toBe(`eq.${USER_ID}`);
    expect(read?.search.get('order')).toBe('id_namespace.asc,media_kind.asc,external_id.asc');
    expect(read?.search.get('offset')).toBe('0');
    expect(read?.search.get('limit')).toBe(String(LIBRARY_PAGE_SIZE));
    expect(read?.prefer).toBe('count=exact');
  });

  it('inserts new entries ignoring existing keys, asking for the key and owner of each row', async () => {
    const { backend, repository } = setup();
    const entries = [GUEST_ONLY, entryOf({ key: keyOf('manga', 7) })];

    await repository.mergeGuestEntries(entries);

    expect(methodsOf(backend.requests)).toStrictEqual(['GET', 'POST']);
    const insert = backend.requests[1];
    expect(insert?.search.get('on_conflict')).toBe(LIBRARY_CONFLICT_COLUMNS);
    expect(insert?.search.get('select')).toBe(WRITTEN_COLUMNS);
    expect(insert?.search.get('columns')).toBe(
      Object.keys(toLibraryRowPayload(GUEST_ONLY))
        .map((column) => `"${column}"`)
        .join(','),
    );
    expect(insert?.prefer).toBe('resolution=ignore-duplicates, return=representation');
    expect(insert?.body).toStrictEqual(entries.map((entry) => toLibraryRowPayload(entry)));
  });

  it('replaces a newer guest entry with an update conditional on the account time', async () => {
    const { backend, repository } = setup([ACCOUNT_ENTRY]);

    await repository.mergeGuestEntries([GUEST_ENTRY]);

    expect(methodsOf(backend.requests)).toStrictEqual(['GET', 'PATCH']);
    const update = backend.requests[1];
    expect(Object.fromEntries(update?.search ?? [])).toStrictEqual({
      user_id: `eq.${USER_ID}`,
      id_namespace: 'eq.mal',
      media_kind: 'eq.anime',
      external_id: `eq.${String(ENTRY_KEY.externalId)}`,
      updated_at: `lt.${LATER}`,
      select: WRITTEN_COLUMNS,
    });
    expect(update?.prefer).toBe('return=representation');
    expect(update?.body).toStrictEqual(toLibraryRowValues(GUEST_ENTRY));
    for (const column of [
      'id_namespace',
      'media_kind',
      'external_id',
      'created_at',
      'updated_at',
    ]) {
      expect(update?.body).not.toHaveProperty(column);
    }
  });

  it('writes nothing for a guest entry as recent as the account one', async () => {
    const { backend, repository } = setup([ACCOUNT_ENTRY]);

    await repository.mergeGuestEntries([{ ...GUEST_ENTRY, updatedAt: EARLIER }]);

    expect(methodsOf(backend.requests)).toStrictEqual(['GET']);
  });

  it('merges into a new account with one read and one insert', async () => {
    const { backend, repository } = setup();

    await repository.mergeGuestEntries(animeEntries(3));

    expect(methodsOf(backend.requests)).toStrictEqual(['GET', 'POST']);
    expect(backend.rows).toHaveLength(3);
  });

  it('inserts 250 new entries in batches of 100, 100 and 50', async () => {
    const { backend, repository } = setup();

    await repository.mergeGuestEntries(animeEntries(250));

    expect(GUEST_MERGE_INSERT_BATCH_SIZE).toBe(100);
    expect(methodsOf(backend.requests)).toStrictEqual(['GET', 'POST', 'POST', 'POST']);
    const batchSizes = backend.requests
      .slice(1)
      .map((request) => (Array.isArray(request.body) ? request.body.length : null));
    expect(batchSizes).toStrictEqual([100, 100, 50]);
    expect(backend.rows).toHaveLength(250);
  });

  it('sends nothing for an empty list, not even a session read', async () => {
    const { backend, repository, client } = setup();
    const getSession = jest.spyOn(client.auth, 'getSession');

    await expect(repository.mergeGuestEntries([])).resolves.toBeUndefined();

    expect(getSession).not.toHaveBeenCalled();
    expect(backend.requests).toStrictEqual([]);
  });

  it.each([
    {
      label: 'an invalid entry',
      entries: [GUEST_ONLY, ...INVALID_ENTRIES.map(({ entry }) => entry)],
    },
    { label: 'two entries of one key', entries: [GUEST_ENTRY, ACCOUNT_ENTRY] },
  ])('rejects $label before any session read or request', async ({ entries }) => {
    const { backend, repository, client, captureError } = setup();
    const getSession = jest.spyOn(client.auth, 'getSession');

    await expect(repository.mergeGuestEntries(entries)).rejects.toBeInstanceOf(RangeError);

    expect(getSession).not.toHaveBeenCalled();
    expect(backend.requests).toStrictEqual([]);
    expect(captureError).not.toHaveBeenCalled();
  });
});

describe('mergeGuestEntries account read', () => {
  it('reads every page, the offset advanced by the rows received', async () => {
    const { backend, repository } = setup(animeEntries(20));
    backend.setMaxRows(7);

    await repository.mergeGuestEntries([entryOf({ key: keyOf('anime', 21) })]);

    expect(methodsOf(backend.requests)).toStrictEqual(['GET', 'GET', 'GET', 'POST']);
    expect(
      backend.requests.slice(0, 3).map((request) => request.search.get('offset')),
    ).toStrictEqual(['0', '7', '14']);
  });

  const earlier = rowOfEntry(USER_ID, 1, { ...ACCOUNT_ENTRY, updatedAt: EARLIER });
  const later = rowOfEntry(USER_ID, 1, { ...ACCOUNT_ENTRY, updatedAt: LATER });
  const other = rowOfEntry(USER_ID, 2, entryOf({ key: keyOf('manga', 1) }));

  it.each([
    { label: 'second', firstRead: earlier, secondRead: later },
    { label: 'first', firstRead: later, secondRead: earlier },
  ])(
    'keeps the latest time of a row read twice, read $label',
    async ({ firstRead, secondRead }) => {
      const { backend, repository } = setup();
      backend.respondNext(pageOf([firstRead, other], '0-1/3'), 'GET');
      backend.respondNext(pageOf([secondRead], '2-2/3'), 'GET');

      await repository.mergeGuestEntries([{ ...GUEST_ENTRY, updatedAt: BETWEEN }]);

      // the account copy is newer than the guest one: nothing is written
      expect(methodsOf(backend.requests)).toStrictEqual(['GET', 'GET']);
    },
  );
});
