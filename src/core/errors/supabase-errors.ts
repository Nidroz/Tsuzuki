// errors of the supabase client transport (src/core/repositories/supabase/). they never reach the
// user as such: supabase-js wraps a failed request into its own error, which the auth and library
// mappers read as a network failure. messages hold no value

/**
 * a request of the supabase client aborted before its response arrived, by the client's timeout
 * (SUPABASE_FETCH_TIMEOUT_MS) or by its caller's signal. named `AbortError` like the error of an
 * aborted fetch, so supabase-js handles both alike.
 */
export class SupabaseRequestAbortedError extends Error {
  constructor() {
    super('Supabase request aborted');
    this.name = 'AbortError';
  }
}
