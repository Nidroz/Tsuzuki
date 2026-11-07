import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, View } from 'react-native';

import { IconButton } from './IconButton';
import { SafeAreaView, type Edge } from './layout/safe-area-view';
import { Text } from './Text';

// the sheet rises from the bottom edge: only that edge needs the safe area inset
const SHEET_EDGES: readonly Edge[] = ['bottom'];

// padding on both platforms: android draws edge to edge, so its window no longer resizes for the
// keyboard, and ios never did
const KEYBOARD_BEHAVIOR = 'padding';

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
  /**
   * the backdrop gets `${testID}-backdrop`, the close button `${testID}-close`, the keyboard
   * avoiding wrapper of the panel `${testID}-keyboard`
   */
  testID?: string;
}

/**
 * a modal panel that slides up from the bottom over a dimmed backdrop: a title, a close button, a
 * scrollable body and an optional footer. it takes at most the height left under the top spacing,
 * the body scrolling when it holds more. the panel rises above the keyboard, its body shrinking
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
          className="absolute inset-none bg-scrim opacity-scrim"
          onPress={onClose}
          accessible={false}
          importantForAccessibility="no"
          {...(testID !== undefined && { testID: `${testID}-backdrop` })}
        />
        {/* only the panel avoids the keyboard: the backdrop keeps covering the whole screen. the
            wrapper is the backdrop's sibling, so it carries the ios modal flag of the panel.
            the body scroll view sets no automaticallyAdjustKeyboardInsets: once this padding lifts
            the panel, the keyboard no longer overlaps the body, so that ios-only inset would add
            nothing at rest and could double the space while the keyboard moves */}
        <KeyboardAvoidingView
          className="shrink"
          behavior={KEYBOARD_BEHAVIOR}
          accessibilityViewIsModal
          {...(testID !== undefined && { testID: `${testID}-keyboard` })}
        >
          <SafeAreaView
            className="mt-2xl shrink rounded-t-lg border-t border-border bg-surface"
            edges={SHEET_EDGES}
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
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
