import { LIBRARY_ENTRIES_PER_USER_MAX } from '@core/domain/database-limits';
import type { LibraryEntry } from '@core/domain/library-entry';
import { libraryEntryId } from '@core/domain/library-view';
import { compareMediaKeys } from '@core/domain/media';
import { useGuestMergeRoom, type GuestMergeRoomFailure } from '@core/hooks/use-guest-merge-room';
import { useTranslation, type TranslationKey } from '@core/i18n/index';
import { usePreferences } from '@core/preferences/index';
import {
  Button,
  EmptyState,
  ErrorState,
  InlineError,
  List,
  Notice,
  Spinner,
  Stack,
  Text,
  type StateAction,
} from '@ui/index';
import { useCallback, useMemo, useState, type ReactElement } from 'react';

import { GUEST_MERGE_FAILED_ANNOUNCE_KEY } from './announce-keys';
import { LibraryMergeRoomRow } from './LibraryMergeRoomRow';
import { LibraryMergeRoomSheet } from './LibraryMergeRoomSheet';

const FAILURE_KEYS = {
  offline: 'library.room.feedback.offline',
  failed: 'library.room.feedback.failed',
} as const satisfies Record<GuestMergeRoomFailure, TranslationKey>;

const keyOfEntry = (entry: LibraryEntry): string => libraryEntryId(entry.key);

export interface LibraryMergeRoomProps {
  /** shown instead while no room can be made (no account instance of the session) */
  fallback: ReactElement;
  /**
   * the view gets `testID`, its notice `-notice` (its message `-notice-message`) with Try again
   * `-retry`, the failure of a removal `-feedback`, the read states `-loading`, `-error` and
   * `-empty`, the list `-list` with its note `-list-hidden-note` and its rows `-entry-<key>` (their
   * Remove `-entry-<key>-remove`), the confirmation `-sheet` (`-sheet-cancel`, `-sheet-confirm`)
   */
  testID: string;
}

/**
 * the library tab while the guest merge is refused because the account library is full (R-09,
 * useGuestMergeRoom): an announced notice says why the titles saved on this device were not added,
 * that they stay there and how to make room, with Try again; then the account's titles, each with
 * Remove only, which asks first in a sheet with a destructive confirm. after each removal the merge
 * is tried again; a removal that did not happen shows an announced error under the notice. the
 * list read has its loading, error (with a retry) and empty states. the notice is announced once
 * with the merge failure the favorites tab and the detail show
 */
export function LibraryMergeRoom({ fallback, testID }: LibraryMergeRoomProps) {
  const { t, formatNumber } = useTranslation();
  const { showAdult } = usePreferences();
  const room = useGuestMergeRoom({ showAdult });
  const { busy, removingKey, remove, retry, reload } = room;
  const [confirming, setConfirming] = useState<LibraryEntry | null>(null);

  const ask = useCallback((entry: LibraryEntry) => {
    setConfirming(entry);
  }, []);
  const close = useCallback(() => {
    setConfirming(null);
  }, []);
  const confirm = useCallback(() => {
    if (confirming !== null) {
      remove(confirming.key);
    }
    setConfirming(null);
  }, [confirming, remove]);

  const rowsTestID = `${testID}-entry`;
  // a new function only when a removal starts or ends: the rows show it
  const renderRow = useCallback(
    (entry: LibraryEntry) => (
      <LibraryMergeRoomRow
        entry={entry}
        onRemove={ask}
        disabled={busy}
        removing={removingKey !== null && compareMediaKeys(removingKey, entry.key) === 0}
        testIDPrefix={rowsTestID}
      />
    ),
    [ask, busy, removingKey, rowsTestID],
  );
  const tryAgain = useMemo<StateAction>(
    () => ({ label: t('library.room.empty.action'), onPress: retry }),
    [t, retry],
  );
  const readAgain = useMemo<StateAction>(
    () => ({ label: t('library.room.error.retry'), onPress: reload }),
    [t, reload],
  );

  if (!room.active) {
    return fallback;
  }

  let content: ReactElement;
  if (room.status === 'loading') {
    content = (
      <Stack gap="none" align="center" justify="center" flex>
        <Spinner accessibilityLabel={t('library.room.loading')} testID={`${testID}-loading`} />
      </Stack>
    );
  } else if (room.status === 'error') {
    content = (
      <ErrorState
        title={t('library.room.error.title')}
        message={t('library.room.error.message')}
        retry={readAgain}
        testID={`${testID}-error`}
      />
    );
  } else if (room.entries.length === 0 && room.hiddenCount === 0) {
    content = (
      <EmptyState
        title={t('library.room.empty.title')}
        message={t('library.room.empty.message')}
        action={tryAgain}
        testID={`${testID}-empty`}
      />
    );
  } else {
    content = (
      <List
        items={room.entries}
        renderItem={renderRow}
        keyOf={keyOfEntry}
        header={
          room.hiddenCount > 0 ? (
            <Text variant="caption" tone="muted" testID={`${testID}-list-hidden-note`}>
              {t('library.list.hidden', { count: room.hiddenCount })}
            </Text>
          ) : null
        }
        testID={`${testID}-list`}
      />
    );
  }

  return (
    <Stack gap="md" flex testID={testID}>
      <Notice
        message={t('library.room.notice', { max: formatNumber(LIBRARY_ENTRIES_PER_USER_MAX) })}
        announceKey={GUEST_MERGE_FAILED_ANNOUNCE_KEY}
        testID={`${testID}-notice`}
      >
        <Button
          label={t('library.room.retry')}
          onPress={retry}
          variant="secondary"
          disabled={busy}
          testID={`${testID}-retry`}
        />
      </Notice>
      {/* keyed by the failure's identity: a second failure in a row, with the same message,
          remounts the alert, so it is announced once more */}
      {room.failure === null ? null : (
        <InlineError
          key={room.failureId}
          message={t(FAILURE_KEYS[room.failure])}
          testID={`${testID}-feedback`}
        />
      )}
      {content}
      <LibraryMergeRoomSheet
        entry={confirming}
        onConfirm={confirm}
        onClose={close}
        testID={`${testID}-sheet`}
      />
    </Stack>
  );
}
