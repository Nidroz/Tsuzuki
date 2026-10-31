import { describe, expect, it } from '@jest/globals';
import { HttpResponse } from 'msw';

import {
  ENTRY_KEY,
  NOTES_TEXT,
  TITLE_TEXT,
  entryOf,
  entryWithMedia,
  keyOf,
} from '../../../../test/core/library-entry-fixtures';
import { describeLibraryRepositoryContract } from '../../../../test/core/library-repository-contract';
import { failureOf } from '../../../../test/core/library-repository-contract-support';
import { server } from '../../../../test/core/msw-server';
import { LibraryRemoteError } from '../../errors/library-errors';
import { createAccountLibrary, type AccountLibraryOptions } from './__fixtures__/account-library';
import { USER_ID } from './__fixtures__/auth-handlers';
import {
  LIBRARY_CONFLICT_COLUMNS,
  defaultRow,
  type LibraryRow,
} from './__fixtures__/library-handlers';
import { LIBRARY_PAGE_SIZE } from './library-repository';
import { LIBRARY_ROW_COLUMNS } from './library-row';

const SEEDED_AT = '2026-02-01T08:00:00.000000+00:00';

const setup = (options?: AccountLibraryOptions) => {
  const library = createAccountLibrary(options);
  server.use(library.backend.handler);
  return library;
};

/** a stored row of USER_ID for the anime `externalId`, with `overrides`. */
const rowOf = (externalId: number, overrides: Partial<LibraryRow> = {}): LibraryRow => ({
  ...defaultRow(USER_ID, externalId, SEEDED_AT),
  ...overrides,
});

/** a page as postgrest answers it, with its Content-Range. */
const pageOf = (rows: readonly LibraryRow[], contentRange: string) => () =>
  HttpResponse.json(rows, { headers: { 'Content-Range': contentRange } });

const offsetsOf = (requests: ReturnType<typeof setup>['backend']['requests']) =>
  requests.map((request) => request.search.get('offset'));

describeLibraryRepositoryContract('supabase account', () => setup().repository);

describe('createSupabaseLibraryRepository requests', () => {
  it('reads the explicit columns of its user in the total order, counting the rows', async () => {
    const { backend, repository } = setup();

    await repository.list();

    const [request] = backend.requests;
    expect(request?.method).toBe('GET');
    expect(request?.search.get('select')).toBe(LIBRARY_ROW_COLUMNS.replaceAll(' ', ''));
    expect(request?.search.get('user_id')).toBe(`eq.${USER_ID}`);
    expect(request?.search.get('order')).toBe(
      'updated_at.desc,id_namespace.asc,media_kind.asc,external_id.asc',
    );
    expect(request?.search.get('limit')).toBe(String(LIBRARY_PAGE_SIZE));
    expect(request?.prefer).toBe('count=exact');
  });

  it('gets one key of its user', async () => {
    const { backend, repository } = setup();

    await repository.get(ENTRY_KEY);

    const search = backend.requests[0]?.search;
    expect(search?.get('user_id')).toBe(`eq.${USER_ID}`);
    expect(search?.get('id_namespace')).toBe('eq.mal');
    expect(search?.get('media_kind')).toBe('eq.anime');
    expect(search?.get('external_id')).toBe(`eq.${String(ENTRY_KEY.externalId)}`);
  });

  it('deletes one key of its user, asking for no row', async () => {
    const { backend, repository } = setup();

    await expect(repository.remove(ENTRY_KEY)).resolves.toBeUndefined();

    const [request] = backend.requests;
    expect(request?.method).toBe('DELETE');
    expect(request?.prefer).toBeNull();
    expect([...(request?.search.keys() ?? [])].sort()).toStrictEqual([
      'external_id',
      'id_namespace',
      'media_kind',
      'user_id',
    ]);
    expect(request?.search.get('user_id')).toBe(`eq.${USER_ID}`);
  });

  it.each([false, true])(
    'upserts every writable column on the media key, media_is_adult %p included',
    async (isAdult) => {
      const { backend, repository } = setup();

      await repository.save(entryWithMedia({ isAdult }));

      const [request] = backend.requests;
      expect(request?.method).toBe('POST');
      expect(request?.search.get('on_conflict')).toBe(LIBRARY_CONFLICT_COLUMNS);
      expect(request?.search.get('select')).toBe(LIBRARY_ROW_COLUMNS.replaceAll(' ', ''));
      expect(request?.prefer).toBe('resolution=merge-duplicates, return=representation');
      expect(request?.accept).toBe('application/vnd.pgrst.object+json');
      expect(request?.body).toMatchObject({ id_namespace: 'mal', media_is_adult: isAdult });
      expect(Object.keys(request?.body ?? {}).sort()).toStrictEqual(
        LIBRARY_ROW_COLUMNS.split(', ')
          .filter((column) => !['created_at', 'updated_at'].includes(column))
          .sort(),
      );
    },
  );

  it('resolves to the server timestamps, keeping createdAt on a replace', async () => {
    const { repository } = setup();

    const first = await repository.save(entryOf());
    const second = await repository.save(entryOf({ progress: 13 }));

    expect(first.createdAt).toBe('2026-03-01T09:00:01.000Z');
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBe('2026-03-01T09:00:02.000Z');
  });
});

