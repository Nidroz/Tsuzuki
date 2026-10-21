import { SCORE_MAX, type LibraryEntry } from '@core/domain/library-entry';
import { canIncrementProgress } from '@core/domain/library-progress';
import type { MediaKey } from '@core/domain/media';
import {
  useLibraryEntryActions,
  type UseLibraryEntryActionsOptions,
} from '@core/hooks/use-library-entry-actions';
import { FORMAT_KEYS, PROGRESS_LABEL_KEYS, useTranslation } from '@core/i18n/index';
import { IconButton, InlineError, MediaListItem, Stack, type StateAction } from '@ui/index';
import { memo, useCallback, useMemo } from 'react';

// the list has no catalog data: an action never refreshes the snapshot from here (ADR-0009)
const NO_MEDIA: UseLibraryEntryActionsOptions = { media: null };

/** the testID of the row of a media key: `library-entry-<namespace>-<kind>-<externalId>` */
export const libraryEntryTestID = (key: MediaKey): string =>
  `library-entry-${key.namespace}-${key.kind}-${String(key.externalId)}`;

export interface LibraryEntryRowProps {
  /** the entry as the list shows it (its cover checked against the provider's hosts) */
  entry: LibraryEntry;
  /** pass a stable function: a new one re-renders every row */
  onOpen: (key: MediaKey) => void;
}

function LibraryEntryRowView({ entry, onOpen }: LibraryEntryRowProps) {
  const { t, formatNumber } = useTranslation();
  // writes go through the actions, which read the stored entry: the shown one is for display only
  const { incrementProgress, error, dismissError } = useLibraryEntryActions(entry.key, NO_MEDIA);
  const { key } = entry;
  const open = useCallback(() => {
    onOpen(key);
  }, [onOpen, key]);
  const dismiss = useMemo<StateAction>(
    () => ({ label: t('library.list.dismiss'), onPress: dismissError }),
    [t, dismissError],
  );

  const progressKeys = PROGRESS_LABEL_KEYS[key.kind];
  const total = entry.media.totalUnits;
  const progress = formatNumber(entry.progress);
  const details = [
    t(FORMAT_KEYS[entry.media.format]),
    total === null
      ? t(progressKeys.alone, { progress, count: entry.progress })
      : t(progressKeys.ofTotal, { progress, total: formatNumber(total), count: total }),
    ...(entry.score === null
      ? []
      : [
          t('library.list.score', {
            score: formatNumber(entry.score),
            max: formatNumber(SCORE_MAX),
          }),
        ]),
  ];
  const testID = libraryEntryTestID(key);

  return (
    <Stack gap="xs">
      <MediaListItem
        title={entry.media.title}
        details={details}
        imageUrl={entry.media.imageUrl}
        onPress={open}
        accessibilityHint={t('mediaList.openHint')}
        trailing={
          <IconButton
            icon="add"
            accessibilityLabel={t('library.list.increment', {
              action: t(progressKeys.increment),
              title: entry.media.title,
            })}
            onPress={incrementProgress}
            disabled={!canIncrementProgress(entry)}
            testID={`${testID}-increment`}
          />
        }
        testID={testID}
      />
      {error === null ? null : (
        <InlineError
          message={t('library.list.writeError')}
          action={dismiss}
          testID={`${testID}-error`}
        />
      )}
    </Stack>
  );
}

/**
 * a library entry in the list (FR-14): cover, title, format, progress and score; pressing it opens
 * the detail, its `+1` button (disabled at the known total, BR-01) adds one episode or chapter, and
 * a failed write shows a message under the row until it is dismissed or the next tap
 */
export const LibraryEntryRow = memo(LibraryEntryRowView);
