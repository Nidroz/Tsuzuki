import type { ReactNode } from 'react';
import { View } from 'react-native';

import type { SpacingToken } from '../theme/spacing';
import {
  ALIGN,
  cx,
  GAP,
  JUSTIFY,
  type AlignToken,
  type JustifyToken,
} from './layout/layout-classes';

/**
 * a row of the options of a single choice, e.g. chips with `role="radio"`: announced as a group
 * named by its translated label (radiogroup role on android; ios has no group trait), like
 * RadioGroup. a plain row has neither
 */
export type RowGroupProps =
  | { accessibilityRole?: never; accessibilityLabel?: never }
  | { accessibilityRole: 'radiogroup'; accessibilityLabel: string };

export type RowProps = RowGroupProps & {
  children?: ReactNode;
  /** space between children, horizontally and between wrapped lines */
  gap: SpacingToken;
  /** cross-axis (vertical) alignment; center by default */
  align?: AlignToken;
  /** main-axis (horizontal) distribution */
  justify?: JustifyToken;
  /** wraps children onto several lines instead of overflowing */
  wrap?: boolean;
  /** fills the remaining space of its parent */
  flex?: boolean;
  testID?: string;
};

/** lays its children out horizontally, separated by a spacing token */
export function Row({
  children,
  gap,
  align = 'center',
  justify,
  wrap = false,
  flex = false,
  accessibilityRole,
  accessibilityLabel,
  testID,
}: RowProps) {
  const className = cx(
    'flex-row',
    GAP[gap],
    ALIGN[align],
    justify && JUSTIFY[justify],
    wrap && 'flex-wrap',
    flex && 'flex-1',
  );
  // a plain row has no role: only a radio group is announced as one
  return (
    <View
      className={className}
      {...(accessibilityRole !== undefined && { accessibilityRole, accessibilityLabel })}
      testID={testID}
    >
      {children}
    </View>
  );
}
