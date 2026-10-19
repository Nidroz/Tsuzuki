import { Chip, Row } from '@ui/index';

/** one chip of a ChoiceChips group */
export interface ChoiceChipOption<T extends string> {
  readonly value: T;
  /** translated visible label, also the accessibility label of the chip */
  readonly label: string;
}

export interface ChoiceChipsProps<T extends string> {
  /** translated name of the group, e.g. the choice its chips make */
  accessibilityLabel: string;
  options: readonly ChoiceChipOption<T>[];
  /** the chosen option */
  value: T;
  /** called with the value of a pressed chip, never for the chip already chosen */
  onChange: (value: T) => void;
  /** the group's test id; each chip gets `${testID}-${value}` */
  testID: string;
}

/** a named group of single-select chips, one per option: exactly one is selected */
export function ChoiceChips<T extends string>({
  accessibilityLabel,
  options,
  value,
  onChange,
  testID,
}: ChoiceChipsProps<T>) {
  return (
    <Row gap="sm" wrap accessibilityLabel={accessibilityLabel} testID={testID}>
      {options.map((option) => (
        <Chip
          key={option.value}
          label={option.label}
          selected={option.value === value}
          onPress={() => {
            if (option.value !== value) {
              onChange(option.value);
            }
          }}
          testID={`${testID}-${option.value}`}
        />
      ))}
    </Row>
  );
}
