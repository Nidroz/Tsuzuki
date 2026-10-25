import { describe, expect, it, jest } from '@jest/globals';
import { HttpResponse } from 'msw';

import { ENTRY_KEY, TITLE_TEXT, entryOf } from '../../../../test/core/library-entry-fixtures';
import { failureOf } from '../../../../test/core/library-repository-contract-support';
import { server } from '../../../../test/core/msw-server';
import type { LibraryRepository } from '../library-repository';
import {
  OTHER_USER_ID,
  createAccountLibrary,
  type AccountLibraryOptions,
} from './__fixtures__/account-library';
import { USER_ID } from './__fixtures__/auth-handlers';
import { SERVER_DETAIL_PREFIX } from './__fixtures__/library-handlers';
import { LIBRARY_REQUEST_TIMEOUT_MS } from './library-repository';

const setup = (options?: AccountLibraryOptions) => {
  const library = createAccountLibrary(options);
  server.use(library.backend.handler);
  return library;
};

type Operation = 'list' | 'get' | 'save' | 'remove';

const call = (repository: LibraryRepository, operation: Operation): Promise<unknown> => {
  switch (operation) {
    case 'list':
      return repository.list();
    case 'get':
      return repository.get(ENTRY_KEY);
    case 'save':
      return repository.save(entryOf());
    case 'remove':
      return repository.remove(ENTRY_KEY);
  }
};

// a postgrest error whose text quotes the row, as postgres messages and details can
const serverError = (status: number, code: string) => () =>
  HttpResponse.json(
    {
      code,
      message: `refused ${TITLE_TEXT}`,
      details: `${SERVER_DETAIL_PREFIX} (${USER_ID}, mal, anime, 52991)`,
      hint: null,
    },
    { status },
  );

const expectNoServerText = (error: unknown): void => {
  const text = `${String(error)} ${JSON.stringify(error)}`;
  expect(text).not.toContain(TITLE_TEXT);
  expect(text).not.toContain(SERVER_DETAIL_PREFIX);
  expect(text).not.toContain(USER_ID);
  expect(text).not.toContain('52991');
};

describe('createSupabaseLibraryRepository session guard', () => {
  it.each<Operation>(['list', 'get', 'save', 'remove'])(
    'rejects %s with signed-out and sends nothing without a session',
    async (operation) => {
      const { backend, repository, captureError } = setup({ sessionUserId: null });

      const error = await failureOf(call(repository, operation));

      expect(error).toMatchObject({ name: 'LibraryRemoteError', reason: 'signed-out' });
      expect(backend.requests).toStrictEqual([]);
      expect(captureError).not.toHaveBeenCalled();
    },
  );

  it.each<Operation>(['list', 'save'])(
    "rejects %s with signed-out and sends nothing under another user's session",
    async (operation) => {
      const { backend, repository } = setup({ sessionUserId: OTHER_USER_ID });

      await expect(call(repository, operation)).rejects.toMatchObject({ reason: 'signed-out' });
      expect(backend.requests).toStrictEqual([]);
    },
  );

  it('rejects with signed-out once the session it was created for ends', async () => {
    const { backend, repository, session } = setup();
    await repository.save(entryOf());

    session.values.clear();

    await expect(repository.list()).rejects.toMatchObject({ reason: 'signed-out' });
    expect(backend.requests).toHaveLength(1);
  });

  it('rejects with signed-out when the session cannot be read', async () => {
    const { backend, repository, client } = setup();
    jest.spyOn(client.auth, 'getSession').mockRejectedValue(new Error('keystore locked'));

    await expect(repository.save(entryOf())).rejects.toMatchObject({ reason: 'signed-out' });
    expect(backend.requests).toStrictEqual([]);
  });
});

