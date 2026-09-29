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

export interface StackProps {
  children?: ReactNode;
  /** space between children */
  gap: SpacingToken;
  /** cross-axis (horizontal) alignment; stretch by default */
  align?: AlignToken;
  /** main-axis (vertical) distribution */
  justify?: JustifyToken;
  /** fills the remaining space of its parent */
  flex?: boolean;
  testID?: string;
}

/** lays its children out vertically, separated by a spacing token */
export function Stack({ children, gap, align, justify, flex = false, testID }: StackProps) {
  const className = cx(
    'flex-col',
    GAP[gap],
    align && ALIGN[align],
    justify && JUSTIFY[justify],
    flex && 'flex-1',
  );
  return (
    <View className={className} testID={testID}>
      {children}
    </View>
  );
}
