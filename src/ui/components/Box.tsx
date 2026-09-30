import type { ReactNode } from 'react';
import { View } from 'react-native';

import type { RadiusToken } from '../theme/radii';
import type { SpacingToken } from '../theme/spacing';
import {
  cx,
  MARGIN,
  MARGIN_X,
  MARGIN_Y,
  PADDING,
  PADDING_X,
  PADDING_Y,
  RADIUS,
  SURFACE,
  type SurfaceToken,
} from './layout/layout-classes';

export interface BoxProps {
  children?: ReactNode;
  padding?: SpacingToken;
  paddingX?: SpacingToken;
  paddingY?: SpacingToken;
  margin?: SpacingToken;
  marginX?: SpacingToken;
  marginY?: SpacingToken;
  /** fills the remaining space of its parent */
  flex?: boolean;
  surface?: SurfaceToken;
  radius?: RadiusToken;
  /** draws a 1px border in the border color */
  bordered?: boolean;
  testID?: string;
}

/** a view whose spacing, surface and corners come from the design tokens */
export function Box({
  children,
  padding,
  paddingX,
  paddingY,
  margin,
  marginX,
  marginY,
  flex = false,
  surface,
  radius,
  bordered = false,
  testID,
}: BoxProps) {
  const className = cx(
    flex && 'flex-1',
    padding && PADDING[padding],
    paddingX && PADDING_X[paddingX],
    paddingY && PADDING_Y[paddingY],
    margin && MARGIN[margin],
    marginX && MARGIN_X[marginX],
    marginY && MARGIN_Y[marginY],
    surface && SURFACE[surface],
    radius && RADIUS[radius],
    bordered && 'border border-border',
  );
  return (
    <View className={className} testID={testID}>
      {children}
    </View>
  );
}
