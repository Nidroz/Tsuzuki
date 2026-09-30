import { Pressable, View } from 'react-native';

import { cx } from './layout/layout-classes';
import { Text } from './Text';

const CHIP = 'min-h-touch flex-row items-center justify-center rounded-full border px-md';
const SELECTED = 'border-primary bg-primary';
const UNSELECTED = 'border-border bg-surface-muted';

export interface ChipProps {
  /** translated visible label, also the accessibility label */
  label: string;
  selected?: boolean;
  /** makes the chip a toggle button (filters, formats) */
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
}

/** a compact label, or a toggle button when onPress is given */
export function Chip({ label, selected = false, onPress, disabled = false, testID }: ChipProps) {
  const className = cx(CHIP, selected ? SELECTED : UNSELECTED, disabled && 'opacity-disabled');
  const text = (
    <Text variant="label" tone={selected ? 'onPrimary' : 'default'} numberOfLines={1}>
      {label}
    </Text>
  );

  // a static chip is one accessible element, so its selected state is announced with its label;
  // it has no button role since it does nothing when activated
  if (onPress === undefined) {
    return (
      <View
        className={className}
        accessible
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        testID={testID}
      >
        {text}
      </View>
    );
  }

  return (
    <Pressable
      className={cx(className, 'active:opacity-pressed')}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      testID={testID}
    >
      {text}
    </Pressable>
  );
}
