import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { FilterChoice, type FilterChoiceProps } from './FilterChoice';

type Size = 'small' | 'large';

// the component takes translated labels from its caller: these stand for them
const OPTIONS = [
  { value: 'small', label: 'Small' },
  { value: 'large', label: 'Large', accessibilityLabel: 'Large size' },
] as const;

const renderChoice = async (props: Partial<FilterChoiceProps<Size>> = {}) => {
  const onChange = jest.fn<(value: Size | null) => void>();
  await renderWithProviders(
    <FilterChoice<Size>
      title="Size"
      options={OPTIONS}
      value={null}
      onChange={onChange}
      deselectable
      testID="choice"
      {...props}
    />,
  );
  return { onChange, user: userEvent.setup() };
};

describe('FilterChoice', () => {
  it('shows its title and one chip per option, the chosen one alone selected', async () => {
    await renderChoice({ value: 'small' });

    expect(screen.getByText('Size')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Small' })).toBeSelected();
    expect(screen.getByRole('button', { name: 'Large size' })).not.toBeSelected();
    expect(screen.getByTestId('choice-large')).toHaveTextContent('Large');
  });

  it('chooses the pressed option', async () => {
    const { onChange, user } = await renderChoice({ value: 'small' });

    await user.press(screen.getByRole('button', { name: 'Large size' }));

    expect(onChange).toHaveBeenCalledWith('large');
  });

  it('clears the choice when the chosen chip is pressed again, if deselectable', async () => {
    const { onChange, user } = await renderChoice({ value: 'small' });

    await user.press(screen.getByRole('button', { name: 'Small' }));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('keeps the choice when the chosen chip is pressed again, if not deselectable', async () => {
    const { onChange, user } = await renderChoice({ value: 'small', deselectable: false });

    await user.press(screen.getByRole('button', { name: 'Small' }));

    expect(onChange).toHaveBeenCalledWith('small');
  });

  it('offers a first chip for no value, selected while nothing is chosen', async () => {
    const { onChange, user } = await renderChoice({ noneLabel: 'Any', deselectable: false });

    const none = screen.getByRole('button', { name: 'Any' });
    expect(none).toBeSelected();
    expect(screen.getAllByRole('button')[0]).toBe(none);

    await user.press(none);

    expect(onChange).toHaveBeenCalledWith(null);
  });
});
