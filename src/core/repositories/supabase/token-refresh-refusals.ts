// the link between the supabase client's fetch, which sees a token refresh refused
// (createSupabaseClient's onTokenRefreshRefused), and the auth repository, which probes whether
// the session's user is gone (user-gone-detector.ts, ADR-0018 update of 2026-11-04). the
// composition root creates one signal and gives `notify` to the client and the signal itself to
// the repository, so neither module knows the other. a refusal carries nothing: no status, no
// body, no token

/** the refused token refreshes, as the auth repository listens to them. */
export interface TokenRefreshRefusals {
  /** calls `listener` once per refused refresh, from now on; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** a TokenRefreshRefusals whose refusals are told by `notify`. */
export interface TokenRefreshRefusalSignal extends TokenRefreshRefusals {
  /** tells every listener of one refusal; the onTokenRefreshRefused of the client. */
  readonly notify: () => void;
}

/**
 * a signal with no listener yet: a refusal told while nobody listens is lost, the auth repository
 * subscribes when it is created. the listeners are called synchronously, in subscription order,
 * and must not throw.
 */
export const createTokenRefreshRefusalSignal = (): TokenRefreshRefusalSignal => {
  const listeners = new Set<() => void>();
  return {
    notify: () => {
      for (const listener of [...listeners]) {
        listener();
      }
    },
    subscribe: (listener) => {
      // a wrapper per subscription, so the same function subscribed twice unsubscribes once each
      const entry = (): void => {
        listener();
      };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
  };
};
