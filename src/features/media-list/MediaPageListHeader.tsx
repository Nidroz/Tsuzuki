import { CatalogNetworkError } from '@core/errors/catalog-errors';
import { useTranslation } from '@core/i18n/index';
import { Button, Row, Spinner, Stack, Text, useAnnouncement } from '@ui/index';

/**
 * the announcement key of the stale note: the discover and search lists stay mounted together,
 * so two lists going stale at once (offline) announce it once
 */
export const STALE_NOTE_ANNOUNCE_KEY = 'media-list-stale-note';

/** a network error is most likely the device being offline */
export const isOffline = (error: Error): boolean => error instanceof CatalogNetworkError;

interface StaleNoteProps {
  /** the failed refetch of the page shown */
  error: Error;
  onRetry: () => void;
  testID: string;
}

// a component of its own: its text is announced while it shows only
function StaleNote({ error, onRetry, testID }: StaleNoteProps) {
  const { t } = useTranslation();
  const note = isOffline(error) ? t('mediaList.stale.offline') : t('mediaList.stale.generic');
  useAnnouncement(note, { key: STALE_NOTE_ANNOUNCE_KEY });
  return (
    <Row gap="sm" wrap testID={testID}>
      <Text variant="caption" tone="muted">
        {note}
      </Text>
      <Button label={t('mediaList.error.retry')} onPress={onRetry} variant="ghost" />
    </Row>
  );
}

interface MediaPageListHeaderProps {
  /** a placeholder is shown, or the retry of a failed refetch runs */
  updating: boolean;
  /** the failed refetch of the page shown, null when it is fresh or its retry runs */
  staleError: Error | null;
  hiddenCount: number;
  onRetry: () => void;
  testIDPrefix: string;
}

/**
 * the notes above the rows of MediaPageList: nothing when the page shown is fresh and complete.
 * the note of a failed refetch, with its retry, is announced when it shows
 */
export function MediaPageListHeader({
  updating,
  staleError,
  hiddenCount,
  onRetry,
  testIDPrefix,
}: MediaPageListHeaderProps) {
  const { t } = useTranslation();
  if (!updating && staleError === null && hiddenCount === 0) {
    return null;
  }
  return (
    <Stack gap="xs" align="start">
      {updating ? (
        <Spinner
          size="small"
          accessibilityLabel={t('mediaList.updating')}
          testID={`${testIDPrefix}-updating`}
        />
      ) : null}
      {staleError === null ? null : (
        <StaleNote error={staleError} onRetry={onRetry} testID={`${testIDPrefix}-stale-note`} />
      )}
      {hiddenCount > 0 ? (
        <Text variant="caption" tone="muted" testID={`${testIDPrefix}-hidden-note`}>
          {t('mediaList.hidden', { count: hiddenCount })}
        </Text>
      ) : null}
    </Stack>
  );
}
