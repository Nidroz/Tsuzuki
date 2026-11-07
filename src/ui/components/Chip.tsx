import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';

import { ICON_SIZE } from '../theme/sizes';
import { useThemeColors } from '../theme/theme-context';
import { CHIP_EXCLUDED_GLYPH } from './icons';
import { cx } from './layout/layout-classes';
import { Text, type TextTone } from './Text';

const CHIP = 'min-h-touch flex-row items-center justify-center rounded-full border px-md';
const SELECTED = 'border-primary bg-primary';
const UNSELECTED = 'border-border bg-surface-muted';
// the danger fill with a glyph: the excluded state is not told by color alone
const EXCLUDED = 'gap-xs border-danger bg-danger';

type ChipLook = 'selected' | 'excluded' | 'unselected';

const LOOK: Readonly<Record<ChipLook, { readonly container: string; readonly tone: TextTone }>> = {
  selected: { container: SELECTED, tone: 'onPrimary' },
  excluded: { container: EXCLUDED, tone: 'onDanger' },
  unselected: { container: UNSELECTED, tone: 'default' },
};

const lookOf = (selected: boolean, excluded: boolean): ChipLook => {
  if (excluded) {
    return 'excluded';
  }
  return selected ? 'selected' : 'unselected';
};

export interface ChipProps {
  /** translated visible label, also the accessibility label unless one is given */
  label: string;
  selected?: boolean;
  /**
   * the excluded state of a three-state filter (included, excluded, neither): drawn in the danger
   * color with a glyph, and wins over selected. name the state in the accessibility label
   */
  excluded?: boolean;
  /** translated label read instead of the visible one, e.g. naming the excluded state */
  accessibilityLabel?: string;
  /** makes the chip a toggle button (filters, formats) */
  onPress?: () => void;
  /**
   * `radio`: a pressable chip is one option of a single choice, announced as a radio checked when
   * selected (put the chips in a Row radio group). a toggle button by default
   */
  role?: 'radio';
  /**
   * the accessibility label already names the chip's state, e.g. "Action, included" for a chip of
   * more than two states: a toggle chip's accessibility state then carries `disabled` only, and a
   * static chip's none, so the state is not announced twice. a two-state toggle keeps a fixed
   * label and its `selected` state; a radio always has a fixed label and its `checked` state, so
   * this has no effect on it
   */
  stateInLabel?: boolean;
  disabled?: boolean;
  testID?: string;
}

// the state convention of the app's controls: a two-state control has a fixed label and states
// its state through the accessibility state (checked for a radio, selected for a toggle); a
// control with more states names its state in its label and sets no state
const toggleState = (
  role: ChipProps['role'],
  selected: boolean,
  stateInLabel: boolean,
  disabled: boolean,
) => {
  if (role === 'radio') {
    return { checked: selected, disabled };
  }
  return stateInLabel ? { disabled } : { selected, disabled };
};

// a component of its own: only an excluded chip needs the theme colors
function ExcludedGlyph() {
  const colors = useThemeColors();
  return (
    <Ionicons
      name={CHIP_EXCLUDED_GLYPH}
      size={ICON_SIZE}
      color={colors.onDanger}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}

/** a compact label, or a toggle button (a radio with `role="radio"`) when onPress is given */
export function Chip({
  label,
  selected = false,
  excluded = false,
  accessibilityLabel = label,
  onPress,
  role,
  stateInLabel = false,
  disabled = false,
  testID,
}: ChipProps) {
  const look = LOOK[lookOf(selected, excluded)];
  const className = cx(CHIP, look.container, disabled && 'opacity-disabled');
  const content = (
    <>
      {excluded ? <ExcludedGlyph /> : null}
      <Text variant="label" tone={look.tone} numberOfLines={1}>
        {label}
      </Text>
    </>
  );

  // a static chip is one accessible element, so its selected state is announced with its label;
  // it has no button role since it does nothing when activated
  if (onPress === undefined) {
    return (
      <View
        className={className}
        accessible
        accessibilityLabel={accessibilityLabel}
        {...(!stateInLabel && { accessibilityState: { selected } })}
        testID={testID}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      className={cx(className, 'active:opacity-pressed')}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={role ?? 'button'}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={toggleState(role, selected, stateInLabel, disabled)}
      testID={testID}
    >
      {content}
    </Pressable>
  );
}