describe('createSupabaseLibraryRepository errors', () => {
  it.each([
    { label: 'no response', operation: 'save', respond: () => HttpResponse.error() },
    { label: 'a 502', operation: 'save', respond: serverError(502, 'PGRST000') },
    { label: 'a 503', operation: 'remove', respond: serverError(503, 'PGRST002') },
    { label: 'a 504', operation: 'save', respond: serverError(504, 'PGRST003') },
  ] as const)('rejects $label with network, never reported', async ({ operation, respond }) => {
    const { backend, repository, captureError } = setup();
    backend.respondNext(respond);

    const error = await failureOf(call(repository, operation));

    expect(error).toMatchObject({ reason: 'network', message: 'Account library unreachable' });
    expectNoServerText(error);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('rejects a 401 with signed-out, never reported', async () => {
    const { backend, repository, captureError } = setup();
    backend.respondNext(serverError(401, 'PGRST303'));

    await expect(repository.save(entryOf())).rejects.toMatchObject({ reason: 'signed-out' });
    expect(captureError).not.toHaveBeenCalled();
  });

  it.each([
    { operation: 'save', status: 400, code: '23514' },
    { operation: 'save', status: 409, code: '23505' },
    { operation: 'get', status: 403, code: '42501' },
    { operation: 'list', status: 400, code: 'PGRST204' },
  ] as const)(
    'rejects a $status $code with rejected, reported with its code',
    async ({ operation, status, code }) => {
      const { backend, repository, captureError } = setup();
      backend.respondNext(serverError(status, code));

      const error = await failureOf(call(repository, operation));

      expect(error).toMatchObject({ reason: 'rejected' });
      expectNoServerText(error);
      expect(captureError).toHaveBeenCalledWith(error, {
        source: 'library-remote',
        tags: { operation, code, status: String(status) },
      });
      expectNoServerText(captureError.mock.calls);
    },
  );

  it('reports a code that is not an identifier without it', async () => {
    const { backend, repository, captureError } = setup();
    backend.respondNext(serverError(400, `bad ${TITLE_TEXT}`));

    await expect(repository.save(entryOf())).rejects.toMatchObject({ reason: 'rejected' });
    expect(captureError.mock.calls[0]?.[1]).toStrictEqual({
      source: 'library-remote',
      tags: { operation: 'save', status: '400' },
    });
  });

  it.each([
    { label: 'a 500', operation: 'remove', respond: serverError(500, 'XX000'), status: '500' },
    {
      label: 'a save without its row',
      operation: 'save',
      respond: () => new HttpResponse(null, { status: 201 }),
      status: '201',
    },
    {
      label: 'a page without rows',
      operation: 'list',
      respond: () => new HttpResponse(null, { status: 200 }),
      status: '200',
    },
  ] as const)('rejects $label with unknown, reported', async ({ operation, respond, status }) => {
    const { backend, repository, captureError } = setup();
    backend.respondNext(respond);

    const error = await failureOf(call(repository, operation));

    expect(error).toMatchObject({ reason: 'unknown' });
    expectNoServerText(error);
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError.mock.calls[0]?.[1]?.tags).toMatchObject({ operation, status });
  });

  it('rejects an error thrown by the client with unknown, reported without a status', async () => {
    const { repository, client, captureError } = setup();
    jest.spyOn(client, 'from').mockImplementation(() => {
      throw new Error(`client bug ${TITLE_TEXT}`);
    });

    const error = await failureOf(repository.list());

    expect(error).toMatchObject({ reason: 'unknown' });
    expectNoServerText(error);
    expect(captureError).toHaveBeenCalledWith(error, {
      source: 'library-remote',
      tags: { operation: 'list' },
    });
  });

  it('rejects a read still unavailable after the client retries with network', async () => {
    const { backend, repository } = setup();
    // postgrest-js retries a GET answered 503 three times, after 1, 2 and 4 seconds
    for (let attempt = 0; attempt < 4; attempt += 1) {
      backend.respondNext(serverError(503, 'PGRST002'));
    }

    const result = failureOf(repository.list());
    await jest.advanceTimersByTimeAsync(7000);

    await expect(result).resolves.toMatchObject({ reason: 'network' });
    expect(backend.requests).toHaveLength(4);
  });
});

describe('createSupabaseLibraryRepository timeout', () => {
  const stalled = () => new Promise<Response>(() => undefined);

  it.each<Operation>(['save', 'get'])(
    'aborts a stalled %s after the timeout, rejecting with network',
    async (operation) => {
      const { backend, repository, captureError } = setup();
      backend.respondNext(stalled);
      let settled = false;
      const result = failureOf(call(repository, operation)).finally(() => {
        settled = true;
      });

      await jest.advanceTimersByTimeAsync(LIBRARY_REQUEST_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);

      await expect(result).resolves.toMatchObject({ reason: 'network' });
      expect(captureError).not.toHaveBeenCalled();
    },
  );

  // msw answers a request aborted before its handler answered with a 500; the platform fetch
  // rejects instead, which this stub reproduces
  it('rejects with network when the fetch rejects on the abort', async () => {
    const { repository } = setup();
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('This operation was aborted', 'AbortError'));
          });
        }),
    );

    const result = failureOf(repository.remove(ENTRY_KEY));
    await jest.advanceTimersByTimeAsync(LIBRARY_REQUEST_TIMEOUT_MS);

    await expect(result).resolves.toMatchObject({ reason: 'network' });
  });

  it('clears its timer once the request settled', async () => {
    const { repository } = setup();
    const setTimer = jest.spyOn(globalThis, 'setTimeout');
    const clearTimer = jest.spyOn(globalThis, 'clearTimeout');

    await repository.save(entryOf());
    await repository.list();

    const timers = setTimer.mock.calls.flatMap((args, index) =>
      args[1] === LIBRARY_REQUEST_TIMEOUT_MS ? [setTimer.mock.results[index]?.value] : [],
    );
    expect(timers).toHaveLength(2);
    const cleared = clearTimer.mock.calls.map(([timer]) => timer);
    for (const timer of timers) {
      expect(cleared).toContain(timer);
    }
  });
});
