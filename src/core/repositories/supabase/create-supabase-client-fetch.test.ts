import { describe, expect, it, jest } from '@jest/globals';
import { http } from 'msw';

import { takeUnexpectedConsoleMessages } from '../../../../test/core/fail-on-console';
import { server } from '../../../../test/core/msw-server';
import { SupabaseRequestAbortedError } from '../../errors/supabase-errors';
import { AUTH_URL, PROJECT_URL, createMemorySessionStorage } from './__fixtures__/auth-handlers';
import { SESSION_STORAGE_KEY, sessionOf } from './__fixtures__/account-library';
import {
  SUPABASE_FETCH_TIMEOUT_MS,
  createBoundedFetch,
  createSupabaseClient,
} from './create-supabase-client';

// the bound of every request of the supabase client (ADR-0017): a stalled request, such as the
// single token refresh auth-js runs without a timeout of its own, never holds its callers forever

const URL_OF_REQUEST = `${PROJECT_URL}/rest/v1/library_entries`;
const ANON_KEY = 'anon-key';
const OK = 200;
const SECONDS_AGO = 60;
const MS_PER_SECOND = 1000;

const never = () => new Promise<Response>(() => undefined);

// the signal the global fetch was called with
const signalOf = (fetchSpy: { mock: { calls: unknown[][] } }): AbortSignal | undefined => {
  const init: unknown = fetchSpy.mock.calls[0]?.[1];
  return init instanceof Object && 'signal' in init && init.signal instanceof AbortSignal
    ? init.signal
    : undefined;
};

describe('createBoundedFetch', () => {
  it('passes the response through and clears its timer', async () => {
    const response = new Response('[]', { status: OK });
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    await expect(createBoundedFetch()(URL_OF_REQUEST, { method: 'GET' })).resolves.toBe(response);

    expect(fetchSpy).toHaveBeenCalledWith(
      URL_OF_REQUEST,
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }),
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects with the error of a failed fetch and clears its timer', async () => {
    const failure = new TypeError('Network request failed');
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(failure);

    await expect(createBoundedFetch()(URL_OF_REQUEST)).rejects.toBe(failure);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('aborts a request without a response after SUPABASE_FETCH_TIMEOUT_MS, not before', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(never);
    let settled = false;
    const result = createBoundedFetch()(URL_OF_REQUEST)
      .catch((error: unknown) => error)
      .finally(() => {
        settled = true;
      });

    await jest.advanceTimersByTimeAsync(SUPABASE_FETCH_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    expect(signalOf(fetchSpy)?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toBeInstanceOf(SupabaseRequestAbortedError);
    expect(signalOf(fetchSpy)?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("aborts the request with the caller's signal and stops listening to it once settled", async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(never);
    const caller = new AbortController();
    const removeListener = jest.spyOn(caller.signal, 'removeEventListener');
    const result = createBoundedFetch()(URL_OF_REQUEST, { signal: caller.signal });

    caller.abort();

    await expect(result).rejects.toBeInstanceOf(SupabaseRequestAbortedError);
    expect(signalOf(fetchSpy)?.aborted).toBe(true);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(jest.getTimerCount()).toBe(0);
  });

  it("rejects at once under a caller's signal already aborted", async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(never);
    const caller = new AbortController();
    caller.abort();

    await expect(
      createBoundedFetch()(URL_OF_REQUEST, { signal: caller.signal }),
    ).rejects.toBeInstanceOf(SupabaseRequestAbortedError);
    expect(signalOf(fetchSpy)?.aborted).toBe(true);
  });
});

describe('createSupabaseClient fetch bound', () => {
  it('releases the session read of a token refresh that never answers', async () => {
    server.use(http.post(`${AUTH_URL}/token`, never));
    const session = createMemorySessionStorage();
    const expired = {
      ...sessionOf('00000000-0000-4000-8000-000000000001'),
      expires_at: Math.floor(Date.now() / MS_PER_SECOND) - SECONDS_AGO,
    };
    session.values.set(SESSION_STORAGE_KEY, JSON.stringify(expired));
    const client = createSupabaseClient({
      url: PROJECT_URL,
      anonKey: ANON_KEY,
      sessionStorage: session.storage,
    });
    let settled = false;
    const read = client.auth.getSession().finally(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(SUPABASE_FETCH_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);

    const { data, error } = await read;
    expect(data.session).toBeNull();
    expect(error).toMatchObject({ name: 'AuthRetryableFetchError' });
    // auth-js warns of the failed refresh itself; the warning holds no token
    const warnings = takeUnexpectedConsoleMessages();
    expect(warnings).toStrictEqual([expect.stringContaining('AuthRetryableFetchError')]);
    expect(warnings.join()).not.toContain(expired.refresh_token);
  });
});
