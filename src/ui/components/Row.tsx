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

export interface RowProps {
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
}

/** lays its children out horizontally, separated by a spacing token */
export function Row({
  children,
  gap,
  align = 'center',
  justify,
  wrap = false,
  flex = false,
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
  return (
    <View className={className} testID={testID}>
      {children}
    </View>
  );
}
