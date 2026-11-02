import { describe, expect, it, jest } from '@jest/globals';
import { HttpResponse } from 'msw';

import { listedValues } from '../../../../test/core/account-library-merge-contract';
import {
  NOTES_TEXT,
  TITLE_TEXT,
  entryOf,
  keyOf,
} from '../../../../test/core/library-entry-fixtures';
import { failureOf } from '../../../../test/core/library-repository-contract-support';
import { server } from '../../../../test/core/msw-server';
import type { LibraryEntry } from '../../domain/library-entry';
import {
  OTHER_USER_ID,
  createAccountLibrary,
  seedEntries,
  type AccountLibraryOptions,
} from './__fixtures__/account-library';
import { USER_ID } from './__fixtures__/auth-handlers';
import type { LibraryBackend } from './__fixtures__/library-handlers';
import { SERVER_DETAIL_PREFIX } from './__fixtures__/postgrest-fake';
import { GUEST_MERGE_BATCH_SIZE } from './library-merge';
import { LIBRARY_REQUEST_TIMEOUT_MS } from './library-requests';

const EARLIER = '2026-02-01T08:00:00.000Z';
const LATER = '2026-02-20T08:00:00.000Z';

// an account entry of ENTRY_KEY, a newer guest entry of the same key, and a new one
const ACCOUNT_ENTRY = entryOf({ progress: 3, updatedAt: EARLIER });
const GUEST_ENTRY = entryOf({ progress: 13, updatedAt: LATER });
const NEW_ENTRY = entryOf({ key: keyOf('manga', 8), updatedAt: LATER });
const GUEST_ENTRIES = [NEW_ENTRY, GUEST_ENTRY];
// one batch and a half: the account entry's key is in the second batch
const TWO_BATCHES = [
  ...Array.from({ length: GUEST_MERGE_BATCH_SIZE }, (_, index) =>
    entryOf({ key: keyOf('manga', index + 1), updatedAt: LATER }),
  ),
  ...Array.from({ length: 49 }, (_, index) =>
    entryOf({ key: keyOf('anime', index + 1), updatedAt: LATER }),
  ),
  GUEST_ENTRY,
];

/** an account store over a fresh fake holding `seed`. */
const setup = (seed: readonly LibraryEntry[] = [], options?: AccountLibraryOptions) => {
  const library = createAccountLibrary(options);
  server.use(library.backend.handler);
  seedEntries(library.backend, seed);
  return library;
};

// a postgrest error whose text quotes the row, as postgres messages and details can
const serverError = (status: number, code: string) => () =>
  HttpResponse.json(
    {
      code,
      message: `refused ${TITLE_TEXT}`,
      details: `${SERVER_DETAIL_PREFIX} (${USER_ID}, mal, anime, 52991, ${NOTES_TEXT})`,
      hint: null,
    },
    { status },
  );

const stalled = () => new Promise<Response>(() => undefined);

// answers the second merge call with `respond`: a change runs when its request arrives, before
// the fake looks for a test's answer, so the first call sets the answer of the next one
const respondToSecondCall = (backend: LibraryBackend, respond: () => Response): void => {
  backend.changeBefore('POST', () => {
    backend.changeBefore('POST', () => {
      backend.respondNext(respond, 'POST');
    });
  });
};

const expectNoValue = (value: unknown): void => {
  const text = `${String(value)} ${JSON.stringify(value)}`;
  for (const forbidden of [TITLE_TEXT, NOTES_TEXT, SERVER_DETAIL_PREFIX, USER_ID, '52991']) {
    expect(text).not.toContain(forbidden);
  }
};

