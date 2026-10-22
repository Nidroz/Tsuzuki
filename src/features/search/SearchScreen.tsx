import type { MediaSummary, SearchParams } from '@core/catalog/catalog-provider';
import type { MediaKind } from '@core/domain/media';
import {
  EMPTY_SEARCH_FILTERS,
  filtersForKind,
  hasActiveFilters,
  toSearchParams,
  withoutAdultGenres,
  type SearchFilters,
} from '@core/domain/search-filters';
import { prepareSearchQuery } from '@core/domain/search-query';
import { useCatalogProvider } from '@core/hooks/use-catalog-provider';
import { useDebouncedValue } from '@core/hooks/use-debounced-value';
import { useGenres } from '@core/hooks/use-genres';
import { useRecentSearches } from '@core/hooks/use-recent-searches';
import { SEARCH_DEBOUNCE_MS, useSearch } from '@core/hooks/use-search';
import { useTranslation } from '@core/i18n/index';
import { usePreferences } from '@core/preferences/index';
import { toMediaRouteParams } from '@core/schemas/media-route-params';
import { MediaPageList } from '@features/media-list/MediaPageList';
import { Input, Row, Screen, Stack, type ScreenEdge } from '@ui/index';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FiltersButton } from './FiltersButton';
import { FiltersSheet } from './FiltersSheet';
import { RecentSearchesList } from './RecentSearchesList';
import { SearchKindSwitch } from './SearchKindSwitch';

// under the navigator header and above the tab bar: only the sides need the safe area
const EDGES: readonly ScreenEdge[] = ['left', 'right'];

const DEFAULT_KIND: MediaKind = 'anime';
const FIRST_PAGE = 1;
const MEDIA_DETAIL_PATHNAME = '/media/[namespace]/[kind]/[id]';

/** the page requested, with the search it belongs to (null while there is nothing to search) */
interface RequestedPage {
  readonly search: string | null;
  readonly page: number;
}

const INITIAL_REQUESTED_PAGE: RequestedPage = { search: null, page: FIRST_PAGE };

const hasGenres = (filters: SearchFilters): boolean =>
  filters.genresIncluded.length > 0 || filters.genresExcluded.length > 0;

/**
 * the search screen (FR-01, FR-02, FR-03, FR-04, BR-06): a field, the kind and the filters, then
 * the recent searches while neither the field nor the filters hold anything to search, the results
 * and their pages otherwise. typing is debounced; a submitted or picked text is searched at once. a search is
 * recorded on submit and when a result is opened, never while typing, and only its text: a search
 * by filters alone is never recorded. while adult content is off, the adult genres of the applied
 * filters are left out of the search, the sheet and the filters count, and kept for when it is on
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
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_SEARCH_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const debouncedText = useDebouncedValue(text, SEARCH_DEBOUNCE_MS);
  const { showAdult } = usePreferences();

  // while adult content is off (BR-06), an adult genre applied while it was on is left out of
  // everything the filters decide; the state keeps it for when the setting is on again. the genre
  // names tell which ids are adult: fetched only then, so a search without genres asks for none.
  // until they load (or when they fail) the filters are used as they are: the adult results are
  // still hidden client-side (useSearch)
  const stripAdultGenres = !showAdult && hasGenres(filters);
  const { data: genres } = useGenres(kind, { enabled: stripAdultGenres });
  // the same object while nothing is left out: the search key and params stay stable
  const appliedFilters = useMemo(
    () =>
      stripAdultGenres && genres !== undefined ? withoutAdultGenres(filters, genres) : filters,
    [stripAdultGenres, genres, filters],
  );

  const query = prepareSearchQuery(text === committedText ? text : debouncedText, maxLength);
  const filtering = hasActiveFilters(appliedFilters);

  // the page belongs to the search it was requested in (FR-04): another kind, query or applied
  // filters start again at page 1. stored information from the previous render, adjusted while
  // rendering rather than in an effect, so no render ever pairs a new search with an old page
  const search =
    query === null && !filtering ? null : JSON.stringify([kind, query, appliedFilters]);
  const [requested, setRequested] = useState<RequestedPage>(INITIAL_REQUESTED_PAGE);
  if (requested.search !== search) {
    setRequested({ search, page: FIRST_PAGE });
  }
  const page = requested.search === search ? requested.page : FIRST_PAGE;
  const changePage = useCallback(
    (next: number) => {
      setRequested({ search, page: next });
    },
    [search],
  );

  const params = useMemo<SearchParams | null>(
    () => (search === null ? null : toSearchParams(kind, query, appliedFilters, page)),
    [search, kind, query, appliedFilters, page],
  );
  const {
    query: { data, error, isFetching, isPlaceholderData, refetch },
    isPlaceholderFromOtherList,
  } = useSearch(params, { showAdult });

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

  // the format and the genres belong to one kind: another kind clears them
  const changeKind = useCallback(
    (next: MediaKind) => {
      if (next !== kind) {
        setKind(next);
        setFilters(filtersForKind);
      }
    },
    [kind],
  );

  const openFilters = useCallback(() => {
    setFiltersOpen(true);
  }, []);
  const closeFilters = useCallback(() => {
    setFiltersOpen(false);
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

  // the raw text and the applied filters decide, without delay: a cleared field without filters
  // shows the recent searches at once, while the placeholder data would still hold the last results
  const hasSearch = prepareSearchQuery(text, maxLength) !== null || filtering;

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
        <Row gap="sm" justify="between" wrap>
          <SearchKindSwitch kind={kind} onChange={changeKind} />
          <FiltersButton filters={appliedFilters} onPress={openFilters} />
        </Row>
        {hasSearch ? (
          <MediaPageList
            page={data}
            error={error}
            isFetching={isFetching}
            isPlaceholderData={isPlaceholderData}
            isPlaceholderFromOtherList={isPlaceholderFromOtherList}
            onRetry={retry}
            onOpen={openResult}
            currentPage={page}
            onPageChange={changePage}
            scrollToTopKey={`${String(search)}#${String(page)}`}
            testIDPrefix="search"
            emptyTitle={t('search.results.empty.title')}
            emptyMessage={t('search.results.empty.message')}
          />
        ) : (
          <RecentSearchesList searches={searches} onSelect={searchAgain} onClear={clear} />
        )}
      </Stack>
      <FiltersSheet
        visible={filtersOpen}
        kind={kind}
        filters={appliedFilters}
        showAdult={showAdult}
        onApply={setFilters}
        onClose={closeFilters}
      />
    </Screen>
  );
}
