import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { cssInterop } from 'nativewind';
import { View } from 'react-native';

import { ICON_SIZE, type CoverSize } from '../theme/sizes';
import { useThemeColors } from '../theme/theme-context';
import { COVER_PLACEHOLDER_GLYPH } from './icons';
import { cx } from './layout/layout-classes';

// expo-image is not a react native core component: nativewind styles it once registered
cssInterop(Image, { className: 'style' });

// a 2:3 frame per cover size token (sizes.ts, tailwind.config.ts)
const FRAME: Readonly<Record<CoverSize, string>> = {
  sm: 'h-cover-sm w-cover-sm',
  md: 'h-cover-md w-cover-md',
};

const FRAME_CLASSES = 'items-center justify-center overflow-hidden rounded-sm bg-surface-muted';

// a short cross-fade when the image arrives, in milliseconds
const TRANSITION_MS = 150;

export interface CoverImageProps {
  /**
   * the cover url of a catalog item, used exactly as given: it was checked against the provider's
   * image allowlist when the item was parsed. null shows a placeholder
   */
  url: string | null;
  /** md by default */
  size?: CoverSize;
  testID?: string;
}

/**
 * the cover of a title in a 2:3 frame, cached in memory and on disk. hidden from screen readers:
 * the text next to it names the title
 */
export function CoverImage({ url, size = 'md', testID }: CoverImageProps) {
  const colors = useThemeColors();

  return (
    <View
      className={cx(FRAME[size], FRAME_CLASSES)}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {url === null ? (
        <Ionicons
          name={COVER_PLACEHOLDER_GLYPH}
          size={ICON_SIZE}
          color={colors.textMuted}
          {...(testID !== undefined && { testID: `${testID}-placeholder` })}
        />
      ) : (
        <Image
          className="h-full w-full"
          source={{ uri: url }}
          cachePolicy="memory-disk"
          contentFit="cover"
          // a recycled list cell never shows the previous cover while the new one loads
          recyclingKey={url}
          transition={TRANSITION_MS}
          accessible={false}
          {...(testID !== undefined && { testID: `${testID}-image` })}
        />
      )}
    </View>
  );
}
