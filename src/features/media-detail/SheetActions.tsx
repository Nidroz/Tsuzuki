import { useTranslation } from '@core/i18n/index';
import { Button, Row, type ButtonVariant } from '@ui/index';

export interface SheetActionsProps {
  /** translated label of the confirm button, e.g. "Save" */
  confirmLabel: string;
  onConfirm: () => void;
  /** primary by default; danger for a destructive action */
  confirmVariant?: ButtonVariant;
  /** disables the confirm button, e.g. while the draft is invalid */
  confirmDisabled?: boolean;
  /** closes the sheet, discarding the draft */
  onCancel: () => void;
  /** the buttons get `${testID}-cancel` and `${testID}-confirm` */
  testID: string;
}

/** the footer of a library sheet: Cancel, then the confirm action */
export function SheetActions({
  confirmLabel,
  onConfirm,
  confirmVariant = 'primary',
  confirmDisabled = false,
  onCancel,
  testID,
}: SheetActionsProps) {
  const { t } = useTranslation();
  return (
    <Row gap="sm" justify="end" wrap>
      <Button
        label={t('mediaDetail.library.cancel')}
        variant="secondary"
        onPress={onCancel}
        testID={`${testID}-cancel`}
      />
      <Button
        label={confirmLabel}
        variant={confirmVariant}
        onPress={onConfirm}
        disabled={confirmDisabled}
        testID={`${testID}-confirm`}
      />
    </Row>
  );
}
