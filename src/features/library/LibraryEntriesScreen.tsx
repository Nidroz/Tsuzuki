import { DEFAULT_LIBRARY_VIEW, type LibraryViewOptions } from '@core/domain/library-view';
import type { MediaKey } from '@core/domain/media';
import { useGuestMerge } from '@core/hooks/use-guest-merge';
import { useLibraryList } from '@core/hooks/use-library-list';
import { useTranslation } from '@core/i18n/index';
import { usePreferences } from '@core/preferences/index';
import { toMediaRouteParams } from '@core/schemas/media-route-params';
import {
  EmptyState,
  ErrorState,
  InlineError,
  Screen,
  Spinner,
  Stack,
  Text,
  type ScreenEdge,
} from '@ui/index';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState, type ReactElement } from 'react';

import { LibraryList } from './LibraryList';

// under the navigator header and above the tab bar: only the sides need the safe area
const EDGES: readonly ScreenEdge[] = ['left', 'right'];

const MEDIA_DETAIL_PATHNAME = '/media/[namespace]/[kind]/[id]';
const SEARCH_PATHNAME = '/search';

// the layout key of the first focus; each focus adds one
const FIRST_LAYOUT_KEY = 0;

/** the translated texts of the empty state: nothing to list yet */
export interface LibraryEntriesEmptyTexts {
  title: string;
  message: string;
  /** the label of its action, which opens Search */
  action: string;
}

export interface LibraryEntriesScreenProps {
  /** lists the favorites only (the favorites screen, FR-15) */
  favoritesOnly: boolean;
  /**
   * the testID prefix: the screen is `<testID>-screen`, its states `-loading`, `-error`,
   * `-empty`, `-merging`, its list `-list`, its filters `-filters` and the guest merge failure
   * `-merge-error` (its action `-merge-error-action`)
   */
  testID: string;
  empty: LibraryEntriesEmptyTexts;
}

// the filters are the default ones: a reset would change nothing
const hasDefaultFilters = (options: LibraryViewOptions): boolean =>
  options.kind === DEFAULT_LIBRARY_VIEW.kind && options.status === DEFAULT_LIBRARY_VIEW.status;

/**
 * a screen of library entries (FR-14, FR-15, FR-12, BR-06): the library, or its favorites only,
 * grouped by status, filtered by kind and status and sorted, each row with its heart and `+1`
 * button. without data, a spinner on the first load or an error with a retry; nothing to list
 * shows `empty`, with a Search action. a failed refetch keeps the rows. the options are kept while
 * the tabs stay mounted, never persisted. a row acted on keeps its place (useLibraryList), an
 * entry unfavorited from the favorites included: the list is laid out again on an option change
 * or when the screen gains focus (a tab switch, back from the detail). while the guest library is
 * merged into the account (ADR-0016), a labelled spinner says so instead; after a failed merge, an
 * error with a retry stays above the account library
 */
export function LibraryEntriesScreen({ favoritesOnly, testID, empty }: LibraryEntriesScreenProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { showAdult } = usePreferences();
  const merge = useGuestMerge();
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
  } = useLibraryList(options, { showAdult, layoutKey, favoritesOnly });

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
  if (merge.status === 'merging') {
    // the library is the pending one meanwhile: no list to show, no write possible
    content = (
      <Stack gap="md" align="center" justify="center" flex>
        <Spinner accessibilityLabel={t('library.merge.inProgress')} testID={`${testID}-merging`} />
        <Text align="center">{t('library.merge.inProgress')}</Text>
      </Stack>
    );
  } else if (view === undefined) {
    // while the retry of an error runs, the spinner replaces it
    content =
      error !== null && !isFetching ? (
        <ErrorState
          title={t('library.list.error.title')}
          message={t('library.list.error.message')}
          retry={{ label: t('library.list.error.retry'), onPress: retry }}
          testID={`${testID}-error`}
        />
      ) : (
        <Stack gap="none" align="center" justify="center" flex>
          <Spinner accessibilityLabel={t('library.list.loading')} testID={`${testID}-loading`} />
        </Stack>
      );
  } else if (view.totalCount === 0 && view.visibleCount === 0) {
    // a row kept by the layout (the last favorite just unfavorited) stays until the next focus
    content = (
      <EmptyState
        title={empty.title}
        message={empty.message}
        action={{ label: empty.action, onPress: openSearch }}
        testID={`${testID}-empty`}
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
        testID={`${testID}-list`}
        filtersTestID={`${testID}-filters`}
      />
    );
  }

  return (
    <Screen edges={EDGES} testID={`${testID}-screen`}>
      <Stack gap="md" flex>
        {merge.status === 'failed' ? (
          <InlineError
            message={t('library.merge.failed')}
            action={{ label: t('library.merge.retry'), onPress: merge.retry }}
            testID={`${testID}-merge-error`}
          />
        ) : null}
        {content}
      </Stack>
    </Screen>
  );
}
