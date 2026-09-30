import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent } from '@testing-library/react-native';
import { Text } from 'react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { spacing, type SpacingToken } from '../theme/spacing';
import { Card } from './Card';
import { PADDING } from './layout/layout-classes';

const TEST_ID = 'card';
const CONTENT = 'Frieren, episode 3 of 28';
const LABEL = 'Frieren, episode 3 of 28, open details';
const HINT = 'Opens the title';
const CARD_CLASSES = ['rounded-lg', 'border', 'border-border', 'bg-surface'];
const SPACING_TOKENS = Object.keys(spacing) as SpacingToken[];

describe('Card', () => {
  describe('static', () => {
    it('renders its children on a bordered surface with md padding by default', async () => {
      await render(
        <Card testID={TEST_ID}>
          <Text>{CONTENT}</Text>
        </Card>,
      );

      expect(screen.getByTestId(TEST_ID)).toContainElement(screen.getByText(CONTENT));
      expect(classesOf(screen.getByTestId(TEST_ID))).toStrictEqual([...CARD_CLASSES, PADDING.md]);
    });

    it('is not a button', async () => {
      await render(
        <Card testID={TEST_ID}>
          <Text>{CONTENT}</Text>
        </Card>,
      );

      expect(screen.queryByRole('button')).not.toBeOnTheScreen();
      expect(screen.getByTestId(TEST_ID).props).not.toHaveProperty('accessibilityRole');
    });

    it('takes no accessibility label: it is no button, its content is read as is', async () => {
      await render(
        // @ts-expect-error(type-test): a static card is no button, so it takes no accessibility label
        <Card testID={TEST_ID} accessibilityLabel={LABEL}>
          <Text>{CONTENT}</Text>
        </Card>,
      );

      expect(screen.getByTestId(TEST_ID).props).not.toHaveProperty('accessibilityLabel');
      expect(screen.queryByLabelText(LABEL)).not.toBeOnTheScreen();
    });

    it.each(SPACING_TOKENS)('maps padding %s to its class', async (padding) => {
      await render(
        <Card testID={TEST_ID} padding={padding}>
          <Text>{CONTENT}</Text>
        </Card>,
      );

      expect(classesOf(screen.getByTestId(TEST_ID))).toStrictEqual([
        ...CARD_CLASSES,
        PADDING[padding],
      ]);
    });
  });

  describe('pressable', () => {
    it('is one button announced with its accessibility label', async () => {
      await render(
        <Card testID={TEST_ID} onPress={jest.fn()} accessibilityLabel={LABEL}>
          <Text>{CONTENT}</Text>
        </Card>,
      );

      const card = screen.getByRole('button', { name: LABEL });

      expect(card).toBe(screen.getByTestId(TEST_ID));
      expect(card).toContainElement(screen.getByText(CONTENT));
      expect(classesOf(card)).toStrictEqual([
        ...CARD_CLASSES,
        PADDING.md,
        'active:opacity-pressed',
      ]);
    });

    it('calls onPress when pressed', async () => {
      const onPress = jest.fn();
      const user = userEvent.setup();
      await render(
        <Card onPress={onPress} accessibilityLabel={LABEL}>
          <Text>{CONTENT}</Text>
        </Card>,
      );

      await user.press(screen.getByRole('button', { name: LABEL }));

      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('passes the accessibility hint, none by default', async () => {
      const { rerender } = await render(
        <Card testID={TEST_ID} onPress={jest.fn()} accessibilityLabel={LABEL}>
          <Text>{CONTENT}</Text>
        </Card>,
      );

      expect(screen.getByTestId(TEST_ID).props).not.toHaveProperty('accessibilityHint');

      await rerender(
        <Card
          testID={TEST_ID}
          onPress={jest.fn()}
          accessibilityLabel={LABEL}
          accessibilityHint={HINT}
        >
          <Text>{CONTENT}</Text>
        </Card>,
      );

      expect(screen.getByHintText(HINT)).toBe(screen.getByRole('button', { name: LABEL }));
    });

    it('requires an accessibility label with onPress', async () => {
      await render(
        // @ts-expect-error(type-test): a pressable card is read as one button and needs a label
        <Card testID={TEST_ID} onPress={jest.fn()}>
          <Text>{CONTENT}</Text>
        </Card>,
      );

      expect(screen.getByRole('button')).toBe(screen.getByTestId(TEST_ID));
    });
  });
});
