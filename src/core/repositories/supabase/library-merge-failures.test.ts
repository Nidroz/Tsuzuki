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
import type { LibraryRequest } from './__fixtures__/library-handlers';
import { SERVER_DETAIL_PREFIX } from './__fixtures__/postgrest-fake';
import { LIBRARY_REQUEST_TIMEOUT_MS } from './library-requests';

const EARLIER = '2026-02-01T08:00:00.000Z';
const LATER = '2026-02-20T08:00:00.000Z';

// an account entry of ENTRY_KEY, a newer guest entry of the same key, and a new one
const ACCOUNT_ENTRY = entryOf({ progress: 3, updatedAt: EARLIER });
const GUEST_ENTRY = entryOf({ progress: 13, updatedAt: LATER });
const NEW_ENTRY = entryOf({ key: keyOf('manga', 8), updatedAt: LATER });
const GUEST_ENTRIES = [NEW_ENTRY, GUEST_ENTRY];

/** an account store over a fresh fake holding `seed`. */
const setup = (seed: readonly LibraryEntry[] = [], options?: AccountLibraryOptions) => {
  const library = createAccountLibrary(options);
  server.use(library.backend.handler);
  seedEntries(library.backend, seed);
  return library;
};

const methodsOf = (requests: readonly LibraryRequest[]) =>
  requests.map((request) => request.method);

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

  it('stops with signed-out when the session ends during the merge', async () => {
    const { backend, repository, session, captureError } = setup([ACCOUNT_ENTRY]);
    const seeded = backend.rows.map((row) => ({ ...row }));
    backend.changeBefore('POST', () => {
      session.values.clear();
    });

    await expect(repository.mergeGuestEntries(GUEST_ENTRIES)).rejects.toMatchObject({
      reason: 'signed-out',
    });

    // the update after the insert is never sent: the account row keeps its values
    expect(methodsOf(backend.requests)).toStrictEqual(['GET', 'POST']);
    expect(backend.rows.slice(0, 1)).toStrictEqual(seeded);
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
  it('completes on a retry after a failed update, to the rows of an uninterrupted merge', async () => {
    const uninterrupted = setup([ACCOUNT_ENTRY]);
    await uninterrupted.repository.mergeGuestEntries(GUEST_ENTRIES);
    const expected = await listedValues(uninterrupted.repository);
    const { backend, repository, captureError } = setup([ACCOUNT_ENTRY]);
    backend.respondNext(serverError(503, 'PGRST002'), 'PATCH');

    const error = await failureOf(repository.mergeGuestEntries(GUEST_ENTRIES));
    expect(error).toMatchObject({ reason: 'network' });
    expect(methodsOf(backend.requests)).toStrictEqual(['GET', 'POST', 'PATCH']);
    await repository.mergeGuestEntries(GUEST_ENTRIES);

    // the inserted entry, now newer on the server, is kept; only the update is sent again
    expect(methodsOf(backend.requests.slice(3))).toStrictEqual(['GET', 'PATCH']);
    await expect(listedValues(repository)).resolves.toStrictEqual(expected);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('aborts a stalled insert after the timeout, rejecting with network', async () => {
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
    expect(methodsOf(backend.requests)).toStrictEqual(['GET', 'POST']);
    expect(captureError).not.toHaveBeenCalled();
  });
});

describe('mergeGuestEntries errors', () => {
  it.each([
    // postgrest-js retries a read answered 503 three times, after 1, 2 and 4 seconds
    { method: 'GET', status: 503, code: 'PGRST002', attempts: 4, reason: 'network' },
    { method: 'POST', status: 401, code: 'PGRST303', attempts: 1, reason: 'signed-out' },
  ])(
    'rejects a $status on $method with $reason, never reported',
    async ({ method, status, code, attempts, reason }) => {
      const { backend, repository, captureError } = setup([ACCOUNT_ENTRY]);
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        backend.respondNext(serverError(status, code), method);
      }

      const result = failureOf(repository.mergeGuestEntries(GUEST_ENTRIES));
      await jest.advanceTimersByTimeAsync(7000);

      const error = await result;
      expect(error).toMatchObject({ reason });
      expectNoValue(error);
      expect(captureError).not.toHaveBeenCalled();
    },
  );

  it.each([
    { method: 'POST', status: 400, code: '23514', reason: 'rejected' },
    { method: 'PATCH', status: 403, code: '42501', reason: 'rejected' },
    { method: 'GET', status: 500, code: 'XX000', reason: 'unknown' },
  ])(
    'rejects a $status $code on $method with $reason, reported with its code and status',
    async ({ method, status, code, reason }) => {
      const { backend, repository, captureError } = setup([ACCOUNT_ENTRY]);
      backend.respondNext(serverError(status, code), method);

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
    jest.spyOn(client, 'from').mockImplementation(() => {
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
