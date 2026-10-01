import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable } from 'react-native';

import { ICON_SIZE } from '../theme/sizes';
import { useThemeColors } from '../theme/theme-context';
import { GLYPHS, type IconName } from './icons';
import { cx } from './layout/layout-classes';

export type { IconName };

export interface IconButtonProps {
  icon: IconName;
  /** translated label: the button has no visible text */
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  /** toggle state (e.g. favorite): drawn in the primary color and announced as selected */
  selected?: boolean;
  accessibilityHint?: string;
  testID?: string;
}

/** an icon-only button with a full-size touch target */
export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  disabled = false,
  selected,
  accessibilityHint,
  testID,
}: IconButtonProps) {
  const colors = useThemeColors();
  return (
    <Pressable
      className={cx(
        'min-h-touch min-w-touch items-center justify-center rounded-full',
        'active:opacity-pressed',
        disabled && 'opacity-disabled',
      )}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, ...(selected !== undefined && { selected }) }}
      {...(accessibilityHint !== undefined && { accessibilityHint })}
      testID={testID}
    >
      <Ionicons
        name={GLYPHS[icon]}
        size={ICON_SIZE}
        color={selected === true ? colors.primary : colors.text}
      />
    </Pressable>
  );
}
