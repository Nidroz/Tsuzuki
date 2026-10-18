import { View } from 'react-native';

import { Text } from './Text';

// screen readers pause on a comma between the label and the value
const LABEL_SEPARATOR = ', ';

export interface FactProps {
  /** translated name of the fact, e.g. "Format" */
  label: string;
  /** translated or formatted value, e.g. "TV" */
  value: string;
  testID?: string;
}

/**
 * a labelled fact of a title, the label above its value. one accessible element: screen readers
 * read the label and the value together ("Format, TV")
 */
export function Fact({ label, value, testID }: FactProps) {
  return (
    <View
      className="gap-xs"
      accessible
      accessibilityLabel={[label, value].join(LABEL_SEPARATOR)}
      testID={testID}
    >
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text>{value}</Text>
    </View>
  );
}
