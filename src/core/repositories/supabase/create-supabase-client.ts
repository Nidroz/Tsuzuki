import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { SupabaseRequestAbortedError } from '../../errors/supabase-errors';
import type { SessionStorage } from '../session-storage';
import type { Database } from './database.types';

/**
 * the time any request of the supabase client may take until its response arrives (ADR-0017).
 * auth-js runs one token refresh at a time and has no timeout of its own, so a stalled refresh
 * request would keep every later session read waiting until the app restarts. the library calls
 * keep their own, shorter bound (LIBRARY_REQUEST_TIMEOUT_MS).
 */
export const SUPABASE_FETCH_TIMEOUT_MS = 30_000;

// a promise rejected once `signal` aborts: the response is never awaited past the abort, even
// from a fetch implementation that ignores the signal
const abortedBy = (signal: AbortSignal): Promise<never> =>
  new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(new SupabaseRequestAbortedError());
      return;
    }
    signal.addEventListener('abort', () => {
      reject(new SupabaseRequestAbortedError());
    });
  });

/** who learns that the auth server refused a token refresh (ADR-0018, update of 2026-11-04). */
export interface TokenRefreshObserver {
  /** the supabase project url, as given to the client: only its token endpoint is observed. */
  readonly projectUrl: string;
  /**
   * called once per refused refresh, asynchronously (a microtask queued once the response
   * arrived, never inside the fetch call): it learns nothing but the refusal. it must not throw:
   * a throw would be an unhandled rejection, never an error of the fetch.
   */
  readonly onRefused: () => void;
}

const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_SERVER_ERROR_MIN = 500;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_MANY_REQUESTS = 429;
const REFRESH_METHOD = 'POST';

/**
 * the url auth-js posts a token refresh to: the auth url supabase-js builds from the project url
 * (`new URL('auth/v1', <url with a trailing slash>)`), then `/token?grant_type=refresh_token`.
 * compared as a whole string, so another origin, path, grant or query never matches.
 */
export const tokenRefreshUrl = (projectUrl: string): string => {
  const trimmed = projectUrl.trim();
  const base = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  return `${new URL('auth/v1', base).href}/token?grant_type=refresh_token`;
};

// what fetch may be called with: a url string, a URL or a Request
type FetchInput = RequestInfo | URL;

// the url and method of a request, whatever form fetch was called with; never its body
const requestUrlOf = (input: FetchInput): string => {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
};

const requestMethodOf = (input: FetchInput, init?: RequestInit): string => {
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  return method.toUpperCase();
};

// a client error that judges the refresh token: a timeout (408) or a rate limit (429) does not
const refusesRefresh = (status: number): boolean =>
  status >= HTTP_CLIENT_ERROR_MIN &&
  status < HTTP_SERVER_ERROR_MIN &&
  status !== HTTP_REQUEST_TIMEOUT &&
  status !== HTTP_TOO_MANY_REQUESTS;

/**
 * `fetch` aborted when its response has not arrived after `timeoutMs`, or when the caller's
 * `init.signal` aborts. a plain controller and timer: react native has neither AbortSignal.timeout
 * nor AbortSignal.any. the global fetch is read at call time, never captured at creation. the
 * bound ends with the response: reading its body is the caller's part.
 *
 * with `refreshObserver`, a response to the token refresh request (POST tokenRefreshUrl) with a
 * 4xx other than 408 and 429 calls its `onRefused` once, asynchronously: only the status, the url
 * and the method are read, never a body or a header, and the response reaches the caller unchanged.
 */
export const createBoundedFetch = (
  timeoutMs: number = SUPABASE_FETCH_TIMEOUT_MS,
  refreshObserver?: TokenRefreshObserver,
): typeof fetch => {
  const refreshUrl =
    refreshObserver === undefined ? null : tokenRefreshUrl(refreshObserver.projectUrl);
  const isRefresh = (input: FetchInput, init?: RequestInit): boolean =>
    refreshUrl !== null &&
    requestUrlOf(input) === refreshUrl &&
    requestMethodOf(input, init) === REFRESH_METHOD;

  return async (input, init) => {
    const callerSignal = init?.signal ?? null;
    const controller = new AbortController();
    const abort = (): void => {
      controller.abort();
    };
    if (callerSignal?.aborted === true) {
      abort();
    } else {
      callerSignal?.addEventListener('abort', abort);
    }
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await Promise.race([
        globalThis.fetch(input, { ...init, signal: controller.signal }),
        abortedBy(controller.signal),
      ]);
      if (
        refreshObserver !== undefined &&
        refusesRefresh(response.status) &&
        isRefresh(input, init)
      ) {
        // queued, not called: the observer never delays the response nor throws into the fetch
        void Promise.resolve().then(() => {
          refreshObserver.onRefused();
        });
      }
      return response;
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', abort);
    }
  };
};

interface SupabaseClientConfig {
  url: string;
  // the public anon key: the service role key never reaches the app (CONTRIBUTING §7)
  anonKey: string;
  sessionStorage: SessionStorage;
  /**
   * called once per token refresh the auth server refused (TokenRefreshObserver.onRefused): the
   * `notify` of a TokenRefreshRefusalSignal (token-refresh-refusals.ts) whose other end goes to the
   * auth repository. left out, no refresh is observed.
   */
  onTokenRefreshRefused?: () => void;
}

/**
 * a supabase client whose auth session is stored only in `sessionStorage`, and whose every
 * request is bounded by SUPABASE_FETCH_TIMEOUT_MS; a refused token refresh calls
 * `onTokenRefreshRefused` when given.
 */
export const createSupabaseClient = ({
  url,
  anonKey,
  sessionStorage,
  onTokenRefreshRefused,
}: SupabaseClientConfig): SupabaseClient<Database> =>
  createClient<Database>(url, anonKey, {
    auth: {
      storage: sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      // mobile: the app parses its own deep links and validates them with zod
      detectSessionInUrl: false,
      flowType: 'pkce',
      // each email link carries its flow id (sb_flow_id), which selects its own verifier
      // (ADR-0014); the redirect allow list accepts the extra param (supabase/config.toml)
      experimental: { appendPkceFlowIdToRedirects: true },
    },
    global: {
      fetch: createBoundedFetch(
        SUPABASE_FETCH_TIMEOUT_MS,
        onTokenRefreshRefused === undefined
          ? undefined
          : { projectUrl: url, onRefused: onTokenRefreshRefused },
      ),
    },
  });
