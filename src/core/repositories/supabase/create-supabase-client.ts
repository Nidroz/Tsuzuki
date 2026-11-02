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

/**
 * `fetch` aborted when its response has not arrived after `timeoutMs`, or when the caller's
 * `init.signal` aborts. a plain controller and timer: react native has neither AbortSignal.timeout
 * nor AbortSignal.any. the global fetch is read at call time, never captured at creation. the
 * bound ends with the response: reading its body is the caller's part.
 */
export const createBoundedFetch =
  (timeoutMs: number = SUPABASE_FETCH_TIMEOUT_MS): typeof fetch =>
  async (input, init) => {
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
      return await Promise.race([
        globalThis.fetch(input, { ...init, signal: controller.signal }),
        abortedBy(controller.signal),
      ]);
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', abort);
    }
  };

interface SupabaseClientConfig {
  url: string;
  // the public anon key: the service role key never reaches the app (CONTRIBUTING §7)
  anonKey: string;
  sessionStorage: SessionStorage;
}

/**
 * a supabase client whose auth session is stored only in `sessionStorage`, and whose every
 * request is bounded by SUPABASE_FETCH_TIMEOUT_MS.
 */
export const createSupabaseClient = ({
  url,
  anonKey,
  sessionStorage,
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
    global: { fetch: createBoundedFetch() },
  });
