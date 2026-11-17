import type { LibraryEntry } from '@core/domain/library-entry';
import type { MediaKey } from '@core/domain/media';
import { useTranslation } from '@core/i18n/index';
import { Button, MediaListItem } from '@ui/index';
import { memo, useCallback } from 'react';

import { libraryEntryDetails } from './library-entry-details';

/** the testID of the row of a media key under `prefix`: `<prefix>-<namespace>-<kind>-<externalId>` */
export const mergeRoomEntryTestID = (prefix: string, key: MediaKey): string =>
  `${prefix}-${key.namespace}-${key.kind}-${String(key.externalId)}`;

export interface LibraryMergeRoomRowProps {
  /** the account entry as shown (its cover checked against the provider's hosts) */
  entry: LibraryEntry;
  /** asks before removing the entry; pass a stable function: a new one re-renders every row */
  onRemove: (entry: LibraryEntry) => void;
  /** true while a removal runs or the merge restarts: Remove is disabled */
  disabled: boolean;
  /** true while this entry's removal runs: its Remove shows it */
  removing: boolean;
  /** the testID prefix of the rows; the row's Remove gets `<row>-remove` */
  testIDPrefix: string;
}

function LibraryMergeRoomRowView({
  entry,
  onRemove,
  disabled,
  removing,
  testIDPrefix,
}: LibraryMergeRoomRowProps) {
  const translation = useTranslation();
  const { t } = translation;
  const remove = useCallback(() => {
    onRemove(entry);
  }, [onRemove, entry]);
  const title = entry.media.title;
  const testID = mergeRoomEntryTestID(testIDPrefix, entry.key);

  // no `+1`, no heart, no detail: the library stays pending, the removal is the only write
  return (
    <MediaListItem
      title={title}
      details={libraryEntryDetails(translation, entry)}
      imageUrl={entry.media.imageUrl}
      trailing={
        <Button
          label={t('library.room.remove')}
          accessibilityLabel={t('library.room.removeLabel', { title })}
          onPress={remove}
          variant="secondary"
          disabled={disabled && !removing}
          loading={removing}
          loadingLabel={t('library.room.removing', { title })}
          testID={`${testID}-remove`}
        />
      }
      testID={testID}
    />
  );
}

/**
 * an account entry of the room made for a refused guest merge (R-09): its cover, title, format,
 * progress and score, not pressable, with Remove as its only action (named with the title), which
 * asks first; disabled while a removal runs, the one removed showing its progress
 */
export const LibraryMergeRoomRow = memo(LibraryMergeRoomRowView);
