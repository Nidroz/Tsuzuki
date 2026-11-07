import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useAnnouncement } from './announcements';
import { Text } from './Text';

export interface NoticeProps {
  /**
   * translated message, e.g. "2 changes could not be synced.": shown, announced, and the
   * accessibility label of the notice
   */
  message: string;
  /** the actions under the message, e.g. buttons; laid out in a row that wraps, at its end */
  children?: ReactNode;
  /** views showing the same state pass the same key, so it is announced once */
  announceKey?: string;
  /** the message, announced as an alert, gets `${testID}-message` */
  testID?: string;
}

/**
 * a lasting state of a screen the user can act on (InlineError is the failure of an action): a
 * bordered panel with its message above its actions, so a large font size never squeezes either.
 * the message is one alert named by its text, announced when it mounts and when it changes; the
 * actions stay reachable by screen readers on their own
 */
export function Notice({ message, children, announceKey, testID }: NoticeProps) {
  // announced here on both platforms, as InlineError: an android live region stays silent when it
  // mounts with its content
  useAnnouncement(message, announceKey === undefined ? {} : { key: announceKey });

  return (
    <View className="gap-sm rounded-md border border-border bg-surface p-md" testID={testID}>
      <View
        accessible
        accessibilityRole="alert"
        accessibilityLabel={message}
        {...(testID !== undefined && { testID: `${testID}-message` })}
      >
        <Text>{message}</Text>
      </View>
      {children === undefined ? null : (
        <View className="flex-row flex-wrap justify-end gap-sm">{children}</View>
      )}
    </View>
  );
}
