import { useEffect } from 'react';
import { AccessibilityInfo, View } from 'react-native';

import { Button } from './Button';
import type { StateAction } from './EmptyState';
import { Text } from './Text';

export interface InlineErrorProps {
  /** translated message, e.g. "Your change could not be saved." */
  message: string;
  /** a button under the message, e.g. { label: "Try again", onPress: refetch } */
  action?: StateAction;
  /** the action button gets `${testID}-action` */
  testID?: string;
}

/**
 * a compact error inside a screen's content, which stays usable around it (ErrorState replaces a
 * whole screen). announced as an alert, the message stacked above its action so a large font
 * size never squeezes either
 */
export function InlineError({ message, action, testID }: InlineErrorProps) {
  // announced here on both platforms, as ErrorState: an android live region stays silent when it
  // mounts with its content. the container stays non-accessible so the action stays reachable
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(message);
  }, [message]);

  return (
    <View
      className="gap-xs rounded-md border border-danger bg-surface p-md"
      accessibilityRole="alert"
      testID={testID}
    >
      <Text tone="danger">{message}</Text>
      {action === undefined ? null : (
        <View className="flex-row justify-end">
          <Button
            label={action.label}
            onPress={action.onPress}
            variant="ghost"
            {...(testID !== undefined && { testID: `${testID}-action` })}
          />
        </View>
      )}
    </View>
  );
}
