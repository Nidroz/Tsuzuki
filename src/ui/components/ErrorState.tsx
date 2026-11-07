import { View } from 'react-native';

import { announcementOf, useAnnouncement } from './announcements';
import { Button } from './Button';
import type { StateAction } from './EmptyState';
import { Text } from './Text';

export interface ErrorStateProps {
  /** translated headline, e.g. "Something went wrong" */
  title: string;
  message?: string;
  /** retry button, e.g. { label: "Try again", onPress: refetch } */
  retry?: StateAction;
  /** views showing the same state pass the same key, so it is announced once */
  announceKey?: string;
  testID?: string;
}

/** centered error message with an optional retry, announced as an alert */
export function ErrorState({ title, message, retry, announceKey, testID }: ErrorStateProps) {
  // the error is announced here on both platforms: an android live region stays silent when it
  // mounts with its content, and ios has none (so the container has no live region, which would
  // read it twice on android). the container stays non-accessible so screen readers still reach
  // the retry button
  useAnnouncement(
    announcementOf(title, message),
    announceKey === undefined ? {} : { key: announceKey },
  );

  return (
    <View
      className="flex-1 items-center justify-center gap-md"
      accessibilityRole="alert"
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
