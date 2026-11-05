import { describe, expect, it } from '@jest/globals';
import { HttpResponse } from 'msw';

import { ENTRY_KEY, entryOf } from '../../../../test/core/library-entry-fixtures';
import { failureOf } from '../../../../test/core/library-repository-contract-support';
import { server } from '../../../../test/core/msw-server';
import type { RemoteAccountLibraryRepository } from '../library-repository';
import { createAccountLibrary } from './__fixtures__/account-library';

// the reports of an outage of the account store (ADR-0017 "Outage reports", update of
// 2026-11-04): an unknown failure once per operation and status until a call succeeds

const setup = () => {
  const library = createAccountLibrary();
  server.use(library.backend.handler);
  return library;
};

const serverError = (status: number) => () =>
  HttpResponse.json(
    { code: 'XX000', message: 'server fault', details: null, hint: null },
    { status },
  );

type Call = 'save' | 'remove' | 'replay';

const call = (repository: RemoteAccountLibraryRepository, operation: Call): Promise<unknown> => {
  switch (operation) {
    case 'save':
      return repository.save(entryOf());
    case 'remove':
      return repository.remove(ENTRY_KEY);
    case 'replay':
      return repository.replayWrites([{ type: 'save', entry: entryOf() }]);
  }
};

// the operation and status tags of each report
const reportedTags = (captureError: ReturnType<typeof setup>['captureError']) =>
  captureError.mock.calls.map(([, context]) => [context?.tags?.operation, context?.tags?.status]);

describe('an unknown failure during an outage', () => {
  it('is reported once per operation and status over direct writes and replays', async () => {
    const { backend, repository, captureError } = setup();
    const calls: readonly (readonly [Call, number])[] = [
      ['save', 500],
      ['replay', 500],
      ['save', 500],
      ['remove', 500],
      ['replay', 500],
      ['replay', 500],
      ['save', 501],
      ['remove', 500],
      ['save', 501],
    ];

    for (const [operation, status] of calls) {
      backend.respondNext(serverError(status));
      await expect(failureOf(call(repository, operation))).resolves.toMatchObject({
        reason: 'unknown',
      });
    }

    expect(reportedTags(captureError)).toStrictEqual([
      ['save', '500'],
      ['replay', '500'],
      ['remove', '500'],
      ['save', '501'],
    ]);
  });

  it('is reported again after a call that succeeded', async () => {
    const { backend, repository, captureError } = setup();
    backend.respondNext(serverError(500));
    await failureOf(repository.save(entryOf()));
    backend.respondNext(serverError(500));
    await failureOf(repository.save(entryOf()));

    await repository.save(entryOf());
    backend.respondNext(serverError(500));
    await failureOf(repository.save(entryOf()));

    expect(reportedTags(captureError)).toStrictEqual([
      ['save', '500'],
      ['save', '500'],
    ]);
  });

  it('never silences a rejected failure, each one reported', async () => {
    const { backend, repository, captureError } = setup();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      backend.respondNext(serverError(500));
      await failureOf(repository.save(entryOf()));
      backend.respondNext(serverError(400));
      await expect(failureOf(repository.save(entryOf()))).resolves.toMatchObject({
        reason: 'rejected',
      });
    }

    expect(reportedTags(captureError)).toStrictEqual([
      ['save', '500'],
      ['save', '400'],
      ['save', '400'],
    ]);
  });
});
