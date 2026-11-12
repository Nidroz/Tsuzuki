import { LIBRARY_ENTRIES_PER_USER_MAX } from '@core/domain/database-limits';
import { LibraryRemoteError } from '@core/errors/library-errors';
import type { GuestMergeFailure } from '@core/hooks/use-guest-merge';
import type { Translation } from '@core/i18n/index';

/**
 * whether a failed library write was refused because the account library holds
 * LIBRARY_ENTRIES_PER_USER_MAX entries already (a new entry: an Add, a favorite, a save)
 */
export const isLibraryFullError = (error: unknown): boolean =>
  error instanceof LibraryRemoteError && error.reason === 'library-full';

/**
 * the message of a failed library write: a full library says so, with its formatted cap and how
 * to go on; any other failure shows `generic`, the screen's own text
 */
export const libraryWriteErrorText = (
  { t, formatNumber }: Translation,
  error: unknown,
  generic: string,
): string =>
  isLibraryFullError(error)
    ? t('library.full', { max: formatNumber(LIBRARY_ENTRIES_PER_USER_MAX) })
    : generic;

/**
 * the message of a failed guest merge (useGuestMerge): the account library full tells that the
 * titles stay on this device and how to go on (remove titles on another device, or sign out to
 * use them here); any other failure, the generic text
 */
export const guestMergeFailedText = (
  { t, formatNumber }: Translation,
  failure: GuestMergeFailure | undefined,
): string =>
  failure === 'library-full'
    ? t('library.merge.full', { max: formatNumber(LIBRARY_ENTRIES_PER_USER_MAX) })
    : t('library.merge.failed');
