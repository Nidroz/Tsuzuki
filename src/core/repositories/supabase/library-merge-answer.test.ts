import { describe, expect, it } from '@jest/globals';
import { HttpResponse, type JsonBodyType } from 'msw';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import { failureOf } from '../../../../test/core/library-repository-contract-support';
import { server } from '../../../../test/core/msw-server';
import { OTHER_USER_ID, createAccountLibrary } from './__fixtures__/account-library';
import { USER_ID } from './__fixtures__/auth-handlers';
import { GUEST_MERGE_BATCH_SIZE } from './library-merge';

// the answer of the merge function confirms a batch only when it holds each of its entries once,
// as rows of the signed-in user (BR-08, ADR-0016)

const LATER = '2026-02-20T08:00:00.000Z';

// two guest entries of one batch, keys anime 52991 and manga 8
const GUEST_ENTRY = entryOf({ progress: 13, updatedAt: LATER });
const NEW_ENTRY = entryOf({ key: keyOf('manga', 8), updatedAt: LATER });
const GUEST_ENTRIES = [GUEST_ENTRY, NEW_ENTRY];
// a batch and one more entry
const TWO_BATCHES = Array.from({ length: GUEST_MERGE_BATCH_SIZE + 1 }, (_, index) =>
  entryOf({ key: keyOf('anime', index + 1), updatedAt: LATER }),
);

const setup = () => {
  const library = createAccountLibrary();
  server.use(library.backend.handler);
  return library;
};

// an answer row as postgrest returns it, of GUEST_ENTRY's key unless overridden
const answerRow = (overrides: Record<string, unknown> = {}) => ({
  id_namespace: 'mal',
  media_kind: 'anime',
  external_id: 52991,
  user_id: USER_ID,
  outcome: 'written',
  ...overrides,
});
const NEW_ENTRY_ROW = answerRow({ media_kind: 'manga', external_id: 8, outcome: 'kept' });

const answer = (body: JsonBodyType) => () => HttpResponse.json(body, { status: 200 });

describe('mergeGuestEntries answer', () => {
  it('resolves on an answer of each entry once, written or kept, in any order', async () => {
    const { backend, repository } = setup();
    backend.respondNext(answer([NEW_ENTRY_ROW, answerRow()]), 'POST');

    await expect(repository.mergeGuestEntries(GUEST_ENTRIES)).resolves.toBeUndefined();
  });

  it('rejects an answer row of another user with signed-out, never reported, sending no other batch', async () => {
    const { backend, repository, captureError } = setup();
    backend.respondNext(
      answer(
        TWO_BATCHES.slice(0, GUEST_MERGE_BATCH_SIZE).map((entry) =>
          answerRow({ external_id: entry.key.externalId, user_id: OTHER_USER_ID }),
        ),
      ),
      'POST',
    );

    const error = await failureOf(repository.mergeGuestEntries(TWO_BATCHES));

    expect(error).toMatchObject({ name: 'LibraryRemoteError', reason: 'signed-out' });
    expect(String(error)).not.toContain(OTHER_USER_ID);
    expect(backend.requests).toHaveLength(1);
    expect(captureError).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'a missing entry', rows: [answerRow()] },
    { label: 'an entry twice', rows: [answerRow(), answerRow(), NEW_ENTRY_ROW] },
    { label: 'a repeated key in place of another', rows: [answerRow(), answerRow()] },
    { label: 'a key of no entry', rows: [answerRow(), answerRow({ external_id: 404 })] },
    { label: 'no row', rows: [] },
  ])(
    'rejects an answer with $label with unknown, reported with the merge operation',
    async ({ rows }) => {
      const { backend, repository, captureError } = setup();
      backend.respondNext(answer(rows), 'POST');

      const error = await failureOf(repository.mergeGuestEntries(GUEST_ENTRIES));

      expect(error).toMatchObject({ name: 'LibraryRemoteError', reason: 'unknown' });
      expect(captureError).toHaveBeenCalledTimes(1);
      expect(captureError).toHaveBeenCalledWith(error, {
        source: 'library-remote',
        tags: { operation: 'merge', status: '200' },
      });
    },
  );

  it.each([
    { label: 'no body', body: null },
    { label: 'an object', body: answerRow() },
    { label: 'a row without its user', body: [{ ...answerRow(), user_id: undefined }] },
    {
      label: 'a row of an unknown kind',
      body: [answerRow({ media_kind: 'novel' }), NEW_ENTRY_ROW],
    },
    { label: 'an unknown outcome', body: [answerRow({ outcome: 'merged' }), NEW_ENTRY_ROW] },
  ])('rejects an answer of $label with unknown, reported', async ({ body }) => {
    const { backend, repository, captureError } = setup();
    backend.respondNext(
      body === null ? () => new HttpResponse(null, { status: 200 }) : answer(body),
      'POST',
    );

    const error = await failureOf(repository.mergeGuestEntries(GUEST_ENTRIES));

    expect(error).toMatchObject({ reason: 'unknown' });
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(error, {
      source: 'library-remote',
      tags: { operation: 'merge', status: '200' },
    });
  });

  it('stops at the first batch an answer does not confirm', async () => {
    const { backend, repository } = setup();
    backend.respondNext(answer([]), 'POST');

    await expect(repository.mergeGuestEntries(TWO_BATCHES)).rejects.toMatchObject({
      reason: 'unknown',
    });

    expect(backend.requests).toHaveLength(1);
  });
});
