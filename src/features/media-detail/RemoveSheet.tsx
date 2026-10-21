import { useTranslation } from '@core/i18n/index';
import { Sheet, Text } from '@ui/index';

import { SheetActions } from './SheetActions';

const TEST_ID = 'media-detail-library-remove-sheet';

export interface RemoveSheetProps {
  visible: boolean;
  /** removes the entry; the sheet closes right after */
  onConfirm: () => void;
  /** closes the sheet without removing anything */
  onClose: () => void;
}

/** asks before removing a media from the library (FR-10): its score and notes go with it */
export function RemoveSheet({ visible, onConfirm, onClose }: RemoveSheetProps) {
  const { t } = useTranslation();

  const confirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title={t('mediaDetail.library.remove.title')}
      closeLabel={t('mediaDetail.library.remove.close')}
      onClose={onClose}
      footer={
        <SheetActions
          confirmLabel={t('mediaDetail.library.remove.confirm')}
          confirmVariant="danger"
          onConfirm={confirm}
          onCancel={onClose}
          testID={TEST_ID}
        />
      }
      testID={TEST_ID}
    >
      <Text>{t('mediaDetail.library.remove.message')}</Text>
    </Sheet>
  );
}
