import { useTranslation } from '@core/i18n/index';
import { Button, Chip, EmptyState, Row, Stack, Text } from '@ui/index';

export interface RecentSearchesListProps {
  /** prepared queries, newest first */
  searches: readonly string[];
  /** searches the entry again */
  onSelect: (query: string) => void;
  onClear: () => void;
}

/**
 * what the search screen shows before anything is typed: the recent searches (FR-02), each one a
 * button that searches it again, with an action that clears them all; a hint when there is none
 */
export function RecentSearchesList({ searches, onSelect, onClear }: RecentSearchesListProps) {
  const { t } = useTranslation();

  if (searches.length === 0) {
    return (
      <EmptyState
        title={t('search.idle.title')}
        message={t('search.idle.message')}
        testID="search-idle"
      />
    );
  }

  return (
    <Stack gap="sm" testID="search-recent">
      <Row gap="sm" justify="between">
        <Text variant="subtitle">{t('search.recent.title')}</Text>
        <Button
          label={t('search.recent.clear')}
          accessibilityLabel={t('search.recent.clearLabel')}
          variant="ghost"
          onPress={onClear}
          testID="search-recent-clear"
        />
      </Row>
      <Row gap="sm" wrap>
        {searches.map((query, index) => (
          <Chip
            // entries are unique ignoring case (src/core/domain/recent-searches.ts)
            key={query}
            label={query}
            onPress={() => {
              onSelect(query);
            }}
            testID={`search-recent-${String(index)}`}
          />
        ))}
      </Row>
    </Stack>
  );
}
