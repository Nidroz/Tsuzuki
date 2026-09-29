import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import type { SpacingToken } from '../theme/spacing';
import { cx, PADDING } from './layout/layout-classes';

const CARD = 'rounded-lg border border-border bg-surface';

interface CardBaseProps {
  children: ReactNode;
  /** md by default */
  padding?: SpacingToken;
  testID?: string;
}

interface StaticCardProps extends CardBaseProps {
  onPress?: never;
  accessibilityLabel?: never;
  accessibilityHint?: never;
}

interface PressableCardProps extends CardBaseProps {
  onPress: () => void;
  /** translated summary of the card, read as one button by screen readers */
  accessibilityLabel: string;
  accessibilityHint?: string;
}

export type CardProps = StaticCardProps | PressableCardProps;

/** a bordered surface; with onPress the whole card is one button */
export function Card(props: CardProps) {
  const { children, padding = 'md', testID } = props;
  const className = cx(CARD, PADDING[padding]);

  if (props.onPress === undefined) {
    return (
      <View className={className} testID={testID}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      className={cx(className, 'active:opacity-pressed')}
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      {...(props.accessibilityHint !== undefined && { accessibilityHint: props.accessibilityHint })}
      testID={testID}
    >
      {children}
    </Pressable>
  );
}
