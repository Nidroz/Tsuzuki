// the onUserGone of the supabase auth repository (ADR-0018, update of 2026-11-04). a refused token
// refresh is ambiguous (a deleted user and a revoked session both answer 400
// refresh_token_not_found), so each refusal starts a check of the session's own unexpired access
// token: only `user_not_found` from the auth server reports that session's user gone. it never
// signs out or purges: the hooks decide. no token, email or server text is ever reported; the
// user id only reaches the listeners
import { isAuthApiError, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { AuthError } from '../../errors/auth-errors';
import type { ErrorReporter } from '../../errors/error-reporter';
import type { UserGoneListener } from '../auth-repository';
import { authReportContext, type AuthOperation } from './auth-error-mapper';
import type { Database } from './database.types';
import type { TokenRefreshRefusals } from './token-refresh-refusals';

/** the auth error code of a token whose user no longer exists, the only signal of a user gone. */
export const USER_NOT_FOUND_CODE = 'user_not_found';

/**
 * the detections kept while no listener is subscribed, the most recent first to stay: one is the
 * normal case (a single session per device), a few cover a quick switch of accounts.
 */
export const MAX_PENDING_GONE_USERS = 4;

const OPERATION: AuthOperation = 'user-gone';
const MS_PER_SECOND = 1000;

// the parts of a supabase-js session the check reads: a session without them is never checked
const checkedSessionSchema = z.object({
  access_token: z.string().min(1),
  // seconds since the epoch
  expires_at: z.number(),
  user: z.object({ id: z.uuid() }),
});

export interface UserGoneDetectorOptions {
  /** the refused token refreshes; without them no check ever runs. */
  readonly refusals?: TokenRefreshRefusals | undefined;
  readonly reporter: ErrorReporter;
  /** the wall clock in ms, against which the access token's expiry is read. */
  readonly now: () => number;
}

export interface UserGoneDetector {
  /** the AuthRepository.onUserGone contract (../auth-repository.ts). */
  onUserGone(listener: UserGoneListener): () => void;
}

/** a detector over `auth`, subscribed to `refusals` for the lifetime of the app. */
export const createUserGoneDetector = (
  auth: SupabaseClient<Database>['auth'],
  { refusals, reporter, now }: UserGoneDetectorOptions,
): UserGoneDetector => {
  // an object per subscription, so one function subscribed twice is two listeners
  const listeners = new Set<{ readonly listener: UserGoneListener }>();
  // insertion order: the oldest goes first when the bound is reached
  const pending = new Set<string>();
  let checking = false;

  const reportUnknown = (): void => {
    reporter.captureError(new AuthError('unknown'), authReportContext(OPERATION, null));
  };

  const deliver = (listener: UserGoneListener, userId: string): void => {
    try {
      listener(userId);
    } catch {
      // the listener's error may quote anything: a fixed error only, the other listeners still run
      reportUnknown();
    }
  };

  const detected = (userId: string): void => {
    if (listeners.size === 0) {
      pending.delete(userId);
      pending.add(userId);
      const [oldest] = pending;
      if (pending.size > MAX_PENDING_GONE_USERS && oldest !== undefined) {
        pending.delete(oldest);
      }
      return;
    }
    for (const { listener } of [...listeners]) {
      deliver(listener, userId);
    }
  };

  const check = async (): Promise<void> => {
    const { data, error } = await auth.getSession();
    if (error !== null || data.session === null) {
      return;
    }
    const session = checkedSessionSchema.safeParse(data.session);
    if (!session.success) {
      return;
    }
    const { access_token: accessToken, expires_at: expiresAt, user } = session.data;
    // an expired token proves nothing (the server answers bad_jwt): no request
    if (expiresAt * MS_PER_SECOND <= now()) {
      return;
    }
    const { error: userError } = await auth.getUser(accessToken);
    if (isAuthApiError(userError) && userError.code === USER_NOT_FOUND_CODE) {
      detected(user.id);
    }
  };

  refusals?.subscribe(() => {
    if (checking) {
      return;
    }
    checking = true;
    void check()
      .catch(reportUnknown)
      .finally(() => {
        checking = false;
      });
  });

  return {
    onUserGone: (listener) => {
      const entry = { listener };
      listeners.add(entry);
      if (pending.size > 0) {
        // asynchronously, as onAuthStateChange gives its first session; to this listener only
        void Promise.resolve().then(() => {
          if (!listeners.has(entry)) {
            return;
          }
          const userIds = [...pending];
          pending.clear();
          for (const userId of userIds) {
            deliver(listener, userId);
          }
        });
      }
      return () => {
        listeners.delete(entry);
      };
    },
  };
};