describe('createSupabaseLibraryRepository list paging', () => {
  it('reads every page of a library larger than the page size', async () => {
    const { backend, repository } = setup();
    const total = LIBRARY_PAGE_SIZE * 2 + 100;
    backend.seed(...Array.from({ length: total }, (_, index) => rowOf(index + 1)));

    const entries = await repository.list();

    expect(entries).toHaveLength(total);
    expect(offsetsOf(backend.requests)).toStrictEqual(['0', '1000', '2000']);
  });

  it('never takes a page shortened by a lower max_rows for the end', async () => {
    const { backend, repository } = setup();
    backend.setMaxRows(7);
    backend.seed(...Array.from({ length: 20 }, (_, index) => rowOf(index + 1)));

    const entries = await repository.list();

    expect(entries.map((entry) => entry.key.externalId)).toStrictEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    expect(offsetsOf(backend.requests)).toStrictEqual(['0', '7', '14']);
  });

  it('stops at a page without rows, whatever the count says', async () => {
    const { backend, repository } = setup();
    backend.respondNext(pageOf([rowOf(1), rowOf(2)], '0-1/5'));
    backend.respondNext(pageOf([], '*/5'));

    await expect(repository.list()).resolves.toHaveLength(2);
    expect(offsetsOf(backend.requests)).toStrictEqual(['0', '2']);
  });

  it('reads on while a response has no count', async () => {
    const { backend, repository } = setup();
    backend.seed(rowOf(1), rowOf(2), rowOf(3));
    backend.respondNext(pageOf([rowOf(1), rowOf(2)], '0-1/*'));

    await expect(repository.list()).resolves.toHaveLength(3);
    expect(offsetsOf(backend.requests)).toStrictEqual(['0', '2']);
  });

  const older = rowOf(1, { progress: 1, updated_at: '2026-02-01T08:00:00.000000+00:00' });
  const newer = rowOf(1, { progress: 2, updated_at: '2026-02-03T08:00:00.000000+00:00' });

  it.each([
    { label: 'second', firstRead: older, secondRead: newer },
    { label: 'first', firstRead: newer, secondRead: older },
  ])(
    'keeps the most recent of a row read twice, read $label',
    async ({ firstRead, secondRead }) => {
      const { backend, repository } = setup();
      backend.respondNext(pageOf([firstRead, rowOf(2)], '0-1/3'));
      backend.respondNext(pageOf([secondRead], '2-2/3'));

      const entries = await repository.list();

      expect(entries.map((entry) => [entry.key.externalId, entry.progress])).toStrictEqual([
        [1, 2],
        [2, 0],
      ]);
    },
  );

  it('orders rows tied once truncated to milliseconds by their key', async () => {
    const { backend, repository } = setup();
    backend.seed(
      rowOf(9, { updated_at: '2026-02-01T08:00:00.123999+00:00' }),
      rowOf(3, { updated_at: '2026-02-01T08:00:00.123001+00:00' }),
      rowOf(1, { media_kind: 'manga', updated_at: '2026-02-01T08:00:00.124000+00:00' }),
    );

    const keys = (await repository.list()).map((entry) => entry.key);

    expect(keys).toStrictEqual([keyOf('manga', 1), keyOf('anime', 3), keyOf('anime', 9)]);
  });
});

describe('createSupabaseLibraryRepository unreadable rows', () => {
  // a row a newer version wrote: a format this version does not know
  const unreadable = rowOf(2, {
    media_format: 'hologram',
    media_title: TITLE_TEXT,
    notes: NOTES_TEXT,
  });

  it('leaves an unreadable row out of the list and reports it once, without a value', async () => {
    const { backend, repository, captureError } = setup();
    backend.seed(rowOf(1), unreadable);

    const first = await repository.list();
    const second = await repository.list();

    expect(first.map((entry) => entry.key)).toStrictEqual([keyOf('anime', 1)]);
    expect(second).toStrictEqual(first);
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(expect.any(LibraryRemoteError), {
      source: 'library-remote',
      tags: { operation: 'list' },
    });
    const reported = JSON.stringify(captureError.mock.calls);
    expect(reported).not.toContain(TITLE_TEXT);
    expect(reported).not.toContain(NOTES_TEXT);
    expect(reported).not.toContain('hologram');
    expect(backend.rows).toContainEqual(unreadable);
  });

  it('rejects the get of an unreadable row with invalid-row, reported once per instance', async () => {
    const { backend, repository, captureError } = setup();
    backend.seed(unreadable);

    const error = await failureOf(repository.get(keyOf('anime', 2)));
    await repository.list();

    expect(error).toBeInstanceOf(LibraryRemoteError);
    expect(error).toMatchObject({ reason: 'invalid-row' });
    expect(String(error)).not.toContain(TITLE_TEXT);
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError.mock.calls[0]?.[1]).toStrictEqual({
      source: 'library-remote',
      tags: { operation: 'get' },
    });
  });
});
