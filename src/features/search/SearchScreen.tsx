import type { MediaSummary, SearchParams } from '@core/catalog/catalog-provider';
import { DEFAULT_SHOW_ADULT } from '@core/domain/content-filter';
import type { MediaKind } from '@core/domain/media';
import { prepareSearchQuery } from '@core/domain/search-query';
import { useCatalogProvider } from '@core/hooks/use-catalog-provider';
import { useDebouncedValue } from '@core/hooks/use-debounced-value';
import { useRecentSearches } from '@core/hooks/use-recent-searches';
import { SEARCH_DEBOUNCE_MS, useSearch } from '@core/hooks/use-search';
import { useTranslation } from '@core/i18n/index';
import { toMediaRouteParams } from '@core/schemas/media-route-params';
import { Input, Screen, Stack, type ScreenEdge } from '@ui/index';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { RecentSearchesList } from './RecentSearchesList';
import { SearchKindSwitch } from './SearchKindSwitch';
import { SearchResults } from './SearchResults';

// under the navigator header and above the tab bar: only the sides need the safe area
const EDGES: readonly ScreenEdge[] = ['left', 'right'];

const DEFAULT_KIND: MediaKind = 'anime';
// pagination is C-06
const FIRST_PAGE = 1;
const MEDIA_DETAIL_PATHNAME = '/media/[namespace]/[kind]/[id]';

/**
 * the search screen (FR-01, FR-02, BR-06): a field, the kind, then the recent searches while the
 * field holds nothing to search, the results otherwise. typing is debounced; a submitted or picked
 * text is searched at once. a search is recorded on submit and when a result is opened, never
 * while typing
 */
export function SearchScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { searchQueryMaxLength: maxLength } = useCatalogProvider();
  const { searches, add, clear } = useRecentSearches();
  const [text, setText] = useState('');
  // the text last submitted or picked from the recent searches: searched without the debounce
  const [committedText, setCommittedText] = useState<string | null>(null);
  const [kind, setKind] = useState<MediaKind>(DEFAULT_KIND);
  const debouncedText = useDebouncedValue(text, SEARCH_DEBOUNCE_MS);

  const query = prepareSearchQuery(text === committedText ? text : debouncedText, maxLength);
  const params = useMemo<SearchParams | null>(
    () => (query === null ? null : { kind, query, page: FIRST_PAGE }),
    [kind, query],
  );
  // TODO(L-06): read the adult content setting
  const { data, error, isPlaceholderData, refetch } = useSearch(params, {
    showAdult: DEFAULT_SHOW_ADULT,
  });

  // the query of the results on screen: while a new search loads, the previous results stay shown
  const shownQueryRef = useRef<string | null>(null);
  useEffect(() => {
    if (data !== undefined && !isPlaceholderData) {
      shownQueryRef.current = query;
    }
  }, [data, isPlaceholderData, query]);

  const submit = useCallback(() => {
    const submitted = prepareSearchQuery(text, maxLength);
    if (submitted !== null) {
      setCommittedText(text);
      add(submitted);
    }
  }, [text, maxLength, add]);

  const searchAgain = useCallback((entry: string) => {
    setText(entry);
    setCommittedText(entry);
  }, []);

  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const openResult = useCallback(
    (item: MediaSummary) => {
      if (shownQueryRef.current !== null) {
        add(shownQueryRef.current);
      }
      // spread: expo-router takes a record of params, which an interface type is not
      router.push({ pathname: MEDIA_DETAIL_PATHNAME, params: { ...toMediaRouteParams(item.key) } });
    },
    [add, router],
  );

  // the raw text decides, without delay: a cleared field shows the recent searches at once, while
  // the placeholder data would still hold the last results
  const hasQuery = prepareSearchQuery(text, maxLength) !== null;

  return (
    <Screen edges={EDGES} testID="search-screen">
      <Stack gap="md" flex>
        <Input
          label={t('search.field.label')}
          placeholder={t('search.field.placeholder')}
          value={text}
          onChangeText={setText}
          onSubmitEditing={submit}
          returnKeyType="search"
          maxLength={maxLength}
          autoCorrect={false}
          testID="search-input"
        />
        <SearchKindSwitch kind={kind} onChange={setKind} />
        {hasQuery ? (
          <SearchResults
            page={data}
            error={error}
            isPlaceholderData={isPlaceholderData}
            onRetry={retry}
            onOpen={openResult}
          />
        ) : (
          <RecentSearchesList searches={searches} onSelect={searchAgain} onClear={clear} />
        )}
      </Stack>
    </Screen>
  );
}
