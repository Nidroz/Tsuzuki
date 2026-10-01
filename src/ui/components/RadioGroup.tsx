import { Pressable, View } from 'react-native';

import { cx } from './layout/layout-classes';
import { Text } from './Text';

const OPTION = 'min-h-touch flex-row items-center gap-md active:opacity-pressed';
const INDICATOR = 'h-xl w-xl items-center justify-center rounded-full border';
const INDICATOR_CHECKED = 'border-primary';
const INDICATOR_UNCHECKED = 'border-border';
const DOT = 'h-md w-md rounded-full bg-primary';

export interface RadioOption<T extends string> {
  value: T;
  /** translated visible label, also the accessibility label of the option */
  label: string;
}

export interface RadioGroupProps<T extends string> {
  /** translated name of the group, e.g. the setting it changes */
  accessibilityLabel: string;
  options: readonly RadioOption<T>[];
  /** the checked option */
  value: T;
  /** called with the value of a pressed option, never for the option already checked */
  onChange: (value: T) => void;
  /** the group's test id; each option gets `${testID}-${value}` */
  testID?: string;
}

interface RadioProps<T extends string> {
  option: RadioOption<T>;
  checked: boolean;
  onChange: (value: T) => void;
  testID: string | undefined;
}

function Radio<T extends string>({ option, checked, onChange, testID }: RadioProps<T>) {
  const select = () => {
    if (!checked) {
      onChange(option.value);
    }
  };

  return (
    <Pressable
      className={OPTION}
      onPress={select}
      accessibilityRole="radio"
      accessibilityLabel={option.label}
      accessibilityState={{ checked }}
      testID={testID}
    >
      <View className={cx(INDICATOR, checked ? INDICATOR_CHECKED : INDICATOR_UNCHECKED)}>
        {checked && <View className={DOT} />}
      </View>
      <Text>{option.label}</Text>
    </Pressable>
  );
}

/**
 * a single choice among a few options, each a radio with a full-size touch target. the group is
 * announced with its label (radiogroup role on android; ios has no group trait), each option with
 * its label and checked state
 */
export function RadioGroup<T extends string>({
  accessibilityLabel,
  options,
  value,
  onChange,
  testID,
}: RadioGroupProps<T>) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} testID={testID}>
      {options.map((option) => (
        <Radio
          key={option.value}
          option={option}
          checked={option.value === value}
          onChange={onChange}
          testID={testID === undefined ? undefined : `${testID}-${option.value}`}
        />
      ))}
    </View>
  );
}
