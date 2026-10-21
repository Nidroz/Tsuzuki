import type { ReactElement } from 'react';
import { Pressable, View } from 'react-native';

import { CoverImage } from './CoverImage';
import { cx } from './layout/layout-classes';
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
  /**
   * an action of its own at the end of the row, e.g. an IconButton: outside the row's button, so
   * the row and the action stay two separate controls
   */
  trailing?: ReactElement;
  /** the row's button gets `${testID}`, its cover `${testID}-cover` */
  testID?: string;
}

const NO_DETAILS: readonly string[] = [];

/**
 * a pressable row of a title list: its cover, its title and secondary lines, and an optional
 * trailing action beside the row's button
 */
export function MediaListItem({
  title,
  subtitle,
  details = NO_DETAILS,
  imageUrl,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  trailing,
  testID,
}: MediaListItemProps) {
  const label =
    accessibilityLabel ??
    [title, ...(subtitle === undefined ? [] : [subtitle]), ...details].join(LABEL_SEPARATOR);

  const button = (
    <Pressable
      className={cx(
        'min-h-touch flex-row items-start gap-md py-sm active:opacity-pressed',
        trailing !== undefined && 'flex-1',
      )}
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
              // static per render and may repeat a string: the position keeps keys unique
              <Text key={`${String(index)}:${detail}`} variant="caption" tone="muted">
                {detail}
              </Text>
            ))}
          </View>
        )}
      </View>
    </Pressable>
  );

  // a button nested in a pressable is not reachable on its own: the action sits beside the row
  return trailing === undefined ? (
    button
  ) : (
    <View className="flex-row items-center gap-sm">
      {button}
      {trailing}
    </View>
  );
}
