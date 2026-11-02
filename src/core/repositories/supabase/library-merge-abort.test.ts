import { describe, expect, it, jest } from '@jest/globals';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import { failureOf } from '../../../../test/core/library-repository-contract-support';
import { server } from '../../../../test/core/msw-server';
import { createAccountLibrary } from './__fixtures__/account-library';
import { GUEST_MERGE_BATCH_SIZE } from './library-merge';

// the signal of a guest merge run (A-05, ADR-0016 "Update"): checked before each batch, so a stale
// run sends no further batch once its account is no longer the committed one

const LATER = '2026-02-20T08:00:00.000Z';
// a batch and one more entry
const TWO_BATCHES = Array.from({ length: GUEST_MERGE_BATCH_SIZE + 1 }, (_, index) =>
  entryOf({ key: keyOf('anime', index + 1), updatedAt: LATER }),
);

const setup = () => {
  const library = createAccountLibrary();
  server.use(library.backend.handler);
  return library;
};

describe('mergeGuestEntries signal', () => {
  it('rejects with signed-out, never reported, before any session read or request once aborted', async () => {
    const { backend, repository, client, captureError } = setup();
    const getSession = jest.spyOn(client.auth, 'getSession');
    const controller = new AbortController();
    controller.abort();

    const error = await failureOf(
      repository.mergeGuestEntries(TWO_BATCHES, { signal: controller.signal }),
    );

    expect(error).toMatchObject({ name: 'LibraryRemoteError', reason: 'signed-out' });
    expect(getSession).not.toHaveBeenCalled();
    expect(backend.requests).toStrictEqual([]);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('completes the batch in flight and sends no further batch when aborted meanwhile', async () => {
    const { backend, repository, captureError } = setup();
    const controller = new AbortController();
    backend.changeBefore('POST', () => {
      controller.abort();
    });

    await expect(
      repository.mergeGuestEntries(TWO_BATCHES, { signal: controller.signal }),
    ).rejects.toMatchObject({ reason: 'signed-out' });

    expect(backend.requests).toHaveLength(1);
    expect(backend.rows).toHaveLength(GUEST_MERGE_BATCH_SIZE);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('merges every batch under a signal that is not aborted', async () => {
    const { backend, repository } = setup();

    await repository.mergeGuestEntries(TWO_BATCHES, { signal: new AbortController().signal });

    expect(backend.requests).toHaveLength(2);
    expect(backend.rows).toHaveLength(TWO_BATCHES.length);
  });
});
