import { useEffect } from 'react';
import { AccessibilityInfo, Platform, View } from 'react-native';

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
  // android reads the container through its assertive live region; ios has none and never exposes
  // a non-accessible alert container, so the error is announced here. the container stays
  // non-accessible so voiceover still reaches the retry button
  useEffect(() => {
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(
        message === undefined ? title : [title, message].join(ANNOUNCEMENT_SEPARATOR),
      );
    }
  }, [title, message]);

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
