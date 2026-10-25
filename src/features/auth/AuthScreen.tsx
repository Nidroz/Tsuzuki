import { Screen, Stack, Text, type ScreenEdge } from '@ui/index';
import type { ReactNode } from 'react';

// under the root stack header, without a tab bar: the bottom and the sides need the safe area
export const AUTH_EDGES: readonly ScreenEdge[] = ['bottom', 'left', 'right'];

export interface AuthScreenProps {
  children: ReactNode;
  testID: string;
}

/** the frame of an auth screen: scrolls, so long text sizes and the keyboard keep it usable */
export function AuthScreen({ children, testID }: AuthScreenProps) {
  return (
    <Screen scroll edges={AUTH_EDGES} testID={testID}>
      <Stack gap="lg">{children}</Stack>
    </Screen>
  );
}

export interface AuthMessageProps {
  /** translated headline, announced as a heading */
  title: string;
  message: string;
  testID?: string;
}

/** a headline and its message: an email sent, an email confirmed */
export function AuthMessage({ title, message, testID }: AuthMessageProps) {
  return (
    <Stack gap="sm" {...(testID !== undefined && { testID })}>
      <Text variant="title">{title}</Text>
      <Text>{message}</Text>
    </Stack>
  );
}
