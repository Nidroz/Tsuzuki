import { describe, expect, it, jest } from '@jest/globals';
import { HttpResponse, type JsonBodyType } from 'msw';

import {
  ENTRY_KEY,
  NOTES_TEXT,
  TITLE_TEXT,
  entryOf,
  keyOf,
} from '../../../../test/core/library-entry-fixtures';
import { failureOf } from '../../../../test/core/library-repository-contract-support';
import { server } from '../../../../test/core/msw-server';
import type { LibraryQueuedWrite } from '../../domain/library-sync';
import {
  OTHER_USER_ID,
  SESSION_STORAGE_KEY,
  createAccountLibrary,
  sessionOf,
} from './__fixtures__/account-library';
import { USER_ID } from './__fixtures__/auth-handlers';
import { accessTokenOf } from './__fixtures__/library-handlers';
import { SERVER_DETAIL_PREFIX } from './__fixtures__/postgrest-fake';
import { LIBRARY_REQUEST_TIMEOUT_MS } from './library-requests';

// the failures of a replay call (ADR-0017): every write applied or none, the answer confirming the
// writes only when it holds each key once as rows of the store's user

const LATER = '2026-02-20T08:00:00.000Z';
const OTHER_KEY = keyOf('manga', 8);

// a save of ENTRY_KEY and a removal of manga 8
const WRITES: readonly LibraryQueuedWrite[] = [
  { type: 'save', entry: entryOf({ notes: NOTES_TEXT, updatedAt: LATER }) },
  { type: 'remove', key: OTHER_KEY, removedAt: LATER },
];

const setup = () => {
  const library = createAccountLibrary();
  server.use(library.backend.handler);
  return library;
};

// an answer row as postgrest returns it, of ENTRY_KEY unless overridden
const answerRow = (overrides: Record<string, unknown> = {}) => ({
  id_namespace: ENTRY_KEY.namespace,
  media_kind: ENTRY_KEY.kind,
  external_id: ENTRY_KEY.externalId,
  user_id: USER_ID,
  outcome: 'written',
  ...overrides,
});
const OTHER_ROW = answerRow({ media_kind: 'manga', external_id: 8, outcome: 'kept' });

const answer = (body: JsonBodyType) => () => HttpResponse.json(body, { status: 200 });

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

const expectNoValue = (value: unknown): void => {
  const text = `${String(value)} ${JSON.stringify(value)}`;
  for (const forbidden of [TITLE_TEXT, NOTES_TEXT, SERVER_DETAIL_PREFIX, USER_ID, '52991']) {
    expect(text).not.toContain(forbidden);
  }
};

describe('replayWrites answer', () => {
  it('rejects an answer row of another user with signed-out, never reported', async () => {
    const { backend, repository, captureError } = setup();
    backend.respondNext(answer([answerRow({ user_id: OTHER_USER_ID }), OTHER_ROW]), 'POST');

    const error = await failureOf(repository.replayWrites(WRITES));

    expect(error).toMatchObject({ name: 'LibraryRemoteError', reason: 'signed-out' });
    expect(String(error)).not.toContain(OTHER_USER_ID);
    expect(captureError).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'a missing write', body: [answerRow()] },
    { label: 'a key twice', body: [answerRow(), answerRow(), OTHER_ROW] },
    { label: 'a repeated key in place of another', body: [answerRow(), answerRow()] },
    { label: 'a key of no write', body: [answerRow(), answerRow({ external_id: 404 })] },
    { label: 'no row', body: [] },
    { label: 'an object', body: answerRow() },
    { label: 'a row without its user', body: [{ ...answerRow(), user_id: undefined }, OTHER_ROW] },
    { label: 'an unknown outcome', body: [answerRow({ outcome: 'merged' }), OTHER_ROW] },
  ])('rejects an answer of $label with unknown, reported', async ({ body }) => {
    const { backend, repository, captureError } = setup();
    backend.respondNext(answer(body), 'POST');

    const error = await failureOf(repository.replayWrites(WRITES));

    expect(error).toMatchObject({ name: 'LibraryRemoteError', reason: 'unknown' });
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(error, {
      source: 'library-remote',
      tags: { operation: 'replay', status: '200' },
    });
    expectNoValue(captureError.mock.calls);
  });

  it('rejects a success without a body with unknown, reported', async () => {
    const { backend, repository, captureError } = setup();
    backend.respondNext(() => new HttpResponse(null, { status: 200 }), 'POST');

    await expect(repository.replayWrites(WRITES)).rejects.toMatchObject({ reason: 'unknown' });
    expect(captureError).toHaveBeenCalledTimes(1);
  });
});

