// a wrapper giving the library hooks a query client and a library repository, and catalog data
// of the media of ENTRY_KEY, for the library hook tests (src/core/hooks/)
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createFakeLibraryRepository, type FakeLibraryRepository } from './fake-library-repository';
import { ENTRY_KEY, SNAPSHOT, TITLE_TEXT } from './library-entry-fixtures';
import type { MediaSummary } from '@core/catalog/catalog-provider';
import type { LibraryEntry } from '@core/domain/library-entry';
import { createQueryClient } from '@core/query/query-client';
import type { LibraryRepository } from '@core/repositories/library-repository';
import { LibraryContextProvider } from '@core/hooks/LibraryContextProvider';
import { useLibraryEntry } from '@core/hooks/use-library-entry';
import { useLibraryEntryActions } from '@core/hooks/use-library-entry-actions';

/** the catalog data of the media of ENTRY_KEY, whose snapshot is SNAPSHOT */
export const MEDIA: MediaSummary = {
  key: ENTRY_KEY,
  title: TITLE_TEXT,
  titleEnglish: null,
  imageUrl: SNAPSHOT.imageUrl,
  format: SNAPSHOT.format,
  status: 'finished',
  totalUnits: SNAPSHOT.totalUnits,
  score: null,
  year: null,
  genres: [],
  isAdult: SNAPSHOT.isAdult,
};

/** a total that changed in the catalog since the snapshot was taken */
export const FRESH_TOTAL = 40;
export const FRESH_MEDIA: MediaSummary = { ...MEDIA, totalUnits: FRESH_TOTAL };

/** a media no snapshot can hold: a title is at least one character (the database limits) */
export const UNSTORABLE_MEDIA: MediaSummary = { ...MEDIA, title: '' };

export const libraryWrapper =
  (queryClient: QueryClient, repository: LibraryRepository) =>
  ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <LibraryContextProvider repository={repository}>{children}</LibraryContextProvider>
    </QueryClientProvider>
  );

export interface EntryHookProps {
  readonly media: MediaSummary | null;
}

/**
 * the entry of ENTRY_KEY and its actions, rendered over a fake repository holding `initial`,
 * with `media` as the catalog data (a prop, so a test can change it)
 */
export const renderLibraryEntry = (
  initial: readonly LibraryEntry[],
  media: MediaSummary | null = MEDIA,
) => {
  const queryClient = createQueryClient();
  const repository: FakeLibraryRepository = createFakeLibraryRepository(initial);
  const rendered = renderHook(
    (props: EntryHookProps) => ({
      entry: useLibraryEntry(ENTRY_KEY, props),
      actions: useLibraryEntryActions({ ...ENTRY_KEY }, props),
    }),
    { initialProps: { media }, wrapper: libraryWrapper(queryClient, repository) },
  );
  return { ...rendered, queryClient, repository };
};
