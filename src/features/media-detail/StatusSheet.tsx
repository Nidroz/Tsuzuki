import { LIBRARY_STATUSES, type LibraryStatus } from '@core/domain/library-entry';
import type { MediaKind } from '@core/domain/media';
import { LIBRARY_STATUS_KEYS, useTranslation } from '@core/i18n/index';
import { RadioGroup, Sheet, SheetActions, type RadioOption } from '@ui/index';
import { useMemo } from 'react';

import { useSheetDraft } from './use-sheet-draft';

const TEST_ID = 'media-detail-library-status-sheet';

export interface StatusSheetProps {
  visible: boolean;
  /** words the current status "Watching" for an anime, "Reading" for a manga (FR-11) */
  kind: MediaKind;
  /** the entry's status: each opening starts a draft from it */
  status: LibraryStatus;
  /** called with a changed status only (BR-04 is the action's) */
  onSave: (status: LibraryStatus) => void;
  /** closes the sheet; without Save the draft is discarded */
  onClose: () => void;
}

/** the status sheet of a library entry: one radio per status, saved with Save */
export function StatusSheet({ visible, kind, status, onSave, onClose }: StatusSheetProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useSheetDraft(visible, status);
  const options = useMemo<readonly RadioOption<LibraryStatus>[]>(
    () => LIBRARY_STATUSES.map((value) => ({ value, label: t(LIBRARY_STATUS_KEYS[kind][value]) })),
    [t, kind],
  );

  const save = () => {
    if (draft !== status) {
      onSave(draft);
    }
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title={t('mediaDetail.library.status.title')}
      closeLabel={t('mediaDetail.library.status.close')}
      onClose={onClose}
      footer={
        <SheetActions
          confirmLabel={t('mediaDetail.library.save')}
          onConfirm={save}
          cancelLabel={t('mediaDetail.library.cancel')}
          onCancel={onClose}
          testID={TEST_ID}
        />
      }
      testID={TEST_ID}
    >
      <RadioGroup
        accessibilityLabel={t('mediaDetail.library.status.title')}
        options={options}
        value={draft}
        onChange={setDraft}
        testID="media-detail-library-status-options"
      />
    </Sheet>
  );
}
