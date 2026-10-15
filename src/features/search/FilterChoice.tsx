import { Chip, Row, Stack, Text } from '@ui/index';

/** one chip of a FilterChoice */
export interface FilterChoiceOption<T extends string | number> {
  readonly value: T;
  /** translated visible label */
  readonly label: string;
  /** translated label read instead of the visible one, e.g. "Score 7 or more" for "7+" */
  readonly accessibilityLabel?: string;
}

export interface FilterChoiceProps<T extends string | number> {
  /** translated section title */
  title: string;
  options: readonly FilterChoiceOption<T>[];
  /** the chosen value, null when none is */
  value: T | null;
  onChange: (value: T | null) => void;
  /** a tap on the chosen chip clears the choice (null) */
  deselectable: boolean;
  /** a first chip standing for no value (null), e.g. "Relevance"; none by default */
  noneLabel?: string;
  /** each chip gets `${testID}-${value}`, the none chip `${testID}-none` */
  testID: string;
}

/**
 * a titled group of single-select chips, one per option: the chosen one is selected. a section of
 * the filters sheet (FR-03)
 */
export function FilterChoice<T extends string | number>({
  title,
  options,
  value,
  onChange,
  deselectable,
  noneLabel,
  testID,
}: FilterChoiceProps<T>) {
  const choose = (option: T) => {
    onChange(deselectable && option === value ? null : option);
  };

  return (
    <Stack gap="sm" testID={testID}>
      <Text variant="subtitle">{title}</Text>
      <Row gap="sm" wrap>
        {noneLabel === undefined ? null : (
          <Chip
            label={noneLabel}
            selected={value === null}
            onPress={() => {
              onChange(null);
            }}
            testID={`${testID}-none`}
          />
        )}
        {options.map((option) => (
          <Chip
            key={option.value}
            label={option.label}
            {...(option.accessibilityLabel !== undefined && {
              accessibilityLabel: option.accessibilityLabel,
            })}
            selected={option.value === value}
            onPress={() => {
              choose(option.value);
            }}
            testID={`${testID}-${String(option.value)}`}
          />
        ))}
      </Row>
    </Stack>
  );
}