describe('mergeGuestEntries session guard', () => {
  it.each([
    { label: 'without a session', sessionUserId: null },
    { label: "under another user's session", sessionUserId: OTHER_USER_ID },
  ])('rejects with signed-out $label, sending nothing', async ({ sessionUserId }) => {
    const { backend, repository, captureError } = setup([], { sessionUserId });

    const error = await failureOf(repository.mergeGuestEntries(GUEST_ENTRIES));

    expect(error).toMatchObject({ name: 'LibraryRemoteError', reason: 'signed-out' });
    expect(backend.requests).toStrictEqual([]);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('stops with signed-out when the session ends between two batches', async () => {
    const { backend, repository, session, captureError } = setup([ACCOUNT_ENTRY]);
    backend.changeBefore('POST', () => {
      session.values.clear();
    });

    await expect(repository.mergeGuestEntries(TWO_BATCHES)).rejects.toMatchObject({
      reason: 'signed-out',
    });

    // the first batch was sent before the session ended, the second never is
    expect(backend.requests).toHaveLength(1);
    expect(backend.rows).toHaveLength(1 + GUEST_MERGE_BATCH_SIZE);
    expect(backend.rows[0]?.progress).toBe(ACCOUNT_ENTRY.progress);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('rejects with network when the session read does not answer in time, sending nothing', async () => {
    const { backend, repository, captureError } = setup([], { stalledSessionRead: true });

    const result = failureOf(repository.mergeGuestEntries(GUEST_ENTRIES));
    await jest.advanceTimersByTimeAsync(LIBRARY_REQUEST_TIMEOUT_MS);

    await expect(result).resolves.toMatchObject({ reason: 'network' });
    expect(backend.requests).toStrictEqual([]);
    expect(captureError).not.toHaveBeenCalled();
  });
});

describe('mergeGuestEntries partial failure', () => {
  it('rejects with network when a second batch fails after a first succeeded, then completes on a retry', async () => {
    const uninterrupted = setup([ACCOUNT_ENTRY]);
    await uninterrupted.repository.mergeGuestEntries(TWO_BATCHES);
    const expected = await listedValues(uninterrupted.repository);
    const { backend, repository, captureError } = setup([ACCOUNT_ENTRY]);
    respondToSecondCall(backend, serverError(503, 'PGRST002'));

    const error = await failureOf(repository.mergeGuestEntries(TWO_BATCHES));

    expect(error).toMatchObject({ reason: 'network' });
    expect(backend.requests).toHaveLength(2);
    // the first batch is written whole, nothing of the second
    expect(backend.rows).toHaveLength(1 + GUEST_MERGE_BATCH_SIZE);
    expect(backend.rows[0]?.progress).toBe(ACCOUNT_ENTRY.progress);

    await repository.mergeGuestEntries(TWO_BATCHES);

    // the first batch, now as recent on the server, is kept; the second is written
    expect(backend.requests).toHaveLength(4);
    await expect(listedValues(repository)).resolves.toStrictEqual(expected);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('aborts a stalled call after the timeout, rejecting with network', async () => {
    const { backend, repository, captureError } = setup();
    backend.respondNext(stalled, 'POST');
    let settled = false;
    const result = failureOf(repository.mergeGuestEntries(GUEST_ENTRIES)).finally(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(LIBRARY_REQUEST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toMatchObject({ reason: 'network' });
    expect(backend.requests).toHaveLength(1);
    expect(captureError).not.toHaveBeenCalled();
  });
});

describe('mergeGuestEntries errors', () => {
  it.each([
    // a merge call is a POST: postgrest-js never retries it
    { status: 503, code: 'PGRST002', reason: 'network' },
    { status: 401, code: 'PGRST303', reason: 'signed-out' },
  ])('rejects a $status with $reason, never reported', async ({ status, code, reason }) => {
    const { backend, repository, captureError } = setup([ACCOUNT_ENTRY]);
    backend.respondNext(serverError(status, code), 'POST');

    const error = await failureOf(repository.mergeGuestEntries(GUEST_ENTRIES));

    expect(error).toMatchObject({ reason });
    expectNoValue(error);
    expect(backend.requests).toHaveLength(1);
    expect(captureError).not.toHaveBeenCalled();
  });

  it.each([
    { status: 400, code: '22023', reason: 'rejected' },
    { status: 400, code: '23514', reason: 'rejected' },
    { status: 403, code: '42501', reason: 'rejected' },
    { status: 500, code: 'XX000', reason: 'unknown' },
  ])(
    'rejects a $status $code with $reason, reported with its code and status',
    async ({ status, code, reason }) => {
      const { backend, repository, captureError } = setup([ACCOUNT_ENTRY]);
      backend.respondNext(serverError(status, code), 'POST');

      const error = await failureOf(repository.mergeGuestEntries(GUEST_ENTRIES));

      expect(error).toMatchObject({ name: 'LibraryRemoteError', reason });
      expectNoValue(error);
      expect(captureError).toHaveBeenCalledTimes(1);
      expect(captureError).toHaveBeenCalledWith(error, {
        source: 'library-remote',
        tags: { operation: 'merge', code, status: String(status) },
      });
      expectNoValue(captureError.mock.calls);
    },
  );

  it('rejects an error thrown by the client with unknown, reported without a status', async () => {
    const { repository, client, captureError } = setup();
    jest.spyOn(client, 'rpc').mockImplementation(() => {
      throw new Error(`client bug ${TITLE_TEXT}`);
    });

    const error = await failureOf(repository.mergeGuestEntries(GUEST_ENTRIES));

    expect(error).toMatchObject({ reason: 'unknown' });
    expectNoValue(error);
    expect(captureError).toHaveBeenCalledWith(error, {
      source: 'library-remote',
      tags: { operation: 'merge' },
    });
  });
});
