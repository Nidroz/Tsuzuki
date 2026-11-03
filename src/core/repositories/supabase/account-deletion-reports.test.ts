import { describe, expect, it, jest } from '@jest/globals';
import { HttpResponse } from 'msw';

import { server } from '../../../../test/core/msw-server';
import { ACCOUNT_DELETION_TIMEOUT_MS } from './account-deletion';
import { ACCESS_TOKEN, EMAIL, USER_ID } from './__fixtures__/auth-handlers';
import { DELETED, deletionError, setupDeletion } from './__fixtures__/delete-account-function';

// the unknown failures of the account deletion (account-deletion.ts, ADR-0018): each reported
// once, with the status and the function's fixed error code at most, never a server text, a token
// or a user id

// the function's handler registered for this test
const setup = (...args: Parameters<typeof setupDeletion>) => {
  const deletion = setupDeletion(...args);
  server.use(deletion.handler);
  return deletion;
};

describe('requestAccountDeletion unknown failures', () => {
  it.each([
    [500, 'deletion-failed'],
    [500, 'server-misconfigured'],
    [405, 'method-not-allowed'],
  ])('rejects a %i answering %s as unknown, reported with both', async (status, code) => {
    const { answer, failureOf, captureError } = setup();
    answer(() => HttpResponse.json({ error: code }, { status }));

    const error = await failureOf();

    expect(error).toEqual(deletionError('unknown'));
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(captureError).toHaveBeenCalledWith(error, {
      source: 'auth',
      tags: { operation: 'delete-account', status: String(status), code },
    });
  });

  it.each([
    ['a server text holding the token and the user id', `${ACCESS_TOKEN} ${USER_ID} ${EMAIL}`],
    ['an error code the function never answers', { error: USER_ID }],
    ['json that is not an error body', { message: ACCESS_TOKEN }],
  ])('reports a 500 with %s by its status only, nothing personal', async (_label, body) => {
    const { answer, failureOf, captureError } = setup();
    answer(() =>
      typeof body === 'string'
        ? HttpResponse.text(body, { status: 500 })
        : HttpResponse.json(body, { status: 500 }),
    );

    const error = await failureOf();

    expect(captureError).toHaveBeenCalledWith(error, {
      source: 'auth',
      tags: { operation: 'delete-account', status: '500' },
    });
    const reported = JSON.stringify([captureError.mock.calls, String(error)]);
    expect(reported).not.toContain(ACCESS_TOKEN);
    expect(reported).not.toContain(USER_ID);
    expect(reported).not.toContain(EMAIL);
  });

  it.each([
    ['deleted false', () => HttpResponse.json({ deleted: false })],
    ['an empty object', () => HttpResponse.json({})],
    ['a text', () => HttpResponse.text('deleted')],
    ['a relay error', () => HttpResponse.json(DELETED, { headers: { 'x-relay-error': 'true' } })],
  ])('rejects a 200 answering %s as unknown, reported with its status', async (_label, respond) => {
    const { answer, failureOf, captureError } = setup();
    answer(respond);

    const error = await failureOf();

    expect(error).toEqual(deletionError('unknown'));
    expect(captureError).toHaveBeenCalledWith(error, {
      source: 'auth',
      tags: { operation: 'delete-account', status: '200' },
    });
  });

  it('reports a 500 whose body never ends by its status, once the timeout passed', async () => {
    const { answer, failureOf, captureError } = setup();
    answer(() => new HttpResponse(new ReadableStream(), { status: 500 }));
    let settled = false;
    const result = failureOf().finally(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(ACCOUNT_DELETION_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    const error = await result;
    expect(error).toEqual(deletionError('unknown'));
    expect(captureError).toHaveBeenCalledWith(error, {
      source: 'auth',
      tags: { operation: 'delete-account', status: '500' },
    });
  });

  it('rejects a json answer that does not parse as unknown, reported without a status', async () => {
    const { answer, failureOf, captureError } = setup();
    answer(
      () => new HttpResponse('{"deleted":', { headers: { 'Content-Type': 'application/json' } }),
    );

    const error = await failureOf();

    expect(error).toEqual(deletionError('unknown'));
    expect(captureError).toHaveBeenCalledWith(error, {
      source: 'auth',
      tags: { operation: 'delete-account' },
    });
  });

  it('rejects a client that throws as unknown, reported', async () => {
    const { client, failureOf, captureError } = setup();
    Object.defineProperty(client, 'functions', {
      value: { invoke: () => Promise.reject(new Error(`invoke failed for ${EMAIL}`)) },
    });

    const error = await failureOf();

    expect(error).toEqual(deletionError('unknown'));
    expect(captureError).toHaveBeenCalledWith(error, {
      source: 'auth',
      tags: { operation: 'delete-account' },
    });
  });
});
