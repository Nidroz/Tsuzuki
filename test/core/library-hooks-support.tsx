// wrappers giving the library hooks a query client, a library repository and the reporter of the
// library actions, and catalog data of the media of ENTRY_KEY, for the library hook tests
// (src/core/hooks/); the session library lives in session-library-support.tsx
import { jest } from '@jest/globals';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { useMemo, type ReactNode } from 'react';

import { createFakeDevicePurgeMarkers } from './fake-device-purge-markers';
import { createFakeLibraryRepository, type FakeLibraryRepository } from './fake-library-repository';
import { ENTRY_KEY, SNAPSHOT, TITLE_TEXT } from './library-entry-fixtures';
import { createFakeCatalogProvider } from '@core/catalog/__fixtures__/fake-catalog-provider';
import type { MediaSummary } from '@core/catalog/catalog-provider';
import type { LibraryEntry } from '@core/domain/library-entry';
import type { ErrorReporter } from '@core/errors/error-reporter';
import { createQueryClient } from '@core/query/query-client';
import type { LibraryRepository } from '@core/repositories/library-repository';
import { CatalogContextProvider } from '@core/hooks/CatalogContextProvider';
import { DevicePurgeContext, type DevicePurgeValue } from '@core/hooks/device-purge-context';
import { guardDevicePurgeMarkers } from '@core/hooks/device-purge-markers';
import {
  LibraryContextProvider,
  type LibraryContextProviderProps,
} from '@core/hooks/LibraryContextProvider';
import { useLibraryEntry } from '@core/hooks/use-library-entry';
import { useLibraryEntryActions } from '@core/hooks/use-library-entry-actions';

// the tests that do not check the reports of the library actions: a report goes nowhere
const IGNORED_REPORTS: ErrorReporter = Object.freeze({ captureError: (): void => undefined });

const keepPersistedCache = (): void => undefined;
const keepGeneration = (): void => undefined;

export interface TestReporterContextProps {
  /** receives the reports of the library actions; by default they go nowhere */
  readonly reporter?: ErrorReporter;
  readonly children: ReactNode;
}

/**
 * the DevicePurgeContext the library actions report their programming errors through
 * (useLibraryEntryActions), as the composition root gives it: `reporter`, markers in memory, a
 * purge that never runs here
 */
export function TestReporterContext({
  reporter = IGNORED_REPORTS,
  children,
}: TestReporterContextProps) {
  const value = useMemo(
    (): DevicePurgeValue => ({
      removePersistedCache: keepPersistedCache,
      reporter,
      markers: guardDevicePurgeMarkers(createFakeDevicePurgeMarkers(), reporter),
      generation: 0,
      advanceGeneration: keepGeneration,
    }),
    [reporter],
  );
  return <DevicePurgeContext value={value}>{children}</DevicePurgeContext>;
}

/** a reporter whose `captureError` is a jest mock, for a test that checks the reports */
export const createRecordingReporter = () => {
  const captureError = jest.fn<ErrorReporter['captureError']>();
  return { reporter: { captureError } satisfies ErrorReporter, captureError };
};

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

/** the query client, the library over `repository` and `reporter` for the library actions */
export const libraryWrapper =
  (queryClient: QueryClient, repository: LibraryRepository, reporter?: ErrorReporter) =>
  ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TestReporterContext {...(reporter !== undefined && { reporter })}>
        <LibraryContextProvider repository={repository}>{children}</LibraryContextProvider>
      </TestReporterContext>
    </QueryClientProvider>
  );

type OnRetired = LibraryContextProviderProps['onRetired'];

/**
 * libraryWrapper whose repository a test switches, as the session library switch does (A-03):
 * `switchTo(next)` then a rerender gives the hooks a new repository, writer and cache scope;
 * `setOnRetired(next)` then a rerender gives the provider another `onRetired`. with a fake catalog
 * provider, for useLibraryList
 */
export const switchableLibraryWrapper = (
  queryClient: QueryClient,
  initial: LibraryRepository,
  onRetired?: OnRetired,
) => {
  const current: { repository: LibraryRepository; onRetired: OnRetired } = {
    repository: initial,
    onRetired,
  };
  const provider = createFakeCatalogProvider();
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <CatalogContextProvider provider={provider}>
        <TestReporterContext>
          <LibraryContextProvider
            repository={current.repository}
            {...(current.onRetired !== undefined && { onRetired: current.onRetired })}
          >
            {children}
          </LibraryContextProvider>
        </TestReporterContext>
      </CatalogContextProvider>
    </QueryClientProvider>
  );
  const switchTo = (next: LibraryRepository): void => {
    current.repository = next;
  };
  const setOnRetired = (next: OnRetired): void => {
    current.onRetired = next;
  };
  return { wrapper, switchTo, setOnRetired };
};

export interface EntryHookProps {
  readonly media: MediaSummary | null;
}

/**
 * the entry of ENTRY_KEY and its actions, rendered over a fake repository holding `initial`,
 * with `media` as the catalog data (a prop, so a test can change it); the reports of the actions
 * reach `captureError`
 */
export const renderLibraryEntry = (
  initial: readonly LibraryEntry[],
  media: MediaSummary | null = MEDIA,
) => {
  const queryClient = createQueryClient();
  const repository: FakeLibraryRepository = createFakeLibraryRepository(initial);
  const { reporter, captureError } = createRecordingReporter();
  const rendered = renderHook(
    (props: EntryHookProps) => ({
      entry: useLibraryEntry(ENTRY_KEY, props),
      actions: useLibraryEntryActions({ ...ENTRY_KEY }, props),
    }),
    { initialProps: { media }, wrapper: libraryWrapper(queryClient, repository, reporter) },
  );
  return { ...rendered, queryClient, repository, captureError };
};
