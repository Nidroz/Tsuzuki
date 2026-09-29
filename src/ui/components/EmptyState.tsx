import { Button } from './Button';
import { Stack } from './Stack';
import { Text } from './Text';

export interface StateAction {
  /** translated button label */
  label: string;
  onPress: () => void;
}

export interface EmptyStateProps {
  /** translated headline, e.g. "Your library is empty" */
  title: string;
  message?: string;
  action?: StateAction;
  testID?: string;
}

/** centered placeholder for a list or screen without content */
export function EmptyState({ title, message, action, testID }: EmptyStateProps) {
  return (
    <Stack gap="md" align="center" justify="center" flex {...(testID !== undefined && { testID })}>
      <Text variant="subtitle" align="center">
        {title}
      </Text>
      {message === undefined ? null : (
        <Text tone="muted" align="center">
          {message}
        </Text>
      )}
      {action === undefined ? null : (
        <Button label={action.label} onPress={action.onPress} variant="secondary" />
      )}
    </Stack>
  );
}
