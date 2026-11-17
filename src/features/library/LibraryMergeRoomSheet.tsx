import type { LibraryEntry } from '@core/domain/library-entry';
import { useTranslation } from '@core/i18n/index';
import { Sheet, SheetActions, Text } from '@ui/index';

export interface LibraryMergeRoomSheetProps {
  /** the entry to remove, the sheet open; null closes it */
  entry: LibraryEntry | null;
  /** removes the entry from the account */
  onConfirm: () => void;
  /** closes the sheet without removing anything */
  onClose: () => void;
  /** the sheet gets `testID`, its buttons `-cancel` and `-confirm` */
  testID: string;
}

/**
 * asks before removing an account entry to make room for a refused guest merge (R-09): the entry
 * leaves the account with its status, progress, score and notes, and a copy saved on this device
 * comes back with the merge. the confirm is destructive
 */
export function LibraryMergeRoomSheet({
  entry,
  onConfirm,
  onClose,
  testID,
}: LibraryMergeRoomSheetProps) {
  const { t } = useTranslation();

  return (
    <Sheet
      visible={entry !== null}
      title={t('library.room.sheet.title')}
      closeLabel={t('library.room.sheet.close')}
      onClose={onClose}
      footer={
        <SheetActions
          confirmLabel={t('library.room.sheet.confirm')}
          confirmVariant="danger"
          onConfirm={onConfirm}
          cancelLabel={t('library.room.sheet.cancel')}
          onCancel={onClose}
          testID={testID}
        />
      }
      testID={testID}
    >
      {entry === null ? null : (
        <Text>{t('library.room.sheet.message', { title: entry.media.title })}</Text>
      )}
    </Sheet>
  );
}