describe('replayWrites failures', () => {
  it.each([
    { label: 'no response', respond: () => HttpResponse.error() },
    { label: 'a 503', respond: serverError(503, 'PGRST002') },
  ])('rejects $label with network, never reported, writing nothing', async ({ respond }) => {
    const { backend, repository, captureError } = setup();
    backend.respondNext(respond, 'POST');

    const error = await failureOf(repository.replayWrites(WRITES));

    expect(error).toMatchObject({ reason: 'network' });
    expectNoValue(error);
    expect(backend.rows).toStrictEqual([]);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('aborts a stalled call after the timeout, rejecting with network', async () => {
    const { backend, repository, captureError } = setup();
    backend.respondNext(() => new Promise<Response>(() => undefined), 'POST');
    let settled = false;
    const result = failureOf(repository.replayWrites(WRITES)).finally(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(LIBRARY_REQUEST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toMatchObject({ reason: 'network' });
    expect(captureError).not.toHaveBeenCalled();
  });

  it('rejects a 401 with signed-out, never reported', async () => {
    const { backend, repository, captureError } = setup();
    backend.respondNext(serverError(401, 'PGRST303'), 'POST');

    await expect(repository.replayWrites(WRITES)).rejects.toMatchObject({ reason: 'signed-out' });
    expect(captureError).not.toHaveBeenCalled();
  });

  it('rejects a refused input (22023) with rejected, reported with its code and status', async () => {
    const { backend, repository, captureError } = setup();
    backend.respondNext(serverError(400, '22023'), 'POST');

    const error = await failureOf(repository.replayWrites(WRITES));

    expect(error).toMatchObject({ name: 'LibraryRemoteError', reason: 'rejected' });
    expectNoValue(error);
    expect(captureError).toHaveBeenCalledWith(error, {
      source: 'library-remote',
      tags: { operation: 'replay', code: '22023', status: '400' },
    });
    expectNoValue(captureError.mock.calls);
  });

  // the token switched to another user after the session guard (the A-03 residual window): the
  // function refuses the call, and neither account is written. a session switch, not a refused
  // write: the device queue keeps the writes for their user and never marks them refused
  it("rejects a token of another user than the store's with signed-out (42501), unreported, writing nothing", async () => {
    const { backend, repository, session, captureError } = setup();
    session.values.set(
      SESSION_STORAGE_KEY,
      JSON.stringify({ ...sessionOf(USER_ID), access_token: accessTokenOf(OTHER_USER_ID) }),
    );

    const error = await failureOf(repository.replayWrites(WRITES));

    expect(error).toMatchObject({ name: 'LibraryRemoteError', reason: 'signed-out' });
    expect(backend.requests).toHaveLength(1);
    expect(backend.rows).toStrictEqual([]);
    expect(captureError).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'a 403', status: 403 },
    { label: 'a 401', status: 401 },
  ])('rejects a 42501 answer ($label) with signed-out, unreported', async ({ status }) => {
    const { backend, repository, captureError } = setup();
    backend.respondNext(serverError(status, '42501'), 'POST');

    const error = await failureOf(repository.replayWrites(WRITES));

    expect(error).toMatchObject({ reason: 'signed-out' });
    expectNoValue(error);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('still rejects another refusal of the database (a 403 of another code) with rejected', async () => {
    const { backend, repository, captureError } = setup();
    backend.respondNext(serverError(403, '42P01'), 'POST');

    const error = await failureOf(repository.replayWrites(WRITES));

    expect(error).toMatchObject({ reason: 'rejected' });
    expect(captureError).toHaveBeenCalledWith(error, {
      source: 'library-remote',
      tags: { operation: 'replay', code: '42P01', status: '403' },
    });
  });

  it('rejects an error thrown by the client with unknown, reported without a status', async () => {
    const { repository, client, captureError } = setup();
    jest.spyOn(client, 'rpc').mockImplementation(() => {
      throw new Error(`client bug ${TITLE_TEXT}`);
    });

    const error = await failureOf(repository.replayWrites(WRITES));

    expect(error).toMatchObject({ reason: 'unknown' });
    expectNoValue(error);
    expect(captureError).toHaveBeenCalledWith(error, {
      source: 'library-remote',
      tags: { operation: 'replay' },
    });
  });
});
