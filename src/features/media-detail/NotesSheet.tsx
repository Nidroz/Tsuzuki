import { codePointLength } from '@core/domain/database-limits';
import { isValidNotes, NOTES_MAX_LENGTH } from '@core/domain/library-entry';
import { useTranslation } from '@core/i18n/index';
import { Input, Sheet, SheetActions, Text } from '@ui/index';

import { useSheetDraft } from './use-sheet-draft';

const TEST_ID = 'media-detail-library-notes-sheet';

export interface NotesSheetProps {
  visible: boolean;
  /** the entry's notes, null for none: each opening starts the text from them */
  notes: string | null;
  /** called with valid, changed text only; blank text clears the notes (the action's rule) */
  onSave: (text: string) => void;
  /** closes the sheet; without Save the text is discarded */
  onClose: () => void;
}

/**
 * the notes sheet of a library entry (FR-13): a text area with a counter of characters (code
 * points, as the database counts them). notes over NOTES_MAX_LENGTH, or holding characters the
 * database cannot store, show a translated error and disable Save (BR-07)
 */
export function NotesSheet({ visible, notes, onSave, onClose }: NotesSheetProps) {
  const { t, formatNumber } = useTranslation();
  const saved = notes ?? '';
  const [text, setText] = useSheetDraft(visible, saved);

  const length = codePointLength(text);
  const tooLong = length > NOTES_MAX_LENGTH;
  const valid = isValidNotes(text);
  const counter = { length: formatNumber(length), max: formatNumber(NOTES_MAX_LENGTH) };
  let error: string | undefined;
  if (tooLong) {
    error = t('mediaDetail.library.notes.tooLong', { max: counter.max });
  } else if (!valid) {
    error = t('mediaDetail.library.notes.unsupported');
  }

  // only reached with valid text: Save is disabled otherwise, and a text area has no submit key
  const save = () => {
    if (text !== saved) {
      onSave(text);
    }
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title={t('mediaDetail.library.notes.title')}
      closeLabel={t('mediaDetail.library.notes.close')}
      onClose={onClose}
      footer={
        <SheetActions
          confirmLabel={t('mediaDetail.library.save')}
          onConfirm={save}
          confirmDisabled={!valid}
          cancelLabel={t('mediaDetail.library.cancel')}
          onCancel={onClose}
          testID={TEST_ID}
        />
      }
      testID={TEST_ID}
    >
      <Input
        label={t('mediaDetail.library.notes.title')}
        value={text}
        onChangeText={setText}
        multiline
        {...(error !== undefined && { error })}
        testID="media-detail-library-notes-input"
      />
      <Text
        variant="caption"
        tone={tooLong ? 'danger' : 'muted'}
        align="end"
        accessibilityLabel={t('mediaDetail.library.notes.counterLabel', counter)}
        testID="media-detail-library-notes-counter"
      >
        {t('mediaDetail.library.notes.counter', counter)}
      </Text>
    </Sheet>
  );
}
