import { memo, useCallback } from 'react';
import { Pressable, View } from 'react-native';

import { cx } from '../layout/layout-classes';
import { Text } from '../Text';

const PAGE = 'min-h-touch min-w-touch items-center justify-center rounded-md px-sm';

// a typographic symbol, not language text: screen readers get the translated label instead
const ELLIPSIS_GLYPH = '…';

export interface PageButtonProps {
  page: number;
  /** the current page: highlighted and announced as selected */
  selected: boolean;
  /** translated accessibility label, e.g. "Page 3" or "Page 3 of 12, current page" */
  accessibilityLabel: string;
  onSelect: (page: number) => void;
  testID?: string;
}

/** one page number of the pagination window */
export const PageButton = memo(function PageButton({
  page,
  selected,
  accessibilityLabel,
  onSelect,
  testID,
}: PageButtonProps) {
  const handlePress = useCallback(() => {
    onSelect(page);
  }, [onSelect, page]);

  return (
    <Pressable
      className={cx(PAGE, 'active:opacity-pressed', selected ? 'bg-primary' : 'bg-transparent')}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      {...(testID !== undefined && { testID })}
    >
      <Text variant="label" tone={selected ? 'onPrimary' : 'default'}>
        {String(page)}
      </Text>
    </Pressable>
  );
});

export interface PageEllipsisProps {
  /** translated accessibility label, e.g. "More pages" */
  accessibilityLabel: string;
}

/** stands for the hidden pages between two page buttons */
export function PageEllipsis({ accessibilityLabel }: PageEllipsisProps) {
  return (
    <View className={PAGE}>
      <Text tone="muted" accessibilityLabel={accessibilityLabel}>
        {ELLIPSIS_GLYPH}
      </Text>
    </View>
  );
}
