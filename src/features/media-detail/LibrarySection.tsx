import type { MediaDetail } from '@core/catalog/catalog-provider';
import type { MediaKey } from '@core/domain/media';
import { useLibraryEntry } from '@core/hooks/use-library-entry';
import { useLibraryEntryActions } from '@core/hooks/use-library-entry-actions';
import { useTranslation } from '@core/i18n/index';
import { Button, InlineError, Spinner, Stack, Text } from '@ui/index';
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
 * the library section of the detail screen (FR-10 to FR-13). while the entry loads, a spinner;
 * when it cannot be read, an error with a retry; a media outside the library gets "Add to library",
 * an entry its panel. viewing only reads the library: every write is a tap, and a failed write
 * shows a translated message until it is dismissed or the next action runs
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
    // while the retry of an error runs, the spinner replaces it: a tap never restarts the read
    body =
      error !== null && !isFetching ? (
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

  return (
    <Stack gap="md" testID={TEST_ID}>
      <Text variant="subtitle" heading>
        {t('mediaDetail.library.title')}
      </Text>
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
