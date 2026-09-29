import { cssInterop } from 'nativewind';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import type { SpacingToken } from '../theme/spacing';
import { cx, PADDING } from './layout/layout-classes';

// the safe area view is not a react native core component: nativewind styles it once registered
cssInterop(SafeAreaView, { className: 'style' });

export type ScreenEdge = Edge;

const ALL_EDGES: readonly ScreenEdge[] = ['top', 'right', 'bottom', 'left'];

export interface ScreenProps {
  children?: ReactNode;
  /** scrolls its content; taps on the content keep working while the keyboard is open */
  scroll?: boolean;
  /** safe area edges to inset; all four by default */
  edges?: readonly ScreenEdge[];
  /** padding around the content; lg by default */
  padding?: SpacingToken;
  testID?: string;
}

/**
 * root of every screen: themed background, safe area insets (the SafeAreaProvider comes from
 * expo-router's root) and an optional scroll container
 */
export function Screen({
  children,
  scroll = false,
  edges = ALL_EDGES,
  padding = 'lg',
  testID,
}: ScreenProps) {
  return (
    // the safe area view is a native view that is never flattened: end-to-end tests find testID
    <SafeAreaView className="flex-1 bg-background" edges={edges} testID={testID}>
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName={cx('grow', PADDING[padding])}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View className={cx('flex-1', PADDING[padding])}>{children}</View>
      )}
    </SafeAreaView>
  );
}
