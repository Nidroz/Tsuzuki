import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';
import { Pressable, ScrollView } from 'react-native';

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
const FOOTER = 'Pages';

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

  it('shows the footer after the items', async () => {
    await renderWithTheme(
      <List
        items={ITEMS}
        renderItem={renderItem}
        keyOf={keyOf}
        footer={<Text testID="footer">{FOOTER}</Text>}
        testID={TEST_ID}
      />,
    );

    const list = screen.getByTestId(TEST_ID);
    const texts = screen.getAllByText(/^(?:Frieren|Mushishi|Monster|Pages)$/u);
    expect(texts.at(-1)).toHaveTextContent(FOOTER);
    expect(list).toContainElement(screen.getByTestId('footer'));
  });

  it('shows the footer under the empty slot without items', async () => {
    await renderWithTheme(
      <List
        items={[]}
        renderItem={renderItem}
        keyOf={keyOf}
        empty={<Text>{EMPTY}</Text>}
        footer={<Text>{FOOTER}</Text>}
      />,
    );

    expect(screen.getByText(EMPTY)).toBeOnTheScreen();
    expect(screen.getByText(FOOTER)).toBeOnTheScreen();
  });

  it('asks the kind of each item, so a cell is recycled for its own kind only', async () => {
    const itemTypeOf = jest.fn((item: Item) => (item.id === 'a' ? 'header' : 'row'));
    await renderWithTheme(
      <List items={ITEMS} renderItem={renderItem} keyOf={keyOf} itemTypeOf={itemTypeOf} />,
    );

    expect(screen.getByText('Monster')).toBeOnTheScreen();
    for (const item of ITEMS) {
      expect(itemTypeOf).toHaveBeenCalledWith(item, expect.anything());
    }
    expect(itemTypeOf).toHaveReturnedWith('header');
    expect(itemTypeOf).toHaveReturnedWith('row');
  });

  describe('scrollToTopKey', () => {
    // the jest mock of ScrollView keeps its instance methods on the prototype, as jest.fn: a spy
    // on it is that mock, whose calls outlive a test
    const scrollTo = () => jest.spyOn(ScrollView.prototype, 'scrollTo').mockClear();
    const listWithKey = (key: string | number | undefined) => (
      <List
        items={ITEMS}
        renderItem={renderItem}
        keyOf={keyOf}
        {...(key !== undefined && { scrollToTopKey: key })}
      />
    );

    it('keeps the offset on the first render', async () => {
      const spy = scrollTo();

      await renderWithTheme(listWithKey('a:1'));

      expect(spy).not.toHaveBeenCalled();
    });

    it('scrolls to the top without animation when the key changes', async () => {
      const spy = scrollTo();
      const { rerender } = await renderWithTheme(listWithKey('a:1'));

      await rerender(listWithKey('a:2'));

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ y: 0, animated: false }));
    });

    it('does not scroll again while the key stays the same', async () => {
      const spy = scrollTo();
      const { rerender } = await renderWithTheme(listWithKey(1));

      await rerender(listWithKey(1));
      await rerender(listWithKey(2));
      await rerender(listWithKey(2));

      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
