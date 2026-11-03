import { describe, expect, it, jest } from '@jest/globals';
import { AuthRetryableFetchError } from '@supabase/supabase-js';
import { delay, http, HttpResponse } from 'msw';

import { server } from '../../../../test/core/msw-server';
import { ACCOUNT_DELETION_TIMEOUT_MS } from './account-deletion';
import {
  ACCESS_TOKEN,
  EMAIL,
  PASSWORD,
  createTestRepository,
  successHandlers,
} from './__fixtures__/auth-handlers';
import {
  DELETED,
  FUNCTION_URL,
  deletionError,
  setupDeletion,
} from './__fixtures__/delete-account-function';

// the account deletion request (account-deletion.ts, ADR-0018): what is sent, the session checked
// first, and the failures read as no answer (`network`) or a refused token (`session-expired`),
// never reported. the unknown failures and their reports: account-deletion-reports.test.ts

const NO_ANSWER_STATUSES = [408, 429, 502, 503, 504];

// the function's handler registered for this test
const setup = (...args: Parameters<typeof setupDeletion>) => {
  const deletion = setupDeletion(...args);
  server.use(deletion.handler);
  return deletion;
};

describe('requestAccountDeletion', () => {
  it('posts once to delete-account with the session token, no body and no query', async () => {
    const { answer, deleteAccount, requests, captureError } = setup();
    answer(() => HttpResponse.json(DELETED));

    await expect(deleteAccount()).resolves.toBeUndefined();

    expect(requests).toStrictEqual([
      { method: 'POST', search: '', body: '', authorization: `Bearer ${ACCESS_TOKEN}` },
    ]);
    expect(captureError).not.toHaveBeenCalled();
  });

  it('rejects with session-expired when the device holds no session, sending nothing', async () => {
    const { answer, failureOf, requests, captureError } = setup('none');
    answer(() => HttpResponse.json(DELETED));

    await expect(failureOf()).resolves.toEqual(deletionError('session-expired'));

    expect(requests).toStrictEqual([]);
    expect(captureError).not.toHaveBeenCalled();
  });

  // a token refresh failing offline answers an error; a broken client throws
  it.each(['answers an error', 'throws'] as const)(
    'rejects with network when the session read %s, sending nothing',
    async (failure) => {
      const { client, answer, failureOf, requests, captureError } = setup();
      answer(() => HttpResponse.json(DELETED));
      const getSession = jest.spyOn(client.auth, 'getSession');
      if (failure === 'throws') {
        getSession.mockRejectedValueOnce(new Error(`session failed for ${EMAIL}`));
      } else {
        getSession.mockResolvedValueOnce({
          data: { session: null },
          error: new AuthRetryableFetchError('Failed to fetch', 0),
        });
      }

      await expect(failureOf()).resolves.toEqual(deletionError('network'));

      expect(requests).toStrictEqual([]);
      expect(captureError).not.toHaveBeenCalled();
    },
  );

  it('rejects a session read that does not answer in time with network, sending nothing', async () => {
    const { answer, failureOf, requests } = setup('stalled');
    answer(() => HttpResponse.json(DELETED));
    let settled = false;
    const result = failureOf().finally(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(ACCOUNT_DELETION_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toEqual(deletionError('network'));
    expect(requests).toStrictEqual([]);
  });

  it('rejects a 401 with session-expired, unreported', async () => {
    const { answer, failureOf, captureError } = setup();
    answer(() => HttpResponse.json({ error: 'unauthorized' }, { status: 401 }));

    await expect(failureOf()).resolves.toEqual(deletionError('session-expired'));
    expect(captureError).not.toHaveBeenCalled();
  });

  it.each(NO_ANSWER_STATUSES)('rejects a %i with network, unreported', async (status) => {
    const { answer, failureOf, captureError } = setup();
    answer(() => HttpResponse.json({ error: 'unavailable' }, { status }));

    await expect(failureOf()).resolves.toEqual(deletionError('network'));
    expect(captureError).not.toHaveBeenCalled();
  });

  it('rejects a fetch error with network, unreported', async () => {
    const { answer, failureOf, captureError } = setup();
    answer(() => HttpResponse.error());

    await expect(failureOf()).resolves.toEqual(deletionError('network'));
    expect(captureError).not.toHaveBeenCalled();
  });

  it('aborts a request unanswered after the timeout and rejects it with network', async () => {
    const { answer, failureOf, requests, captureError } = setup();
    answer(async () => {
      await delay('infinite');
      return HttpResponse.json(DELETED);
    });
    let settled = false;
    const result = failureOf().finally(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(ACCOUNT_DELETION_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toEqual(deletionError('network'));
    expect(requests).toHaveLength(1);
    expect(captureError).not.toHaveBeenCalled();
  });
});

describe('createSupabaseAuthRepository deleteAccount', () => {
  it('deletes the account of the signed-in session, neither purging nor signing out', async () => {
    server.use(...successHandlers());
    const context = createTestRepository();
    await context.repository.signIn({ email: EMAIL, password: PASSWORD });
    const authorizations: (string | null)[] = [];
    server.use(
      http.post(FUNCTION_URL, ({ request }) => {
        authorizations.push(request.headers.get('authorization'));
        return HttpResponse.json(DELETED);
      }),
    );

    await expect(context.repository.deleteAccount()).resolves.toBeUndefined();

    expect(authorizations).toStrictEqual([`Bearer ${ACCESS_TOKEN}`]);
    expect(context.session.values.size).toBeGreaterThan(0);
  });
});
