import { describe, expect, it, jest } from '@jest/globals';

import { ENTRY_KEY, entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import { failureOf } from '../../../../test/core/library-repository-contract-support';
import { server } from '../../../../test/core/msw-server';
import type { AccountLibraryRepository } from '../library-repository';
import { createAccountLibrary, seedEntries } from './__fixtures__/account-library';
import { LIBRARY_REQUEST_TIMEOUT_MS } from './library-requests';

// the session guard and the request timeout of every account store request (library-requests.ts)

const setup = (options?: Parameters<typeof createAccountLibrary>[0]) => {
  const library = createAccountLibrary(options);
  server.use(library.backend.handler);
  return library;
};

type Operation = 'list' | 'get' | 'save' | 'remove' | 'mergeGuestEntries';

const call = (repository: AccountLibraryRepository, operation: Operation): Promise<unknown> => {
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
  }
};

describe('account store session guard under the request timeout', () => {
  it.each<Operation>(['list', 'get', 'save', 'remove', 'mergeGuestEntries'])(
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
