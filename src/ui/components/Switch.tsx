import { Switch as NativeSwitch } from 'react-native';

import { useThemeColors } from '../theme/theme-context';

export interface SwitchProps {
  /** whether the switch is on */
  value: boolean;
  /** called with the new value when the user flips the switch */
  onValueChange: (value: boolean) => void;
  /** translated name of the setting it changes, e.g. "Show adult content" */
  accessibilityLabel: string;
  /** greys the switch out and ignores flips */
  disabled?: boolean;
  testID?: string;
}

/**
 * an on/off toggle drawn in the theme colors: the primary track when on, the border track when
 * off (both reach the 3:1 of non-text UI components), a surface-colored thumb. announced as a
 * switch with its label and checked state
 */
export function Switch({
  value,
  onValueChange,
  accessibilityLabel,
  disabled = false,
  testID,
}: SwitchProps) {
  const colors = useThemeColors();
  return (
    <NativeSwitch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: colors.border, true: colors.primary }}
      thumbColor={colors.surface}
      ios_backgroundColor={colors.border}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      testID={testID}
    />
  );
}
