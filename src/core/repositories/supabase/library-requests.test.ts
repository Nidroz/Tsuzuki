import { describe, expect, it, jest } from '@jest/globals';
import { AuthError } from '@supabase/supabase-js';

import { ENTRY_KEY, entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import { failureOf } from '../../../../test/core/library-repository-contract-support';
import { server } from '../../../../test/core/msw-server';
import type { RemoteAccountLibraryRepository } from '../library-repository';
import { OTHER_USER_ID, createAccountLibrary, seedEntries } from './__fixtures__/account-library';
import { LIBRARY_REQUEST_TIMEOUT_MS } from './library-requests';

// the session guard and the request timeout of every account store request (library-requests.ts)

const setup = (options?: Parameters<typeof createAccountLibrary>[0]) => {
  const library = createAccountLibrary(options);
  server.use(library.backend.handler);
  return library;
};

type Operation = 'list' | 'get' | 'save' | 'remove' | 'mergeGuestEntries' | 'replayWrites';

const OPERATIONS: readonly Operation[] = [
  'list',
  'get',
  'save',
  'remove',
  'mergeGuestEntries',
  'replayWrites',
];

const call = (
  repository: RemoteAccountLibraryRepository,
  operation: Operation,
): Promise<unknown> => {
  switch (operation) {
    case 'list':
      return repository.list();
    case 'get':
      return repository.get(ENTRY_KEY);
    case 'save':
      return repository.save(entryOf());
    case 'remove':
      return repository.remove(ENTRY_KEY);
    case 'mergeGuestEntries':
      return repository.mergeGuestEntries([entryOf()]);
    case 'replayWrites':
      return repository.replayWrites([{ type: 'save', entry: entryOf() }]);
  }
};

describe('account store session guard under the request timeout', () => {
  it.each(OPERATIONS)(
    'rejects %s with network when the session read does not answer in time, sending nothing',
    async (operation) => {
      const { backend, repository, captureError } = setup({ stalledSessionRead: true });
      let settled = false;
      const result = failureOf(call(repository, operation)).finally(() => {
        settled = true;
      });

      await jest.advanceTimersByTimeAsync(LIBRARY_REQUEST_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);

      await expect(result).resolves.toMatchObject({
        name: 'LibraryRemoteError',
        reason: 'network',
      });
      expect(backend.requests).toStrictEqual([]);
      expect(captureError).not.toHaveBeenCalled();
    },
  );

  // a failed read (a token refresh failing offline) is transient, never a sign out (ADR-0017)
  it.each(OPERATIONS)(
    'rejects %s with network, never reported, when the session read answers an error',
    async (operation) => {
      const { backend, repository, client, captureError } = setup();
      jest
        .spyOn(client.auth, 'getSession')
        .mockResolvedValue({ data: { session: null }, error: new AuthError('refresh failed') });

      await expect(call(repository, operation)).rejects.toMatchObject({
        name: 'LibraryRemoteError',
        reason: 'network',
      });
      expect(backend.requests).toStrictEqual([]);
      expect(captureError).not.toHaveBeenCalled();
    },
  );

  it.each(OPERATIONS)(
    'rejects %s with network, never reported, when the session read throws',
    async (operation) => {
      const { backend, repository, client, captureError } = setup();
      jest.spyOn(client.auth, 'getSession').mockRejectedValue(new Error('keystore locked'));

      await expect(call(repository, operation)).rejects.toMatchObject({ reason: 'network' });
      expect(backend.requests).toStrictEqual([]);
      expect(captureError).not.toHaveBeenCalled();
    },
  );

  it.each([
    { label: 'without a session', sessionUserId: null },
    { label: "under another user's session", sessionUserId: OTHER_USER_ID },
  ])('still rejects with signed-out $label', async ({ sessionUserId }) => {
    const { backend, repository } = setup({ sessionUserId });

    await expect(
      repository.replayWrites([{ type: 'save', entry: entryOf() }]),
    ).rejects.toMatchObject({ reason: 'signed-out' });
    expect(backend.requests).toStrictEqual([]);
  });

  it('checks the session again before each page of a list', async () => {
    const { backend, repository, session } = setup();
    seedEntries(
      backend,
      Array.from({ length: 20 }, (_, index) => entryOf({ key: keyOf('anime', index + 1) })),
    );
    backend.setMaxRows(7);
    backend.changeBefore('GET', () => {
      session.values.clear();
    });

    await expect(repository.list()).rejects.toMatchObject({ reason: 'signed-out' });
    expect(backend.requests).toHaveLength(1);
  });

  it('starts one timer per request, the session read included, and clears it', async () => {
    const { repository } = setup();
    const setTimer = jest.spyOn(globalThis, 'setTimeout');
    const clearTimer = jest.spyOn(globalThis, 'clearTimeout');

    await repository.mergeGuestEntries([entryOf()]);

    const timers = setTimer.mock.calls.flatMap((args, index) =>
      args[1] === LIBRARY_REQUEST_TIMEOUT_MS ? [setTimer.mock.results[index]?.value] : [],
    );
    // the merge call
    expect(timers).toHaveLength(1);
    const cleared = clearTimer.mock.calls.map(([timer]) => timer);
    for (const timer of timers) {
      expect(cleared).toContain(timer);
    }
  });
});
