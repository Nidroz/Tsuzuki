import { useEffect } from 'react';
import { AccessibilityInfo, View } from 'react-native';

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

// voiceover pauses on a line break between the title and the message
const ANNOUNCEMENT_SEPARATOR = '\n';

/** centered error message with an optional retry, announced as an alert */
export function ErrorState({ title, message, retry, testID }: ErrorStateProps) {
  // the error is announced here on both platforms: an android live region stays silent when it
  // mounts with its content, and ios has none (so the container has no live region, which would
  // read it twice on android). the container stays non-accessible so screen readers still reach
  // the retry button
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(
      message === undefined ? title : [title, message].join(ANNOUNCEMENT_SEPARATOR),
    );
  }, [title, message]);

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
