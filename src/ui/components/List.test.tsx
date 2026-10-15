import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';
import { Pressable } from 'react-native';

import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { List } from './List';
import { Text } from './Text';

interface Item {
  readonly id: string;
  readonly name: string;
}

const ITEMS: readonly Item[] = [
  { id: 'a', name: 'Frieren' },
  { id: 'b', name: 'Mushishi' },
  { id: 'c', name: 'Monster' },
];
const TEST_ID = 'list';
const HEADER = 'Results';
const EMPTY = 'No results';

const keyOf = (item: Item) => item.id;
const renderItem = (item: Item) => <Text testID={`row-${item.id}`}>{item.name}</Text>;

describe('List', () => {
  it('renders every item in order with renderItem', async () => {
    await renderWithTheme(
      <List items={ITEMS} renderItem={renderItem} keyOf={keyOf} testID={TEST_ID} />,
    );

    const rows = screen.getAllByText(/^(?:Frieren|Mushishi|Monster)$/u);

    expect(rows).toHaveLength(ITEMS.length);
    ITEMS.forEach((item, index) => {
      expect(rows[index]).toHaveTextContent(item.name);
    });
    expect(screen.getByTestId(TEST_ID)).toContainElement(screen.getByTestId('row-b'));
  });

  it('shows the header above the items', async () => {
    await renderWithTheme(
      <List items={ITEMS} renderItem={renderItem} keyOf={keyOf} header={<Text>{HEADER}</Text>} />,
    );

    expect(screen.getByText(HEADER)).toBeOnTheScreen();
    expect(screen.getByText('Frieren')).toBeOnTheScreen();
  });

  it('shows the empty slot without items, and not with items', async () => {
    const { rerender } = await renderWithTheme(
      <List items={[]} renderItem={renderItem} keyOf={keyOf} empty={<Text>{EMPTY}</Text>} />,
    );

    expect(screen.getByText(EMPTY)).toBeOnTheScreen();

    await rerender(
      <List items={ITEMS} renderItem={renderItem} keyOf={keyOf} empty={<Text>{EMPTY}</Text>} />,
    );

    expect(screen.queryByText(EMPTY)).not.toBeOnTheScreen();
  });

  it('keeps taps on rows while the keyboard is open and dismisses it on drag', async () => {
    await renderWithTheme(
      <List items={ITEMS} renderItem={renderItem} keyOf={keyOf} testID={TEST_ID} />,
    );

    expect(screen.getByTestId(TEST_ID)).toHaveProp('keyboardShouldPersistTaps', 'handled');
    expect(screen.getByTestId(TEST_ID)).toHaveProp('keyboardDismissMode', 'on-drag');
  });

  it('lets a row handle its press', async () => {
    const onPress = jest.fn();
    const user = userEvent.setup();
    const pressableRow = (item: Item) => (
      <Pressable accessibilityRole="button" accessibilityLabel={item.name} onPress={onPress}>
        <Text>{item.name}</Text>
      </Pressable>
    );
    await renderWithTheme(<List items={ITEMS} renderItem={pressableRow} keyOf={keyOf} />);

    await user.press(screen.getByRole('button', { name: 'Mushishi' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
