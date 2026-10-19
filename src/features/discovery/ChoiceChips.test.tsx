import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { ChoiceChips, type ChoiceChipOption } from './ChoiceChips';

type Fruit = 'apple' | 'pear' | 'plum';

const OPTIONS: readonly ChoiceChipOption<Fruit>[] = [
  { value: 'apple', label: 'Apple' },
  { value: 'pear', label: 'Pear' },
  { value: 'plum', label: 'Plum' },
];
const GROUP_LABEL = 'Fruit';
const TEST_ID = 'fruit';

const renderChips = (value: Fruit, onChange = jest.fn<(value: Fruit) => void>()) =>
  renderWithProviders(
    <ChoiceChips
      accessibilityLabel={GROUP_LABEL}
      options={OPTIONS}
      value={value}
      onChange={onChange}
      testID={TEST_ID}
    />,
  );

describe('ChoiceChips', () => {
  it('is a group named by its label, with one button per option in order', async () => {
    await renderChips('apple');

    const group = screen.getByTestId(TEST_ID);
    expect(group).toHaveProp('accessibilityRole', 'radiogroup');
    expect(group).toHaveProp('accessibilityLabel', GROUP_LABEL);
    expect(screen.getAllByRole('button')).toStrictEqual([
      screen.getByTestId('fruit-apple'),
      screen.getByTestId('fruit-pear'),
      screen.getByTestId('fruit-plum'),
    ]);
    expect(screen.getByRole('button', { name: 'Pear' })).toBeOnTheScreen();
  });

  it('selects the chosen option alone', async () => {
    await renderChips('pear');

    expect(screen.getByRole('button', { name: 'Pear' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Apple' })).not.toBeSelected();
    expect(screen.getByRole('button', { name: 'Plum' })).not.toBeSelected();
  });

  it('asks for the option of a pressed chip', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn<(value: Fruit) => void>();
    await renderChips('apple', onChange);

    await user.press(screen.getByRole('button', { name: 'Plum' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('plum');
  });

  it('asks for nothing when the chosen chip is pressed again', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn<(value: Fruit) => void>();
    await renderChips('apple', onChange);

    await user.press(screen.getByRole('button', { name: 'Apple' }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
