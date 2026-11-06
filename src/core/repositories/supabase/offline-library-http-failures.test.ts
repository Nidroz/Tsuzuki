import { describe, expect, it, jest } from '@jest/globals';
import { HttpResponse } from 'msw';

import { entryOf, keyOf } from '../../../../test/core/library-entry-fixtures';
import { server } from '../../../../test/core/msw-server';
import type { LibraryEntry } from '../../domain/library-entry';
import type { ErrorReporter } from '../../errors/error-reporter';
import type { LibraryReplayRun } from '../offline-account-library-repository';
import { createMemoryStorage } from '../local/__fixtures__/memory-storage';
import { createOfflineAccountLibraries } from '../local/account-libraries';
import { readAccountQueue } from '../local/account-library-documents';
import { LIBRARY_REPLAY_RETRY_DELAYS_MS } from '../local/account-library-replay';
import { createAccountLibrary } from './__fixtures__/account-library';
import { USER_ID } from './__fixtures__/auth-handlers';
import { LIBRARY_ENDPOINT, REPLAY_ENDPOINT } from './__fixtures__/library-handlers';

// the offline account library over the account store and its http answers (ADR-0017): a status
// whose outcome is uncertain (a 500, a 52x) keeps a direct write queued, and a status asking to
// try later (a 408, a 429) is transient: a direct write is kept, a replay batch is retried with
// backoff, never split one write per call, never taken for refused

const DEVICE_TIME = '2025-12-31T23:00:00.000Z';
const QUEUE_KEY = `account-library-queue.${USER_ID}`;

const changed = (overrides: Partial<LibraryEntry> = {}): LibraryEntry =>
  entryOf({ createdAt: DEVICE_TIME, updatedAt: DEVICE_TIME, ...overrides });

const statusAnswer = (status: number) => () =>
  HttpResponse.json(
    { code: 'PGRST000', message: 'try later', details: null, hint: null },
    { status },
  );

const setup = () => {
  const account = createAccountLibrary();
  server.use(account.backend.handler);
  const storage = createMemoryStorage();
  const connectivity = { online: true };
  const captureError = jest.fn<ErrorReporter['captureError']>();
  const library = createOfflineAccountLibraries({
    storage,
    remoteFor: () => account.repository,
    isOnline: () => connectivity.online,
    reporter: { captureError },
  })(USER_ID);
  const queued = () => readAccountQueue(storage.getString(QUEUE_KEY)).value.records;
  const callsTo = (endpoint: string) =>
    account.backend.requests.filter((request) => request.endpoint === endpoint);
  return { ...account, library, connectivity, queued, callsTo, deviceReports: captureError };
};

// a run's outcome, readable before it settles
const track = (run: Promise<LibraryReplayRun>) => {
  const state: { result: LibraryReplayRun | null } = { result: null };
  void run.then((result) => {
    state.result = result;
  });
  return state;
};

describe('a direct save answered with a status of uncertain outcome', () => {
  it.each([500, 520, 524])(
    'answered %p, stays queued and resolves, then is replayed',
    async (status) => {
      const { backend, library, queued, callsTo } = setup();
      backend.respondNext(statusAnswer(status), 'POST');

      await expect(library.save(changed())).resolves.toStrictEqual(changed());
      expect(queued()).toHaveLength(1);

      await expect(library.replayQueuedWrites()).resolves.toStrictEqual({
        status: 'done',
        confirmed: 1,
      });
      expect(queued()).toStrictEqual([]);
      expect(callsTo(LIBRARY_ENDPOINT)).toHaveLength(1);
      expect(callsTo(REPLAY_ENDPOINT)).toHaveLength(1);
      expect(backend.rows).toHaveLength(1);
    },
  );
});

describe('a status asking to try later', () => {
  it.each([408, 429])(
    'on a direct save (%p), keeps the write queued, never reported',
    async (status) => {
      const { backend, library, queued, captureError, deviceReports } = setup();
      backend.respondNext(statusAnswer(status), 'POST');

      await expect(library.save(changed())).resolves.toStrictEqual(changed());

      expect(queued()).toHaveLength(1);
      expect(captureError).not.toHaveBeenCalled();
      expect(deviceReports).not.toHaveBeenCalled();
    },
  );

  it('on a replay batch (429), retries the batch whole after the backoff, nothing refused', async () => {
    const { backend, library, connectivity, queued, callsTo, captureError } = setup();
    connectivity.online = false;
    for (const id of [1, 2, 3]) {
      await library.save(changed({ key: keyOf('anime', id) }));
    }
    connectivity.online = true;
    backend.respondNext(statusAnswer(429), 'POST');

    const run = track(library.replayQueuedWrites());
    await jest.advanceTimersByTimeAsync(0);
    expect(callsTo(REPLAY_ENDPOINT)).toHaveLength(1);
    expect(run.result).toBeNull();

    await jest.advanceTimersByTimeAsync(LIBRARY_REPLAY_RETRY_DELAYS_MS[0] ?? 0);

    expect(run.result).toStrictEqual({ status: 'done', confirmed: 3 });
    // two calls of the whole batch: no split into single writes
    expect(callsTo(REPLAY_ENDPOINT)).toHaveLength(2);
    for (const request of callsTo(REPLAY_ENDPOINT)) {
      expect(request.body).toMatchObject({ writes: [{}, {}, {}] });
    }
    expect(queued()).toStrictEqual([]);
    expect(backend.rows).toHaveLength(3);
    expect(captureError).not.toHaveBeenCalled();
  });
});
