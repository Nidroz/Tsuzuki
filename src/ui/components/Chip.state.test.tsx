import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { Chip } from './Chip';

const LABEL = 'Anime';
const STATE_LABEL = 'Anime, excluded';
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

// the convention of the app's controls: a control of more than two states names its state in its
// label and sets no state, so the state is not announced twice
describe('Chip with its state in its label', () => {
  it('keeps only disabled in the state of a toggle chip, whatever its look', async () => {
    await renderWithTheme(
      <Chip
        label={LABEL}
        accessibilityLabel={STATE_LABEL}
        onPress={jest.fn()}
        selected
        excluded
        stateInLabel
        testID={TEST_ID}
      />,
    );

    const chip = screen.getByRole('button', { name: STATE_LABEL });

    expect(chip).toBe(screen.getByTestId(TEST_ID));
    expect(chip).toHaveProp('accessibilityState', { disabled: false });
    expect(chip).not.toBeSelected();
    expect(classesOf(chip)).toContain('bg-danger');
  });

  it('draws a selected chip as before, without announcing it as selected', async () => {
    await render(
      <Chip
        label={LABEL}
        accessibilityLabel={`${LABEL}, included`}
        onPress={jest.fn()}
        selected
        stateInLabel
        disabled
        testID={TEST_ID}
      />,
    );

    const chip = screen.getByTestId(TEST_ID);

    expect(chip).toHaveProp('accessibilityState', { disabled: true });
    expect(chip).toBeDisabled();
    expect(classesOf(chip)).toStrictEqual([
      ...CHIP_CLASSES,
      'border-primary',
      'bg-primary',
      'opacity-disabled',
      'active:opacity-pressed',
    ]);
  });

  it('sets no state on a static chip', async () => {
    await render(
      <Chip
        label={LABEL}
        accessibilityLabel={STATE_LABEL}
        selected
        stateInLabel
        testID={TEST_ID}
      />,
    );

    const chip = screen.getByLabelText(STATE_LABEL);

    expect(chip).toBe(screen.getByTestId(TEST_ID));
    expect(chip.props).not.toHaveProperty('accessibilityState');
    expect(classesOf(chip)).toContain('bg-primary');
  });

  it('leaves a radio checked', async () => {
    await render(<Chip label={LABEL} role="radio" onPress={jest.fn()} selected stateInLabel />);

    expect(screen.getByRole('radio', { name: LABEL })).toHaveProp('accessibilityState', {
      checked: true,
      disabled: false,
    });
  });
});
