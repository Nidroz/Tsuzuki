import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useCallback, type ReactElement } from 'react';

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
  testID?: string;
}

/**
 * a virtualized vertical list that recycles its rows. taps on a row work while the keyboard is
 * open, and dragging the list dismisses the keyboard
 */
export function List<T>({ items, renderItem, keyOf, header, empty, testID }: ListProps<T>) {
  const renderListItem = useCallback(
    ({ item }: ListRenderItemInfo<T>) => renderItem(item),
    [renderItem],
  );

  return (
    <FlashList
      data={items}
      renderItem={renderListItem}
      keyExtractor={keyOf}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      testID={testID}
    />
  );
}
