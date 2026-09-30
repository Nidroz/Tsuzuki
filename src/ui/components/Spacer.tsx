import { View } from 'react-native';

import type { SpacingToken } from '../theme/spacing';
import { SQUARE } from './layout/layout-classes';

/** a fixed gap of one spacing token, or a flexible gap that fills the remaining space */
export type SpacerProps = ({ size: SpacingToken; flex?: never } | { flex: true; size?: never }) & {
  testID?: string;
};

/** empty space between siblings; hidden from screen readers */
export function Spacer(props: SpacerProps) {
  const className = props.flex ? 'flex-1' : SQUARE[props.size];
  return (
    <View
      className={className}
      testID={props.testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
