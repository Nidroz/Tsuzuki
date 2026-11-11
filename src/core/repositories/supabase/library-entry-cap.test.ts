import { describe, expect, it } from '@jest/globals';

import { NOTES_TEXT, TITLE_TEXT, entryOf } from '../../../../test/core/library-entry-fixtures';
import { failureOf } from '../../../../test/core/library-repository-contract-support';
import { server } from '../../../../test/core/msw-server';
import { createAccountLibrary } from './__fixtures__/account-library';
import { USER_ID } from './__fixtures__/auth-handlers';
import { BAD_REQUEST, SERVER_DETAIL_PREFIX, errorResponse } from './__fixtures__/postgrest-fake';
import { LIBRARY_ENTRY_LIMIT_CODE } from './library-error-mapper';

// the per-user entry cap of the database (R-04, pgTAP 090-library-entry-cap): an insert of a new
// key past it is refused with the sqlstate TZ001, which postgrest answers with 400, and nothing of
// the call is written. on every write of the account store it is `library-full`, a condition of
// the user, never reported; another code of a 400 stays `rejected`, reported

const ENTRY = entryOf({ notes: NOTES_TEXT, updatedAt: '2026-02-20T08:00:00.000Z' });

type Repository = ReturnType<typeof createAccountLibrary>['repository'];

// each write of the store, and its operation as reports name it
const WRITES: readonly {
  readonly operation: string;
  readonly write: (repository: Repository) => Promise<unknown>;
}[] = [
  { operation: 'save', write: (repository) => repository.save(ENTRY) },
  { operation: 'merge', write: (repository) => repository.mergeGuestEntries([ENTRY]) },
  {
    operation: 'replay',
    write: (repository) => repository.replayWrites([{ type: 'save', entry: ENTRY }]),
  },
];

// a refusal whose text quotes the row, as postgres messages and details can
const refusal = (code: string) => () =>
  errorResponse(
    BAD_REQUEST,
    code,
    `refused ${TITLE_TEXT}`,
    `${SERVER_DETAIL_PREFIX} (${USER_ID}, mal, anime, 52991, ${NOTES_TEXT})`,
  );

const setup = () => {
  const library = createAccountLibrary();
  server.use(library.backend.handler);
  return library;
};

describe('the entry cap', () => {
  it.each(WRITES)(
    'maps a 400 with code TZ001 on $operation to library-full, not reported',
    async ({ write }) => {
      const { backend, repository, captureError } = setup();
      backend.respondNext(refusal(LIBRARY_ENTRY_LIMIT_CODE), 'POST');

      const error = await failureOf(write(repository));

      expect(error).toMatchObject({ name: 'LibraryRemoteError', reason: 'library-full' });
      expect(JSON.stringify(error)).not.toContain(TITLE_TEXT);
      expect(String(error)).not.toContain(TITLE_TEXT);
      expect(captureError).not.toHaveBeenCalled();
      expect(backend.requests).toHaveLength(1);
    },
  );

  it.each(WRITES)(
    'keeps a 400 with another code on $operation rejected, reported with its code',
    async ({ operation, write }) => {
      const { backend, repository, captureError } = setup();
      backend.respondNext(refusal('23514'), 'POST');

      await expect(write(repository)).rejects.toMatchObject({ reason: 'rejected' });

      expect(captureError).toHaveBeenCalledTimes(1);
      expect(captureError).toHaveBeenCalledWith(expect.anything(), {
        source: 'library-remote',
        tags: { operation, code: '23514', status: '400' },
      });
    },
  );
});
