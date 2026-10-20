import { isValidProgress, progressMaxOf } from '@core/domain/library-progress';
import type { MediaKind } from '@core/domain/media';
import { PROGRESS_LABEL_KEYS, useTranslation } from '@core/i18n/index';
import { parseProgressInput } from '@core/schemas/progress-input';
import { Input, Sheet } from '@ui/index';

import { SheetActions } from './SheetActions';
import { useSheetDraft } from './use-sheet-draft';

const TEST_ID = 'media-detail-library-progress-sheet';

export interface ProgressSheetProps {
  visible: boolean;
  /** labels the field in episodes or chapters */
  kind: MediaKind;
  /** the entry's progress: each opening starts the field text from it */
  progress: number;
  /** the total of the entry's snapshot, null when unknown: the upper bound when known (BR-01) */
  totalUnits: number | null;
  /** called with a valid, changed progress only (BR-02 and BR-03 are the action's) */
  onSave: (progress: number) => void;
  /** closes the sheet; without Save the text is discarded */
  onClose: () => void;
}

/**
 * the progress sheet of a library entry (FR-12 manual edit): a number field, checked as typed.
 * text that is not a whole number of 0 or more, or a number above the known total, shows a
 * translated error and disables Save
 */
export function ProgressSheet({
  visible,
  kind,
  progress,
  totalUnits,
  onSave,
  onClose,
}: ProgressSheetProps) {
  const { t, formatNumber } = useTranslation();
  const [text, setText] = useSheetDraft(visible, String(progress));

  const value = parseProgressInput(text);
  let error: string | undefined;
  if (value === null) {
    error = t('mediaDetail.library.progress.invalid');
  } else if (!isValidProgress(value, totalUnits)) {
    error = t('mediaDetail.library.progress.tooHigh', {
      max: formatNumber(progressMaxOf(totalUnits)),
    });
  }
  const valid = value !== null && error === undefined;

  const save = () => {
    if (!valid) {
      return;
    }
    if (value !== progress) {
      onSave(value);
    }
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title={t('mediaDetail.library.progress.title')}
      closeLabel={t('mediaDetail.library.progress.close')}
      onClose={onClose}
      footer={
        <SheetActions
          confirmLabel={t('mediaDetail.library.save')}
          onConfirm={save}
          confirmDisabled={!valid}
          onCancel={onClose}
          testID={TEST_ID}
        />
      }
      testID={TEST_ID}
    >
      <Input
        label={t(PROGRESS_LABEL_KEYS[kind].field)}
        value={text}
        onChangeText={setText}
        keyboardType="number-pad"
        returnKeyType="done"
        onSubmitEditing={save}
        autoCorrect={false}
        {...(error !== undefined && { error })}
        testID="media-detail-library-progress-input"
      />
    </Sheet>
  );
}
