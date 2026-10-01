import Ionicons from '@expo/vector-icons/Ionicons';

import { ICON_SIZE } from '../theme/sizes';
import { useThemeColors } from '../theme/theme-context';
import { TAB_GLYPHS, type TabIconName } from './icons';

export type { TabIconName };

export interface TabBarIconProps {
  /** the tab, by meaning */
  icon: TabIconName;
  /** filled and in the primary color for the focused tab, outline and muted otherwise */
  focused: boolean;
}

/**
 * the icon of a tab bar button. hidden from screen readers: the tab button carries the translated
 * title, its role and its selected state
 */
export function TabBarIcon({ icon, focused }: TabBarIconProps) {
  const colors = useThemeColors();
  const glyphs = TAB_GLYPHS[icon];
  return (
    <Ionicons
      name={focused ? glyphs.focused : glyphs.unfocused}
      size={ICON_SIZE}
      color={focused ? colors.primary : colors.textMuted}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
