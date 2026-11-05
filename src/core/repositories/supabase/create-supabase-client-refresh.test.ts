import { describe, expect, it, jest } from '@jest/globals';
import { AuthApiError } from '@supabase/supabase-js';
import { http, HttpResponse } from 'msw';

import { server } from '../../../../test/core/msw-server';
import { SupabaseRequestAbortedError } from '../../errors/supabase-errors';
import {
  AUTH_URL,
  EMAIL,
  PASSWORD,
  PROJECT_URL,
  REFRESH_TOKEN,
  createMemorySessionStorage,
  createSession,
} from './__fixtures__/auth-handlers';
import { SESSION_STORAGE_KEY } from './__fixtures__/account-library';
import {
  SUPABASE_FETCH_TIMEOUT_MS,
  createBoundedFetch,
  createSupabaseClient,
  tokenRefreshUrl,
} from './create-supabase-client';

// the refused token refresh signal of the bounded fetch (ADR-0018, update of 2026-11-04): only a
// 4xx other than 408 and 429 answered to POST <project>/auth/v1/token?grant_type=refresh_token,
// told asynchronously, with nothing read but the status, the url and the method

const REFRESH_URL = `${AUTH_URL}/token?grant_type=refresh_token`;
const PASSWORD_URL = `${AUTH_URL}/token?grant_type=password`;
const ANON_KEY = 'anon-key';
// the auto refresh tick of auth-js, which bounds its retries of a refresh
const AUTO_REFRESH_TICK_MS = 30_000;

const never = () => new Promise<Response>(() => undefined);

// a bounded fetch observing PROJECT_URL, its observer, and the global fetch answering `status`
const setup = (status = 400) => {
  const onRefused = jest.fn<() => void>();
  const response = new Response('{"error_code":"refresh_token_not_found"}', { status });
  const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);
  const boundedFetch = createBoundedFetch(SUPABASE_FETCH_TIMEOUT_MS, {
    projectUrl: PROJECT_URL,
    onRefused,
  });
  return { onRefused, response, fetchSpy, boundedFetch };
};

// the microtasks queued by a settled fetch
const settle = () => jest.advanceTimersByTimeAsync(0);

describe('tokenRefreshUrl', () => {
  it.each([PROJECT_URL, `${PROJECT_URL}/`, ` ${PROJECT_URL} `])(
    'builds the refresh url of auth-js from %p',
    (projectUrl) => {
      expect(tokenRefreshUrl(projectUrl)).toBe(REFRESH_URL);
    },
  );

  it('keeps a path of the project url, as supabase-js does', () => {
    expect(tokenRefreshUrl('http://127.0.0.1:54321/base')).toBe(
      'http://127.0.0.1:54321/base/auth/v1/token?grant_type=refresh_token',
    );
  });
});

describe('createBoundedFetch refresh observer', () => {
  it.each([400, 401, 403, 404, 422])(
    'tells a %i refresh once, after the response, which reaches the caller unread',
    async (status) => {
      const { onRefused, response, boundedFetch } = setup(status);

      const result = boundedFetch(REFRESH_URL, { method: 'POST', body: '{}' });
      expect(onRefused).not.toHaveBeenCalled();
      await expect(result).resolves.toBe(response);
      await settle();

      expect(onRefused).toHaveBeenCalledTimes(1);
      expect(onRefused).toHaveBeenCalledWith();
      expect(response.bodyUsed).toBe(false);
    },
  );

  it('tells a refresh sent as a Request or a URL', async () => {
    const { onRefused, boundedFetch } = setup();

    await boundedFetch(new Request(REFRESH_URL, { method: 'POST' }));
    await boundedFetch(new URL(REFRESH_URL), { method: 'post' });
    await settle();

    expect(onRefused).toHaveBeenCalledTimes(2);
  });

  it.each([200, 408, 429, 500, 502, 503, 504])('never tells a %i refresh', async (status) => {
    const { onRefused, boundedFetch } = setup(status);

    await boundedFetch(REFRESH_URL, { method: 'POST' });
    await settle();

    expect(onRefused).not.toHaveBeenCalled();
  });

  it.each([
    ['the password grant', PASSWORD_URL, 'POST'],
    ['another auth path', `${AUTH_URL}/user`, 'GET'],
    ['the logout path', `${AUTH_URL}/logout?scope=local`, 'POST'],
    ['the refresh url with another query', `${REFRESH_URL}&extra=1`, 'POST'],
    [
      'another origin',
      'https://other-ref.supabase.co/auth/v1/token?grant_type=refresh_token',
      'POST',
    ],
    ['a GET of the refresh url', REFRESH_URL, 'GET'],
    ['the rest api', `${PROJECT_URL}/rest/v1/library_entries`, 'POST'],
  ])('never tells a 400 of %s', async (_case, url, method) => {
    const { onRefused, boundedFetch } = setup();

    await boundedFetch(url, { method });
    await settle();

    expect(onRefused).not.toHaveBeenCalled();
  });

  it('never tells a 400 of the refresh url sent without a method (a GET)', async () => {
    const { onRefused, boundedFetch } = setup();

    await boundedFetch(REFRESH_URL);
    await settle();

    expect(onRefused).not.toHaveBeenCalled();
  });

  it('never tells a refresh that failed with a network error', async () => {
    const { onRefused, fetchSpy, boundedFetch } = setup();
    const failure = new TypeError('Network request failed');
    fetchSpy.mockRejectedValue(failure);

    await expect(boundedFetch(REFRESH_URL, { method: 'POST' })).rejects.toBe(failure);
    await settle();

    expect(onRefused).not.toHaveBeenCalled();
  });

  it('never tells a refresh aborted by the timeout', async () => {
    const { onRefused, fetchSpy, boundedFetch } = setup();
    fetchSpy.mockImplementation(never);
    const result = boundedFetch(REFRESH_URL, { method: 'POST' }).catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(SUPABASE_FETCH_TIMEOUT_MS);

    await expect(result).resolves.toBeInstanceOf(SupabaseRequestAbortedError);
    expect(onRefused).not.toHaveBeenCalled();
  });

  it('observes nothing without an observer', async () => {
    const response = new Response('{}', { status: 400 });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    await expect(createBoundedFetch()(REFRESH_URL, { method: 'POST' })).resolves.toBe(response);
  });
});

