import { Button, type ButtonVariant } from './Button';
import { Row } from './Row';

export interface SheetActionsProps {
  /** translated label of the confirm button, e.g. "Save" */
  confirmLabel: string;
  onConfirm: () => void;
  /** primary by default; danger for a destructive action */
  confirmVariant?: ButtonVariant;
  /** disables the confirm button, e.g. while the draft is invalid */
  confirmDisabled?: boolean;
  /** translated label of the cancel button, e.g. "Cancel" */
  cancelLabel: string;
  /** closes the sheet, discarding the draft */
  onCancel: () => void;
  /** the buttons get `${testID}-cancel` and `${testID}-confirm` */
  testID: string;
}

/** the footer of a sheet: Cancel, then the confirm action */
export function SheetActions({
  confirmLabel,
  onConfirm,
  confirmVariant = 'primary',
  confirmDisabled = false,
  cancelLabel,
  onCancel,
  testID,
}: SheetActionsProps) {
  return (
    <Row gap="sm" justify="end" wrap>
      <Button
        label={cancelLabel}
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
