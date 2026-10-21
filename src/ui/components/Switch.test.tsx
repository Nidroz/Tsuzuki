import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';

import { renderWithTheme } from '../../../test/mobile/render-with-theme';
import { palettes } from '../theme/colors';
import { Switch, type SwitchProps } from './Switch';

const LABEL = 'Show adult content';
const TEST_ID = 'some-switch';

type ValueHandler = (value: boolean) => void;

const renderSwitch = async (props: Partial<SwitchProps> = {}) => {
  const onValueChange = jest.fn<ValueHandler>();
  await renderWithTheme(
    <Switch
      value={false}
      onValueChange={onValueChange}
      accessibilityLabel={LABEL}
      testID={TEST_ID}
      {...props}
    />,
  );
  return { onValueChange, element: screen.getByTestId(TEST_ID) };
};

describe('Switch', () => {
  it.each([false, true])('is announced as a switch with its label, checked %s', async (value) => {
    const { element } = await renderSwitch({ value });

    expect(screen.getByRole('switch', { name: LABEL })).toBe(element);
    expect(element).toHaveProp('value', value);
    expect(element).toHaveProp('accessibilityState', { checked: value, disabled: false });
    expect(screen.queryByRole('switch', { checked: true })).toBe(value ? element : null);
  });

  it('calls onValueChange with the new value when flipped, and holds no state of its own', async () => {
    const { onValueChange, element } = await renderSwitch({ value: false });

    await fireEvent(element, 'valueChange', true);

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith(true);
    expect(element).not.toBeChecked();
  });

  // the native switch ignores flips while disabled; the test renderer does not emulate it
  it('is disabled for the native switch and announced as disabled', async () => {
    const { element } = await renderSwitch({ disabled: true });

    expect(element).toHaveProp('disabled', true);
    expect(element).toBeDisabled();
    expect(element).toHaveProp('accessibilityState', { checked: false, disabled: true });
  });

  it('draws the track and thumb in the theme colors', async () => {
    const { element } = await renderSwitch();

    expect(element).toHaveProp('onTintColor', palettes.light.primary);
    expect(element).toHaveProp('tintColor', palettes.light.border);
    expect(element).toHaveProp('thumbTintColor', palettes.light.surface);
  });

  it('requires an accessibility label', async () => {
    // @ts-expect-error(type-test): screen readers need the translated name of the setting
    await renderWithTheme(<Switch value={false} onValueChange={jest.fn()} testID={TEST_ID} />);

    expect(screen.getByTestId(TEST_ID)).toBeOnTheScreen();
  });
});
