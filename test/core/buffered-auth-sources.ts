// auth sources a test drives for the auth repository overrides of renderDevicePurgeDriver, when a
// report comes before the driver listens: a session reported only when the test says (the session
// still loading until then), and users gone delivered as the supabase repository delivers them
// (src/core/repositories/supabase/user-gone-detector.ts), kept while no listener is subscribed
import type {
  AuthSession,
  AuthSessionListener,
  UserGoneListener,
} from '@core/repositories/auth-repository';

/**
 * for the onAuthStateChange override: a listener gets no session until `report(session)`, so the
 * session stays loading until then; then every report reaches every listener
 */
export const createLateSessionSource = () => {
  const listeners = new Set<AuthSessionListener>();
  return {
    subscribe: (listener: AuthSessionListener): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    report: (session: AuthSession | null): void => {
      for (const listener of [...listeners]) {
        listener(session);
      }
    },
  };
};

/**
 * for the onUserGone override, as the supabase repository: `report(userId)` calls every subscribed
 * listener synchronously; with none subscribed, the id is kept (each once, a repeat moved last)
 * and delivered once, asynchronously (a microtask), to the next listener that subscribes, still
 * subscribed by then
 */
export const createBufferedUserGoneSource = () => {
  // an object per subscription, so one function subscribed twice is two listeners
  const listeners = new Set<{ readonly listener: UserGoneListener }>();
  const pending = new Set<string>();
  return {
    subscribe: (listener: UserGoneListener): (() => void) => {
      const entry = { listener };
      listeners.add(entry);
      if (pending.size > 0) {
        void Promise.resolve().then(() => {
          if (!listeners.has(entry)) {
            return;
          }
          const userIds = [...pending];
          pending.clear();
          for (const userId of userIds) {
            listener(userId);
          }
        });
      }
      return () => {
        listeners.delete(entry);
      };
    },
    report: (userId: string): void => {
      if (listeners.size === 0) {
        pending.delete(userId);
        pending.add(userId);
        return;
      }
      for (const { listener } of [...listeners]) {
        listener(userId);
      }
    },
    listenerCount: (): number => listeners.size,
    /** the ids kept for the next listener, oldest first */
    pending: (): readonly string[] => [...pending],
  };
};
