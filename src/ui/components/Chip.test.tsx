import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent } from '@testing-library/react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { Chip } from './Chip';

const LABEL = 'Anime';
const TEST_ID = 'chip';
const CHIP_CLASSES = [
  'min-h-touch',
  'flex-row',
  'items-center',
  'justify-center',
  'rounded-full',
  'border',
  'px-md',
];

describe('Chip', () => {
  describe('static', () => {
    it('renders its label on one line, unselected by default', async () => {
      await render(<Chip label={LABEL} testID={TEST_ID} />);

      const chip = screen.getByTestId(TEST_ID);

      expect(screen.getByText(LABEL)).toHaveProp('numberOfLines', 1);
      expect(chip).toHaveProp('accessibilityState', { selected: false });
      expect(classesOf(chip)).toStrictEqual([...CHIP_CLASSES, 'border-border', 'bg-surface-muted']);
      expect(classesOf(screen.getByText(LABEL))).toContain('text-text');
    });

    it('is one accessible element named by its label, announced as not selected', async () => {
      await render(<Chip label={LABEL} testID={TEST_ID} />);

      const chip = screen.getByLabelText(LABEL);

      expect(chip).toBe(screen.getByTestId(TEST_ID));
      expect(chip).toHaveProp('accessible', true);
      expect(chip).toHaveAccessibleName(LABEL);
      expect(chip).not.toBeSelected();
      expect(chip).toContainElement(screen.getByText(LABEL));
    });

    it('is not a button', async () => {
      await render(<Chip label={LABEL} testID={TEST_ID} />);

      expect(screen.queryByRole('button')).not.toBeOnTheScreen();
      expect(screen.getByTestId(TEST_ID).props).not.toHaveProperty('accessibilityRole');
    });

    it('is drawn in the primary color and marked selected when selected', async () => {
      await render(<Chip label={LABEL} selected testID={TEST_ID} />);

      const chip = screen.getByTestId(TEST_ID);

      expect(screen.getByLabelText(LABEL)).toBe(chip);
      expect(chip).toBeSelected();
      expect(chip).toHaveProp('accessibilityState', { selected: true });
      expect(classesOf(chip)).toStrictEqual([...CHIP_CLASSES, 'border-primary', 'bg-primary']);
      expect(classesOf(screen.getByText(LABEL))).toContain('text-on-primary');
    });

    it('is dimmed when disabled', async () => {
      await render(<Chip label={LABEL} disabled testID={TEST_ID} />);

      expect(classesOf(screen.getByTestId(TEST_ID))).toContain('opacity-disabled');
    });
  });

  describe('toggle', () => {
    it('is a button announced with its label and selected state', async () => {
      await render(<Chip label={LABEL} onPress={jest.fn()} selected testID={TEST_ID} />);

      const chip = screen.getByRole('button', { name: LABEL });

      expect(chip).toBe(screen.getByTestId(TEST_ID));
      expect(chip).toBeSelected();
      expect(chip).toBeEnabled();
      expect(classesOf(chip)).toStrictEqual([
        ...CHIP_CLASSES,
        'border-primary',
        'bg-primary',
        'active:opacity-pressed',
      ]);
    });

    it('is announced as not selected when unselected', async () => {
      await render(<Chip label={LABEL} onPress={jest.fn()} />);

      const chip = screen.getByRole('button', { name: LABEL });

      expect(chip).not.toBeSelected();
      expect(chip).toHaveProp('accessibilityState', { selected: false, disabled: false });
    });

    it('calls onPress when pressed', async () => {
      const onPress = jest.fn();
      const user = userEvent.setup();
      await render(<Chip label={LABEL} onPress={onPress} />);

      await user.press(screen.getByRole('button', { name: LABEL }));

      expect(onPress).toHaveBeenCalledTimes(1);
    });

    it('is disabled, dimmed and ignores presses when disabled', async () => {
      const onPress = jest.fn();
      const user = userEvent.setup();
      await render(<Chip label={LABEL} onPress={onPress} disabled />);

      const chip = screen.getByRole('button', { name: LABEL });
      await user.press(chip);

      expect(onPress).not.toHaveBeenCalled();
      expect(chip).toBeDisabled();
      expect(classesOf(chip)).toContain('opacity-disabled');
    });
  });
});
