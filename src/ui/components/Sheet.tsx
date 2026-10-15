import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { IconButton } from './IconButton';
import { SafeAreaView, type Edge } from './layout/safe-area-view';
import { Text } from './Text';

// the sheet rises from the bottom edge: only that edge needs the safe area inset
const SHEET_EDGES: readonly Edge[] = ['bottom'];

export interface SheetProps {
  /** shown when true; its children are not rendered while it is closed */
  visible: boolean;
  /** translated title, announced as a heading */
  title: string;
  /** translated accessibility label of the close button, e.g. "Close the filters" */
  closeLabel: string;
  /** called by the close button, the backdrop and the android back button */
  onClose: () => void;
  /** the scrollable body */
  children?: ReactNode;
  /** pinned under the body, e.g. the actions of the sheet */
  footer?: ReactNode;
  /** the backdrop gets `${testID}-backdrop`, the close button `${testID}-close` */
  testID?: string;
}

/**
 * a modal panel that slides up from the bottom over a dimmed backdrop: a title, a close button, a
 * scrollable body and an optional footer. it takes at most the height left under the top spacing,
 * the body scrolling when it holds more
 */
export function Sheet({
  visible,
  title,
  closeLabel,
  onClose,
  children,
  footer,
  testID,
}: SheetProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID={testID}
    >
      <View className="flex-1 justify-end">
        {/* screen readers close the sheet with its close button: the backdrop is not announced */}
        <Pressable
          className="absolute inset-none bg-background opacity-pressed"
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no"
          {...(testID !== undefined && { testID: `${testID}-backdrop` })}
        />
        <SafeAreaView
          className="mt-2xl shrink rounded-t-lg border-t border-border bg-surface"
          edges={SHEET_EDGES}
          accessibilityViewIsModal
        >
          <View className="flex-row items-center justify-between gap-sm pl-lg pr-sm pt-sm">
            <View className="shrink">
              <Text variant="title">{title}</Text>
            </View>
            <IconButton
              icon="close"
              accessibilityLabel={closeLabel}
              onPress={onClose}
              {...(testID !== undefined && { testID: `${testID}-close` })}
            />
          </View>
          <ScrollView
            className="shrink"
            contentContainerClassName="gap-lg p-lg"
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          {footer === undefined ? null : (
            <View className="border-t border-border px-lg py-md">{footer}</View>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}
