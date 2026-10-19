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
  it('is a radio group named by its label, with one radio per option in order', async () => {
    await renderChips('apple');

    // the group is not an accessible element itself: role queries miss it (RadioGroup.test.tsx)
    const group = screen.getByTestId(TEST_ID);
    expect(group).toHaveProp('accessibilityRole', 'radiogroup');
    expect(group).toHaveProp('accessibilityLabel', GROUP_LABEL);
    expect(screen.getAllByRole('radio')).toStrictEqual([
      screen.getByTestId('fruit-apple'),
      screen.getByTestId('fruit-pear'),
      screen.getByTestId('fruit-plum'),
    ]);
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });

  it('checks the chosen option alone', async () => {
    await renderChips('pear');

    expect(screen.getByRole('radio', { name: 'Pear' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Apple' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Plum' })).not.toBeChecked();
  });

  it('asks for the option of a pressed chip', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn<(value: Fruit) => void>();
    await renderChips('apple', onChange);

    await user.press(screen.getByRole('radio', { name: 'Plum' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('plum');
  });

  it('asks for nothing when the chosen chip is pressed again', async () => {
    const user = userEvent.setup();
    const onChange = jest.fn<(value: Fruit) => void>();
    await renderChips('apple', onChange);

    await user.press(screen.getByRole('radio', { name: 'Apple' }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
