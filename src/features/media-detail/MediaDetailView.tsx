import type { MediaKey } from '@core/domain/media';
import { CatalogNetworkError, isCatalogNotFoundError } from '@core/errors/catalog-errors';
import { useMediaDetail } from '@core/hooks/use-media-detail';
import { useTranslation } from '@core/i18n/index';
import { usePreferences } from '@core/preferences/index';
import { EmptyState, ErrorState, Screen, Spinner, Stack, type ScreenEdge } from '@ui/index';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { LibrarySection } from './LibrarySection';
import { MediaDetailContent } from './MediaDetailContent';

// under the stack header: the top inset is the header's
export const MEDIA_DETAIL_EDGES: readonly ScreenEdge[] = ['bottom', 'left', 'right'];

/** the path of the discover tab, the way out of a link that leads nowhere */
export const DISCOVER_PATH = '/';

/** the path of the settings tab, where a hidden adult title can be shown (FR-32) */
export const SETTINGS_PATH = '/settings';

// every state of a valid link: end-to-end flows and route tests wait on it
const SCREEN_TEST_ID = 'media-detail-screen';

export interface MediaDetailViewProps {
  /** the parsed key of the media of the route */
  mediaKey: MediaKey;
}

/**
 * the details of the media `mediaKey`, in this order of precedence while nothing is cached: an
 * error (not found, offline or generic), replaced by the spinner while its retry runs, a spinner on
 * the first load. once data is cached, it is
 * shown even when a refetch fails, so a viewed title stays readable offline: hidden when it is
 * adult content and the setting is off (BR-06), nothing of it shown but a way to the settings
 * (FR-32), otherwise its details (FR-06)
 * with its library section (FR-10 to FR-13). the library is read only for a visible title
 */
export function MediaDetailView({ mediaKey }: MediaDetailViewProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { showAdult } = usePreferences();
  const { data, error, isFetching, refetch } = useMediaDetail(mediaKey, { showAdult });

  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  // navigation only: leaving a missing title writes nothing
  const goToDiscover = useCallback(() => {
    router.dismissTo(DISCOVER_PATH);
  }, [router]);
  // navigation only: the setting changes on the settings tab, after its confirmation
  const openSettings = useCallback(() => {
    router.navigate(SETTINGS_PATH);
  }, [router]);

  if (data === undefined) {
    // while the retry of an error runs, the spinner replaces it: a tap never restarts the request
    if (error !== null && !isFetching) {
      return (
        <Screen edges={MEDIA_DETAIL_EDGES} testID={SCREEN_TEST_ID}>
          {isCatalogNotFoundError(error) ? (
            <ErrorState
              title={t('mediaDetail.error.notFound.title')}
              message={t('mediaDetail.error.notFound.message')}
              retry={{ label: t('mediaDetail.error.notFound.action'), onPress: goToDiscover }}
              testID="media-detail-not-found"
            />
          ) : (
            <MediaDetailError offline={error instanceof CatalogNetworkError} onRetry={retry} />
          )}
        </Screen>
      );
    }
    return (
      <Screen edges={MEDIA_DETAIL_EDGES} testID={SCREEN_TEST_ID}>
        <Stack gap="none" align="center" justify="center" flex>
          <Spinner accessibilityLabel={t('mediaDetail.loading')} testID="media-detail-loading" />
        </Stack>
      </Screen>
    );
  }

  if (data.hidden) {
    return (
      <Screen edges={MEDIA_DETAIL_EDGES} testID={SCREEN_TEST_ID}>
        <EmptyState
          title={t('mediaDetail.hidden.title')}
          message={t('mediaDetail.hidden.message')}
          action={{ label: t('mediaDetail.hidden.action'), onPress: openSettings }}
          testID="media-detail-hidden"
        />
      </Screen>
    );
  }

  return (
    <Screen edges={MEDIA_DETAIL_EDGES} scroll testID={SCREEN_TEST_ID}>
      <MediaDetailContent
        media={data.media}
        library={<LibrarySection mediaKey={mediaKey} media={data.media} />}
      />
    </Screen>
  );
}

interface MediaDetailErrorProps {
  /** a network error: most likely the device being offline */
  offline: boolean;
  onRetry: () => void;
}

// a failure other than a missing title, with a retry
function MediaDetailError({ offline, onRetry }: MediaDetailErrorProps) {
  const { t } = useTranslation();
  return (
    <ErrorState
      title={offline ? t('mediaDetail.error.offline.title') : t('mediaDetail.error.generic.title')}
      message={
        offline ? t('mediaDetail.error.offline.message') : t('mediaDetail.error.generic.message')
      }
      retry={{ label: t('mediaDetail.error.retry'), onPress: onRetry }}
      testID="media-detail-error"
    />
  );
}
