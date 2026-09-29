import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable } from 'react-native';

import { ICON_SIZE } from '../theme/sizes';
import { useThemeColors } from '../theme/theme-context';
import { cx } from './layout/layout-classes';

type IoniconsGlyph = ComponentProps<typeof Ionicons>['name'];

// the icons the app uses, by meaning: screens never name an icon set glyph, so the set can change
// here alone
const GLYPHS = {
  add: 'add',
  remove: 'remove',
  favorite: 'heart',
  'favorite-outline': 'heart-outline',
  search: 'search',
  close: 'close',
  'chevron-back': 'chevron-back',
  'chevron-forward': 'chevron-forward',
  settings: 'settings-outline',
  refresh: 'refresh',
} as const satisfies Record<string, IoniconsGlyph>;

export type IconName = keyof typeof GLYPHS;

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
