import type { MediaDetail } from '@core/catalog/catalog-provider';
import type { MediaKey } from '@core/domain/media';
import { LibrarySnapshotError } from '@core/errors/library-errors';
import { useLibraryEntry } from '@core/hooks/use-library-entry';
import { useLibraryEntryActions } from '@core/hooks/use-library-entry-actions';
import { useTranslation } from '@core/i18n/index';
import { Button, IconButton, InlineError, Row, Spinner, Stack, Text } from '@ui/index';
import { useCallback, type ReactNode } from 'react';

import { LibraryEntryPanel } from './LibraryEntryPanel';

const TEST_ID = 'media-detail-library';

export interface LibrarySectionProps {
  /** the key of the media of the route */
  mediaKey: MediaKey;
  /** its visible details (never a hidden adult title, BR-06): the snapshot an action writes */
  media: MediaDetail;
}

/**
 * the library section of the detail screen (FR-10 to FR-13, FR-15). while the entry loads, a
 * spinner; when it cannot be read, an error with a retry, or, for a media no snapshot can hold,
 * a message without one (a retry could not succeed); a media outside the library gets "Add to
 * library", an entry its panel. once the entry is read, the heading has the favorite toggle: on a
 * media outside the library it adds a planned favorite (BR-05). viewing only reads the library:
 * every write is a tap, and a failed write shows a translated message until it is dismissed or
 * the next action runs
 */
export function LibrarySection({ mediaKey, media }: LibrarySectionProps) {
  const { t } = useTranslation();
  const { data, error, isFetching, refetch } = useLibraryEntry(mediaKey, { media });
  const actions = useLibraryEntryActions(mediaKey, { media });

  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  let body: ReactNode;
  if (data === undefined) {
    // a media no snapshot can hold fails the read again on any retry: none is offered. while the
    // retry of another error runs, the spinner replaces it: a tap never restarts the read
    body =
      error instanceof LibrarySnapshotError ? (
        <InlineError
          message={t('mediaDetail.library.unsupported')}
          testID={`${TEST_ID}-unsupported`}
        />
      ) : error !== null && !isFetching ? (
        <InlineError
          message={t('mediaDetail.library.readError')}
          action={{ label: t('mediaDetail.library.retry'), onPress: retry }}
          testID={`${TEST_ID}-read-error`}
        />
      ) : (
        <Spinner
          size="small"
          accessibilityLabel={t('mediaDetail.library.loading')}
          testID={`${TEST_ID}-loading`}
        />
      );
  } else if (data === null) {
    body = (
      <Button
        label={t('mediaDetail.library.add')}
        onPress={actions.add}
        testID={`${TEST_ID}-add`}
      />
    );
  } else {
    body = <LibraryEntryPanel entry={data} kind={mediaKey.kind} actions={actions} />;
  }

  const isFavorite = data?.isFavorite === true;

  return (
    <Stack gap="md" testID={TEST_ID}>
      <Row gap="sm" justify="between">
        <Stack gap="none" flex>
          <Text variant="subtitle" heading>
            {t('mediaDetail.library.title')}
          </Text>
        </Stack>
        {data === undefined ? null : (
          <IconButton
            icon={isFavorite ? 'favorite' : 'favorite-outline'}
            accessibilityLabel={t(
              isFavorite
                ? 'mediaDetail.library.favorite.remove'
                : 'mediaDetail.library.favorite.add',
            )}
            onPress={actions.toggleFavorite}
            selected={isFavorite}
            testID={`${TEST_ID}-favorite`}
          />
        )}
      </Row>
      {actions.error === null ? null : (
        <InlineError
          message={t('mediaDetail.library.writeError')}
          action={{ label: t('mediaDetail.library.dismiss'), onPress: actions.dismissError }}
          testID={`${TEST_ID}-write-error`}
        />
      )}
      {body}
    </Stack>
  );
}