describe('createSupabaseClient onTokenRefreshRefused', () => {
  // a client over a stored session, told of refusals
  const setupClient = () => {
    const session = createMemorySessionStorage();
    session.values.set(SESSION_STORAGE_KEY, JSON.stringify(createSession()));
    const onTokenRefreshRefused = jest.fn<() => void>();
    const client = createSupabaseClient({
      url: PROJECT_URL,
      anonKey: ANON_KEY,
      sessionStorage: session.storage,
      onTokenRefreshRefused,
    });
    return { client, onTokenRefreshRefused };
  };

  // the answer of the auth server to the refresh token of a deleted user or a revoked session
  const refusedRefresh = () =>
    HttpResponse.json(
      { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' },
      { status: 400 },
    );

  it('tells a refused refresh once; auth-js still reads the error code', async () => {
    const bodies: string[] = [];
    server.use(
      http.post(`${AUTH_URL}/token`, async ({ request }) => {
        bodies.push(await request.text());
        return refusedRefresh();
      }),
    );
    const { client, onTokenRefreshRefused } = setupClient();

    const { error } = await client.auth.refreshSession();
    await settle();

    expect(error).toBeInstanceOf(AuthApiError);
    expect(error).toMatchObject({ status: 400, code: 'refresh_token_not_found' });
    expect(bodies).toStrictEqual([JSON.stringify({ refresh_token: REFRESH_TOKEN })]);
    expect(onTokenRefreshRefused).toHaveBeenCalledTimes(1);
  });

  it('never tells a refused password sign in', async () => {
    server.use(
      http.post(`${AUTH_URL}/token`, () =>
        HttpResponse.json(
          { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' },
          { status: 400 },
        ),
      ),
    );
    const { client, onTokenRefreshRefused } = setupClient();

    const { error } = await client.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    await settle();

    expect(error).toMatchObject({ code: 'invalid_credentials' });
    expect(onTokenRefreshRefused).not.toHaveBeenCalled();
  });

  it('never tells a refresh the server could not judge, through the retries of auth-js', async () => {
    let attempts = 0;
    server.use(
      http.post(`${AUTH_URL}/token`, () => {
        attempts += 1;
        return HttpResponse.json({ code: 503, msg: 'unavailable' }, { status: 503 });
      }),
    );
    const { client, onTokenRefreshRefused } = setupClient();

    const refresh = client.auth.refreshSession();
    // auth-js retries a 5xx with a backoff, within one auto refresh tick
    await jest.advanceTimersByTimeAsync(AUTO_REFRESH_TICK_MS);
    const { error } = await refresh;

    expect(error).toMatchObject({ name: 'AuthRetryableFetchError' });
    expect(attempts).toBeGreaterThan(1);
    expect(onTokenRefreshRefused).not.toHaveBeenCalled();
  });
});
