import { ActivityIndicator } from 'react-native';

import { useThemeColors } from '../theme/theme-context';

export type SpinnerSize = 'small' | 'large';

export interface SpinnerProps {
  /** translated description of what is loading, e.g. "Loading results" */
  accessibilityLabel: string;
  /** large by default */
  size?: SpinnerSize;
  testID?: string;
}

/** an indeterminate progress indicator in the primary color */
export function Spinner({ accessibilityLabel, size = 'large', testID }: SpinnerProps) {
  const colors = useThemeColors();
  return (
    <ActivityIndicator
      size={size}
      color={colors.primary}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: true }}
      testID={testID}
    />
  );
}
