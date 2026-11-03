import type { QueryClient } from '@tanstack/react-query';

import { DevicePurgeError, type DevicePurgeStep } from '../errors/device-purge-errors';
import type { ErrorReporter } from '../errors/error-reporter';
import type {
  GuestLibraryRepository,
  OfflineAccountLibraryRepository,
} from '../repositories/library-repository';
import type { RecentSearchesRepository } from '../repositories/recent-searches-repository';
import type { GuestMergeStatus } from './guest-merge-context';

const REPORT_SOURCE = 'device-purge';

// the merge has not concluded: the guest store may hold entries the account lacks
const GUEST_LIBRARY_KEPT_STATUSES: ReadonlySet<GuestMergeStatus> = new Set([
  'checking',
  'merging',
  'failed',
]);

/**
 * whether a sign out keeps the guest library (ADR-0018), from the merge status read before the
 * session ends: kept while the merge is `checking`, `merging` or `failed` (guest data the account
 * has not confirmed, shown again as the guest library and merged at the next sign in), cleared once
 * `idle` (the merge concluded: the guest store holds nothing the account lacks, BR-08)
 */
export const keepsGuestLibrary = (status: GuestMergeStatus): boolean =>
  GUEST_LIBRARY_KEPT_STATUSES.has(status);

export interface DevicePurgeInput {
  /** the account instance of the session that ends: its device copy and write queue go */
  readonly account: OfflineAccountLibraryRepository;
  readonly guest: GuestLibraryRepository;
  /** false keeps the guest library (keepsGuestLibrary) */
  readonly clearGuestLibrary: boolean;
  readonly recentSearches: RecentSearchesRepository;
  readonly queryClient: QueryClient;
  /** deletes the persisted query cache document (the persister's removeClient) */
  readonly removePersistedCache: () => void | PromiseLike<void>;
  readonly reporter: ErrorReporter;
  /** adds one to the purge generation, which remounts the screens keyed with it */
  readonly advanceGeneration: () => void;
}

/**
 * deletes the signed-out user's data from the device (FR-24, FR-25, ADR-0018 "Device purge"), in
 * order: the account library copy and queue, the guest library (unless kept), the recent searches,
 * every query of the cache (mutations untouched: the running sign out lives there), then the
 * persisted cache document, so a later save holds only queries fetched after the purge, and last
 * the purge generation, so a screen remounted by it reads the purged state. each step is
 * independent: a failure is reported as a DevicePurgeError of its step (fixed message, no cause: a
 * storage error could quote stored content) and the next steps still run. never rejects
 */
export const purgeDeviceUserData = async (input: DevicePurgeInput): Promise<void> => {
  const runStep = async (
    step: DevicePurgeStep,
    action: () => void | PromiseLike<void>,
  ): Promise<void> => {
    try {
      await action();
    } catch {
      input.reporter.captureError(new DevicePurgeError(step), {
        source: REPORT_SOURCE,
        tags: { step },
      });
    }
  };

  await runStep('account-library', () => {
    input.account.purgeDeviceData();
  });
  if (input.clearGuestLibrary) {
    await runStep('guest-library', () => input.guest.clear());
  }
  await runStep('recent-searches', () => {
    input.recentSearches.clear();
  });
  await runStep('query-cache', () => {
    input.queryClient.removeQueries();
  });
  await runStep('persisted-cache', () => input.removePersistedCache());
  input.advanceGeneration();
};
