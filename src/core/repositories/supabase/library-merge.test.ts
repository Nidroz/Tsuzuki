import { describe, expect, it, jest } from '@jest/globals';

import {
  GUEST_ONLY,
  describeAccountLibraryMergeContract,
  listedValues,
  valuesOf,
} from '../../../../test/core/account-library-merge-contract';
import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import { INVALID_ENTRIES } from '../../../../test/core/library-repository-contract-support';
import { server } from '../../../../test/core/msw-server';
import type { LibraryEntry } from '../../domain/library-entry';
import { createAccountLibrary, seedEntries } from './__fixtures__/account-library';
import { USER_ID } from './__fixtures__/auth-handlers';
import { MERGE_ENDPOINT, type LibraryRequest } from './__fixtures__/library-handlers';
import { instantOf, isRecord } from './__fixtures__/postgrest-fake';
import { GUEST_MERGE_BATCH_SIZE } from './library-merge';
import { toLibraryRowPayload } from './library-row';

// times before the fake's server clock (2026-03-01T09:00:00Z, a second per write), and one after
const EARLIER = '2026-02-01T08:00:00.000Z';
const LATER = '2026-02-20T08:00:00.000Z';
const FUTURE = '2100-01-01T00:00:00.000Z';

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

const animeEntries = (count: number): LibraryEntry[] =>
  Array.from({ length: count }, (_, index) => entryOf({ key: keyOf('anime', index + 1) }));

// the `entries` argument of a merge call
const entriesOf = (request: LibraryRequest | undefined): unknown[] => {
  const entries = isRecord(request?.body) ? request.body.entries : null;
  return Array.isArray(entries) ? entries : [];
};

describeAccountLibraryMergeContract('supabase account', (seed) => setup(seed).repository);

describe('mergeGuestEntries requests', () => {
  it('calls the merge function once with every writable column and the time of each entry', async () => {
    const { backend, repository } = setup();
    const entries = [GUEST_ONLY, entryOf({ key: keyOf('manga', 7), updatedAt: EARLIER })];

    await repository.mergeGuestEntries(entries);

    expect(backend.requests).toHaveLength(1);
    const [call] = backend.requests;
    expect(call?.endpoint).toBe(MERGE_ENDPOINT);
    expect(call?.method).toBe('POST');
    expect([...(call?.search.keys() ?? [])]).toStrictEqual([]);
    expect(call?.body).toStrictEqual({
      entries: entries.map((entry) => ({
        ...toLibraryRowPayload(entry),
        updated_at: entry.updatedAt,
      })),
    });
  });

  it('never sends the user id, the row id or created_at: the database takes the user from the token', async () => {
    const { backend, repository } = setup();

    await repository.mergeGuestEntries([GUEST_ONLY]);

    const [sent] = entriesOf(backend.requests[0]);
    expect(Object.keys(isRecord(sent) ? sent : {}).sort()).toStrictEqual(
      [...Object.keys(toLibraryRowPayload(GUEST_ONLY)), 'updated_at'].sort(),
    );
    for (const column of ['user_id', 'id', 'created_at']) {
      expect(sent).not.toHaveProperty(column);
    }
  });

  it('sends each time in the Date#toISOString form', async () => {
    const { backend, repository } = setup();

    await repository.mergeGuestEntries([{ ...GUEST_ONLY, updatedAt: '2026-02-20T09:00:00+01:00' }]);

    expect(entriesOf(backend.requests[0])).toMatchObject([{ updated_at: LATER }]);
  });

  it('merges 250 entries in batches of 100, 100 and 50, one call each', async () => {
    const { backend, repository } = setup();

    await repository.mergeGuestEntries(animeEntries(250));

    expect(GUEST_MERGE_BATCH_SIZE).toBe(100);
    expect(backend.requests.map(({ endpoint }) => endpoint)).toStrictEqual([
      MERGE_ENDPOINT,
      MERGE_ENDPOINT,
      MERGE_ENDPOINT,
    ]);
    expect(backend.requests.map((request) => entriesOf(request).length)).toStrictEqual([
      100, 100, 50,
    ]);
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

describe('mergeGuestEntries times (BR-08)', () => {
  it('keeps the guest time on a replaced row', async () => {
    const { backend, repository } = setup([ACCOUNT_ENTRY]);

    await repository.mergeGuestEntries([GUEST_ENTRY]);

    expect(backend.rows).toHaveLength(1);
    expect(instantOf(backend.rows[0]?.updated_at)).toBe(instantOf(LATER));
    await expect(repository.list()).resolves.toStrictEqual([GUEST_ENTRY]);
  });

  it('caps a future guest time at the server time of the call', async () => {
    const { backend, repository } = setup();

    await repository.mergeGuestEntries([{ ...GUEST_ONLY, updatedAt: FUTURE }]);

    // the row was inserted at the server time of the call, which is also its updated_at
    const [row] = backend.rows;
    expect(row?.updated_at).toBe(row?.created_at);
    const [merged] = await repository.list();
    expect(merged?.updatedAt).toBe(merged?.createdAt);
    expect((merged?.updatedAt ?? FUTURE) < FUTURE).toBe(true);
  });

  // the same media changed as a guest on a phone, then on a tablet
  const PHONE_CHANGE = entryOf({ progress: 2, notes: 'on the phone', updatedAt: EARLIER });
  const TABLET_CHANGE = entryOf({ progress: 9, notes: 'on the tablet', updatedAt: LATER });

  it.each([
    { label: 'second', first: PHONE_CHANGE, second: TABLET_CHANGE },
    { label: 'first', first: TABLET_CHANGE, second: PHONE_CHANGE },
  ])(
    'keeps the most recent change of two devices of the user merged $label',
    async ({ first, second }) => {
      const phone = setup();
      const tablet = createAccountLibrary({ backend: phone.backend });

      await phone.repository.mergeGuestEntries([first]);
      await tablet.repository.mergeGuestEntries([second]);

      await expect(listedValues(phone.repository)).resolves.toStrictEqual([
        valuesOf(TABLET_CHANGE),
      ]);
      expect(phone.backend.rows).toMatchObject([{ user_id: USER_ID }]);
    },
  );
});
