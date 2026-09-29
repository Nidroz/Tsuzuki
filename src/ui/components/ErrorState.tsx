import { View } from 'react-native';

import { Button } from './Button';
import type { StateAction } from './EmptyState';
import { Text } from './Text';

export interface ErrorStateProps {
  /** translated headline, e.g. "Something went wrong" */
  title: string;
  message?: string;
  /** retry button, e.g. { label: "Try again", onPress: refetch } */
  retry?: StateAction;
  testID?: string;
}

/** centered error message with an optional retry, announced as an alert */
export function ErrorState({ title, message, retry, testID }: ErrorStateProps) {
  return (
    <View
      className="flex-1 items-center justify-center gap-md"
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      testID={testID}
    >
      <Text variant="subtitle" tone="danger" align="center">
        {title}
      </Text>
      {message === undefined ? null : (
        <Text tone="muted" align="center">
          {message}
        </Text>
      )}
      {retry === undefined ? null : (
        <Button label={retry.label} onPress={retry.onPress} variant="secondary" />
      )}
    </View>
  );
}
