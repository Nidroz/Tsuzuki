import { DEFAULT_SHOW_ADULT } from '@core/domain/content-filter';
import { DEFAULT_LIBRARY_VIEW, type LibraryViewOptions } from '@core/domain/library-view';
import type { MediaKey } from '@core/domain/media';
import { useLibraryList } from '@core/hooks/use-library-list';
import { useTranslation } from '@core/i18n/index';
import { toMediaRouteParams } from '@core/schemas/media-route-params';
import { EmptyState, ErrorState, Screen, Spinner, Stack, type ScreenEdge } from '@ui/index';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, type ReactElement } from 'react';

import { LibraryList } from './LibraryList';

// under the navigator header and above the tab bar: only the sides need the safe area
const EDGES: readonly ScreenEdge[] = ['left', 'right'];

const MEDIA_DETAIL_PATHNAME = '/media/[namespace]/[kind]/[id]';
const SEARCH_PATHNAME = '/search';

// the layout key of the first focus; each focus adds one
const FIRST_LAYOUT_KEY = 0;

// TODO(L-06): read the adult content setting
const SHOW_ADULT = DEFAULT_SHOW_ADULT;

/** the testIDs of the states: `library-loading`, `library-error`, `library-empty` */
const TEST_ID = 'library';

// the filters are the default ones: a reset would change nothing
const hasDefaultFilters = (options: LibraryViewOptions): boolean =>
  options.kind === DEFAULT_LIBRARY_VIEW.kind && options.status === DEFAULT_LIBRARY_VIEW.status;

/**
 * the library screen (FR-14, FR-12, BR-06): the entries grouped by status, filtered by kind and
 * status and sorted, each with its `+1` button. without data, a spinner on the first load or an
 * error with a retry; an empty library says how to add titles. a failed refetch keeps the rows.
 * the options are kept while the tabs stay mounted, never persisted. a row acted on keeps its
 * place (useLibraryList): the list is laid out again on an option change or when the screen gains
 * focus (a tab switch, back from the detail)
 */
export function LibraryScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [options, setOptions] = useState<LibraryViewOptions>(DEFAULT_LIBRARY_VIEW);
  const [layoutKey, setLayoutKey] = useState(FIRST_LAYOUT_KEY);
  // stable: useFocusEffect reruns a new callback, which would lay the list out on every render
  const layOutAgain = useCallback(() => {
    setLayoutKey((key) => key + 1);
  }, []);
  useFocusEffect(layOutAgain);
  const {
    query: { error, isFetching, refetch },
    view,
  } = useLibraryList(options, { showAdult: SHOW_ADULT, layoutKey });

  const retry = useCallback(() => {
    // a retry tap while the read runs never restarts it
    void refetch({ cancelRefetch: false });
  }, [refetch]);
  const open = useCallback(
    (key: MediaKey) => {
      // spread: expo-router takes a record of params, which an interface type is not
      router.push({ pathname: MEDIA_DETAIL_PATHNAME, params: { ...toMediaRouteParams(key) } });
    },
    [router],
  );
  const openSearch = useCallback(() => {
    router.navigate(SEARCH_PATHNAME);
  }, [router]);
  // the sort is kept: only the filters hid the entries
  const resetFilters = useCallback(() => {
    setOptions((current) => ({ ...DEFAULT_LIBRARY_VIEW, sort: current.sort }));
  }, []);

  let content: ReactElement;
  if (view === undefined) {
    // while the retry of an error runs, the spinner replaces it
    content =
      error !== null && !isFetching ? (
        <ErrorState
          title={t('library.list.error.title')}
          message={t('library.list.error.message')}
          retry={{ label: t('library.list.error.retry'), onPress: retry }}
          testID={`${TEST_ID}-error`}
        />
      ) : (
        <Stack gap="none" align="center" justify="center" flex>
          <Spinner accessibilityLabel={t('library.list.loading')} testID={`${TEST_ID}-loading`} />
        </Stack>
      );
  } else if (view.totalCount === 0) {
    content = (
      <EmptyState
        title={t('library.list.empty.title')}
        message={t('library.list.empty.message')}
        action={{ label: t('library.list.empty.action'), onPress: openSearch }}
        testID={`${TEST_ID}-empty`}
      />
    );
  } else {
    content = (
      <LibraryList
        view={view}
        options={options}
        onOptionsChange={setOptions}
        onResetFilters={hasDefaultFilters(options) ? null : resetFilters}
        onOpen={open}
      />
    );
  }

  return (
    <Screen edges={EDGES} testID="library-screen">
      {content}
    </Screen>
  );
}
