import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, userEvent, within } from '@testing-library/react-native';

import { classesOf } from '../../../test/mobile/class-names';
import { RadioGroup, type RadioOption } from './RadioGroup';

type Theme = 'system' | 'light' | 'dark';

const GROUP_LABEL = 'Theme';
const TEST_ID = 'theme';
const OPTIONS: readonly RadioOption<Theme>[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const OPTION_CLASSES = [
  'min-h-touch',
  'flex-row',
  'items-center',
  'gap-md',
  'active:opacity-pressed',
];
const INDICATOR_CLASSES = ['h-xl', 'w-xl', 'items-center', 'justify-center', 'rounded-full'];

const renderGroup = (value: Theme, onChange: (value: Theme) => void = jest.fn(), testID?: string) =>
  render(
    <RadioGroup
      accessibilityLabel={GROUP_LABEL}
      options={OPTIONS}
      value={value}
      onChange={onChange}
      {...(testID !== undefined && { testID })}
    />,
  );

// the indicator circle is the first child of the option
const indicatorOf = (value: Theme) => {
  const [indicator] = screen.getByTestId(`${TEST_ID}-${value}`).children;
  if (indicator === undefined || typeof indicator === 'string') {
    throw new Error(`the ${value} option has no indicator`);
  }
  return indicator;
};

describe('RadioGroup', () => {
  it('is a radio group announced with its label', async () => {
    await renderGroup('system', jest.fn(), TEST_ID);

    const group = screen.getByTestId(TEST_ID);

    expect(group).toHaveProp('accessibilityRole', 'radiogroup');
    expect(group).toHaveProp('accessibilityLabel', GROUP_LABEL);
    expect(screen.getAllByRole('radio')).toHaveLength(OPTIONS.length);
  });

  it('renders each option as a radio named and labelled by its visible label', async () => {
    await renderGroup('system');

    for (const { label } of OPTIONS) {
      const radio = screen.getByRole('radio', { name: label });
      expect(within(radio).getByText(label)).toBeOnTheScreen();
    }
  });

  it.each(OPTIONS.map(({ value }) => value))('checks only the %s option', async (value) => {
    await renderGroup(value);

    for (const option of OPTIONS) {
      const radio = screen.getByRole('radio', { name: option.label });
      expect(radio).toHaveProp('accessibilityState', { checked: option.value === value });
    }
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1);
  });

  it('calls onChange with the value of a pressed unchecked option', async () => {
    const onChange = jest.fn<(value: Theme) => void>();
    const user = userEvent.setup();
    await renderGroup('system', onChange);

    await user.press(screen.getByRole('radio', { name: 'Dark' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('dark');
  });

  it('does not call onChange when the checked option is pressed again', async () => {
    const onChange = jest.fn<(value: Theme) => void>();
    const user = userEvent.setup();
    await renderGroup('light', onChange);

    await user.press(screen.getByRole('radio', { name: 'Light' }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('gives each option a full touch target and draws the checked one in the primary color', async () => {
    await renderGroup('dark', jest.fn(), TEST_ID);

    expect(classesOf(screen.getByTestId(`${TEST_ID}-dark`))).toStrictEqual(OPTION_CLASSES);
    expect(classesOf(indicatorOf('dark'))).toStrictEqual([
      ...INDICATOR_CLASSES,
      'border',
      'border-primary',
    ]);
    expect(classesOf(indicatorOf('light'))).toStrictEqual([
      ...INDICATOR_CLASSES,
      'border',
      'border-border',
    ]);
    // only the checked option has the inner dot
    expect(indicatorOf('dark').children).toHaveLength(1);
    expect(indicatorOf('light').children).toHaveLength(0);
  });

  it('has no test ids when none is given', async () => {
    await renderGroup('system');

    expect(screen.queryByTestId(`${TEST_ID}-system`)).not.toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'System' }).props).not.toHaveProperty('testID');
  });
});
