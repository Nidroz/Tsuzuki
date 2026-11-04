import { useMutation } from '@tanstack/react-query';

import { AccountDeletionError } from '../errors/account-deletion-errors';
import { isAuthError, type AuthErrorReason } from '../errors/auth-errors';
import { isDeviceOnline } from '../query/online-manager';
import { keepsGuestLibrary } from './device-purge';
import { useSessionLibrary } from './session-library-context';
import { AUTH_MUTATION_OPTIONS } from './use-auth-mutations';
import { useAuthContext } from './use-auth-context';
import { useDevicePurge, useDevicePurgeContext } from './use-device-purge';
import { useGuestMerge } from './use-guest-merge';
import { useLatest } from './use-latest';

const REPORT_SOURCE = 'account-deletion';
const SIGN_OUT_STEP = 'sign-out';
// the reason tag of a local sign out that rejected with something else than an AuthError
const UNKNOWN_REASON = 'unknown';
// the AuthError reason the auth repository reports itself: reporting it here would report it twice
const REPOSITORY_REPORTED_REASON: AuthErrorReason = 'unknown';

// a local sign out failure the auth repository has not reported: any AuthError but its reported
// reason, and any other value
const isUnreported = (error: unknown): boolean =>
  !isAuthError(error) || error.reason !== REPOSITORY_REPORTED_REASON;

/**
 * deletes the account of the session (FR-24, ADR-0018 "Account deletion, client"), a mutation
 * without variables: (1) the session's account instance is taken as the call starts, none rejects
 * `session-expired`; (2) the device offline rejects `offline`; nothing is sent in either case;
 * (3) `deleteAccount()`: a rejection (an AccountDeletionError) rejects, nothing purged, still
 * signed in; (4) the device purge, the queued writes included (the account is gone), the guest
 * library kept while its merge has not concluded; (5) the local sign out: a rejection is reported
 * (an AuthError `unknown` by the auth repository only), not shown, and the mutation still
 * resolves. read inside every provider of the composition root
 */
export const useDeleteAccount = () => {
  const { repository } = useAuthContext();
  const { account } = useSessionLibrary();
  const { status } = useGuestMerge();
  const { reporter } = useDevicePurgeContext();
  const purge = useDevicePurge();
  const latest = useLatest({ account, status });
  return useMutation({
    ...AUTH_MUTATION_OPTIONS,
    mutationFn: async (): Promise<void> => {
      const sessionAccount = latest.current.account;
      if (sessionAccount === null) {
        throw new AccountDeletionError('session-expired');
      }
      if (!isDeviceOnline()) {
        throw new AccountDeletionError('offline');
      }
      await repository.deleteAccount();
      // the purge first: the device data is gone even if the sign out fails or the app is killed
      await purge({
        account: sessionAccount,
        clearGuestLibrary: !keepsGuestLibrary(latest.current.status),
      });
      try {
        await repository.signOut();
      } catch (error) {
        // the next token refresh fails and ends the session (ADR-0018 "Residuals")
        if (isUnreported(error)) {
          reporter.captureError(error, {
            source: REPORT_SOURCE,
            tags: {
              step: SIGN_OUT_STEP,
              reason: isAuthError(error) ? error.reason : UNKNOWN_REASON,
            },
          });
        }
      }
    },
  });
};
