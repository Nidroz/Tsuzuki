import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import { useCallback, useEffect, useRef, type ReactElement } from 'react';

// the scroll offset of the top of the list
const TOP_OFFSET = 0;

export interface ListProps<T> {
  items: readonly T[];
  /** renders one item; pass a stable function (module level or memoized) and a memoized row */
  renderItem: (item: T) => ReactElement;
  /** a stable, unique key per item; pass a stable function */
  keyOf: (item: T) => string;
  /** shown above the items, scrolled with them */
  header?: ReactElement | null;
  /** shown instead of the items when there are none */
  empty?: ReactElement | null;
  /** shown after the items, scrolled with them */
  footer?: ReactElement | null;
  /**
   * when it changes after the first render, the list scrolls back to the top without animation,
   * e.g. the key of the content shown (a search and its page)
   */
  scrollToTopKey?: string | number;
  testID?: string;
}

/**
 * a virtualized vertical list that recycles its rows. taps on a row work while the keyboard is
 * open, and dragging the list dismisses the keyboard
 */
export function List<T>({
  items,
  renderItem,
  keyOf,
  header,
  empty,
  footer,
  scrollToTopKey,
  testID,
}: ListProps<T>) {
  const listRef = useRef<FlashListRef<T>>(null);
  const renderListItem = useCallback(
    ({ item }: ListRenderItemInfo<T>) => renderItem(item),
    [renderItem],
  );

  // the key the list was last scrolled for: the first render keeps the offset it starts with
  const scrolledKeyRef = useRef(scrollToTopKey);
  useEffect(() => {
    if (scrolledKeyRef.current !== scrollToTopKey) {
      scrolledKeyRef.current = scrollToTopKey;
      listRef.current?.scrollToOffset({ offset: TOP_OFFSET, animated: false });
    }
  }, [scrollToTopKey]);

  return (
    <FlashList
      ref={listRef}
      data={items}
      renderItem={renderListItem}
      keyExtractor={keyOf}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      ListFooterComponent={footer}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      testID={testID}
    />
  );
}
