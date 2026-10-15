import { Pressable, View } from 'react-native';

import { CoverImage } from './CoverImage';
import { Text } from './Text';

// screen readers pause on a comma between the parts of the row
const LABEL_SEPARATOR = ', ';

export interface MediaListItemProps {
  /** translated or catalog title, the main line */
  title: string;
  /** a second title line, e.g. the english title */
  subtitle?: string;
  /** distinct short facts under the title, translated and formatted (format, year, score) */
  details?: readonly string[];
  /** the catalog cover url, used as given; null shows a placeholder */
  imageUrl: string | null;
  onPress: () => void;
  /** read instead of the visible lines; the title and lines joined by commas by default */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** the cover gets `${testID}-cover` */
  testID?: string;
}

const NO_DETAILS: readonly string[] = [];

/** a pressable row of a title list: its cover, its title and secondary lines */
export function MediaListItem({
  title,
  subtitle,
  details = NO_DETAILS,
  imageUrl,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: MediaListItemProps) {
  const label =
    accessibilityLabel ??
    [title, ...(subtitle === undefined ? [] : [subtitle]), ...details].join(LABEL_SEPARATOR);

  return (
    <Pressable
      className="min-h-touch flex-row items-start gap-md py-sm active:opacity-pressed"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(accessibilityHint !== undefined && { accessibilityHint })}
      testID={testID}
    >
      <CoverImage url={imageUrl} {...(testID !== undefined && { testID: `${testID}-cover` })} />
      <View className="flex-1 gap-xs">
        <Text variant="label" numberOfLines={2}>
          {title}
        </Text>
        {subtitle === undefined ? null : (
          <Text tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        )}
        {details.length === 0 ? null : (
          <View className="flex-row flex-wrap gap-x-sm">
            {details.map((detail, index) => (
              // the list is static per render and may repeat a string: the position keeps keys unique
              <Text key={`${String(index)}:${detail}`} variant="caption" tone="muted">
                {detail}
              </Text>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  );
}
