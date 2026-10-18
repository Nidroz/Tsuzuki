import { useTranslation } from '@core/i18n/index';
import { parseMediaRouteParams } from '@core/schemas/media-route-params';
import { ErrorState, Screen } from '@ui/index';
import { useRouter } from 'expo-router';

import { DISCOVER_PATH, MEDIA_DETAIL_EDGES, MediaDetailView } from './MediaDetailView';

export interface MediaDetailScreenProps {
  /** the raw route params, untrusted: they come from a deep link as well as from the app */
  params: unknown;
}

/**
 * the media detail screen of a `media/[namespace]/[kind]/[id]` route, such as
 * `tsuzuki://media/mal/anime/52991`: the namespace says whose catalog ids the id is. a deep link
 * never triggers a write: this screen only reads its params and the catalog, and calls no
 * repository and no mutation
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
      <Screen edges={MEDIA_DETAIL_EDGES} testID="media-detail-invalid">
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

  return <MediaDetailView mediaKey={media} />;
}
