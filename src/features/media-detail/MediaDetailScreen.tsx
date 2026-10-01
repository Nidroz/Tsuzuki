import type { MediaKind } from '@core/domain/media';
import { useTranslation, type TranslationKey } from '@core/i18n/index';
import { parseMediaRouteParams } from '@core/schemas/media-route-params';
import { ErrorState, Screen, Text, type ScreenEdge } from '@ui/index';
import { useRouter } from 'expo-router';

// under the stack header: the top inset is the header's
const EDGES: readonly ScreenEdge[] = ['bottom', 'left', 'right'];

const DISCOVER_PATH = '/';

const KIND_KEYS = {
  anime: 'media.kind.anime',
  manga: 'media.kind.manga',
} as const satisfies Record<MediaKind, TranslationKey>;

export interface MediaDetailScreenProps {
  /** the raw route params, untrusted: they come from a deep link as well as from the app */
  params: unknown;
}

/**
 * the media detail screen of a `media/[kind]/[id]` route. a deep link never triggers a write: this
 * screen only reads its params, and calls no repository and no mutation
 */
export function MediaDetailScreen({ params }: MediaDetailScreenProps) {
  const { t } = useTranslation();
  const router = useRouter();
  // navigation only: leaving an invalid link writes nothing
  const goToDiscover = () => {
    router.dismissTo(DISCOVER_PATH);
  };
  const media = parseMediaRouteParams(params);

  if (media === null) {
    return (
      <Screen edges={EDGES} testID="media-detail-invalid">
        <ErrorState
          title={t('mediaDetail.invalidLink.title')}
          message={t('mediaDetail.invalidLink.message')}
          retry={{
            label: t('mediaDetail.invalidLink.action'),
            onPress: goToDiscover,
          }}
        />
      </Screen>
    );
  }

  // TODO(C-07): show the media details
  return (
    <Screen edges={EDGES} testID="media-detail-screen">
      <Text>
        {t('mediaDetail.placeholder', { kind: t(KIND_KEYS[media.kind]), id: media.malId })}
      </Text>
    </Screen>
  );
}
